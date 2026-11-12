/**
 * pointEntreeOxygen.js — le point d'entrée privé, appelé par le serveur Oxygen.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.2.
 *
 * QUI L'APPELLE
 * ─────────────
 * Le serveur Oxygen (une fonction Supabase), jamais un téléphone. Il présente un
 * jeton d'identité Google émis pour un compte de service DÉDIÉ, qui n'a aucun
 * rôle sur le projet sauf le droit d'appeler ce seul service (`invokerOxygen`).
 * Une requête sans ce jeton est refusée par Google AVANT d'atteindre ce code :
 * aucune instance ne démarre, aucune lecture n'est facturée.
 *
 * Ce module fait donc confiance au `compteOxygen` reçu : c'est le serveur Oxygen
 * qui a vérifié le code secret de l'agent. Il ne connaît ni code secret, ni
 * numéro de téléphone, ni appareil.
 *
 * LA FORME DES RÉPONSES, FIGÉE DES DEUX CÔTÉS
 * ───────────────────────────────────────────
 *   • un refus MÉTIER arrive toujours en 200 (`{ ok: false, raison }`) ;
 *   • tout le reste est une panne : 400 pour une demande mal formée, 403 si le
 *     profil a fermé la liaison, 500 pour l'imprévu. Oxygen dit alors
 *     « distributeur injoignable », JAMAIS « absent » — une panne prise pour une
 *     absence ferait croire à un agent qu'il n'existe pas chez nous.
 *
 * ⚠ AUCUNE LECTURE SANS BORNE. Chaque action coûte quelques lectures, et
 *   l'activité se lit par pages de 50 (docs/rester-dans-le-quota-gratuit.md).
 */

import { ligneDeDocument } from '../clients/historiqueClient.js'
import {
  COLLECTION_CODES,
  COLLECTION_JOURNAL,
  COLLECTION_LIAISONS,
  OXYGEN_DU_PROFIL,
} from './genererCodeLiaison.js'
import { cleVerrou, dansLesPeriodes, enMs, hacherCode, verifierCode } from './liaison.js'

/** Le compte de service qui appelle, créé dans CE projet (docs/deployer-les-functions.md §8). */
export const COMPTE_APPELANT = 'oxygen-appel'

/**
 * Qui a le droit d'appeler : le compte de service dédié du projet déployé.
 *
 * ⚠ SANS PROJET CONNU, « private », JAMAIS « public ». Le projet se lit dans
 *   l'environnement que le CLI fournit au chargement ; s'il manquait, mieux vaut
 *   un service que personne ne peut appeler qu'un service ouvert à tous.
 */
export function invokerOxygen(env = process.env) {
  let projet = env.GCLOUD_PROJECT
  if (!projet && env.FIREBASE_CONFIG) {
    try { projet = JSON.parse(env.FIREBASE_CONFIG).projectId } catch { projet = null }
  }
  return typeof projet === 'string' && /^[a-z][a-z0-9-]{4,29}$/.test(projet)
    ? [`${COMPTE_APPELANT}@${projet}.iam.gserviceaccount.com`]
    : ['private']
}

/** Une page d'activité (contrat §5.2, « pages de 50 »). */
export const PAGE_ACTIVITE = 50

/**
 * Le recouvrement d'une synchronisation à la suivante.
 *
 * `updatedAt` est l'heure de VALIDATION d'une écriture. Une transaction lancée
 * juste avant notre lecture peut valider juste après avec une heure un peu plus
 * ancienne que notre départ : repartir deux minutes plus tôt la rattrape. Le prix
 * est de relire ce qui a bougé dans ces deux minutes — quelques lignes.
 */
export const MARGE_SYNCHRO_MS = 2 * 60 * 1000

/** Les trois champs où vit un identifiant agent, comme `_refuserDoublonAgent`. */
const CHAMPS_IDENTIFIANT = Object.freeze(['codeAgent', 'numeroAgent', 'orange'])

/** Au-delà, ce n'est plus un doublon mais une donnée à corriger. Une borne de lecture. */
const MAX_FICHES = 10

