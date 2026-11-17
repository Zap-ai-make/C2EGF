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
import { STORE_NETWORKS } from '../config/storeProfile.js'
import { dealerDe, flotteDe } from '../boutiques/numeros.js'
import { estRembSiege } from '../storeTransactions/rembSiege.js'
import {
  COLLECTION_DEMANDES,
  ETATS_DEMANDE,
  LIMITE_DEMANDES,
  RETENUE_DEMANDES_MS,
  TYPE_DU_SENS,
  codeReseauDeFiche,
  demandeRendue,
} from './demande.js'
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
    // Le contrat validé avec Oxygen ne connaît pas ce type : il n'entre pas dans
    // le flux avant que l'utilisateur rouvre ce contrat (TC-377-RS).
    if (estRembSiege(donnees)) return null
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

// ─── Les demandes d'opération ─────────────────────────────────────────────────
//
// Contrat : C:\dev\oxygen\docs\contrats\demande-operation.md, version 4, §8 ;
// précisé par docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.2.
//
// Oxygen crée, annule et relit ; la caissière accepte ou rejette, avec sa
// propre authentification, par `storeTransactionCommand`. Un agent peut avoir
// autant de demandes en attente qu'il veut (décidé le 2026-11-17) : aucun verrou.

/** Le format des identifiants de document : celui de `commandeId`. */
const FORMAT_ID = /^[A-Za-z0-9_-]{1,160}$/
const SENS = Object.freeze(Object.keys(TYPE_DU_SENS))
const CLES_COMMUNES = Object.freeze(['action', 'distributeurId', 'compteOxygen', 'liaison'])

const refDemande = (db, boutiqueId, demandeId) => db.doc(`clients/${boutiqueId}/${COLLECTION_DEMANDES}/${demandeId}`)
const refus = (raison) => ({ ok: false, raison })

/** Les champs communs à toute action sur les demandes, plus ceux de l'action. */
function validerCommun(corps, cles, oxygen) {
  validerCles(corps, [...CLES_COMMUNES, ...cles])
  validerDistributeur(corps, oxygen)
  return {
    compteOxygen: valider(corps.compteOxygen, FORMAT_COMPTE, 'Compte invalide.'),
    liaisonId: valider(corps.liaison, FORMAT_LIAISON, 'Liaison invalide.'),
  }
}

/** La boutique et la demande qu'une action désigne. */
const validerCible = (corps) => ({
  boutiqueId: valider(corps.boutiqueId, FORMAT_ID, 'Boutique invalide.'),
  demandeId: valider(corps.demandeId, FORMAT_ID, 'Demande invalide.'),
})

/**
 * La liaison, si elle appartient à CE compte chez CE distributeur — ouverte ou
 * fermée : c'est à chaque action de dire ce qu'une liaison fermée lui permet.
 */
function liaisonDuCompte(snap, { compteOxygen }, oxygen) {
  const liaison = snap.exists ? snap.data() : null
  return liaison && liaison.compteOxygen === compteOxygen && liaison.distributeurId === oxygen.distributeurId
    ? liaison
    : null
}

/** Une demande que ce compte peut voir : la sienne, et seulement elle. */
const demandeDuCompte = (snap, { compteOxygen }) => (snap.exists && snap.get('compteOxygen') === compteOxygen ? snap.data() : null)

/**
 * Crée une demande, en attente.
 *
 * ⚠ LE REJEU D'ABORD. Renvoyée après une réponse perdue, la même clé rend la
 *   même demande, quel que soit son état depuis : la liaison a pu se fermer
 *   entre les deux, et l'agent se croirait refusé alors qu'il a bien demandé.
 */
/**
 * Le numéro dealer de la boutique, pour un retrait seulement (contrat §9) :
 * l'app compose aussitôt le code d'envoi des unités vers lui. Sur un dépôt,
 * c'est la boutique qui envoie : rien à composer. Lu sur la fiche au moment
 * de la réponse, jamais recopié dans la demande.
 */
function avecDealer(demande, fiche) {
  const dealer = demande.sens === 'retrait' ? dealerDe(fiche, demande.reseau) : undefined
  return dealer ? { ...demande, dealer } : demande
}

/** La boutique telle que la liste la rend : son numéro flotte s'il en a un, jamais le numéro dealer. */
function boutiqueListee(snap, enPlus = {}) {
  const flotte = flotteDe(snap.data())
  return { id: snap.id, nom: snap.get('name') ?? '', ...enPlus, ...(flotte ? { flotte } : {}) }
}

