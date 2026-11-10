import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'

/**
 * Le patron crée une boutique depuis son écran : le compte de connexion, la fiche
 * `stores/{id}` et le profil `store_admin`, en un geste. Jusqu'ici il fallait
 * passer par la console Firebase, Authentication puis Firestore, à la main.
 *
 * ⚠ LE NAVIGATEUR NE PEUT PAS LE FAIRE LUI-MÊME. Créer le compte de connexion
 *   d'un TIERS demande l'Admin SDK ; et les règles refusent `stores.create` et
 *   `users.create` depuis la fermeture de l'inscription libre (audit SEC-02,
 *   `profileAllowsSelfRegistration`). Cette callable est la seule porte, et seul
 *   le patron la franchit.
 *
 * ⚠ C'EST LA SEULE ÉCRITURE DE L'ESPACE DU PATRON, décidée le 2026-11-10. Le
 *   reste de son espace est en lecture seule : le garde ci-dessous est local, et
 *   n'ouvre rien d'autre.
 *
 * ⚠ LE MOT DE PASSE NE QUITTE JAMAIS CETTE FONCTION : ni écrit en base, ni
 *   journalisé, ni renvoyé. `wrapCallable` ne journalise que des erreurs
 *   assainies, jamais `request.data`.
 */

const NOM_MIN = 2
const NOM_MAX = 80
const EMAIL_MAX = 254
const MOT_DE_PASSE_MIN = 8
const MOT_DE_PASSE_MAX = 128

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const validateCallerProfile = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (profile.role !== 'system_manager') {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée au gérant du réseau.')
  }
}

export function lireNom(valeur) {
  const nom = typeof valeur === 'string' ? valeur.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  if (nom.length < NOM_MIN || nom.length > NOM_MAX || /\p{Cc}/u.test(nom)) {
    throw new DealerRequestError('INVALID_STORE_NAME', `Nom de boutique : ${NOM_MIN} à ${NOM_MAX} caractères.`)
  }
  return nom
}

export function lireEmail(valeur) {
  const email = typeof valeur === 'string' ? valeur.trim().toLowerCase() : ''
  if (email.length > EMAIL_MAX || !EMAIL.test(email)) {
    throw new DealerRequestError('INVALID_EMAIL', 'Adresse e-mail invalide.')
  }
  return email
}

// Pas de `trim` : un espace en tête ou en fin se perd quand le mot de passe est
// recopié dans un message. On le refuse plutôt que de l'enlever en silence.
export function lireMotDePasse(valeur) {
  if (
    typeof valeur !== 'string'
    || valeur.length < MOT_DE_PASSE_MIN
    || valeur.length > MOT_DE_PASSE_MAX
    || valeur !== valeur.trim()
  ) {
    throw new DealerRequestError(
      'INVALID_PASSWORD',
      `Mot de passe : ${MOT_DE_PASSE_MIN} caractères au moins, sans espace au début ni à la fin.`,
    )
  }
  return valeur
}

/** Deux noms qui ne diffèrent que par la casse, les accents ou les espaces sont le même nom. */
export const cleNom = (nom) => String(nom ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/** Même forme que l'ancienne inscription (`AuthContext.jsx`, `createStoreId`). */
export function identifiantBoutique(nom, uid) {
  const slug = cleNom(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'boutique'}-${uid.slice(0, 6)}`
}

async function compteExistant(auth, email) {
  try {
    return await auth.getUserByEmail(email)
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return null
    throw err
  }
}

/**
 * ⚠ UN SECOND CLIC N'EST PAS UNE ERREUR. Si la réponse se perd en route (coupure
 *   pendant l'appel), le patron reclique : la boutique existe déjà, avec ce nom
 *   et cet e-mail. On la lui rend au lieu d'un « e-mail déjà utilisé » qui lui
 *   ferait croire à un échec. Un e-mail porté par un AUTRE compte reste refusé.
 */
async function reprendre(db, compte, nom, email) {
  const profil = (await db.doc(`users/${compte.uid}`).get()).data()
  const storeId = profil?.storeId
  if (profil?.role === 'store_admin' && typeof storeId === 'string' && cleNom(profil.storeName) === cleNom(nom)) {
    const boutique = await db.doc(`stores/${storeId}`).get()
    if (boutique.exists && boutique.data()?.adminUid === compte.uid) {
      return { success: true, storeId, uid: compte.uid, nom: boutique.data().name, email, dejaCreee: true }
    }
  }
  throw new DealerRequestError('EMAIL_ALREADY_USED', 'Cet e-mail sert déjà à un autre compte.')
}

function erreurDeCreation(err) {
  if (err?.code === 'auth/email-already-exists') {
    return new DealerRequestError('EMAIL_ALREADY_USED', 'Cet e-mail sert déjà à un autre compte.')
  }
  if (err?.code === 'auth/invalid-email') return new DealerRequestError('INVALID_EMAIL', 'Adresse e-mail invalide.')
  if (err?.code === 'auth/invalid-password') {
    return new DealerRequestError('INVALID_PASSWORD', 'Mot de passe refusé par le service de connexion.')
  }
  return err
}

export async function creerBoutiqueHandler(request, { db, FieldValue, auth }) {
  const actorUid = validateAuthUid(request.auth?.uid)
  const data = request.data ?? {}
  validateInputPayload(data, ['nom', 'email', 'motDePasse'])
  const nom = lireNom(data.nom)
  const email = lireEmail(data.email)
  const motDePasse = lireMotDePasse(data.motDePasse)

  await readValidatedProfile(db, actorUid, validateCallerProfile)

  const existant = await compteExistant(auth, email)
  if (existant) return reprendre(db, existant, nom, email)

  // ~84 lectures, une création de temps en temps : rien à côté du quota. Une
  // requête `name ==` coûterait moins, mais laisserait passer « c2egf ouaga »
  // à côté de « C2EGF OUAGA ».
  const actives = await db.collection('stores').where('active', '==', true).get()
  if (actives.docs.some((d) => cleNom(d.data()?.name) === cleNom(nom))) {
    throw new DealerRequestError('STORE_NAME_TAKEN', 'Une boutique active porte déjà ce nom.')
  }

  let compte
  try {
    compte = await auth.createUser({ email, password: motDePasse, displayName: nom, emailVerified: false, disabled: false })
  } catch (err) {
    throw erreurDeCreation(err)
  }

  // Les champs de l'ancienne inscription et de `scripts/seedStores.mjs`, plus
  // `createdBy`. Les soldes réseau ne sont PAS créés ici : comme avant, la
  // boutique les initialise à sa première connexion (`ensureNetworkBalances`).
  const storeId = identifiantBoutique(nom, compte.uid)
  const maintenant = FieldValue.serverTimestamp()
  const lot = db.batch()
  lot.create(db.doc(`stores/${storeId}`), {
    name: nom, email, active: true, adminUid: compte.uid,
    createdBy: actorUid, createdAt: maintenant, updatedAt: maintenant,
  })
  lot.create(db.doc(`users/${compte.uid}`), {
    name: nom, email, role: 'store_admin', active: true, storeId, storeName: nom,
    createdBy: actorUid, createdAt: maintenant, updatedAt: maintenant,
  })
  try {
    await lot.commit()
  } catch (err) {
    // Sans fiche ni profil, le compte ne donne accès à rien ; on le retire pour
    // que l'e-mail reste libre au prochain essai.
    await auth.deleteUser(compte.uid).catch(() => {})
    throw err
  }

  return { success: true, storeId, uid: compte.uid, nom, email, dejaCreee: false }
}