const FORMAT_IDENTIFIANT = /^\d{4,15}$/
const FORMAT_CODE = /^\d{6}$/
const FORMAT_COMPTE = /^[A-Za-z0-9_.:-]{1,128}$/
const FORMAT_LIAISON = /^[A-Za-z0-9]{1,128}$/
const FORMAT_CHEMIN = /^clients\/[^/]+\/history\/[^/]+$/

/** Parmi plusieurs refus (fiches jumelles), le plus informatif. */
const PRIORITE_REFUS = Object.freeze(['code_deja_utilise', 'code_expire', 'code_annule', 'code_incorrect'])

class DemandeInvalide extends Error {}

const invalide = (message) => { throw new DemandeInvalide(message) }
const repondre = (corps, statut = 200) => ({ statut, corps })
const fermee = () => repondre({ erreur: 'La liaison Oxygen est fermée chez ce distributeur.' }, 403)

const estObjetSimple = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/** Liste blanche des clés, comme `validateInputPayload` : rien d'imprévu n'entre. */
function validerCles(objet, cles) {
  const permises = new Set(cles)
  const propres = Reflect.ownKeys(objet)
  if (propres.some((k) => typeof k !== 'string' || !permises.has(k))) invalide('Champ non autorisé.')
}

const valider = (valeur, format, message) =>
  (typeof valeur === 'string' && format.test(valeur) ? valeur : invalide(message))

function validerDistributeur(corps, oxygen) {
  if (corps.distributeurId !== oxygen.distributeurId) invalide('Distributeur inconnu.')
}

const estInstant = (v) => Number.isSafeInteger(v) && v >= 0

function validerPosition(apres) {
  if (!estObjetSimple(apres)) invalide('Curseur invalide.')
  validerCles(apres, ['s', 'n', 'chemin'])
  const { s, n, chemin } = apres
  if (!Number.isSafeInteger(s) || !Number.isInteger(n) || n < 0 || n > 999_999_999) invalide('Curseur invalide.')
  valider(chemin, FORMAT_CHEMIN, 'Curseur invalide.')
  return { s, n, chemin }
}

/**
 * Le curseur d'activité, ou `null` pour un premier remplissage.
 *
 *   { mode: 'creation', synchroDepuisMs, apres }  — la suite du premier remplissage
 *   { mode: 'modification', depuisMs, apres? }    — la synchronisation
 *
 * ⚠ LA POSITION PORTE SECONDES ET NANOSECONDES. Un curseur en millisecondes
 *   perdrait les lignes de la même milliseconde aux nanosecondes inférieures,
 *   sans erreur (mesuré pour `listClientHistory`). Le chemin départage les ex
 *   æquo, et sert de curseur sans relire le document — qui peut avoir disparu.
 */
function validerCurseurActivite(curseur) {
  if (curseur === undefined || curseur === null) return null
  if (!estObjetSimple(curseur)) invalide('Curseur invalide.')
  if (curseur.mode === 'creation') {
    validerCles(curseur, ['mode', 'synchroDepuisMs', 'apres'])
    if (!estInstant(curseur.synchroDepuisMs)) invalide('Curseur invalide.')
    return { mode: 'creation', synchroDepuisMs: curseur.synchroDepuisMs, apres: validerPosition(curseur.apres) }
  }
  if (curseur.mode === 'modification') {
    validerCles(curseur, ['mode', 'depuisMs', 'apres'])
    if (!estInstant(curseur.depuisMs)) invalide('Curseur invalide.')
    return {
      mode: 'modification',
      depuisMs: curseur.depuisMs,
      apres: curseur.apres === undefined ? null : validerPosition(curseur.apres),
    }
  }
  return invalide('Curseur invalide.')
}

// ─── Les fiches et les codes ──────────────────────────────────────────────────

