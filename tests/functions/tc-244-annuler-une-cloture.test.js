import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-244 — Annuler une clôture.
 *
 * LE GESTE QUI MANQUAIT
 * ─────────────────────
 * Une clôture met les deux réserves à zéro. Lancée par erreur — et elle se
 * lance d'un bouton — elle laissait la boutique devant des soldes vides sans
 * aucun moyen de revenir en arrière : `cancelHistory` et `trashHistory` la
 * refusent tous les deux, et ils ont raison de la refuser (leur inversion lit
 * UN réseau et UN montant ; une clôture en a autant que la boutique en opère).
 *
 * CE QUI REND L'INVERSE EXACT
 * ───────────────────────────
 * La clôture enregistre `soldes` — le stock et la liquidité de CHAQUE réseau au
 * moment où elle les a balayés. On rend exactement cela, réseau par réseau.
 * Rien n'est recalculé, rien n'est déduit du total.
 *
 * ⚠ CE QUE CES TESTS PROTÈGENT AVANT TOUT
 *   On AJOUTE, on ne restaure pas un état : ce qui est arrivé après la clôture
 *   doit survivre. Et le geste est borné à la journée en cours — au-delà, le
 *   montant reviendrait s'ajouter aux soldes d'un autre jour, ce qui est
 *   arithmétiquement l'inverse de la clôture mais ne correspond à aucune
 *   journée lisible.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-cancelclosure-admin'
const STORE = 'store-cancelclosure-a'

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) {
    throw new Error('Émulateur demo requis')
  }
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})

afterAll(async () => { await deleteApp(app) })

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique A', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({
    balances: { Orange: { stock: 600_000, liquidite: 400_000 } },
  })
})

const call = (data) => storeTransactionCommandHandler(
  { auth: { uid: UID }, data },
  { db, FieldValue, logWriter: () => {} },
)

const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const ligne = async (id) => (await db.doc(`clients/${STORE}/history/${id}`).get()).data()

