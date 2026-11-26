/**
 * TC-420 — Le remboursement depuis l'app, côté point d'entrée Oxygen.
 *   Handlers avec l'émulateur Firestore, { db } et l'horloge injectés.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\demande-operation.md, version 10, §11.2.
 *
 * Comportement protégé :
 *   rembourser      : seulement un Dépôt « Non Terminées » de CET agent, créé
 *                     pendant ses périodes ; plafond = reste − l'autre demande
 *                     en attente ; une demande en attente par mode ; rejeu.
 *   rembourserSiege : aucune cible, aucun contrôle de dette.
 *   listerBoutiques : `remboursement: true` au niveau de la réponse.
 *   profil fermé    : ni actions (400), ni drapeau.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { traiterDemandeOxygen } from '../../functions/src/oxygen/pointEntreeOxygen.js'

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })

const T0 = Date.UTC(2026, 10, 26, 9, 0)
const OXYGEN = { actif: true, distributeurId: 'c2egf', nom: 'C2EGF', remboursement: true }

const appel = (corps, oxygen = OXYGEN) =>
  traiterDemandeOxygen(corps, { db, Timestamp, maintenant: () => T0, oxygen })

const commun = { distributeurId: 'c2egf', compteOxygen: 'ox-1', liaison: 'L1' }
const rembourser = (over = {}) => appel({
  action: 'rembourser', ...commun,
  boutiqueId: 'b1', operationId: 'op-1', montant: 5000, mode: 'Cash', saisieLe: T0 - 2000, cle: 'r-1',
  ...over,
})
const rembourserSiege = (over = {}) => appel({
  action: 'rembourserSiege', ...commun,
  boutiqueId: 'b1', montant: 3000, mode: 'Orange Money', saisieLe: T0 - 2000, cle: 's-1',
  ...over,
})
const raison = async (promesse) => (await promesse).corps.raison

const ligne = (over = {}) => ({
  type: 'Dépôt', montant: 20_000, clientId: 'c1', reseau: 'Orange', statut: 'Non Terminées',
  createdAt: Timestamp.fromMillis(T0 - 500), storeId: 'b1', ...over,
})

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc('liaisonsOxygen/L1').set({ compteOxygen: 'ox-1', distributeurId: 'c2egf', clientId: 'c1', debutLe: Timestamp.fromMillis(T0 - 1000), finLe: null }),
    db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', orange: '70123456' }),
    db.doc('stores/b1').set({ active: true, name: 'Boutique 1' }),
    db.doc('stores/b2').set({ active: false, name: 'Boutique 2' }),
    db.doc('clients/b1/drafts/op-1').set(ligne()),
    db.doc('clients/b1/drafts/op-autre').set(ligne({ clientId: 'c2' })),
    db.doc('clients/b1/drafts/op-avant').set(ligne({ createdAt: Timestamp.fromMillis(T0 - 5000) })),
    db.doc('clients/b1/drafts/op-retrait').set(ligne({ type: 'Retrait' })),
    db.doc('clients/b1/drafts/op-siege').set(ligne({ type: 'Remb. siège', balanceType: 'stock' })),
    db.doc('clients/b1/drafts/op-partielle').set(ligne({ paidAmount: 8000, remainingAmount: 12_000, settlementStatus: 'partial' })),
  ])
}, 30000)

describe('TC-420 — rembourser', () => {
  it('[TC-420-01] une demande en attente sur la ligne visée, et la même au rejeu', async () => {
    const r = await rembourser()
    expect(r.statut).toBe(200)
    expect(r.corps).toEqual({
      ok: true,
      demande: {
        id: 'r-1', boutiqueId: 'b1', boutiqueNom: 'Boutique 1', sens: 'depot', reseau: 'Orange', montant: 5000,
        etat: 'en_attente', creeLe: T0, reponduLe: null, operationId: null,
        nature: 'remboursement', cibleId: 'op-1', mode: 'Cash',
      },
    })
    const doc = (await db.doc('clients/b1/demandesAgent/r-1').get()).data()
    expect(doc).toMatchObject({ compteOxygen: 'ox-1', liaisonId: 'L1', clientId: 'c1', agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' } })

    expect((await rembourser()).corps).toEqual(r.corps)
    expect((await db.collection('clients/b1/demandesAgent').get()).size).toBe(1)
  })

  it('[TC-420-02] une ligne qu’il ne voit pas, ou qui n’est pas un crédit, ou un montant ou un mode faux : refusé', async () => {
    expect(await raison(rembourser({ operationId: 'op-autre' }))).toBe('operation_inconnue')
    expect(await raison(rembourser({ operationId: 'op-absente' }))).toBe('operation_inconnue')
    expect(await raison(rembourser({ operationId: 'op-avant' }))).toBe('operation_inconnue')
    expect(await raison(rembourser({ operationId: 'op-retrait' }))).toBe('pas_un_credit')
    expect(await raison(rembourser({ operationId: 'op-siege' }))).toBe('pas_un_credit')
    expect(await raison(rembourser({ montant: 0 }))).toBe('montant_invalide')
    expect(await raison(rembourser({ montant: 1.5 }))).toBe('montant_invalide')
    expect(await raison(rembourser({ montant: 20_001 }))).toBe('montant_invalide')
    expect(await raison(rembourser({ operationId: 'op-partielle', montant: 12_001 }))).toBe('montant_invalide')
    expect(await raison(rembourser({ mode: 'Moov Money' }))).toBe('mode_invalide')
    expect((await db.collection('clients/b1/demandesAgent').get()).size).toBe(0)
  })

  it('[TC-420-02b] même 1 F passe ; l’autre mode n’a plus que le reste moins ce franc', async () => {
    expect((await rembourser({ montant: 1 })).corps.ok).toBe(true)
    expect((await rembourser({ montant: 20_000, mode: 'Orange Money', cle: 'r-2' })).corps.ok).toBe(false)
  })

  it('[TC-420-03] deux demandes, une par mode, ne dépassent jamais le reste à elles deux', async () => {
    expect((await rembourser({ montant: 12_000, mode: 'Orange Money', cle: 'r-om' })).corps.ok).toBe(true)
    expect(await raison(rembourser({ montant: 9000, mode: 'Cash', cle: 'r-c1' }))).toBe('montant_invalide')
    expect((await rembourser({ montant: 8000, mode: 'Cash', cle: 'r-c2' })).corps.ok).toBe(true)
    expect(await raison(rembourser({ montant: 1, mode: 'Orange Money', cle: 'r-om2' }))).toBe('deja_en_attente')
  })

  it('[TC-420-03b] une demande fermée ne bloque plus son mode', async () => {
    await rembourser({ montant: 4000, mode: 'Cash', cle: 'r-a' })
    await db.doc('clients/b1/demandesAgent/r-a').update({ etat: 'rejetee' })
    expect((await rembourser({ montant: 20_000, mode: 'Cash', cle: 'r-b' })).corps.ok).toBe(true)
  })

  it('[TC-420-04] liaison fermée, boutique fermée : refusé', async () => {
    await db.doc('liaisonsOxygen/L1').update({ finLe: Timestamp.fromMillis(T0 - 10) })
    expect(await raison(rembourser())).toBe('liaison_fermee')
    await db.doc('liaisonsOxygen/L1').update({ finLe: null })
    await db.doc('clients/b2/drafts/op-1').set(ligne({ storeId: 'b2' }))
    expect(await raison(rembourser({ boutiqueId: 'b2' }))).toBe('boutique_indisponible')
  })

  it('[TC-420-04b] une forme fausse est une panne de l’appelant (400)', async () => {
    expect((await rembourser({ cle: 'a/b' })).statut).toBe(400)
    expect((await rembourser({ operationId: '' })).statut).toBe(400)
    expect((await rembourser({ saisieLe: 'hier' })).statut).toBe(400)
    expect((await rembourser({ enPlus: 1 })).statut).toBe(400)
  })
})

describe('TC-420 — rembourserSiege', () => {
  it('[TC-420-05] une demande sans cible, au premier réseau de la boutique', async () => {
    const r = await rembourserSiege()
    expect(r.corps).toEqual({
      ok: true,
      demande: {
        id: 's-1', boutiqueId: 'b1', boutiqueNom: 'Boutique 1', sens: 'depot', reseau: 'Orange', montant: 3000,
        etat: 'en_attente', creeLe: T0, reponduLe: null, operationId: null,
        nature: 'remb_siege', mode: 'Orange Money',
      },
    })
    expect(await raison(rembourserSiege({ cle: 's-2', montant: 0 }))).toBe('montant_invalide')
    expect(await raison(rembourserSiege({ cle: 's-3', mode: 'Espèces' }))).toBe('mode_invalide')
    expect(await raison(rembourserSiege({ cle: 's-4', boutiqueId: 'b2' }))).toBe('boutique_indisponible')
  })
})

describe('TC-420 — les actions communes', () => {
  it('[TC-420-06] annuler, lireDemandes et etatDemande rendent la nature, la cible et le mode', async () => {
    await rembourser()
    const viser = (action) => appel({ action, ...commun, boutiqueId: 'b1', demandeId: 'r-1' })
    expect((await viser('etatDemande')).corps.demande).toMatchObject({ nature: 'remboursement', cibleId: 'op-1', mode: 'Cash' })
    const lues = (await appel({ action: 'lireDemandes', ...commun })).corps.demandes
    expect(lues[0]).toMatchObject({ nature: 'remboursement', cibleId: 'op-1', mode: 'Cash' })
    expect((await viser('annuler')).corps.demande).toMatchObject({ etat: 'annulee_agent', nature: 'remboursement', cibleId: 'op-1' })
  })

  it('[TC-420-07] listerBoutiques porte le drapeau à côté des réseaux ; profil fermé : ni drapeau, ni actions', async () => {
    const ouvert = (await appel({ action: 'listerBoutiques', ...commun })).corps
    expect(ouvert).toMatchObject({ ok: true, reseaux: ['Orange'], remboursement: true })

    const ferme = { ...OXYGEN, remboursement: false }
    expect((await appel({ action: 'listerBoutiques', ...commun }, ferme)).corps).not.toHaveProperty('remboursement')
    expect((await appel({ action: 'rembourser', ...commun, boutiqueId: 'b1', operationId: 'op-1', montant: 1, mode: 'Cash', saisieLe: T0, cle: 'x' }, ferme)).statut).toBe(400)
  })
})
