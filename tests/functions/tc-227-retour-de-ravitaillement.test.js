import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-227 — Le retour de ravitaillement (S8).
 *
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────
 * La boutique reçoit du stock ou des espèces de plusieurs personnes dans la
 * journée, et doit rendre à CHACUNE ce qu'elle a reçu d'elle. Deux propriétés
 * portent tout le reste :
 *
 *   1. UNE SEULE RÉSERVE BOUGE. C'est la raison d'être de l'opération : un dépôt
 *      validé en déplace deux, et la boutique voulait juste faire sortir un
 *      montant. Si un deuxième solde bouge, le geste a échoué même si le total
 *      semble juste.
 *
 *   2. LE RESTE DÛ EST EXACT. Il descend à zéro et pas en dessous, il remonte
 *      quand on défait un retour, et il distingue les livraisons d'avant ce lot
 *      — dont le reste dû est inconnaissable — de celles qui sont vraiment
 *      soldées.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-retour-admin'
const STORE = 'store-retour-a'
const request = data => ({ auth: { uid: UID }, data })

const STOCK_INITIAL = 500_000
const LIQUIDITE_INITIALE = 300_000

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique A', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({
    balances: { Orange: { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE } },
  })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const ligne = async id => (await db.doc(`clients/${STORE}/history/${id}`).get()).data()
const boutique = async () => (await db.doc(`stores/${STORE}`).get()).data()
const poserSoldes = (stock, liquidite) =>
  db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock, liquidite } } })

const ravitailler = ({ amount = 100_000, balanceType = 'stock', expediteur = 'Patron' } = {}) =>
  call({ action: 'replenish', amount, balanceType, expediteur })

