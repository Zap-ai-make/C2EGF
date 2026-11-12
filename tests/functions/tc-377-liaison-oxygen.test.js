/**
 * TC-377 — Liaison Oxygen : genererCodeLiaison et le point d'entrée privé.
 *   Handlers avec l'émulateur Firestore, { db } et l'horloge injectés.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.
 *
 * Comportement protégé :
 *   génération : comptes de boutique seulement ; fiche existante portant un
 *                identifiant ; code jamais stocké en clair ; journal ; un nouveau
 *                code remplace le précédent.
 *   rechercher : les trois champs ; rien d'autre que le distributeur.
 *   relier     : la fiche du code ; refus métier en 200 ; cinq échecs ; rejeu ;
 *                un seul titulaire par point de vente, fiches jumelles comprises.
 *   code secret: refusé sans liaison active de CE compte ; ne touche pas la liaison.
 *   activité   : bornée aux périodes du compte ; non terminées en entier ; pages
 *                de 50 ; synchronisation sur la date de modification.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { genererCodeLiaisonHandler } from '../../functions/src/oxygen/genererCodeLiaison.js'
import { traiterDemandeOxygen, invokerOxygen } from '../../functions/src/oxygen/pointEntreeOxygen.js'
import { DUREE_CODE_MS, ECHECS_MAX } from '../../functions/src/oxygen/liaison.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

const COLLECTIONS = [
  'users', 'globalClients', 'codesLiaisonOxygen', 'liaisonsOxygen', 'journalLiaisonsOxygen',
  'clients/store-a/history', 'clients/store-b/history', 'clients/store-a/drafts', 'clients/store-b/drafts',
]

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

/** L'horloge des tests : déplaçable, pour expirer un code sans attendre. */
const T0 = Date.UTC(2026, 10, 12, 9, 0)
let maintenantMs = T0
const maintenant = () => maintenantMs
const OXYGEN = { actif: true, distributeurId: 'c2egf', nom: 'C2EGF' }
const deps = () => ({ db, Timestamp, maintenant, oxygen: OXYGEN })

const CAISSIERE_A = { uid: 'u-a', role: 'store_admin', storeId: 'store-a', storeName: 'C2EGF OUAGA', active: true, name: 'C2EGF OUAGA' }
const CAISSIERE_B = { uid: 'u-b', role: 'member', storeId: 'store-b', storeName: 'C2EGF BOBO', active: true, name: 'C2EGF BOBO' }
const DEALER = { uid: 'u-dealer', role: 'dealer', active: true, name: 'Le dealer' }
const PATRON = { uid: 'u-patron', role: 'system_manager', active: true, name: 'Le patron' }
const INACTIVE = { uid: 'u-ex', role: 'member', storeId: 'store-a', active: false, name: 'Ex' }

const fiche = (over = {}) => ({
  nom: 'OUEDRAOGO', prenom: 'Awa', registeredStoreId: 'store-a', registeredStoreName: 'C2EGF OUAGA', ...over,
})

beforeEach(async () => {
  maintenantMs = T0
  await Promise.all(COLLECTIONS.map(effacer))
  await Promise.all([
    ...[CAISSIERE_A, CAISSIERE_B, DEALER, PATRON, INACTIVE].map((p) => db.doc(`users/${p.uid}`).set(p)),
    // Fiche rangée : code et numéro séparés.
    db.doc('globalClients/f-awa').set(fiche({ codeAgent: '1234567', numeroAgent: '70112233', orange: '1234567' })),
    // Fiche d'avant la séparation : tout dans `orange`.
    db.doc('globalClients/f-ancien').set(fiche({ nom: 'KABORE', orange: '7654321' })),
    // Fiche sans aucun identifiant agent.
    db.doc('globalClients/f-vide').set(fiche({ nom: 'SANS', codeAgent: '', numeroAgent: '' })),
  ])
}, 30000)