/** Les fiches qui portent cet identifiant, dans l'un des trois champs. */
async function fichesPortant(t, db, identifiant) {
  const snaps = await Promise.all(CHAMPS_IDENTIFIANT.map((champ) =>
    t.get(db.collection('globalClients').where(champ, '==', identifiant).limit(MAX_FICHES))))
  const parId = new Map()
  for (const snap of snaps) for (const doc of snap.docs) parId.set(doc.id, doc)
  return [...parId.values()]
}

/** Ce que vaut le code saisi pour chacune de ces fiches. */
async function deciderCodes(t, db, clientIds, { code, compteOxygen, objet, maintenantMs }) {
  if (clientIds.length === 0) return []
  const refs = clientIds.map((id) => db.doc(`${COLLECTION_CODES}/${id}`))
  const snaps = await t.getAll(...refs)
  return snaps.map((snap, i) => {
    const donnees = snap.exists ? snap.data() : null
    return {
      clientId: clientIds[i],
      ref: refs[i],
      donnees,
      decision: verifierCode(donnees, { empreinte: hacherCode(clientIds[i], code), compteOxygen, objet, maintenantMs }),
    }
  })
}

const auteurDuCode = (donnees) => ({
  storeId: donnees?.storeId ?? '', storeName: donnees?.storeName ?? '', uid: donnees?.uid ?? '',
})

/**
 * Écrit ce qu'un refus doit laisser (un échec de plus, l'annulation au
 * cinquième) et rend la raison à donner.
 */
function enregistrerRefus(t, db, decisions, heure) {
  for (const { clientId, ref, donnees, decision } of decisions) {
    if (!decision.echecs) continue
    t.update(ref, { echecs: decision.echecs })
    if (decision.epuise) {
      t.set(db.collection(COLLECTION_JOURNAL).doc(), { issue: 'essais_epuises', clientId, ...auteurDuCode(donnees), heure })
    }
  }
  const raisons = new Set(decisions.map((d) => d.decision.refus))
  return PRIORITE_REFUS.find((r) => raisons.has(r)) ?? 'code_incorrect'
}

const retenue = (decisions) => decisions.find((d) => d.decision.accepte || d.decision.rejoue)

// ─── Les actions ──────────────────────────────────────────────────────────────

/** Rend le distributeur si une fiche porte l'identifiant. Rien d'autre. */
async function rechercher(corps, { db, oxygen }) {
  validerCles(corps, ['action', 'identifiant'])
  const identifiant = valider(corps.identifiant, FORMAT_IDENTIFIANT, 'Identifiant invalide.')
  if (!oxygen.actif) return repondre({ trouve: false })

  // Une requête après l'autre, et non les trois ensemble : la plupart des agents
  // sont trouvés par leur code agent, et chaque requête coûte au moins une lecture.
  for (const champ of CHAMPS_IDENTIFIANT) {
    const snap = await db.collection('globalClients').where(champ, '==', identifiant).limit(1).get()
    if (!snap.empty) return repondre({ trouve: true, distributeurId: oxygen.distributeurId, nom: oxygen.nom })
  }
  return repondre({ trouve: false })
}

/**
 * Relie un compte Oxygen à la fiche du code, en une transaction.
 *
 * ⚠ LE VERROU « UN SEUL COMPTE ACTIF » SE PREND DEUX FOIS : sur la clé tirée de
 *   la fiche (le point de vente, fiches jumelles comprises), ET sur la fiche
 *   elle-même (une boutique a pu corriger son code depuis la dernière liaison).
 */
