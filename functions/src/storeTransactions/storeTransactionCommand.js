import { write } from 'firebase-functions/logger'
import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  normalizeNetworkBalances,
  applyInitialTransactionImpact,
  reverseInitialTransactionImpact,
  applySettlementImpact,
  mapPaymentMethodToNetwork,
  reverseHistoryTransactionImpact,
} from '../settlements/financialUtils.js'
import {
  STORE_NETWORKS,
  STORE_TRANSACTION_TYPES,
  STORE_PAYMENT_METHODS,
  CASHIER_CAN_EDIT_BALANCES,
} from '../config/storeProfile.js'

const SETTLEMENT_FIELDS = [
  'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
  'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
  'settlementAmount', 'settlementType',
]
const PENDING = ['Non Terminées', 'Non Terminees']
const VALIDATED = ['Validée', 'Validee']

function fail(code, message) { throw new DealerRequestError(code, message) }
function cleanId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.trim())) fail('STORE_TRANSACTION_INVALID', `${field} invalide.`)
  return value.trim()
}
function cleanAmount(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('STORE_TRANSACTION_INVALID', 'Montant FCFA invalide.')
  return value
}
function cleanTransaction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORE_TRANSACTION_INVALID', 'Transaction invalide.')
  if (JSON.stringify(input).length > 20_000) fail('STORE_TRANSACTION_INVALID', 'Transaction trop volumineuse.')
  const type = String(input.type || '').trim()
  const reseau = String(input.reseau || '').trim()
  const statut = String(input.statut || '').trim()
  if (!STORE_TRANSACTION_TYPES.includes(type)) fail('STORE_TRANSACTION_INVALID', 'Type de transaction non autorisé par le profil.')
  if (!STORE_NETWORKS.includes(reseau)) fail('STORE_TRANSACTION_INVALID', 'Réseau non autorisé par le profil.')
  if (![...PENDING, ...VALIDATED].includes(statut)) fail('STORE_TRANSACTION_INVALID', 'Statut initial non autorisé.')
  const clientId = cleanId(input.clientId, 'clientId')
  return {
    ...(input.client && typeof input.client === 'object' && !Array.isArray(input.client) ? { client: input.client } : {}),
    clientId,
    type,
    reseau,
    ...(typeof input.code === 'string' ? { code: input.code.slice(0, 160) } : {}),
    montant: cleanAmount(input.montant),
    statut,
  }
}
function dateFr() {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Ouagadougou' }).format(new Date())
}

async function readActor(t, db, uid) {
  const profileSnap = await t.get(db.doc(`users/${uid}`))
  if (!profileSnap.exists) fail('PROFILE_NOT_FOUND', 'Profil introuvable.')
  const profile = profileSnap.data()
  if (!profile.active) fail('PROFILE_INACTIVE', 'Compte désactivé.')
  if (!['store_admin', 'member'].includes(profile.role)) fail('ROLE_FORBIDDEN', 'Accès réservé aux boutiques.')
  const storeId = cleanId(profile.storeId, 'storeId')
  const storeSnap = await t.get(db.doc(`stores/${storeId}`))
  if (!storeSnap.exists) fail('STORE_NOT_FOUND', 'Boutique introuvable.')
  if (storeSnap.data().active !== true) fail('STORE_INACTIVE', 'Boutique désactivée.')
  return { profile, storeId, store: storeSnap.data() }
}

