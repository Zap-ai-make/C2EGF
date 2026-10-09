import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from '../../functions/src/settlements/addTransactionRefund.js'

/**
 * TC-235 — Le code agent sur lequel un règlement a été envoyé.
 *
 * À QUOI SERT CE CHAMP
 * ────────────────────
 * Quand la boutique ne remet pas l'argent en main propre mais l'envoie sur le
 * compte d'un agent, rien n'en gardait trace : le règlement disait « payé par
 * Cash » et s'arrêtait là. Un règlement contesté ne se rapprochait donc de
 * rien — c'est exactement ce que la boutique veut pouvoir produire.
 *
 * CE QUE CES TESTS PROTÈGENT
 * ──────────────────────────
 *   1. FACULTATIF VEUT DIRE FACULTATIF. L'immense majorité des règlements ne
 *      portent pas ce code, et aucun ne doit être refusé pour son absence.
 *   2. Le champ part dans un document d'AUDIT et ressort à l'écran comme dans
 *      l'export : il est validé par liste blanche, pas nettoyé après coup.
 *   3. ⚠ L'IDEMPOTENCE LE PREND EN COMPTE. C'est le piège de ce lot : rejouer
 *      une clé avec un code différent doit être refusé, sinon corriger un code
 *      mal tapé rendrait « déjà enregistré » et n'écrirait jamais la correction.
 *   4. Et symétriquement, un rejeu d'un règlement ANCIEN — écrit avant que ce
 *      champ existe, donc sans lui — ne doit pas se mettre à échouer.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-agentcode-admin'
const STORE = 'store-agentcode-a'
const DRAFT = 'draft-agentcode-1'

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
    balances: { Orange: { stock: 500_000, liquidite: 300_000 } },
  })
  await db.doc(`clients/${STORE}/drafts/${DRAFT}`).set({
    type: 'Dépôt',
    montant: 10_000,
    clientId: 'client-1',
    reseau: 'Orange',
    statut: 'Non Terminées',
    date: '08/10/2026 10:00',
  })
})

// ⚠ Construites À L'APPEL : `db` n'existe qu'après `beforeAll`, et un objet de
//   dépendances figé à l'import capturerait `undefined`.
const deps = () => ({ db, FieldValue, logWriter: () => {} })
const payer = (data) => addTransactionPaymentHandler({ auth: { uid: UID }, data }, deps())
const rembourser = (data) => addTransactionRefundHandler({ auth: { uid: UID }, data }, deps())

const base = (over = {}) => ({
  draftId: DRAFT,
  amount: 10_000,
  paymentMethod: 'Cash',
  idempotencyKey: 'cle-1',
  ...over,
})

/** Le règlement écrit sous le brouillon, quel que soit son identifiant. */
const reglement = async () => {
  const snap = await db.collection(`clients/${STORE}/drafts/${DRAFT}/settlements`).get()
  return snap.docs[0]?.data() ?? null
}

const ligneHistorique = async (historyId) =>
  (await db.doc(`clients/${STORE}/history/${historyId}`).get()).data()

describe('TC-235 — le champ est facultatif', () => {
  it('[TC-235-1] un paiement sans code agent passe, et n’en écrit aucun', async () => {
    const resultat = await payer(base())

    expect(resultat.fullySettled).toBe(true)
    expect((await reglement()).agentCode).toBeNull()
  })

  it('[TC-235-2] une chaîne vide vaut une absence', async () => {
    await payer(base({ agentCode: '' }))
    expect((await reglement()).agentCode).toBeNull()
  })

  it('[TC-235-3] des espaces seuls aussi', async () => {
    await payer(base({ agentCode: '   ' }))
    expect((await reglement()).agentCode).toBeNull()
  })
})