async function relier(corps, { db, Timestamp, maintenant, oxygen }) {
  validerCles(corps, ['action', 'distributeurId', 'identifiant', 'code', 'compteOxygen'])
  validerDistributeur(corps, oxygen)
  const identifiant = valider(corps.identifiant, FORMAT_IDENTIFIANT, 'Identifiant invalide.')
  const compteOxygen = valider(corps.compteOxygen, FORMAT_COMPTE, 'Compte invalide.')
  if (!oxygen.actif) return fermee()
  // Un code mal tapé n'est qu'un mauvais code : la raison métier, pas une panne.
  if (typeof corps.code !== 'string' || !FORMAT_CODE.test(corps.code)) {
    return repondre({ ok: false, raison: 'code_incorrect' })
  }

  const maintenantMs = maintenant()
  const heure = Timestamp.fromMillis(maintenantMs)
  const liaisons = db.collection(COLLECTION_LIAISONS)

  return repondre(await db.runTransaction(async (t) => {
    const fiches = await fichesPortant(t, db, identifiant)
    if (fiches.length === 0) return { ok: false, raison: 'identifiant_inconnu' }

    const decisions = await deciderCodes(t, db, fiches.map((f) => f.id), {
      code: corps.code, compteOxygen, objet: 'liaison', maintenantMs,
    })
    const gagnante = retenue(decisions)
    if (!gagnante) return { ok: false, raison: enregistrerRefus(t, db, decisions, heure) }
    if (gagnante.decision.rejoue) {
      return gagnante.donnees.resultat ?? { ok: true, liaison: gagnante.donnees.liaisonId, nom: oxygen.nom }
    }

    const fiche = fiches.find((f) => f.id === gagnante.clientId)
    const cle = cleVerrou(fiche.data())
    const [parCle, parFiche] = await Promise.all([
      t.get(liaisons.where('cleVerrou', '==', cle).where('finLe', '==', null)),
      t.get(liaisons.where('clientId', '==', fiche.id).where('finLe', '==', null)),
    ])
    const actives = new Map([...parCle.docs, ...parFiche.docs].map((d) => [d.id, d]))

    const nouvelle = liaisons.doc()
    for (const ancienne of actives.values()) t.update(ancienne.ref, { finLe: heure, fermeePar: nouvelle.id })

    // L'ancien titulaire, pour qu'Oxygen le prévienne (règle 8) — pas le compte
    // qui se relie lui-même, il n'a rien à apprendre.
    const ancienCompte = [...actives.values()]
      .map((d) => d.data())
      .sort((a, b) => enMs(b.debutLe) - enMs(a.debutLe))
      .find((l) => l.compteOxygen !== compteOxygen)?.compteOxygen

    const auteur = auteurDuCode(gagnante.donnees)
    t.set(nouvelle, {
      distributeurId: oxygen.distributeurId,
      clientId: fiche.id,
      cleVerrou: cle,
      identifiant,
      compteOxygen,
      debutLe: heure,
      finLe: null,
      codeGenerePar: auteur,
    })
    const resultat = { ok: true, liaison: nouvelle.id, nom: oxygen.nom, ...(ancienCompte ? { ancienCompte } : {}) }
    t.update(gagnante.ref, { utiliseLe: heure, utilisePar: compteOxygen, objet: 'liaison', liaisonId: nouvelle.id, resultat })
    t.set(db.collection(COLLECTION_JOURNAL).doc(), {
      issue: 'utilise', clientId: fiche.id, ...auteur, heure, liaisonId: nouvelle.id,
    })
    return resultat
  }))
}

/**
 * Un code de liaison autorise le changement du code secret de l'agent.
 *
 * ⚠ SEULEMENT POUR UNE FICHE QUE CE COMPTE TIENT. Les codes cherchés sont ceux
 *   des fiches de ses liaisons ACTIVES : un code généré pour un autre agent ne
 *   vaut rien ici, et la liaison n'est pas touchée.
 */