export async function storeTransactionCommandHandler(request, { db, FieldValue, logWriter = write }) {
  const uid = validateAuthUid(request.auth?.uid)
  const payload = validateInputPayload(request.data, ['action', 'transaction', 'draftId', 'historyId', 'updates', 'paymentMethod', 'amount', 'network', 'balanceType', 'balanceAmount', 'balances'])
  const action = String(payload.action || '')
  const now = FieldValue.serverTimestamp()

  const result = await db.runTransaction(async t => {
    const { profile, storeId, store } = await readActor(t, db, uid)
    const balanceRef = db.doc(`clients/${storeId}/networkBalances/current`)

    if (action === 'ensureBalances') {
      const snap = await t.get(balanceRef)
      if (!snap.exists) t.set(balanceRef, { balances: normalizeNetworkBalances({}), updatedAt: now })
      return { balances: normalizeNetworkBalances(snap.exists ? snap.data() : {}) }
    }

    if (action === 'setBalance') {
      if (!CASHIER_CAN_EDIT_BALANCES) fail('BALANCE_EDIT_FORBIDDEN', 'La saisie directe des soldes est désactivée.')
      if (!STORE_NETWORKS.includes(payload.network) || !['stock', 'liquidite'].includes(payload.balanceType) || !Number.isSafeInteger(payload.balanceAmount) || payload.balanceAmount < 0) {
        fail('STORE_TRANSACTION_INVALID', 'Modification de solde invalide.')
      }
      const snap = await t.get(balanceRef)
      const before = normalizeNetworkBalances(snap.exists ? snap.data() : {})
      const balances = { ...before, [payload.network]: { ...before[payload.network], [payload.balanceType]: payload.balanceAmount } }
      t.set(balanceRef, { balances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, network: payload.network, balanceType: payload.balanceType, before: before[payload.network][payload.balanceType], after: payload.balanceAmount, createdAt: now })
      return { balances }
    }

    if (action === 'setBalances') {
      if (!CASHIER_CAN_EDIT_BALANCES) fail('BALANCE_EDIT_FORBIDDEN', 'La saisie directe des soldes est désactivée.')
      if (!payload.balances || typeof payload.balances !== 'object' || Array.isArray(payload.balances)) fail('STORE_TRANSACTION_INVALID', 'Soldes invalides.')
      const balances = normalizeNetworkBalances({})
      for (const network of STORE_NETWORKS) {
        const entry = payload.balances[network]
        if (!entry || !Number.isSafeInteger(entry.stock) || entry.stock < 0 || !Number.isSafeInteger(entry.liquidite) || entry.liquidite < 0) {
          fail('STORE_TRANSACTION_INVALID', `Soldes invalides pour ${network}.`)
        }
        balances[network] = { stock: entry.stock, liquidite: entry.liquidite }
      }
      const snap = await t.get(balanceRef)
      const before = normalizeNetworkBalances(snap.exists ? snap.data() : {})
      t.set(balanceRef, { balances, updatedAt: now })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, beforeBalances: before, afterBalances: balances, createdAt: now })
      return { balances }
    }

    const balanceSnap = await t.get(balanceRef)
    if (!balanceSnap.exists) fail('BALANCE_NOT_FOUND', 'Soldes de la boutique introuvables.')
    const balances = normalizeNetworkBalances(balanceSnap.data())

    if (action === 'add') {
      const transaction = cleanTransaction(payload.transaction)
      const nextBalances = applyInitialTransactionImpact(balances, transaction)
      const collection = PENDING.includes(transaction.statut) ? 'drafts' : 'history'
      const ref = db.collection(`clients/${storeId}/${collection}`).doc()
      const data = { ...transaction, storeId, storeName: store.name || profile.storeName || '', operatorId: uid, operatorName: profile.name || '', operatorEmail: profile.email || '', date: dateFr(), createdAt: now, updatedAt: now }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, ...data }
    }

    if (action === 'updateDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement est figée.')
      const transaction = cleanTransaction({ ...old, ...payload.updates, statut: 'Non Terminées' })
      const restored = reverseInitialTransactionImpact(balances, old)
      const nextBalances = applyInitialTransactionImpact(restored, transaction)
      t.update(ref, { ...transaction, storeId, updatedAt: now })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, after: transaction, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: draftId, ...transaction }
    }

    if (action === 'deleteDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) return { deleted: false }
      const old = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement ne peut pas être supprimée.')
      const nextBalances = reverseInitialTransactionImpact(balances, old)
      t.delete(ref)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { deleted: true }
    }

    if (action === 'validateDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(draftRef)
      if (!snap.exists) return { validated: false }
      const draft = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(draft, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Utilisez le règlement par tranche pour cette transaction.')
      const amount = payload.amount == null ? draft.montant : cleanAmount(payload.amount)
      const paymentMethod = payload.paymentMethod == null ? null : String(payload.paymentMethod)
      if (paymentMethod && !STORE_PAYMENT_METHODS.includes(paymentMethod)) fail('INVALID_PAYMENT_METHOD', 'Méthode de paiement non autorisée.')
      const nextBalances = paymentMethod ? applySettlementImpact(balances, { ...draft, montant: amount }, paymentMethod) : balances
      const historyRef = db.collection(`clients/${storeId}/history`).doc()
      const history = { ...draft, storeId, statut: paymentMethod ? `${String(draft.type).normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'Depot' ? 'Encaissé' : 'Payé'} par ${paymentMethod}` : 'Validée', paymentMethod, effectiveNetwork: paymentMethod ? mapPaymentMethodToNetwork(paymentMethod) : null, settlementAmount: amount, originalAmount: draft.montant, paidAmount: amount, refundedAmount: 0, remainingAmount: 0, settlementStatus: 'settled', validatedAt: now, settlementUpdatedAt: now, updatedAt: now }
      t.set(historyRef, history)
      t.delete(draftRef)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: historyRef.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { validated: true, historyId: historyRef.id }
    }

    if (action === 'cancelHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      if (history.collaborationId) fail('STORE_TRANSACTION_INVALID', "Une trace de collaboration ne peut pas être annulée depuis l'historique.")
      const nextBalances = reverseHistoryTransactionImpact(balances, history)
      t.update(ref, { statut: 'Annulée', cancelledAt: now, cancelledBy: uid, updatedAt: now })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { cancelled: true }
    }

    fail('STORE_TRANSACTION_INVALID', 'Commande inconnue.')
  })

  logWriter({ severity: 'INFO', event: 'STORE_TRANSACTION_COMMAND', action, actorUid: uid, result: 'success' })
  return result
}