describe('TC-244 — la clôture du jour se défait', () => {
  it('[TC-244-1] les deux réserves reviennent à ce qu’elles étaient', async () => {
    const cloture = await call({ action: 'closeDay' })
    expect(await soldes()).toEqual({ stock: 0, liquidite: 0 })

    const resultat = await call({ action: 'cancelClosure', historyId: cloture.id })

    expect(resultat.cancelled).toBe(true)
    expect(await soldes()).toEqual({ stock: 600_000, liquidite: 400_000 })
  })

  it('[TC-244-2] la ligne passe à « Annulée » et dit par qui', async () => {
    const cloture = await call({ action: 'closeDay' })
    await call({ action: 'cancelClosure', historyId: cloture.id })

    const apres = await ligne(cloture.id)
    expect(apres.statut).toBe('Annulée')
    expect(apres.cancelledBy).toBe(UID)
    expect(apres.cancelledByName).toBe('Awa')
    expect(apres.cancelledAt).toBeTruthy()
    // Le détail reste écrit : la ligne doit rester lisible après coup.
    expect(apres.soldes).toEqual([{ network: 'Orange', stock: 600_000, liquidite: 400_000 }])
  })

  /** Toute opération financière laisse une piste (AGENTS.md). */
  it('[TC-244-3] un journal d’audit porte l’avant et l’après', async () => {
    const cloture = await call({ action: 'closeDay' })
    await call({ action: 'cancelClosure', historyId: cloture.id })

    const logs = await db.collection(`clients/${STORE}/auditLogs`).get()
    const annulation = logs.docs.map((d) => d.data()).find((d) => d.action === 'cancelClosure')

    expect(annulation).toMatchObject({ historyId: cloture.id, uid: UID })
    expect(annulation.beforeBalances.Orange).toEqual({ stock: 0, liquidite: 0 })
    expect(annulation.afterBalances.Orange).toEqual({ stock: 600_000, liquidite: 400_000 })
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LA JOURNÉE EN COURS.
   *   Entre la clôture et son annulation, la boutique a reçu un ravitaillement.
   *   Restaurer l'ÉTAT d'avant la clôture l'effacerait ; on rend le DELTA, donc
   *   il survit — c'est la même règle que pour toutes les autres inversions.
   */
  it('[TC-244-4] ce qui est arrivé depuis la clôture survit', async () => {
    const cloture = await call({ action: 'closeDay' })
    await call({ action: 'replenish', amount: 1_000_000, balanceType: 'stock', expediteur: 'Patron' })

    await call({ action: 'cancelClosure', historyId: cloture.id })

    expect(await soldes()).toEqual({ stock: 1_600_000, liquidite: 400_000 })
  })
})

describe('TC-244 — ce que le serveur refuse', () => {
  it('[TC-244-5] annuler deux fois la même clôture', async () => {
    const cloture = await call({ action: 'closeDay' })
    await call({ action: 'cancelClosure', historyId: cloture.id })

    await expect(call({ action: 'cancelClosure', historyId: cloture.id }))
      .rejects.toThrow(/déjà été annulée/i)
    // Et surtout : les soldes n'ont pas doublé.
    expect(await soldes()).toEqual({ stock: 600_000, liquidite: 400_000 })
  })

  /**
   * ⚠ LE CAS QUI A DÉCIDÉ DE LA RÈGLE. Annuler la clôture de mardi rajouterait
   *   son montant par-dessus les soldes d'aujourd'hui : juste au sens du delta,
   *   illisible au sens de la journée. Annuler répare un geste du jour.
   */
  it('[TC-244-6] une clôture d’un autre jour', async () => {
    const cloture = await call({ action: 'closeDay' })
    const hier = new Date(Date.now() - 36 * 3_600_000)
    await db.doc(`clients/${STORE}/history/${cloture.id}`).update({ createdAt: Timestamp.fromDate(hier) })

    await expect(call({ action: 'cancelClosure', historyId: cloture.id }))
      .rejects.toThrow(/journée close/i)
    expect(await soldes()).toEqual({ stock: 0, liquidite: 0 })
  })

  it('[TC-244-7] une clôture sans détail par réseau', async () => {
    const cloture = await call({ action: 'closeDay' })
    await db.doc(`clients/${STORE}/history/${cloture.id}`).update({ soldes: FieldValue.delete() })

    await expect(call({ action: 'cancelClosure', historyId: cloture.id }))
      .rejects.toThrow(/inconnaissable/i)
  })

  it('[TC-244-8] une ligne qui n’est pas une clôture', async () => {
    const rav = await call({ action: 'replenish', amount: 50_000, balanceType: 'stock', expediteur: 'Patron' })

    await expect(call({ action: 'cancelClosure', historyId: rav.id }))
      .rejects.toThrow(/pas une clôture/i)
  })

  it('[TC-244-9] une ligne qui n’existe pas', async () => {
    await expect(call({ action: 'cancelClosure', historyId: 'inexistante' }))
      .rejects.toThrow(/introuvable/i)
  })

  /**
   * Les deux commandes génériques continuent de la refuser, et c'est voulu :
   * leur inversion ne rendrait qu'un réseau. Si elles se mettaient à accepter,
   * une clôture multi-réseaux serait défaite à moitié, sans erreur.
   */
  it('[TC-244-10] les commandes génériques la refusent toujours', async () => {
    const cloture = await call({ action: 'closeDay' })

    await expect(call({ action: 'cancelHistory', historyId: cloture.id }))
      .rejects.toThrow(/ne s'annule pas depuis l'historique/i)
    await expect(call({ action: 'trashHistory', historyId: cloture.id }))
      .rejects.toThrow(/ne peut pas être annulée/i)
  })
})

describe('TC-244 — plusieurs réseaux', () => {
  /**
   * C2EGF n'en opère qu'un, et c'est précisément ce qui rendrait un défaut
   * invisible ici : avec un seul réseau, « rendre le premier » et « rendre
   * tous » donnent le même résultat. On force donc deux réserves à la main.
   */
  it('[TC-244-11] chaque réseau retrouve exactement sa part', async () => {
    const cloture = await call({ action: 'closeDay' })
    await db.doc(`clients/${STORE}/history/${cloture.id}`).update({
      soldes: [
        { network: 'Orange', stock: 600_000, liquidite: 400_000 },
        { network: 'Moov', stock: 123_000, liquidite: 45_000 },
      ],
    })

    await call({ action: 'cancelClosure', historyId: cloture.id })

    const balances = (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances
    expect(balances.Orange).toEqual({ stock: 600_000, liquidite: 400_000 })
    expect(balances.Moov).toMatchObject({ stock: 123_000, liquidite: 45_000 })
  })
})
