/**
 * TC-393 — Les demandes d'opération, côté point d'entrée Oxygen.
 *   Handlers avec l'émulateur Firestore, { db } et l'horloge injectés.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\demande-operation.md, version 4, §8 ;
 * précisé par docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.2.
 *
 * Comportement protégé :
 *   demander    : la clé est l'identifiant ; rejeu ; AUCUNE limite du nombre de
 *                 demandes en attente ; refus métier en 200 ; forme en 400.
 *   etatDemande : une demande de CE compte, sinon demande_inconnue.
 *   annuler     : en attente → annulee_agent ; sinon l'état réel, sans écrire.
 *   une liaison fermée n'empêche ni de relire ni d'annuler ses demandes.
 *   listerBoutiques, lireDemandes : voir la deuxième partie.
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

const T0 = Date.UTC(2026, 10, 17, 9, 0)
let maintenantMs = T0
const maintenant = () => maintenantMs
const OXYGEN = { actif: true, distributeurId: 'c2egf', nom: 'C2EGF' }

const appel = (corps, depsEnPlus = {}) =>
  traiterDemandeOxygen(corps, { db, Timestamp, maintenant, oxygen: OXYGEN, ...depsEnPlus })

const commun = { distributeurId: 'c2egf', compteOxygen: 'ox-1', liaison: 'L1' }
const base = (over = {}) => ({
  action: 'demander', ...commun,
  boutiqueId: 'b1', sens: 'depot', reseau: 'Orange', montant: 5000, saisieLe: T0 - 5000, cle: 'k-1',
  ...over,
})
const viser = (action, demandeId, over = {}) => ({ action, ...commun, boutiqueId: 'b1', demandeId, ...over })

const demandes = async (boutique = 'b1') => (await db.collection(`clients/${boutique}/demandesAgent`).get()).docs

beforeEach(async () => {
  maintenantMs = T0
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc('liaisonsOxygen/L1').set({ compteOxygen: 'ox-1', distributeurId: 'c2egf', clientId: 'c1', debutLe: Timestamp.fromMillis(T0 - 1000), finLe: null }),
    db.doc('liaisonsOxygen/L2').set({ compteOxygen: 'ox-2', distributeurId: 'c2egf', clientId: 'c2', debutLe: Timestamp.fromMillis(T0 - 1000), finLe: null }),
    db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', orange: '70123456' }),
    db.doc('globalClients/c2').set({ nom: 'SANOU', prenom: 'Issa', orange: '76543210' }),
    db.doc('stores/b1').set({ active: true, name: 'Boutique 1' }),
    db.doc('stores/b2').set({ active: false, name: 'Boutique 2' }),
  ])
}, 30000)

describe('TC-393 — demander', () => {
  it('[TC-393-01] écrit la demande en attente, sous la clé, avec l’agent tiré de la fiche', async () => {
    const r = await appel(base())
    expect(r.statut).toBe(200)
    expect(r.corps).toEqual({
      ok: true,
      demande: {
        id: 'k-1', boutiqueId: 'b1', boutiqueNom: 'Boutique 1', sens: 'depot', reseau: 'Orange', montant: 5000,
        etat: 'en_attente', creeLe: T0, reponduLe: null, operationId: null, nature: 'operation',
      },
    })
    const doc = (await db.doc('clients/b1/demandesAgent/k-1').get()).data()
    expect(doc).toMatchObject({
      distributeurId: 'c2egf', compteOxygen: 'ox-1', liaisonId: 'L1', clientId: 'c1',
      agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' },
      etat: 'en_attente', reponduLe: null, reponduPar: null, operationId: null,
    })
    expect(doc.saisieLe.toMillis()).toBe(T0 - 5000)
  })

  it('[TC-393-02] la même clé renvoyée rend la même demande, sans en créer une autre', async () => {
    const premiere = await appel(base())
    maintenantMs = T0 + 30_000
    const seconde = await appel(base())
    expect(seconde).toEqual(premiere)
    expect(await demandes()).toHaveLength(1)
  })

  it('[TC-393-21] un retrait rend le numéro dealer de la boutique pour son réseau ; un dépôt, non ; jamais recopié dans la demande', async () => {
    await db.doc('stores/b1').update({ dealer: { Orange: '76111111' } })
    const retrait = await appel(base({ sens: 'retrait', cle: 'k-r' }))
    expect(retrait.corps.demande.dealer).toBe('76111111')
    const depot = await appel(base({ sens: 'depot', cle: 'k-d' }))
    expect(depot.corps.demande).not.toHaveProperty('dealer')
    // Une fiche retouchée à la main : aucun numéro plutôt qu'un numéro faux.
    await db.doc('stores/b1').update({ dealer: { Orange: '76 11 11 11' } })
    const douteux = await appel(base({ sens: 'retrait', cle: 'k-x' }))
    expect(douteux.corps.demande).not.toHaveProperty('dealer')
    for (const d of await demandes()) expect(d.data()).not.toHaveProperty('dealer')
  })

  it('[TC-393-22] rejouée après un changement de numéro, la demande rend le numéro du moment', async () => {
    await db.doc('stores/b1').update({ dealer: { Orange: '76111111' } })
    expect((await appel(base({ sens: 'retrait' }))).corps.demande.dealer).toBe('76111111')
    await db.doc('stores/b1').update({ dealer: { Orange: '76222222' } })
    expect((await appel(base({ sens: 'retrait' }))).corps.demande.dealer).toBe('76222222')
  })

  it('[TC-393-03] la même clé venue d’un autre compte est une demande mal formée', async () => {
    await appel(base())
    const r = await appel(base({ compteOxygen: 'ox-2', liaison: 'L2' }))
    expect(r.statut).toBe(400)
    expect(await demandes()).toHaveLength(1)
  })

  it('[TC-393-04] aucune limite : deux demandes en attente du même agent passent toutes les deux', async () => {
    expect((await appel(base())).corps.ok).toBe(true)
    expect((await appel(base({ cle: 'k-2', sens: 'retrait', montant: 7000 }))).corps.ok).toBe(true)
    const docs = await demandes()
    expect(docs.map((d) => d.data().etat)).toEqual(['en_attente', 'en_attente'])
  })

  it('[TC-393-05] montant ou réseau refusés en 200, sans rien écrire', async () => {
    for (const montant of [0, 12.5, '5000', -100]) {
      const r = await appel(base({ montant }))
      expect(r).toEqual({ statut: 200, corps: { ok: false, raison: 'montant_invalide' } })
    }
    expect((await appel(base({ reseau: 'Moov' }))).corps).toEqual({ ok: false, raison: 'reseau_invalide' })
    expect(await demandes()).toHaveLength(0)
  })

  it('[TC-393-06] sens, clé, moment de saisie ou champ inconnus : 400', async () => {
    for (const over of [{ sens: 'credit' }, { cle: 'a/b' }, { cle: '' }, { saisieLe: -1 }, { saisieLe: '10:42' }, { boutiqueId: 'x/y' }, { inconnu: 1 }]) {
      expect((await appel(base(over))).statut).toBe(400)
    }
    expect(await demandes()).toHaveLength(0)
  })

  it('[TC-393-07] liaison fermée, d’un autre compte ou absente', async () => {
    await db.doc('liaisonsOxygen/L1').update({ finLe: Timestamp.fromMillis(T0 - 10) })
    expect((await appel(base())).corps).toEqual({ ok: false, raison: 'liaison_fermee' })
    expect((await appel(base({ compteOxygen: 'ox-9' }))).corps).toEqual({ ok: false, raison: 'liaison_inconnue' })
    expect((await appel(base({ liaison: 'L404' }))).corps).toEqual({ ok: false, raison: 'liaison_inconnue' })
    expect(await demandes()).toHaveLength(0)
  })

  it('[TC-393-08] boutique désactivée ou inconnue', async () => {
    expect((await appel(base({ boutiqueId: 'b2' }))).corps).toEqual({ ok: false, raison: 'boutique_indisponible' })
    expect((await appel(base({ boutiqueId: 'b404' }))).corps).toEqual({ ok: false, raison: 'boutique_indisponible' })
    expect(await demandes('b2')).toHaveLength(0)
  })

  it('[TC-393-09] une fiche sans code sur ce réseau ne pourrait jamais être validée : refusée', async () => {
    await db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', codeAgent: '', numeroAgent: '' })
    expect((await appel(base())).corps).toEqual({ ok: false, raison: 'reseau_invalide' })
    expect(await demandes()).toHaveLength(0)
    // Sans `orange` mais avec un code agent : le compte Orange se dérive, comme à l'app.
    await db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', codeAgent: '1234567' })
    expect((await appel(base())).corps.ok).toBe(true)
    expect((await db.doc('clients/b1/demandesAgent/k-1').get()).data().agent.code).toBe('1234567')
  })

  it('[TC-393-10] distributeur éteint par le profil : 403', async () => {
    expect((await appel(base(), { oxygen: { ...OXYGEN, actif: false } })).statut).toBe(403)
  })
})

describe('TC-393 — etatDemande et annuler', () => {
  it('[TC-393-11] etatDemande rend la demande de ce compte, et rien de celle d’un autre', async () => {
    await appel(base())
    const r = await appel(viser('etatDemande', 'k-1'))
    expect(r.statut).toBe(200)
    expect(r.corps).toMatchObject({ ok: true, demande: { id: 'k-1', etat: 'en_attente' } })
    expect((await appel(viser('etatDemande', 'k-1', { compteOxygen: 'ox-2', liaison: 'L2' }))).corps)
      .toEqual({ ok: false, raison: 'demande_inconnue' })
    expect((await appel(viser('etatDemande', 'k-404'))).corps).toEqual({ ok: false, raison: 'demande_inconnue' })
  })

  it('[TC-393-12] annuler ferme une demande en attente ; sur une demande déjà traitée, rend son état réel', async () => {
    await appel(base())
    maintenantMs = T0 + 60_000
    const r = await appel(viser('annuler', 'k-1'))
    expect(r.corps).toMatchObject({ ok: true, demande: { id: 'k-1', etat: 'annulee_agent', reponduLe: T0 + 60_000 } })
    expect((await db.doc('clients/b1/demandesAgent/k-1').get()).data().reponduPar).toBeNull()

    await appel(base({ cle: 'k-3' }))
    const reponduLe = Timestamp.fromMillis(T0 + 1000)
    await db.doc('clients/b1/demandesAgent/k-3').update({ etat: 'validee', reponduLe, operationId: 'k-3', reponduPar: 'u-a' })
    const deja = await appel(viser('annuler', 'k-3'))
    expect(deja.corps).toMatchObject({ ok: true, demande: { etat: 'validee', operationId: 'k-3', reponduLe: T0 + 1000 } })
    expect((await db.doc('clients/b1/demandesAgent/k-3').get()).data()).toMatchObject({ etat: 'validee', reponduPar: 'u-a' })

    expect((await appel(viser('annuler', 'k-1', { compteOxygen: 'ox-2', liaison: 'L2' }))).corps)
      .toEqual({ ok: false, raison: 'demande_inconnue' })
  })

  it('[TC-393-13] une liaison fermée laisse relire et annuler ses propres demandes', async () => {
    await appel(base())
    await db.doc('liaisonsOxygen/L1').update({ finLe: Timestamp.fromMillis(T0 + 10) })
    expect((await appel(viser('etatDemande', 'k-1'))).corps).toMatchObject({ ok: true, demande: { etat: 'en_attente' } })
    expect((await appel(viser('annuler', 'k-1'))).corps).toMatchObject({ ok: true, demande: { etat: 'annulee_agent' } })
  })
})

describe('TC-393 — listerBoutiques', () => {
  const lister = (over = {}) => appel({ action: 'listerBoutiques', ...commun, ...over })
  const ligne = (boutique, id, ms) => db.doc(`clients/${boutique}/history/${id}`)
    .set({ clientId: 'c1', type: 'Dépôt', montant: 1000, createdAt: Timestamp.fromMillis(ms) })

  beforeEach(async () => {
    await db.doc('stores/b3').set({ active: true, name: 'Atelier 3' })
    await Promise.all([
      ligne('b1', 'h1', T0 - 9000),
      ligne('b1', 'h2', T0 - 5000),
      ligne('b3', 'h3', T0 - 1000),
      ligne('b2', 'h4', T0 - 500),
      db.doc('clients/b1/history/h5').set({ clientId: 'c2', type: 'Dépôt', montant: 1, createdAt: Timestamp.fromMillis(T0) }),
    ])
  })

  it('[TC-393-14] servies : les boutiques distinctes de l’historique de la fiche, la plus récente d’abord, sans les désactivées', async () => {
    const r = await lister()
    expect(r.statut).toBe(200)
    expect(r.corps.servies).toEqual([
      { id: 'b3', nom: 'Atelier 3', derniereLe: T0 - 1000 },
      { id: 'b1', nom: 'Boutique 1', derniereLe: T0 - 5000 },
    ])
  })

  it('[TC-393-15] toutes les boutiques actives seulement sur demande, triées par nom ; les réseaux du profil', async () => {
    const sans = await lister()
    expect(sans.corps).not.toHaveProperty('boutiques')
    expect(sans.corps.reseaux).toEqual(['Orange'])
    const avec = await lister({ avecToutes: true })
    expect(avec.corps.boutiques).toEqual([{ id: 'b3', nom: 'Atelier 3' }, { id: 'b1', nom: 'Boutique 1' }])
    expect((await lister({ avecToutes: 'oui' })).statut).toBe(400)
  })

  it('[TC-393-20] le numéro flotte accompagne la boutique qui en a un ; le numéro dealer, seulement la liste complète', async () => {
    // Contrat §9.1 (v8, 2026-11-18) : Oxygen RETIENT le premier numéro dealer
    // vu par boutique ; un changement bloque le retrait jusqu'au déblocage
    // signé par l'utilisateur. Il le lit dans `boutiques`, jamais dans `servies`.
    await db.doc('stores/b1').update({ flotte: '70111111', dealer: { Orange: '76111111' } })
    const r = await lister({ avecToutes: true })
    expect(r.corps.servies).toEqual([
      { id: 'b3', nom: 'Atelier 3', derniereLe: T0 - 1000 },
      { id: 'b1', nom: 'Boutique 1', derniereLe: T0 - 5000, flotte: '70111111' },
    ])
    expect(r.corps.boutiques).toEqual([
      { id: 'b3', nom: 'Atelier 3' },
      { id: 'b1', nom: 'Boutique 1', flotte: '70111111', dealer: { Orange: '76111111' } },
    ])
  })

  it('[TC-393-23] un numéro dealer non conforme, ou rangé sous un autre réseau, n’entre pas dans la liste', async () => {
    await db.doc('stores/b1').update({ dealer: { Orange: '76 11 11 11', Moov: '70000000' } })
    await db.doc('stores/b3').update({ dealer: { Orange: '76333333', Moov: '70000000' } })
    const { boutiques } = (await lister({ avecToutes: true })).corps
    expect(boutiques).toEqual([
      { id: 'b3', nom: 'Atelier 3', dealer: { Orange: '76333333' } },
      { id: 'b1', nom: 'Boutique 1' },
    ])
  })

  it('[TC-393-16] une liaison fermée ne liste plus rien', async () => {
    await db.doc('liaisonsOxygen/L1').update({ finLe: Timestamp.fromMillis(T0 - 10) })
    expect((await lister()).corps).toEqual({ ok: false, raison: 'liaison_fermee' })
  })
})

describe('TC-393 — lireDemandes', () => {
  const lire = (over = {}) => appel({ action: 'lireDemandes', ...commun, ...over })
  const JOUR = 24 * 60 * 60 * 1000

  beforeEach(async () => {
    await appel(base())
    maintenantMs = T0 + 500
    await appel(base({ cle: 'k-2', sens: 'retrait' }))
    maintenantMs = T0 + 1000
    await appel(viser('annuler', 'k-2'))
    await Promise.all([
      db.doc('clients/b1/demandesAgent/k-vieille').set({
        compteOxygen: 'ox-1', boutiqueId: 'b1', etat: 'rejetee', creeLe: Timestamp.fromMillis(T0 - 9 * JOUR), reponduLe: Timestamp.fromMillis(T0 - 8 * JOUR),
      }),
      db.doc('clients/b1/demandesAgent/k-autre').set({
        compteOxygen: 'ox-2', boutiqueId: 'b1', etat: 'en_attente', creeLe: Timestamp.fromMillis(T0), reponduLe: null,
      }),
    ])
  })

  it('[TC-393-17] les en attente et les fermées depuis moins de 7 jours, de ce compte, la plus récente d’abord', async () => {
    const r = await lire()
    expect(r.statut).toBe(200)
    expect(r.corps.ok).toBe(true)
    expect(r.corps.demandes.map((d) => [d.id, d.etat])).toEqual([['k-2', 'annulee_agent'], ['k-1', 'en_attente']])
  })

  it('[TC-393-18] enAttente : seulement les demandes en attente', async () => {
    const r = await lire({ enAttente: true })
    expect(r.corps.demandes.map((d) => d.id)).toEqual(['k-1'])
    expect((await lire({ enAttente: 1 })).statut).toBe(400)
  })

  it('[TC-393-19] une liaison fermée laisse relire ses demandes', async () => {
    await db.doc('liaisonsOxygen/L1').update({ finLe: Timestamp.fromMillis(T0 + 10) })
    expect((await lire()).corps.demandes).toHaveLength(2)
  })
})