// ═══════════════════════════════════════════════════════════════════════════
// L'expéditeur
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-227 — l’expéditeur', () => {
  it('[TC-227-1] un ravitaillement porte son expéditeur et son reste dû', async () => {
    const { id } = await ravitailler({ amount: 100_000, expediteur: 'Mme Sawadogo' })
    const rav = await ligne(id)

    expect(rav.expediteur).toBe('Mme Sawadogo')
    expect(rav.montant).toBe(100_000)
    expect(rav.returnedAmount).toBe(0)
    expect(rav.remainingAmount).toBe(100_000)
    expect(rav.replenishmentStatus).toBe('open')
  })

  it('[TC-227-2] un ravitaillement sans expéditeur est refusé', async () => {
    await expect(call({ action: 'replenish', amount: 50_000, balanceType: 'stock' })).rejects.toThrow()
    await expect(call({ action: 'replenish', amount: 50_000, balanceType: 'stock', expediteur: '   ' })).rejects.toThrow()
  })

  /**
   * LA PROPRIÉTÉ QUI ÉVITE TROIS CRÉANCIERS POUR UNE PERSONNE.
   *
   * La liste du soir se groupe par expéditeur. Si « Mme Sawadogo », « mme
   * sawadogo » et « Mme  Sawadogo » entrent comme trois noms, chaque total est
   * juste et leur SÉPARATION est fausse — l'erreur que personne ne voit.
   */
  it('[TC-227-3] une casse ou un espace de différence ne crée pas un second expéditeur', async () => {
    const a = await ravitailler({ expediteur: 'Mme Sawadogo' })
    const b = await ravitailler({ expediteur: '  mme   sawadogo ' })
    const c = await ravitailler({ expediteur: 'MME SAWADOGO' })

    for (const { id } of [a, b, c]) {
      expect((await ligne(id)).expediteur).toBe('Mme Sawadogo')
    }
    // Et le nom du profil n'a pas été recopié dans la mémoire de la boutique.
    expect((await boutique()).ravitaillementExpediteurs ?? []).toEqual([])
  })

  it('[TC-227-4] un nom inédit est mémorisé pour la boutique', async () => {
    await ravitailler({ expediteur: 'Issouf' })
    expect((await boutique()).ravitaillementExpediteurs).toEqual(['Issouf'])

    // Et il ne s'ajoute pas une seconde fois à la livraison suivante.
    await ravitailler({ expediteur: 'issouf' })
    expect((await boutique()).ravitaillementExpediteurs).toEqual(['Issouf'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Le retour
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-227 — le retour', () => {
  /**
   * L'ASSERTION QUI VAUT LE PLUS CHER DU FICHIER.
   *
   * Un dépôt validé déplace DEUX réserves. Toute la raison d'être du retour est
   * de n'en déplacer qu'une. Si la liquidité bouge ici, le geste a échoué —
   * même si le stock, lui, est juste.
   */
  it('[TC-227-5] un retour ne déplace QUE la réserve choisie', async () => {
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })
    expect(await soldes()).toEqual({ stock: 600_000, liquidite: LIQUIDITE_INITIALE })

    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 40_000, balanceType: 'stock' })

    expect(await soldes()).toEqual({ stock: 560_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-227-6] la boucle complète est neutre', async () => {
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })
    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 100_000, balanceType: 'stock' })

    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
    expect((await ligne(id)).remainingAmount).toBe(0)
    expect((await ligne(id)).replenishmentStatus).toBe('settled')
  })

  it('[TC-227-7] on rend dans un autre vase que celui reçu', async () => {
    // On reçoit du stock électronique, on rend des espèces : c'est la même
    // dette, exprimée dans deux vases.
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })
    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 70_000, balanceType: 'liquidite' })

    expect(await soldes()).toEqual({ stock: 600_000, liquidite: 230_000 })
    expect((await ligne(id)).remainingAmount).toBe(30_000)
  })

  it('[TC-227-8] les retours s’accumulent jusqu’au solde', async () => {
    const { id } = await ravitailler({ amount: 100_000 })

    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 30_000, balanceType: 'stock' })
    expect((await ligne(id)).remainingAmount).toBe(70_000)

    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 70_000, balanceType: 'stock' })
    const rav = await ligne(id)
    expect(rav.returnedAmount).toBe(100_000)
    expect(rav.remainingAmount).toBe(0)
    expect(rav.replenishmentStatus).toBe('settled')
  })

  it('[TC-227-9] un retour supérieur au reste dû est refusé', async () => {
    const { id } = await ravitailler({ amount: 100_000 })
    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 60_000, balanceType: 'stock' })

    await expect(
      call({ action: 'returnReplenishment', replenishmentId: id, amount: 50_000, balanceType: 'stock' }),
    ).rejects.toThrow(/reste/i)

    // Et rien n'a bougé : un refus ne laisse pas de trace sur les soldes.
    expect(await soldes()).toEqual({ stock: 540_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-227-10] un retour sur une livraison soldée est refusé', async () => {
    const { id } = await ravitailler({ amount: 50_000 })
    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 50_000, balanceType: 'stock' })

    await expect(
      call({ action: 'returnReplenishment', replenishmentId: id, amount: 1_000, balanceType: 'stock' }),
    ).rejects.toThrow(/solde/i)
  })

  /**
   * Le refus « réserve insuffisante » n'est pas réécrit dans l'action : il est
   * porté par `adjustBalanceValue` pour tout delta négatif, avec le disponible
   * dans son message. Ce test vérifie qu'il remonte bien jusqu'à l'appelant.
   */
  it('[TC-227-11] un retour que la réserve ne couvre pas est refusé, avec le disponible', async () => {
    await poserSoldes(STOCK_INITIAL, 50_000)
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })

    await expect(
      call({ action: 'returnReplenishment', replenishmentId: id, amount: 80_000, balanceType: 'liquidite' }),
    ).rejects.toThrow(/50\s?000/)

    expect(await soldes()).toEqual({ stock: 600_000, liquidite: 50_000 })
  })

  it('[TC-227-12] un retour sur une ligne qui n’est pas un ravitaillement est refusé', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 20_000, statut: 'Validée' },
    })

    await expect(
      call({ action: 'returnReplenishment', replenishmentId: id, amount: 10_000, balanceType: 'stock' }),
    ).rejects.toThrow()
  })

  /**
   * LES LIVRAISONS D'AVANT CE LOT.
   *
   * Elles n'ont pas de reste dû, et il est INCONNAISSABLE : ce qui en a déjà
   * été rendu ne fut jamais enregistré. Accepter un retour dessus réclamerait
   * un montant que la boutique a peut-être déjà remis.
   */
  it('[TC-227-13] un retour sur une livraison antérieure au suivi est refusé', async () => {
    const ref = db.collection(`clients/${STORE}/history`).doc()
    await ref.set({ type: 'Ravitaillement', montant: 100_000, reseau: 'Orange', balanceType: 'stock', statut: 'Validée', storeId: STORE })

    await expect(
      call({ action: 'returnReplenishment', replenishmentId: ref.id, amount: 10_000, balanceType: 'stock' }),
    ).rejects.toThrow(/anterieur|antérieur|inconnu/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Défaire un retour
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-227 — défaire un retour', () => {
  /**
   * LES DEUX MOITIÉS, ET POURQUOI `trashHistory` NE SUFFIT PAS.
   *
   * L'inversion générique rendrait la réserve et laisserait la livraison soldée
   * à tort : la boutique croirait ne plus rien devoir. C'est pour cette seconde
   * moitié que le type « Retour » est refusé à `trashHistory`.
   */
  it('[TC-227-14] la réserve est recréditée ET le reste dû remonte', async () => {
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })
    const { id: retourId } = await call({ action: 'returnReplenishment', replenishmentId: id, amount: 100_000, balanceType: 'stock' })

    expect((await ligne(id)).replenishmentStatus).toBe('settled')
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })

    await call({ action: 'trashReplenishmentReturn', returnId: retourId })

    expect(await soldes()).toEqual({ stock: 600_000, liquidite: LIQUIDITE_INITIALE })
    const rav = await ligne(id)
    expect(rav.returnedAmount).toBe(0)
    expect(rav.remainingAmount).toBe(100_000)
    // La livraison REVIENT dans la liste : elle était sortie à tort.
    expect(rav.replenishmentStatus).toBe('open')
  })

  it('[TC-227-15] le retour supprimé part à la corbeille, et pas deux fois', async () => {
    const { id } = await ravitailler({ amount: 60_000 })
    const { id: retourId } = await call({ action: 'returnReplenishment', replenishmentId: id, amount: 20_000, balanceType: 'stock' })

    await call({ action: 'trashReplenishmentReturn', returnId: retourId })
    expect((await ligne(retourId)).statut).toBe('Supprimée')
    expect((await ligne(retourId)).deletedAt).toBeTruthy()

    await expect(call({ action: 'trashReplenishmentReturn', returnId: retourId })).rejects.toThrow(/deja|déjà/i)
    // Le solde n'a pas été rendu deux fois.
    expect(await soldes()).toEqual({ stock: 560_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-227-16] `trashHistory` refuse un retour, et le ravitaillement aussi', async () => {
    const { id } = await ravitailler({ amount: 60_000 })
    const { id: retourId } = await call({ action: 'returnReplenishment', replenishmentId: id, amount: 20_000, balanceType: 'stock' })

    await expect(call({ action: 'trashHistory', historyId: retourId })).rejects.toThrow()
    await expect(call({ action: 'trashHistory', historyId: id })).rejects.toThrow()
  })

  it('[TC-227-17] le retour défait puis refait laisse les soldes au même endroit', async () => {
    const { id } = await ravitailler({ amount: 100_000, balanceType: 'stock' })
    const { id: retourId } = await call({ action: 'returnReplenishment', replenishmentId: id, amount: 40_000, balanceType: 'liquidite' })
    const apresRetour = await soldes()

    await call({ action: 'trashReplenishmentReturn', returnId: retourId })
    await call({ action: 'returnReplenishment', replenishmentId: id, amount: 40_000, balanceType: 'liquidite' })

    expect(await soldes()).toEqual(apresRetour)
    expect((await ligne(id)).remainingAmount).toBe(60_000)
  })
})