async function demander(corps, { db, Timestamp, maintenant, oxygen }) {
  const ids = validerCommun(corps, ['boutiqueId', 'sens', 'reseau', 'montant', 'saisieLe', 'cle'], oxygen)
  const boutiqueId = valider(corps.boutiqueId, FORMAT_ID, 'Boutique invalide.')
  const cle = valider(corps.cle, FORMAT_ID, 'Clé invalide.')
  if (!SENS.includes(corps.sens)) invalide('Sens invalide.')
  if (!estInstant(corps.saisieLe)) invalide('Moment de saisie invalide.')
  if (!oxygen.actif) return fermee()
  if (!Number.isSafeInteger(corps.montant) || corps.montant <= 0) return repondre(refus('montant_invalide'))
  if (!STORE_NETWORKS.includes(corps.reseau)) return repondre(refus('reseau_invalide'))

  const ref = refDemande(db, boutiqueId, cle)
  const heure = Timestamp.fromMillis(maintenant())

  return repondre(await db.runTransaction(async (t) => {
    const existante = await t.get(ref)
    if (existante.exists) {
      // Une clé est un UUID tiré par l'app : la retrouver sous un autre compte
      // n'est pas un rejeu, c'est une demande mal formée.
      if (existante.get('compteOxygen') !== ids.compteOxygen) invalide('Clé déjà prise.')
      const rejouee = existante.data()
      // Le numéro du MOMENT, relu sur la fiche : la boutique a pu en changer.
      const fiche = rejouee.sens === 'retrait' ? (await t.get(db.doc(`stores/${rejouee.boutiqueId}`))).data() : null
      return { ok: true, demande: avecDealer(demandeRendue(ref.id, rejouee), fiche) }
    }

    const liaison = liaisonDuCompte(await t.get(db.doc(`${COLLECTION_LIAISONS}/${ids.liaisonId}`)), ids, oxygen)
    if (!liaison) return refus('liaison_inconnue')
    if (liaison.finLe) return refus('liaison_fermee')

    const [boutique, fiche] = await t.getAll(db.doc(`stores/${boutiqueId}`), db.doc(`globalClients/${liaison.clientId}`))
    if (!boutique.exists || boutique.get('active') !== true) return refus('boutique_indisponible')
    // Sans code sur ce réseau, la caissière ne pourrait jamais la valider : la
    // demande attendrait sans fin. Mieux vaut le dire à l'agent maintenant.
    const code = codeReseauDeFiche(fiche.exists ? fiche.data() : null, corps.reseau)
    if (!code) return refus('reseau_invalide')

    const donnees = {
      distributeurId: oxygen.distributeurId,
      compteOxygen: ids.compteOxygen,
      liaisonId: ids.liaisonId,
      clientId: liaison.clientId,
      // Une copie, pour que l'écran de la caisse n'ait pas à lire la fiche de
      // chaque demande. La fiche fait foi à la validation.
      agent: { nom: fiche.get('nom') ?? '', prenom: fiche.get('prenom') ?? '', code },
      boutiqueId,
      boutiqueNom: boutique.get('name') ?? '',
      sens: corps.sens,
      reseau: corps.reseau,
      montant: corps.montant,
      // L'heure du téléphone, pour l'affichage seulement : l'opération sera
      // datée de sa validation, côté serveur.
      saisieLe: Timestamp.fromMillis(corps.saisieLe),
      etat: ETATS_DEMANDE.EN_ATTENTE,
      creeLe: heure,
      reponduLe: null,
      reponduPar: null,
      operationId: null,
    }
    t.set(ref, donnees)
    return { ok: true, demande: avecDealer(demandeRendue(ref.id, donnees), boutique.data()) }
  }))
}

/** Une seule demande, par son chemin : deux lectures, la liaison et elle. */
async function etatDemande(corps, { db, oxygen }) {
  const ids = validerCommun(corps, ['boutiqueId', 'demandeId'], oxygen)
  const { boutiqueId, demandeId } = validerCible(corps)
  if (!oxygen.actif) return fermee()

  const [liaisonSnap, demandeSnap] = await db.getAll(db.doc(`${COLLECTION_LIAISONS}/${ids.liaisonId}`), refDemande(db, boutiqueId, demandeId))
  if (!liaisonDuCompte(liaisonSnap, ids, oxygen)) return repondre(refus('liaison_inconnue'))
  const donnees = demandeDuCompte(demandeSnap, ids)
  if (!donnees) return repondre(refus('demande_inconnue'))
  return repondre({ ok: true, demande: demandeRendue(demandeId, donnees) })
}

/**
 * L'agent retire sa demande, tant que la caissière n'a pas répondu. Sinon rien
 * ne s'écrit, et l'agent apprend ce qui lui est arrivé.
 */
async function annuler(corps, { db, Timestamp, maintenant, oxygen }) {
  const ids = validerCommun(corps, ['boutiqueId', 'demandeId'], oxygen)
  const { boutiqueId, demandeId } = validerCible(corps)
  if (!oxygen.actif) return fermee()
  const ref = refDemande(db, boutiqueId, demandeId)
  const heure = Timestamp.fromMillis(maintenant())

  return repondre(await db.runTransaction(async (t) => {
    const [liaisonSnap, demandeSnap] = await t.getAll(db.doc(`${COLLECTION_LIAISONS}/${ids.liaisonId}`), ref)
    if (!liaisonDuCompte(liaisonSnap, ids, oxygen)) return refus('liaison_inconnue')
    const donnees = demandeDuCompte(demandeSnap, ids)
    if (!donnees) return refus('demande_inconnue')
    if (donnees.etat !== ETATS_DEMANDE.EN_ATTENTE) return { ok: true, demande: demandeRendue(demandeId, donnees) }

    const fermeture = { etat: ETATS_DEMANDE.ANNULEE_AGENT, reponduLe: heure }
    t.update(ref, fermeture)
    return { ok: true, demande: demandeRendue(demandeId, { ...donnees, ...fermeture }) }
  }))
}

