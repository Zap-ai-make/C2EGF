import { write } from 'firebase-functions/logger'
import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  normalizeNetworkBalances,
  applyInitialTransactionImpact,
  applyReplenishmentImpact,
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
const REPLENISHMENT_TYPE = 'Ravitaillement'
const CLOSURE_TYPE = 'Clôture'
// Ni l'un ni l'autre n'est un mouvement client : `reverseHistoryTransactionImpact`
// ne sait pas les défaire, et `cancelHistory` les refuse pour cette raison.
const UNCANCELLABLE_TYPES = [REPLENISHMENT_TYPE, CLOSURE_TYPE]
const NOTE_MAX = 280

function fail(code, message) { throw new DealerRequestError(code, message) }
function cleanId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.trim())) fail('STORE_TRANSACTION_INVALID', `${field} invalide.`)
  return value.trim()
}
function cleanAmount(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('STORE_TRANSACTION_INVALID', 'Montant FCFA invalide.')
  return value
}
// La note du ravitaillement est libre et facultative, donc bornée : elle finit
// dans un historique qu'on relit, pas dans un champ de recherche.
function cleanNote(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > NOTE_MAX) fail('STORE_TRANSACTION_INVALID', 'Note invalide.')
  return value.trim()
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
  const payload = validateInputPayload(request.data, ['action', 'transaction', 'draftId', 'historyId', 'updates', 'paymentMethod', 'amount', 'network', 'balanceType', 'balanceAmount', 'balances', 'note'])
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

    // Ravitaillement : la centrale réapprovisionne la boutique. Le client ne
    // choisit que le montant, le vase et la note ; le réseau vient du profil
    // (STORE_NETWORKS), jamais de la charge utile — un réseau soufflé par le
    // navigateur crediterait un solde que la boutique n'opère pas.
    if (action === 'replenish') {
      const amount = cleanAmount(payload.amount)
      if (!['stock', 'liquidite'].includes(payload.balanceType)) fail('STORE_TRANSACTION_INVALID', 'Vase de ravitaillement inconnu.')
      const note = cleanNote(payload.note)
      const network = STORE_NETWORKS[0]
      const nextBalances = applyReplenishmentImpact(balances, network, payload.balanceType, amount)
      const ref = db.collection(`clients/${storeId}/history`).doc()
      const data = {
        type: REPLENISHMENT_TYPE,
        montant: amount,
        reseau: network,
        balanceType: payload.balanceType,
        statut: 'Validée',
        note,
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        validatedAt: now,
      }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, balanceType: payload.balanceType, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
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

    // Clôture : la boutique repart de zéro. On écrit d'abord ce qu'on solde,
    // on remet à zéro ensuite — l'inverse ferait disparaître les montants des
    // livres. Rien n'est lu dans la charge utile : le serveur solde ce qu'il
    // voit, et un montant soufflé par le navigateur n'a aucun effet.
    if (action === 'closeDay') {
      const soldes = STORE_NETWORKS.map(network => ({
        network,
        stock: Number(balances[network]?.stock) || 0,
        liquidite: Number(balances[network]?.liquidite) || 0,
      }))
      const total = soldes.reduce((somme, s) => somme + s.stock + s.liquidite, 0)
      if (total <= 0) fail('STORE_TRANSACTION_INVALID', 'Les soldes sont déjà à zéro.')

      const nextBalances = normalizeNetworkBalances({})
      const principal = soldes[0]
      const ref = db.collection(`clients/${storeId}/history`).doc()
      const data = {
        type: CLOSURE_TYPE,
        montant: total,
        reseau: principal.network,
        stockSolde: principal.stock,
        liquiditeSoldee: principal.liquidite,
        soldes,
        statut: 'Validée',
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        validatedAt: now,
      }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, ...data }
    }

    if (action === 'cancelHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      if (history.collaborationId) fail('STORE_TRANSACTION_INVALID', "Une trace de collaboration ne peut pas être annulée depuis l'historique.")
      // `reverseHistoryTransactionImpact` ne sait défaire qu'un dépôt ou un
      // retrait. Sur un ravitaillement ou une clôture il ne rendrait rien et la
      // ligne passerait quand même à « Annulée » : le solde resterait faux sans
      // trace du désaccord. On refuse plutôt que de mentir au gérant.
      if (UNCANCELLABLE_TYPES.includes(history.type)) fail('STORE_TRANSACTION_INVALID', `Une ligne « ${history.type} » ne s'annule pas depuis l'historique.`)
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