describe('TC-235 — le champ est enregistré', () => {
  it('[TC-235-4] le code part dans le règlement', async () => {
    await payer(base({ agentCode: '1234567' }))
    expect((await reglement()).agentCode).toBe('1234567')
  })

  it('[TC-235-5] il est rogné de ses espaces', async () => {
    await payer(base({ agentCode: '  1234567  ' }))
    expect((await reglement()).agentCode).toBe('1234567')
  })

  /**
   * ⚠ `settlementAgentCode` ET NON `agentCode` sur la ligne d'historique : elle
   *   porte déjà `code`, celui du CLIENT. Les deux répondent à des questions
   *   différentes, et un nom court les confondrait à la relecture.
   */
  it('[TC-235-6] et se retrouve sur la ligne d’historique, sous son nom long', async () => {
    const resultat = await payer(base({ agentCode: '1234567' }))
    const ligne = await ligneHistorique(resultat.historyId)

    expect(ligne.settlementAgentCode).toBe('1234567')
    expect(ligne.code).not.toBe('1234567')
  })

  it('[TC-235-7] un remboursement le porte aussi', async () => {
    await payer(base({ amount: 5_000, idempotencyKey: 'cle-paiement' }))
    await rembourser(base({ amount: 2_000, idempotencyKey: 'cle-remb', agentCode: '7654321' }))

    const snap = await db.collection(`clients/${STORE}/drafts/${DRAFT}/settlements`).get()
    const remboursement = snap.docs.map((d) => d.data()).find((d) => d.type === 'refund')
    expect(remboursement.agentCode).toBe('7654321')
  })
})

describe('TC-235 — ce que le serveur refuse', () => {
  it('[TC-235-8] un code trop long', async () => {
    await expect(payer(base({ agentCode: '1'.repeat(33) }))).rejects.toThrow(/trop long/i)
  })

  /**
   * Liste blanche, et non liste noire : ce champ ressort dans l'export et à
   * l'écran. On énumère ce qui est permis plutôt que de deviner ce qui nuit.
   */
  it('[TC-235-9] un code qui porte autre chose que du texte simple', async () => {
    for (const mauvais of ['<script>', 'abc\n123', 'code;drop', 'é@#']) {
      await expect(payer(base({ agentCode: mauvais }))).rejects.toThrow(/Code agent/i)
    }
  })

  it('[TC-235-10] un code qui n’est pas une chaîne', async () => {
    await expect(payer(base({ agentCode: 1234567 }))).rejects.toThrow(/Code agent invalide/i)
  })

  it('[TC-235-11] accepte lettres, chiffres, espace, point et tiret', async () => {
    await payer(base({ agentCode: 'AG-12.34 56' }))
    expect((await reglement()).agentCode).toBe('AG-12.34 56')
  })
})

