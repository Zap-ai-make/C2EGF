/**
 * TC-341 — l'annuaire des clients, sur émulateur (docs/rester-dans-le-quota-gratuit.md §A1).
 *
 * Le déclencheur tient une tranche à jour à chaque écriture d'une fiche ; la
 * reconstruction remplit l'annuaire entier. Les deux écrivent ce que le
 * navigateur lira à la place des ~15 700 fiches.
 *
 * Prérequis : firebase emulators:exec --only firestore --project demo-akayis-test
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import {
  COLLECTION_ANNUAIRE,
  DOC_ETAT,
  NOMBRE_TRANCHES,
  majAnnuaireClientsHandler,
  reconstruireAnnuaireClientsHandler,
  trancheDe,
} from '../../functions/src/clients/annuaireClients.js'

let adminApp
let db
const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${PROJECT_ID}"`)
  adminApp = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(adminApp)
})

afterAll(async () => {
  if (adminApp) await deleteApp(adminApp)
})

beforeEach(async () => {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider l'émulateur Firestore : HTTP ${res.status}`)
})

const deps = () => ({ db, FieldValue, FieldPath })
const evenement = (clientId) => ({ params: { clientId } })
const tranche = async (clientId) => (await db.doc(`${COLLECTION_ANNUAIRE}/${trancheDe(clientId)}`).get()).data()
const fiche = (clientId, donnees) => db.doc(`globalClients/${clientId}`).set(donnees)

describe('TC-341 — le déclencheur suit chaque fiche', () => {
  it('[TC-341-01] une fiche créée entre dans sa tranche, sans les champs que personne ne lit', async () => {
    await fiche('c1', { nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '1234567', registeredBy: 'uid-x', updatedAt: 'hier' })
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    const t = await tranche('c1')
    expect(t.entrees.c1).toEqual({ nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '1234567' })
    expect(t.majLe).toBeDefined()
  })

  it('[TC-341-02] un champ retiré de la fiche disparaît de l’entrée', async () => {
    await fiche('c1', { nom: 'OUEDRAOGO', prenom: 'Salif', numeroAgent: '70123456' })
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    await fiche('c1', { nom: 'OUEDRAOGO', prenom: 'Salif' })
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    expect((await tranche('c1')).entrees.c1).toEqual({ nom: 'OUEDRAOGO', prenom: 'Salif' })
  })

  it('[TC-341-03] une fiche supprimée quitte sa tranche, les autres y restent', async () => {
    // Deux fiches de la même tranche : on cherche un second identifiant qui y tombe.
    const voisin = Array.from({ length: 2000 }, (_, i) => `v${i}`).find((id) => trancheDe(id) === trancheDe('c1'))
    await fiche('c1', { nom: 'A', prenom: 'B' })
    await fiche(voisin, { nom: 'C', prenom: 'D' })
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    await majAnnuaireClientsHandler(evenement(voisin), deps())
    await db.doc('globalClients/c1').delete()
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    const t = await tranche('c1')
    expect(t.entrees.c1).toBeUndefined()
    expect(t.entrees[voisin]).toEqual({ nom: 'C', prenom: 'D' })
  })

  it('[TC-341-04] un événement en retard écrit l’état COURANT de la fiche, pas le sien', async () => {
    // L'événement de la v1 n'arrive qu'après l'écriture de la v2 : la fiche
    // est relue, l'annuaire porte la v2.
    await fiche('c1', { nom: 'KABORE', prenom: 'Awa' })
    await fiche('c1', { nom: 'KABORE', prenom: 'Awa', localite: 'Koudougou' })
    await majAnnuaireClientsHandler(evenement('c1'), deps())
    expect((await tranche('c1')).entrees.c1.localite).toBe('Koudougou')
  })

  it('[TC-341-05] un événement sans identifiant n’écrit rien', async () => {
    expect(await majAnnuaireClientsHandler({ params: {} }, deps())).toEqual({ ignore: true })
    expect((await db.collection(COLLECTION_ANNUAIRE).get()).size).toBe(0)
  })
})

describe('TC-341 — la reconstruction remplit l’annuaire entier', () => {
  it('[TC-341-06] toutes les tranches, chaque fiche dans la sienne, puis l’état « complet »', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `f${i}`)
    await Promise.all(ids.map((id, i) => fiche(id, { nom: `NOM${i}`, prenom: 'P', registeredBy: 'x' })))
    const rendu = await reconstruireAnnuaireClientsHandler(deps())
    expect(rendu).toEqual({ fiches: 50, tranches: NOMBRE_TRANCHES })

    const annuaire = await db.collection(COLLECTION_ANNUAIRE).get()
    expect(annuaire.size).toBe(NOMBRE_TRANCHES + 1)
    const etat = (await db.doc(`${COLLECTION_ANNUAIRE}/${DOC_ETAT}`).get()).data()
    expect(etat).toMatchObject({ complet: true, tranches: NOMBRE_TRANCHES, fiches: 50 })
    for (const id of ids) expect((await tranche(id)).entrees[id]).toEqual({ nom: `NOM${ids.indexOf(id)}`, prenom: 'P' })
  })

  it('[TC-341-07] une entrée orpheline — fiche supprimée sans déclencheur — disparaît', async () => {
    await db.doc(`${COLLECTION_ANNUAIRE}/${trancheDe('fantome')}`).set({ entrees: { fantome: { nom: 'X', prenom: 'Y' } } })
    await fiche('c1', { nom: 'A', prenom: 'B' })
    await reconstruireAnnuaireClientsHandler(deps())
    expect((await tranche('fantome')).entrees.fantome).toBeUndefined()
  })

  it('[TC-341-08] une base vide donne un annuaire vide mais complet', async () => {
    expect(await reconstruireAnnuaireClientsHandler(deps())).toEqual({ fiches: 0, tranches: NOMBRE_TRANCHES })
    expect((await db.doc(`${COLLECTION_ANNUAIRE}/${DOC_ETAT}`).get()).data().complet).toBe(true)
  })
})