const generer = (uid, clientId, depsEnPlus = {}) =>
  genererCodeLiaisonHandler({ auth: uid ? { uid } : null, data: { clientId } }, { ...deps(), ...depsEnPlus })

const demander = (corps, depsEnPlus = {}) => traiterDemandeOxygen(corps, { ...deps(), ...depsEnPlus })

/** Le corps seul : chaque refus métier de ce bloc arrive en 200 (vérifié par TC-377-16). */
const relier = async (identifiant, code, compteOxygen = 'cpt-1') => {
  const { statut, corps } = await demander({ action: 'relier', distributeurId: 'c2egf', identifiant, code, compteOxygen })
  expect(statut).toBe(200)
  return corps
}

const journal = async () => (await db.collection('journalLiaisonsOxygen').get()).docs.map((d) => d.data())

const actives = async () => (await db.collection('liaisonsOxygen').where('finLe', '==', null).get()).docs.map((d) => d.data())

const mauvaisCode = (code) => (code === '000000' ? '000001' : '000000')

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-377 — genererCodeLiaison', () => {
  it('[TC-377-01] refuse un appel sans authentification', async () => {
    await expect(generer(null, 'f-awa')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[TC-377-02] réservé aux comptes de boutique : ni dealer, ni patron, ni compte inactif', async () => {
    await expect(generer('u-dealer', 'f-awa')).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    await expect(generer('u-patron', 'f-awa')).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    await expect(generer('u-ex', 'f-awa')).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  it('[TC-377-03] refuse un champ hors liste blanche', async () => {
    await expect(genererCodeLiaisonHandler({ auth: { uid: 'u-a' }, data: { clientId: 'f-awa', storeId: 'store-z' } }, deps()))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[TC-377-03b] refuse un identifiant de fiche qui serait un chemin', async () => {
    // `globalClients/x/y/z` est un chemin de document valide : sans ce refus,
    // l'identifiant désignerait un document ailleurs que dans la collection.
    await expect(generer('u-a', 'f-awa/codes/x')).rejects.toMatchObject({ code: 'INVALID_CLIENT_ID' })
  })

  it('[TC-377-04] refuse une fiche introuvable, puis une fiche sans code ni numéro agent', async () => {
    await expect(generer('u-a', 'f-fantome')).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' })
    await expect(generer('u-a', 'f-vide')).rejects.toMatchObject({ code: 'AGENT_SANS_IDENTIFIANT' })
  })

  it('[TC-377-05] refuse quand le profil ferme la liaison', async () => {
    await expect(generer('u-a', 'f-awa', { oxygen: { ...OXYGEN, actif: false } }))
      .rejects.toMatchObject({ code: 'OXYGEN_DISABLED' })
  })

  it('[TC-377-06] rend six chiffres valables quinze minutes, depuis N’IMPORTE QUELLE boutique', async () => {
    // La fiche appartient à store-a ; la caissière de store-b la sert aussi.
    const reponse = await generer('u-b', 'f-awa')
    // `valableMs` : le poste compte à rebours depuis la RÉCEPTION, sur sa propre
    // horloge. Une machine éteinte chaque soir peut avoir des minutes d'écart
    // avec le serveur : `expireLe` comparé à son heure afficherait un faux temps.
    expect(reponse).toEqual({
      success: true, code: expect.stringMatching(/^\d{6}$/), expireLe: T0 + DUREE_CODE_MS, valableMs: DUREE_CODE_MS,
    })
  })

  it('[TC-377-07] le code n’est jamais écrit en clair', async () => {
    const { code } = await generer('u-a', 'f-awa')
    const doc = (await db.doc('codesLiaisonOxygen/f-awa').get()).data()
    expect(JSON.stringify(doc)).not.toContain(code)
    expect(doc).toMatchObject({ clientId: 'f-awa', echecs: 0, utiliseLe: null, storeId: 'store-a', uid: 'u-a' })
  })

  it('[TC-377-08] trace la boutique, le compte, l’heure et la fiche — pas le nom d’une personne', async () => {
    await generer('u-b', 'f-awa')
    const lignes = await journal()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toEqual({
      issue: 'genere', clientId: 'f-awa', storeId: 'store-b', storeName: 'C2EGF BOBO', uid: 'u-b',
      heure: Timestamp.fromMillis(T0),
    })
  })

  it('[TC-377-09] un nouveau code annule le précédent, et le journal le dit', async () => {
    const premier = await generer('u-a', 'f-awa')
    maintenantMs = T0 + 60_000
    const second = await generer('u-b', 'f-awa')
    expect(await relier('1234567', premier.code)).toEqual({ ok: false, raison: 'code_annule' })
    expect((await journal()).map((l) => l.issue).sort()).toEqual(['genere', 'genere', 'remplace'])
    expect(await relier('1234567', second.code)).toMatchObject({ ok: true })
  })
})

describe('TC-377 — rechercher', () => {
  const rechercher = (identifiant) => demander({ action: 'rechercher', identifiant })

  it('[TC-377-10] trouve par le code agent, par le numéro agent, et dans l’ancien champ', async () => {
    const trouve = { trouve: true, distributeurId: 'c2egf', nom: 'C2EGF' }
    expect(await rechercher('1234567')).toEqual({ statut: 200, corps: trouve })
    expect(await rechercher('70112233')).toEqual({ statut: 200, corps: trouve })
    expect(await rechercher('7654321')).toEqual({ statut: 200, corps: trouve })
  })

  it('[TC-377-11] absent : `trouve: false`, en 200, et rien d’autre', async () => {
    expect(await rechercher('9999999')).toEqual({ statut: 200, corps: { trouve: false } })
  })

  it('[TC-377-12] un distributeur qui a fermé la liaison répond « absent »', async () => {
    expect(await demander({ action: 'rechercher', identifiant: '1234567' }, { oxygen: { ...OXYGEN, actif: false } }))
      .toEqual({ statut: 200, corps: { trouve: false } })
  })

  it('[TC-377-13] une demande mal formée est une panne de l’appelant (400), jamais « absent »', async () => {
    for (const corps of [
      null, [], 'rechercher', { action: 'rechercher' }, { action: 'rechercher', identifiant: '12 34' },
      { action: 'rechercher', identifiant: 1234567 }, { action: 'rechercher', identifiant: '1234567', nom: 'x' },
      { action: 'supprimer', identifiant: '1234567' },
    ]) {
      expect((await demander(corps)).statut, JSON.stringify(corps)).toBe(400)
    }
  })
})

describe('TC-377 — relier', () => {
  it('[TC-377-14] relie le compte à la fiche du code, et consomme le code', async () => {
    const { code } = await generer('u-b', 'f-awa')
    const reponse = await relier('1234567', code)
    expect(reponse).toEqual({ ok: true, liaison: expect.any(String), nom: 'C2EGF' })

    const liaison = (await db.doc(`liaisonsOxygen/${reponse.liaison}`).get()).data()
    expect(liaison).toMatchObject({
      distributeurId: 'c2egf', clientId: 'f-awa', cleVerrou: '1234567', compteOxygen: 'cpt-1',
      debutLe: Timestamp.fromMillis(T0), finLe: null,
    })
    const codeDoc = (await db.doc('codesLiaisonOxygen/f-awa').get()).data()
    expect(codeDoc).toMatchObject({ utilisePar: 'cpt-1', objet: 'liaison', liaisonId: reponse.liaison })
    expect((await journal()).find((l) => l.issue === 'utilise'))
      .toMatchObject({ clientId: 'f-awa', storeId: 'store-b', uid: 'u-b', liaisonId: reponse.liaison })
  })

  it('[TC-377-15] par le numéro agent aussi', async () => {
    const { code } = await generer('u-a', 'f-awa')
    expect(await relier('70112233', code)).toMatchObject({ ok: true })
  })

  it('[TC-377-16] le refus métier arrive en 200, avec sa raison', async () => {
    expect(await demander({ action: 'relier', distributeurId: 'c2egf', identifiant: '9999999', code: '123456', compteOxygen: 'cpt-1' }))
      .toEqual({ statut: 200, corps: { ok: false, raison: 'identifiant_inconnu' } })
  })

  it('[TC-377-17] aucun code pour cette fiche : incorrect', async () => {
    expect(await relier('1234567', '123456')).toEqual({ ok: false, raison: 'code_incorrect' })
  })

  it('[TC-377-18] le code d’une fiche ne relie pas une autre fiche', async () => {
    const { code } = await generer('u-a', 'f-awa')
    expect(await relier('7654321', code)).toEqual({ ok: false, raison: 'code_incorrect' })
  })

  it('[TC-377-19] cinq échecs annulent le code, même juste après', async () => {
    const { code } = await generer('u-a', 'f-awa')
    for (let i = 1; i < ECHECS_MAX; i += 1) {
      expect(await relier('1234567', mauvaisCode(code))).toEqual({ ok: false, raison: 'code_incorrect' })
    }
    expect(await relier('1234567', mauvaisCode(code))).toEqual({ ok: false, raison: 'code_annule' })
    expect(await relier('1234567', code)).toEqual({ ok: false, raison: 'code_annule' })
    expect((await journal()).filter((l) => l.issue === 'essais_epuises')).toHaveLength(1)
  })

  it('[TC-377-20] un code mal formé n’est qu’un code incorrect, sans compter d’échec', async () => {
    await generer('u-a', 'f-awa')
    expect(await relier('1234567', '12')).toEqual({ ok: false, raison: 'code_incorrect' })
    expect((await db.doc('codesLiaisonOxygen/f-awa').get()).data().echecs).toBe(0)
  })

  it('[TC-377-21] expiré à quinze minutes', async () => {
    const { code } = await generer('u-a', 'f-awa')
    maintenantMs = T0 + DUREE_CODE_MS
    expect(await relier('1234567', code)).toEqual({ ok: false, raison: 'code_expire' })
  })

  it('[TC-377-22] rejoué par le même compte : la même réponse, une seule liaison', async () => {
    const { code } = await generer('u-a', 'f-awa')
    const premiere = await relier('1234567', code)
    maintenantMs = T0 + DUREE_CODE_MS + 1 // le rejeu peut arriver après l'expiration
    expect(await relier('1234567', code)).toEqual(premiere)
    expect(await actives()).toHaveLength(1)
  })

  it('[TC-377-23] déjà utilisé par un autre compte', async () => {
    const { code } = await generer('u-a', 'f-awa')
    await relier('1234567', code, 'cpt-1')
    expect(await relier('1234567', code, 'cpt-2')).toEqual({ ok: false, raison: 'code_deja_utilise' })
  })

  it('[TC-377-24] un second compte ferme la liaison du premier, et le nomme', async () => {
    const un = await generer('u-a', 'f-awa')
    const premiere = await relier('1234567', un.code, 'cpt-1')
    maintenantMs = T0 + 3_600_000
    const deux = await generer('u-a', 'f-awa')
    expect(await relier('1234567', deux.code, 'cpt-2'))
      .toEqual({ ok: true, liaison: expect.any(String), nom: 'C2EGF', ancienCompte: 'cpt-1' })
    const fermee = (await db.doc(`liaisonsOxygen/${premiere.liaison}`).get()).data()
    expect(fermee.finLe).toEqual(Timestamp.fromMillis(T0 + 3_600_000))
    expect((await actives()).map((l) => l.compteOxygen)).toEqual(['cpt-2'])
  })

  it('[TC-377-25] par le numéro puis par le code : toujours un seul titulaire', async () => {
    const un = await generer('u-a', 'f-awa')
    await relier('70112233', un.code, 'cpt-1')
    const deux = await generer('u-a', 'f-awa')
    await relier('1234567', deux.code, 'cpt-2')
    expect((await actives()).map((l) => l.compteOxygen)).toEqual(['cpt-2'])
  })

  it('[TC-377-26] deux fiches jumelles ne donnent pas deux titulaires', async () => {
    await db.doc('globalClients/f-jumelle').set(fiche({ nom: 'OUEDRAOGO BIS', codeAgent: '1234567', numeroAgent: '' }))
    const un = await generer('u-a', 'f-awa')
    await relier('1234567', un.code, 'cpt-1')
    const deux = await generer('u-b', 'f-jumelle')
    expect(await relier('1234567', deux.code, 'cpt-2')).toMatchObject({ ok: true, ancienCompte: 'cpt-1' })
    expect((await actives()).map((l) => l.compteOxygen)).toEqual(['cpt-2'])
  })

  it('[TC-377-27] le même compte qui se relie ne se prévient pas lui-même', async () => {
    const un = await generer('u-a', 'f-awa')
    await relier('1234567', un.code, 'cpt-1')
    const deux = await generer('u-a', 'f-awa')
    expect(await relier('1234567', deux.code, 'cpt-1')).toEqual({ ok: true, liaison: expect.any(String), nom: 'C2EGF' })
  })

  it('[TC-377-28] un autre distributeur, ou un compte mal formé, est une panne de l’appelant', async () => {
    const { code } = await generer('u-a', 'f-awa')
    const base = { action: 'relier', distributeurId: 'c2egf', identifiant: '1234567', code, compteOxygen: 'cpt-1' }
    expect((await demander({ ...base, distributeurId: 'autre' })).statut).toBe(400)
    expect((await demander({ ...base, compteOxygen: '' })).statut).toBe(400)
    expect((await demander({ ...base, compteOxygen: 'a/b' })).statut).toBe(400)
  })

  it('[TC-377-29] un distributeur qui a fermé la liaison ne relie plus', async () => {
    const { code } = await generer('u-a', 'f-awa')
    const reponse = await demander(
      { action: 'relier', distributeurId: 'c2egf', identifiant: '1234567', code, compteOxygen: 'cpt-1' },
      { oxygen: { ...OXYGEN, actif: false } },
    )
    expect(reponse.statut).toBe(403)
  })
})

describe('TC-377 — consommerPourCodeSecret', () => {
  const consommer = (code, compteOxygen = 'cpt-1') =>
    demander({ action: 'consommerPourCodeSecret', distributeurId: 'c2egf', code, compteOxygen })

  it('[TC-377-30] refusé sans liaison active de ce compte', async () => {
    const { code } = await generer('u-a', 'f-awa')
    expect(await consommer(code)).toEqual({ statut: 200, corps: { ok: false, raison: 'code_incorrect' } })
  })

  it('[TC-377-31] accepté pour la fiche reliée à ce compte, sans toucher la liaison', async () => {
    const un = await generer('u-a', 'f-awa')
    const { liaison } = await relier('1234567', un.code, 'cpt-1')
    const deux = await generer('u-b', 'f-awa')
    expect(await consommer(deux.code)).toEqual({ statut: 200, corps: { ok: true } })
    expect(await consommer(deux.code)).toEqual({ statut: 200, corps: { ok: true } }) // rejeu
    expect((await db.doc(`liaisonsOxygen/${liaison}`).get()).data().finLe).toBeNull()
    expect((await db.doc('codesLiaisonOxygen/f-awa').get()).data()).toMatchObject({ objet: 'code_secret', utilisePar: 'cpt-1' })
    expect((await journal()).filter((l) => l.issue === 'utilise_code_secret')).toHaveLength(1)
  })

  it('[TC-377-32] le code d’une fiche que ce compte ne tient pas ne vaut rien', async () => {
    const un = await generer('u-a', 'f-awa')
    await relier('1234567', un.code, 'cpt-1')
    const autre = await generer('u-a', 'f-ancien')
    expect((await consommer(autre.code)).corps).toEqual({ ok: false, raison: 'code_incorrect' })
  })

  it('[TC-377-33] un code de liaison déjà consommé pour relier ne change pas le code secret', async () => {
    const { code } = await generer('u-a', 'f-awa')
    await relier('1234567', code, 'cpt-1')
    expect((await consommer(code)).corps).toEqual({ ok: false, raison: 'code_deja_utilise' })
  })
})

describe('TC-377 — lireActivite', () => {
  const H = 3_600_000
  const ts = (ms) => Timestamp.fromMillis(ms)
  const ligne = (over = {}) => ({
    clientId: 'f-awa', type: 'Dépôt', montant: 1000, statut: 'Validée', storeName: 'C2EGF OUAGA',
    createdAt: ts(T0 + H), updatedAt: ts(T0 + H), ...over,
  })
  const lire = (liaison, curseur, compteOxygen = 'cpt-1') =>
    demander({ action: 'lireActivite', distributeurId: 'c2egf', compteOxygen, liaison, ...(curseur ? { curseur } : {}) })

  /** Relie cpt-1 à f-awa à T0, puis avance l'horloge à T0 + 10 h. */
  const relie = async (compteOxygen = 'cpt-1') => {
    const { code } = await generer('u-a', 'f-awa')
    const { liaison } = await relier('1234567', code, compteOxygen)
    return liaison
  }

  it('[TC-377-34] la liaison d’un autre compte n’ouvre rien', async () => {
    const liaison = await relie('cpt-1')
    expect(await lire(liaison, null, 'cpt-2')).toEqual({ statut: 200, corps: { ok: false, raison: 'liaison_inconnue' } })
    expect(await lire('inexistante')).toEqual({ statut: 200, corps: { ok: false, raison: 'liaison_inconnue' } })
  })

  it('[TC-377-35] premier remplissage : la période seulement, cette fiche seulement', async () => {
    const liaison = await relie()
    maintenantMs = T0 + 10 * H
    await Promise.all([
      db.doc('clients/store-a/history/avant').set(ligne({ createdAt: ts(T0 - H) })),
      db.doc('clients/store-a/history/pendant').set(ligne()),
      db.doc('clients/store-b/history/ailleurs').set(ligne({ createdAt: ts(T0 + 2 * H) })),
      db.doc('clients/store-a/history/autre-fiche').set(ligne({ clientId: 'f-ancien' })),
      db.doc('clients/store-a/history/ravit').set(ligne({ type: 'ravitaillement' })),
      db.doc('clients/store-a/drafts/d-avant').set(ligne({ statut: 'Non Terminées', createdAt: ts(T0 - H) })),
      db.doc('clients/store-b/drafts/d-pendant').set(ligne({ statut: 'Non Terminées', createdAt: ts(T0 + 3 * H) })),
    ])
    const { statut, corps } = await lire(liaison)
    expect(statut).toBe(200)
    expect(corps.ok).toBe(true)
    expect(corps.lignes.map((l) => l.id)).toEqual(['ailleurs', 'pendant'])
    expect(corps.nonTerminees.map((l) => l.id)).toEqual(['d-pendant'])
    expect(corps.encore).toBe(false)
    // Fini : la suite se lit sur la date de modification, depuis le début de cet appel.
    expect(corps.curseur).toEqual({ mode: 'modification', depuisMs: T0 + 10 * H - 2 * 60_000 })
  })

  it('[TC-377-36] pages de 50, reprises sans perte ni doublon', async () => {
    const liaison = await relie()
    maintenantMs = T0 + 10 * H
    await Promise.all(Array.from({ length: 60 }, (_, i) =>
      db.doc(`clients/store-a/history/h${String(i).padStart(2, '0')}`).set(ligne({ createdAt: ts(T0 + H + i * 1000) }))))
    const page1 = (await lire(liaison)).corps
    expect(page1.lignes).toHaveLength(50)
    expect(page1.encore).toBe(true)
    expect(page1.curseur.mode).toBe('creation')
    maintenantMs = T0 + 11 * H
    const page2 = (await lire(liaison, page1.curseur)).corps
    expect(page2.lignes).toHaveLength(10)
    expect(page2.encore).toBe(false)
    expect(new Set([...page1.lignes, ...page2.lignes].map((l) => l.id)).size).toBe(60)
    // La synchronisation repart du PREMIER appel, pas du dernier.
    expect(page2.curseur).toEqual({ mode: 'modification', depuisMs: T0 + 10 * H - 2 * 60_000 })
  })

  it('[TC-377-37] la synchronisation rend ce qui a changé, et les non terminées en entier', async () => {
    const liaison = await relie()
    await Promise.all([
      db.doc('clients/store-a/history/ancienne').set(ligne({ updatedAt: ts(T0 + H) })),
      db.doc('clients/store-a/history/modifiee').set(ligne({ updatedAt: ts(T0 + 5 * H) })),
      db.doc('clients/store-a/drafts/rouverte').set(ligne({
        statut: 'Non Terminées', reopenedFromHistoryId: 'h-vieille', updatedAt: ts(T0 + 5 * H),
      })),
    ])
    maintenantMs = T0 + 6 * H
    const { corps } = await lire(liaison, { mode: 'modification', depuisMs: T0 + 4 * H })
    expect(corps.lignes.map((l) => l.id)).toEqual(['modifiee'])
    expect(corps.lignes[0].updatedAt).toBe(T0 + 5 * H)
    expect(corps.nonTerminees).toEqual([expect.objectContaining({ id: 'rouverte', reopenedFromHistoryId: 'h-vieille' })])
    expect(corps.curseur).toEqual({ mode: 'modification', depuisMs: T0 + 6 * H - 2 * 60_000 })
  })

  it('[TC-377-38] après une autre liaison et un retour, le trou reste fermé', async () => {
    const premiere = await relie('cpt-1')               // cpt-1 de T0 à T0+2h
    maintenantMs = T0 + 2 * H
    await relie('cpt-2')                                // cpt-2 de T0+2h à T0+4h
    maintenantMs = T0 + 4 * H
    await relie('cpt-1')                                // cpt-1 de nouveau depuis T0+4h
    maintenantMs = T0 + 6 * H
    await Promise.all([
      db.doc('clients/store-a/history/a').set(ligne({ createdAt: ts(T0 + H) })),
      db.doc('clients/store-a/history/b').set(ligne({ createdAt: ts(T0 + 3 * H) })),
      db.doc('clients/store-a/history/c').set(ligne({ createdAt: ts(T0 + 5 * H) })),
    ])
    const { corps } = await lire(premiere)
    expect(corps.lignes.map((l) => l.id)).toEqual(['c', 'a'])
  })

  it('[TC-377-39] un curseur mal formé est une panne de l’appelant', async () => {
    const liaison = await relie()
    for (const curseur of [
      { mode: 'autre' }, { mode: 'modification' }, { mode: 'modification', depuisMs: -1 },
      { mode: 'creation', synchroDepuisMs: T0, apres: { s: 1, n: 0, chemin: 'stores/x' } },
    ]) {
      expect((await lire(liaison, curseur)).statut, JSON.stringify(curseur)).toBe(400)
    }
  })
})

describe('TC-377 — qui peut appeler le point d’entrée', () => {
  it('[TC-377-40] le compte de service dédié du projet, et lui seul', () => {
    expect(invokerOxygen({ GCLOUD_PROJECT: 'c2egf-b0b5a' })).toEqual(['oxygen-appel@c2egf-b0b5a.iam.gserviceaccount.com'])
    expect(invokerOxygen({ FIREBASE_CONFIG: JSON.stringify({ projectId: 'c2egf-b0b5a' }) }))
      .toEqual(['oxygen-appel@c2egf-b0b5a.iam.gserviceaccount.com'])
  })

  it('[TC-377-41] sans projet connu : privé, jamais public', () => {
    expect(invokerOxygen({})).toEqual(['private'])
    expect(invokerOxygen({ FIREBASE_CONFIG: 'pas du json' })).toEqual(['private'])
  })
})