async function consommerPourCodeSecret(corps, { db, Timestamp, maintenant, oxygen }) {
  validerCles(corps, ['action', 'distributeurId', 'code', 'compteOxygen'])
  validerDistributeur(corps, oxygen)
  const compteOxygen = valider(corps.compteOxygen, FORMAT_COMPTE, 'Compte invalide.')
  if (!oxygen.actif) return fermee()
  if (typeof corps.code !== 'string' || !FORMAT_CODE.test(corps.code)) {
    return repondre({ ok: false, raison: 'code_incorrect' })
  }

  const maintenantMs = maintenant()
  const heure = Timestamp.fromMillis(maintenantMs)

  return repondre(await db.runTransaction(async (t) => {
    const actives = await t.get(db.collection(COLLECTION_LIAISONS)
      .where('compteOxygen', '==', compteOxygen).where('finLe', '==', null))
    const clientIds = [...new Set(actives.docs.map((d) => d.data().clientId))]
    if (clientIds.length === 0) return { ok: false, raison: 'code_incorrect' }

    const decisions = await deciderCodes(t, db, clientIds, { code: corps.code, compteOxygen, objet: 'code_secret', maintenantMs })
    const gagnante = retenue(decisions)
    if (!gagnante) return { ok: false, raison: enregistrerRefus(t, db, decisions, heure) }
    if (gagnante.decision.rejoue) return { ok: true }

    t.update(gagnante.ref, { utiliseLe: heure, utilisePar: compteOxygen, objet: 'code_secret', resultat: { ok: true } })
    t.set(db.collection(COLLECTION_JOURNAL).doc(), {
      issue: 'utilise_code_secret', clientId: gagnante.clientId, ...auteurDuCode(gagnante.donnees), heure,
    })
    return { ok: true }
  }))
}

const position = (doc, champ) => {
  const instant = doc.get(champ)
  return { s: instant.seconds, n: instant.nanoseconds, chemin: doc.ref.path }
}

/**
 * Une page d'historique de la fiche.
 *
 * Premier remplissage : par date de CRÉATION, la plus récente d'abord, à partir
 * du début de la première période (l'index clientId + createdAt existe déjà).
 * Ensuite : par date de MODIFICATION, la plus ancienne d'abord. Sur la date de
 * création, une non terminée validée après coup serait manquée : sa ligne
 * d'historique garde la date du brouillon.
 */
async function lirePage({ db, Timestamp }, clientId, curseur, debutMin, debutAppelMs) {
  const base = db.collectionGroup('history').where('clientId', '==', clientId)

  if (curseur?.mode !== 'modification') {
    const synchroDepuisMs = curseur?.synchroDepuisMs ?? debutAppelMs - MARGE_SYNCHRO_MS
    let requete = base
      .where('createdAt', '>=', Timestamp.fromMillis(debutMin))
      .orderBy('createdAt', 'desc')
      .orderBy('__name__', 'desc')
    if (curseur?.apres) {
      requete = requete.startAfter(new Timestamp(curseur.apres.s, curseur.apres.n), db.doc(curseur.apres.chemin))
    }
    const snap = await requete.limit(PAGE_ACTIVITE + 1).get()
    const encore = snap.docs.length > PAGE_ACTIVITE
    const docs = snap.docs.slice(0, PAGE_ACTIVITE)
    return {
      docs,
      encore,
      curseur: encore
        ? { mode: 'creation', synchroDepuisMs, apres: position(docs.at(-1), 'createdAt') }
        : { mode: 'modification', depuisMs: synchroDepuisMs },
    }
  }

  let requete = base
    .where('updatedAt', '>=', Timestamp.fromMillis(curseur.depuisMs))
    .orderBy('updatedAt', 'asc')
    .orderBy('__name__', 'asc')
  if (curseur.apres) {
    requete = requete.startAfter(new Timestamp(curseur.apres.s, curseur.apres.n), db.doc(curseur.apres.chemin))
  }
  const snap = await requete.limit(PAGE_ACTIVITE + 1).get()
  const encore = snap.docs.length > PAGE_ACTIVITE
  const docs = snap.docs.slice(0, PAGE_ACTIVITE)
  return {
    docs,
    encore,
    curseur: encore
      ? { mode: 'modification', depuisMs: curseur.depuisMs, apres: position(docs.at(-1), 'updatedAt') }
      : { mode: 'modification', depuisMs: debutAppelMs - MARGE_SYNCHRO_MS },
  }
}

/**
 * L'activité de la fiche, bornée aux périodes de ce compte.
 *
 * Rend à chaque appel la liste COMPLÈTE des non terminées de la période : une
 * opération change de document au cours de sa vie (validée, supprimée,
 * rouverte) et l'ancien est effacé — un effacement ne se voit dans aucune
 * requête. L'app retire donc de son cache toute non terminée absente de la
 * liste, et toute ligne d'historique qu'un `reopenedFromHistoryId` désigne.
 */