/** Les dernières opérations de la fiche, d'où l'on tire les boutiques qui ont servi l'agent. */
const LIGNES_SERVIES = 50

const validerDrapeau = (valeur, message) => {
  if (valeur !== undefined && typeof valeur !== 'boolean') invalide(message)
  return valeur === true
}

/**
 * Les boutiques à proposer à l'agent : celles qui l'ont déjà servi, et, quand
 * Oxygen le demande (son cache de 24 h est périmé), toutes les actives.
 *
 * Toute boutique active accepte des demandes (première version, contrat §8).
 * Ni solde ni montant : des identifiants et des noms.
 */
async function listerBoutiques(corps, { db, oxygen }) {
  const ids = validerCommun(corps, ['avecToutes'], oxygen)
  const avecToutes = validerDrapeau(corps.avecToutes, 'avecToutes invalide.')
  if (!oxygen.actif) return fermee()

  const liaison = liaisonDuCompte(await db.doc(`${COLLECTION_LIAISONS}/${ids.liaisonId}`).get(), ids, oxygen)
  if (!liaison) return repondre(refus('liaison_inconnue'))
  if (liaison.finLe) return repondre(refus('liaison_fermee'))

  // La requête de `lireActivite`, et son index : au plus 50 lectures.
  const historique = await db.collectionGroup('history')
    .where('clientId', '==', liaison.clientId)
    .orderBy('createdAt', 'desc')
    .limit(LIGNES_SERVIES)
    .get()
  // La boutique se lit sur le CHEMIN de la ligne, qui ne ment jamais : un
  // `storeId` recopié pourrait manquer sur une ligne ancienne.
  const derniere = new Map()
  for (const ligne of historique.docs) {
    const boutiqueId = ligne.ref.parent.parent?.id
    if (boutiqueId && !derniere.has(boutiqueId)) derniere.set(boutiqueId, enMs(ligne.get('createdAt')))
  }
  // Le nom du jour, et une boutique fermée depuis retirée.
  const boutiques = derniere.size ? await db.getAll(...[...derniere.keys()].map((id) => db.doc(`stores/${id}`))) : []
  const servies = boutiques
    .filter((b) => b.exists && b.get('active') === true)
    .map((b) => boutiqueListee(b, { derniereLe: derniere.get(b.id) }))

  const reponse = { ok: true, servies, reseaux: [...STORE_NETWORKS] }
  if (avecToutes) {
    const actives = await db.collection('stores').where('active', '==', true).orderBy('name').get()
    reponse.boutiques = actives.docs.map((b) => boutiqueListee(b))
  }
  return repondre(reponse)
}

/**
 * Les demandes de ce compte : en attente, et fermées depuis moins de sept jours.
 *
 * `enAttente` (demandé par Oxygen le 2026-11-17) ne garde que la première
 * requête : l'Accueil de l'agent la relit toutes les 10 s tant qu'une demande
 * attend, et n'a que faire du fil de la semaine à chaque tour.
 */
async function lireDemandes(corps, { db, Timestamp, maintenant, oxygen }) {
  const ids = validerCommun(corps, ['enAttente'], oxygen)
  const seulementEnAttente = validerDrapeau(corps.enAttente, 'enAttente invalide.')
  if (!oxygen.actif) return fermee()

  if (!liaisonDuCompte(await db.doc(`${COLLECTION_LIAISONS}/${ids.liaisonId}`).get(), ids, oxygen)) {
    return repondre(refus('liaison_inconnue'))
  }

  const duCompte = db.collectionGroup(COLLECTION_DEMANDES).where('compteOxygen', '==', ids.compteOxygen)
  const [enAttente, fermees] = await Promise.all([
    duCompte.where('etat', '==', ETATS_DEMANDE.EN_ATTENTE).limit(LIMITE_DEMANDES).get(),
    seulementEnAttente
      ? null
      : duCompte
        .where('reponduLe', '>=', Timestamp.fromMillis(maintenant() - RETENUE_DEMANDES_MS))
        .orderBy('reponduLe', 'desc')
        .limit(LIMITE_DEMANDES)
        .get(),
  ])

  const parChemin = new Map()
  for (const doc of [...enAttente.docs, ...(fermees?.docs ?? [])]) parChemin.set(doc.ref.path, demandeRendue(doc.id, doc.data()))
  const demandes = [...parChemin.values()].sort((a, b) => (b.creeLe ?? 0) - (a.creeLe ?? 0))
  return repondre({ ok: true, demandes })
}

const ACTIONS = Object.freeze({
  rechercher, relier, consommerPourCodeSecret, lireActivite,
  listerBoutiques, demander, annuler, lireDemandes, etatDemande,
})

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