describe('TC-235 — l’idempotence', () => {
  it('[TC-235-12] le même code sous la même clé est un rejeu, pas un conflit', async () => {
    await payer(base({ amount: 5_000, agentCode: '1234567' }))
    const rejeu = await payer(base({ amount: 5_000, agentCode: '1234567' }))

    expect(rejeu.idempotent).toBe(true)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI ÉVITE UNE CORRECTION SILENCIEUSEMENT PERDUE.
   *   Sans ce refus, corriger un code mal tapé et reconfirmer renverrait
   *   « déjà enregistré » : la caissière verrait un succès, et le code corrigé
   *   ne serait jamais écrit.
   */
  it('[TC-235-13] un code différent sous la même clé est refusé', async () => {
    await payer(base({ amount: 5_000, agentCode: '1234567' }))

    await expect(payer(base({ amount: 5_000, agentCode: '7654321' })))
      .rejects.toThrow(/déjà été enregistrée/i)
  })

  it('[TC-235-14] ajouter un code là où il n’y en avait pas est refusé aussi', async () => {
    await payer(base({ amount: 5_000 }))

    await expect(payer(base({ amount: 5_000, agentCode: '1234567' })))
      .rejects.toThrow(/déjà été enregistrée/i)
  })

  /**
   * ⚠ LE CAS DE PRODUCTION. Les règlements déjà en base n'ont pas de champ
   *   `agentCode`. Comparer leur `undefined` au `null` d'un rejeu sans code
   *   ferait échouer toute reprise réseau sur une opération ancienne.
   */
  it('[TC-235-15] un règlement d’avant ce champ se rejoue sans conflit', async () => {
    await payer(base({ amount: 5_000 }))

    const snap = await db.collection(`clients/${STORE}/drafts/${DRAFT}/settlements`).get()
    await snap.docs[0].ref.update({ agentCode: FieldValue.delete() })

    const rejeu = await payer(base({ amount: 5_000 }))
    expect(rejeu.idempotent).toBe(true)
  })
})

describe('TC-235 — un règlement en plusieurs tranches', () => {
  /** Le cumul des destinations, tel que la ligne d'historique le porte. */
  const destinations = async (historyId) => (await ligneHistorique(historyId)).settlementAgentCode

  /**
   * ⚠ LE DÉFAUT QUE CETTE SECTION FERME.
   *   `settlementAgentCode` n'était écrit qu'à la DERNIÈRE tranche, avec le
   *   code de cette tranche-là. Un dépôt de 10 000 réglé en trois fois sur
   *   trois comptes différents ressortait donc dans l'export comme si les
   *   10 000 étaient partis sur le dernier : les deux premiers tiers étaient
   *   attribués au mauvais destinataire, et un rapprochement contesté partait
   *   d'un chiffre faux.
   */
  it('[TC-235-16] les trois codes se retrouvent sur la ligne, pas seulement le dernier', async () => {
    await payer(base({ amount: 3_000, idempotencyKey: 'cle-1', agentCode: '1111111' }))
    await payer(base({ amount: 3_000, idempotencyKey: 'cle-2', agentCode: '2222222' }))
    const fin = await payer(base({ amount: 4_000, idempotencyKey: 'cle-3', agentCode: '3333333' }))

    expect(fin.fullySettled).toBe(true)
    expect(await destinations(fin.historyId)).toBe('1111111 + 2222222 + 3333333')
  })

  /** Régler deux fois sur le même compte n'est pas deux destinations. */
  it('[TC-235-17] le même code sur deux tranches n’est cité qu’une fois', async () => {
    await payer(base({ amount: 5_000, idempotencyKey: 'cle-1', agentCode: '1111111' }))
    const fin = await payer(base({ amount: 5_000, idempotencyKey: 'cle-2', agentCode: '1111111' }))

    expect(await destinations(fin.historyId)).toBe('1111111')
  })

  /**
   * Le champ reste FACULTATIF tranche par tranche : la caissière envoie la
   * première moitié sur un compte et remet la seconde en main propre. Taire le
   * premier code parce que le dernier manque perdrait la seule trace qui
   * existait.
   */
  it('[TC-235-18] une tranche sans code n’efface pas celui des précédentes', async () => {
    await payer(base({ amount: 5_000, idempotencyKey: 'cle-1', agentCode: '1111111' }))
    const fin = await payer(base({ amount: 5_000, idempotencyKey: 'cle-2' }))

    expect(await destinations(fin.historyId)).toBe('1111111')
  })

  /**
   * Et sans aucun code, le document garde la forme qu'il avait avant ce champ :
   * un `agentCodes: []` dans le résumé ferait croire à une destination vide
   * plutôt qu'à une absence de destination.
   */
  it('[TC-235-19] aucun code sur aucune tranche : rien n’est inscrit', async () => {
    await payer(base({ amount: 5_000, idempotencyKey: 'cle-1' }))
    const fin = await payer(base({ amount: 5_000, idempotencyKey: 'cle-2' }))

    const ligne = await ligneHistorique(fin.historyId)
    expect(ligne.settlementAgentCode).toBeNull()
    expect(ligne.settlementSummary.agentCodes).toBeUndefined()
  })

  /**
   * Un remboursement ne solde jamais : il ne construit donc aucune ligne
   * d'historique. Sa destination doit quand même traverser le résumé jusqu'à
   * la tranche qui, elle, en construira une.
   */
  it('[TC-235-20] le code d’un remboursement survit jusqu’à la ligne finale', async () => {
    await payer(base({ amount: 6_000, idempotencyKey: 'cle-1', agentCode: '1111111' }))
    await rembourser(base({ amount: 2_000, idempotencyKey: 'cle-remb', agentCode: '9999999' }))
    const fin = await payer(base({ amount: 6_000, idempotencyKey: 'cle-2', agentCode: '1111111' }))

    expect(fin.fullySettled).toBe(true)
    expect(await destinations(fin.historyId)).toBe('1111111 + 9999999')
  })
})