async function lireActivite(corps, { db, Timestamp, maintenant, oxygen }) {
  validerCles(corps, ['action', 'distributeurId', 'compteOxygen', 'liaison', 'curseur'])
  validerDistributeur(corps, oxygen)
  const compteOxygen = valider(corps.compteOxygen, FORMAT_COMPTE, 'Compte invalide.')
  const liaisonId = valider(corps.liaison, FORMAT_LIAISON, 'Liaison invalide.')
  const curseur = validerCurseurActivite(corps.curseur)
  if (!oxygen.actif) return fermee()

  const debutAppelMs = maintenant()
  const liaisonSnap = await db.doc(`${COLLECTION_LIAISONS}/${liaisonId}`).get()
  const liaison = liaisonSnap.exists ? liaisonSnap.data() : null
  if (!liaison || liaison.compteOxygen !== compteOxygen || liaison.distributeurId !== oxygen.distributeurId) {
    return repondre({ ok: false, raison: 'liaison_inconnue' })
  }

  // Toutes les périodes de CE compte sur CETTE fiche — pas celles d'un autre
  // titulaire entre deux, qui restent fermées (règle 5).
  const periodes = (await db.collection(COLLECTION_LIAISONS)
    .where('compteOxygen', '==', compteOxygen)
    .where('clientId', '==', liaison.clientId)
    .get()).docs.map((d) => d.data())
  const debutMin = Math.min(...periodes.map((p) => enMs(p.debutLe)))

  const [brouillons, page] = await Promise.all([
    db.collectionGroup('drafts').where('clientId', '==', liaison.clientId).get(),
    lirePage({ db, Timestamp }, liaison.clientId, curseur, debutMin, debutAppelMs),
  ])

  const enLigne = (doc, source) => {
    const donnees = doc.data() ?? {}
    const ligne = ligneDeDocument({ id: doc.id, chemin: doc.ref.path, donnees, source, nomsDeBoutique: new Map() })
    if (!ligne || !dansLesPeriodes(ligne.createdAt, periodes)) return null
    return {
      ...ligne,
      updatedAt: enMs(donnees.updatedAt) || null,
      ...(source === 'draft' ? { reopenedFromHistoryId: donnees.reopenedFromHistoryId ?? null } : {}),
    }
  }

  const nonTerminees = brouillons.docs
    .map((d) => enLigne(d, 'draft'))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
  const lignes = page.docs.map((d) => enLigne(d, 'history')).filter(Boolean)

  return repondre({ ok: true, nonTerminees, lignes, curseur: page.curseur, encore: page.encore })
}

const ACTIONS = Object.freeze({ rechercher, relier, consommerPourCodeSecret, lireActivite })

/**
 * Traite une demande du serveur Oxygen. Rend `{ statut, corps }` ; l'enveloppe
 * HTTP est dans `index.js`.
 *
 * @param {unknown} corps  le JSON reçu
 * ⚠ `Timestamp` EST INJECTÉ, comme `FieldValue` ailleurs : `functions/` a son
 *   propre firebase-admin, et une classe venue d'un autre exemplaire du paquet
 *   est refusée à l'écriture (« doesn't match the expected instance »).
 *
 * @param {{ db: object, Timestamp: Function, maintenant?: () => number, oxygen?: object }} deps
 */
export async function traiterDemandeOxygen(corps, { db, Timestamp, maintenant = Date.now, oxygen = OXYGEN_DU_PROFIL }) {
  try {
    if (!estObjetSimple(corps)) invalide('Corps JSON attendu.')
    if (typeof corps.action !== 'string' || !Object.hasOwn(ACTIONS, corps.action)) invalide('Action inconnue.')
    return await ACTIONS[corps.action](corps, { db, Timestamp, maintenant, oxygen })
  } catch (erreur) {
    if (erreur instanceof DemandeInvalide) return repondre({ erreur: erreur.message }, 400)
    throw erreur
  }
}
