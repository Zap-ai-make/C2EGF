/**
 * collaborationService — couche unique entre l'UI et le module collaborations.
 *
 * Elle centralise trois choses, et rien d'autre :
 *   • l'appel des Cloud Functions (aucune écriture Firestore directe : les règles
 *     l'interdisent, et c'est le serveur qui fait autorité sur les soldes) ;
 *   • la traduction des codes d'erreur serveur en messages français — on lit
 *     `err.details.code`, JAMAIS le message brut du serveur ;
 *   • les abonnements temps réel, tous passés par resilientOnSnapshot.
 *
 * ⚠ Le filtre de statut est TOUJOURS dans la requête, jamais appliqué après coup.
 *   `limit()` s'exécute côté serveur AVANT tout filtrage client : filtrer ensuite
 *   ferait disparaître des lignes qui n'ont jamais été chargées. Deux chemins sont
 *   donc exposés — `statusFilter` (un statut, file opérationnelle) et `statuses`
 *   (plusieurs, chemin historique) — et aucun appelant ne doit filtrer lui-même.
 */

import {
  collection, collectionGroup, doc, query, where, orderBy, limit,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../config/firebase.js'
import { resilientOnSnapshot, isPermanentSnapshotError } from './resilientOnSnapshot.js'
import { parseAmount } from '../utils/parseAmount.js'
import {
  COLLABORATIONS_PAGE_SIZE,
  INTERNAL_DEBTS_PAGE_SIZE,
} from '../constants/collaborationConstants.js'

// ─────────────────────────────────────────────────────────────────────────────
// Dictionnaire d'erreurs — le serveur envoie un code, l'utilisateur lit du français
// ─────────────────────────────────────────────────────────────────────────────

export const ERROR_MESSAGES = Object.freeze({
  UNAUTHENTICATED: 'Votre session a expiré. Reconnectez-vous.',
  PROFILE_NOT_FOUND: 'Votre profil est introuvable.',
  PROFILE_INACTIVE: 'Votre compte est inactif.',
  ROLE_FORBIDDEN: 'Action réservée aux boutiques.',
  COLLABORATIONS_DISABLED: "Les collaborations entre boutiques ne sont pas activées.",

  INVALID_OPERATION_TYPE: "Type d'opération invalide (dépôt ou retrait).",
  INVALID_COLLABORATION_AMOUNT: 'Montant invalide : entier strictement positif requis.',
  INVALID_COLLABORATION_NETWORK: 'Réseau invalide.',
  INVALID_COLLABORATION_ID: 'Collaboration invalide.',
  INVALID_STORE_ID: 'Boutique invalide.',
  INVALID_CLIENT_ID: 'Client invalide.',
  SAME_STORE_COLLABORATION: 'La boutique fournisseuse doit être différente de la vôtre.',
  CLIENT_NOT_FOUND: 'Client introuvable.',
  SUPPLIER_STORE_NOT_FOUND: 'Boutique fournisseuse introuvable.',
  SUPPLIER_STORE_INACTIVE: "Cette boutique n'est plus active.",
  INSUFFICIENT_SUPPLIER_BALANCE: 'Stock insuffisant pour exécuter cette collaboration.',
  COLLABORATION_NOT_FOUND: 'Collaboration introuvable.',
  COLLABORATION_NOT_PENDING: 'Cette collaboration a déjà été traitée.',
  COLLABORATION_STORE_MISMATCH: 'Cette collaboration ne vous est pas destinée.',

  INVALID_DEBT_ID: 'Dette invalide.',
  INVALID_SETTLEMENT_ID: 'Règlement invalide.',
  INVALID_SETTLEMENT_METHOD: 'Méthode de règlement invalide.',
  INVALID_SETTLEMENT_AMOUNT: 'Montant invalide : entier strictement positif requis.',
  INVALID_IDEMPOTENCY_KEY: 'Clé de règlement invalide.',
  INVALID_DEBT_DATA: 'Les données de cette dette sont incohérentes.',
  DEBT_NOT_FOUND: 'Dette introuvable.',
  DEBT_ALREADY_SETTLED: 'Cette dette est déjà réglée.',
  DEBT_STORE_MISMATCH: "Vous n'êtes pas autorisé sur cette dette.",
  SETTLEMENT_NOT_DECLARED: "Ce règlement n'est pas en attente de confirmation.",
  SETTLEMENT_NOT_FOUND: 'Règlement introuvable.',
  SETTLEMENT_EXCEEDS_REMAINING: 'Le montant dépasse le reste dû (des règlements sont peut-être déjà en attente).',
  SETTLEMENT_INSUFFICIENT_BALANCE: 'Solde réseau insuffisant chez la boutique débitrice pour ce remboursement.',

  INVALID_OPPOSITE_DEBT: 'Dette opposée invalide.',
  NOT_OPPOSITE_PAIR: 'La dette opposée doit lier les deux mêmes boutiques en sens inverse.',
  COMPENSATION_EXCEEDS_REMAINING: 'Le montant dépasse ce qui est compensable.',

  IDEMPOTENCY_CONFLICT: 'Une tranche différente existe déjà pour cette action.',
  INVALID_REJECTION_REASON: 'Le motif est invalide (3 à 500 caractères).',
  BALANCE_OVERFLOW: 'Le solde résultant est invalide.',
  TRANSACTION_FAILED: "L'opération n'a pas pu être finalisée.",

  // ── Échecs d'ABONNEMENT, pas de commande ─────────────────────────────
  // Ces deux-là ne se réessaient pas : ils exigent un déploiement. Le message le
  // dit, parce qu'inviter à réessayer serait envoyer le gérant dans le mur.
  SNAPSHOT_PERMISSION_DENIED:
    "Vous n'avez pas accès à ces données. C'est un réglage à corriger : signalez-le au gérant, réessayer n'y changera rien.",
  SNAPSHOT_FAILED_PRECONDITION:
    "Cette vue n'est pas encore disponible côté serveur. Signalez-le au gérant : réessayer n'y changera rien.",
})

const DEFAULT_ERROR = "Une erreur inattendue s'est produite."

/**
 * Traduit une erreur de callable en Error porteuse d'un message affichable.
 *
 * ⚠ Le message brut du serveur n'est JAMAIS exposé : il peut contenir des détails
 *   d'implémentation. On lit le code métier, et à défaut on reste neutre plutôt
 *   que de risquer un message spécifique trompeur.
 */
export function mapCollaborationError(err) {
  const detailCode = err?.details?.code
  if (detailCode) {
    const mapped = new Error(ERROR_MESSAGES[detailCode] || DEFAULT_ERROR)
    mapped.code = detailCode
    return mapped
  }
  const funcCode = String(err?.code ?? '')
  if (funcCode.includes('unauthenticated')) {
    const mapped = new Error(ERROR_MESSAGES.UNAUTHENTICATED)
    mapped.code = 'UNAUTHENTICATED'
    return mapped
  }
  const mapped = new Error(DEFAULT_ERROR)
  mapped.code = ''
  return mapped
}

/**
 * Traduit l'échec d'un ABONNEMENT, et dit s'il est définitif.
 *
 * POURQUOI CETTE FONCTION EXISTE, EN PLUS DE mapCollaborationError
 * ──────────────────────────────────────────────────────
 * `resilientOnSnapshot` sait déjà distinguer une coupure passagère d'un refus de
 * règle ou d'un index manquant : il cesse de se réabonner dans le second cas.
 * Mais `mapCollaborationError` n'était écrite que pour les callables — elle lit
 * `err.details.code`, qu'un échec de snapshot ne porte pas — et rendait donc
 * « Une erreur inattendue s'est produite » avec un code vide dans les DEUX cas.
 *
 * L'écran ne pouvait pas faire la différence entre « ça revient dans quelques
 * secondes » et « ça ne reviendra jamais sans déploiement », et proposait donc
 * d'attendre dans les deux cas. Le drapeau `permanent` rend cette distinction
 * lisible à l'appelant, sans jamais exposer le message brut du serveur.
 */
export function mapSnapshotError(err) {
  const code = String(err?.code ?? '')
  if (code.includes('permission-denied')) {
    const mapped = new Error(ERROR_MESSAGES.SNAPSHOT_PERMISSION_DENIED)
    mapped.code = 'SNAPSHOT_PERMISSION_DENIED'
    mapped.permanent = true
    return mapped
  }
  if (code.includes('failed-precondition')) {
    const mapped = new Error(ERROR_MESSAGES.SNAPSHOT_FAILED_PRECONDITION)
    mapped.code = 'SNAPSHOT_FAILED_PRECONDITION'
    mapped.permanent = true
    return mapped
  }
  const mapped = mapCollaborationError(err)
  // Toujours posé explicitement : un appelant qui teste `err.permanent` ne doit
  // jamais lire `undefined` et le prendre pour « on ne sait pas ».
  mapped.permanent = isPermanentSnapshotError(err)
  return mapped
}

async function callFunction(name, payload) {
  try {
    const result = await httpsCallable(functions, name)(payload)
    return result.data
  } catch (err) {
    throw mapCollaborationError(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clé d'idempotence
// ─────────────────────────────────────────────────────────────────────────────

// Base36 uniquement : le serveur restreint la clé à [A-Za-z0-9_-] parce qu'elle
// entre dans un identifiant de document Firestore.
export function generateIdempotencyKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ─────────────────────────────────────────────────────────────────────────────
// Commandes — collaborations
// ─────────────────────────────────────────────────────────────────────────────

// ⚠ Les commandes ci-dessous sont TOUTES `async`, y compris celles dont la seule
// validation est synchrone : une fonction qui rend une promesse doit REJETER, pas
// lever. Sinon un appelant en `.catch()` laisserait filer l'erreur, alors qu'un
// appelant en `await` l'attraperait — deux comportements pour un même échec.
function requireAmount(raw) {
  const amount = parseAmount(raw)
  if (amount === null) {
    const err = new Error(ERROR_MESSAGES.INVALID_COLLABORATION_AMOUNT)
    err.code = 'INVALID_COLLABORATION_AMOUNT'
    throw err
  }
  return amount
}

export async function createStoreCollaboration({ clientId, operationType, amount, supplierStoreId }) {
  return callFunction('createStoreCollaboration', {
    clientId,
    operationType,
    amount: requireAmount(amount),
    supplierStoreId,
  })
}

export async function confirmStoreCollaboration({ collaborationId }) {
  return callFunction('confirmStoreCollaboration', { collaborationId })
}

export async function rejectStoreCollaboration({ collaborationId, rejectionReason }) {
  return callFunction('rejectStoreCollaboration', { collaborationId, rejectionReason })
}

export async function listStoreCollaborationProviders({ network } = {}) {
  const data = await callFunction('listStoreCollaborationProviders', network ? { network } : {})
  return data?.providers ?? []
}

// ─────────────────────────────────────────────────────────────────────────────
// Commandes — dettes internes
// ─────────────────────────────────────────────────────────────────────────────

export async function declareInternalDebtSettlement({ debtId, amount, method, idempotencyKey }) {
  return callFunction('declareInternalDebtSettlement', {
    debtId,
    amount: requireAmount(amount),
    method,
    idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
  })
}

export async function confirmInternalDebtSettlement({ debtId, settlementId }) {
  return callFunction('confirmInternalDebtSettlement', { debtId, settlementId })
}

export async function rejectInternalDebtSettlement({ debtId, settlementId, rejectionReason }) {
  return callFunction('rejectInternalDebtSettlement', { debtId, settlementId, rejectionReason })
}

export async function declareInternalDebtCompensation({ debtId, oppositeDebtId, amount, idempotencyKey }) {
  return callFunction('declareInternalDebtCompensation', {
    debtId,
    oppositeDebtId,
    amount: requireAmount(amount),
    idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
  })
}

export async function confirmInternalDebtCompensation({ debtId, settlementId }) {
  return callFunction('confirmInternalDebtCompensation', { debtId, settlementId })
}

export async function rejectInternalDebtCompensation({ debtId, settlementId, rejectionReason }) {
  return callFunction('rejectInternalDebtCompensation', { debtId, settlementId, rejectionReason })
}

// ─────────────────────────────────────────────────────────────────────────────
// Abonnements temps réel
// ─────────────────────────────────────────────────────────────────────────────

const rows = (snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))

const noop = () => {}

/**
 * Construit la contrainte de statut. Un seul des deux chemins est utilisé :
 *   statusFilter → `==` (file opérationnelle : un seul statut)
 *   statuses     → `in` (historique : plusieurs statuts terminaux)
 * Voir l'avertissement en tête de fichier : jamais de filtrage après coup.
 */
function statusConstraints({ statusFilter, statuses }) {
  if (statusFilter) return [where('status', '==', statusFilter)]
  if (Array.isArray(statuses) && statuses.length > 0) return [where('status', 'in', statuses)]
  return []
}

function subscribeCollaborations({
  field, storeId, statusFilter, statuses,
  limitCount = COLLABORATIONS_PAGE_SIZE, onUpdate, onError,
}) {
  if (!storeId) { onUpdate?.([]); return noop }
  const q = query(
    collection(db, 'storeCollaborations'),
    where(field, '==', storeId),
    ...statusConstraints({ statusFilter, statuses }),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  )
  return resilientOnSnapshot(q, {
    onNext: (snap) => onUpdate?.(rows(snap)),
    onError: (err) => onError?.(mapSnapshotError(err)),
  })
}

/** Mes demandes — je suis la boutique demandeuse. */
export function subscribeOutgoingCollaborations(options) {
  return subscribeCollaborations({ ...options, field: 'requestingStoreId' })
}

/** Reçues — je suis la fournisseuse, c'est à moi d'exécuter. */
export function subscribeIncomingCollaborations(options) {
  return subscribeCollaborations({ ...options, field: 'supplierStoreId' })
}

/**
 * Compteur du badge « collaborations reçues en attente ».
 * Sans orderBy ni limit : on ne lit que `snap.size`. Cet abonnement doit vivre
 * indépendamment du montage de la page — un onglet fermé doit pouvoir alerter.
 */
export function subscribeIncomingCollaborationsCount({ storeId, onUpdate } = {}) {
  if (!storeId) { onUpdate?.(0); return noop }
  const q = query(
    collection(db, 'storeCollaborations'),
    where('supplierStoreId', '==', storeId),
    where('status', '==', 'pending'),
  )
  return resilientOnSnapshot(q, { onNext: (snap) => onUpdate?.(snap.size) })
}

function subscribeDebts({ field, storeId, limitCount = INTERNAL_DEBTS_PAGE_SIZE, onUpdate, onError }) {
  if (!storeId) { onUpdate?.([]); return noop }
  const q = query(
    collection(db, 'internalDebts'),
    where(field, '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  )
  return resilientOnSnapshot(q, {
    onNext: (snap) => onUpdate?.(rows(snap)),
    onError: (err) => onError?.(mapSnapshotError(err)),
  })
}

/** Ce que je dois. */
export function subscribeMyDebts(options) {
  return subscribeDebts({ ...options, field: 'debtorStoreId' })
}

/** Ce qu'on me doit. */
export function subscribeMyCredits(options) {
  return subscribeDebts({ ...options, field: 'creditorStoreId' })
}

/** Les tranches d'UNE dette — requête sans clause `where` (cf. règles §13.2). */
export function subscribeDebtSettlements({ debtId, onUpdate, onError } = {}) {
  if (!debtId) { onUpdate?.([]); return noop }
  const q = query(
    collection(db, 'internalDebts', debtId, 'settlements'),
    orderBy('declaredAt', 'desc'),
  )
  return resilientOnSnapshot(q, {
    onNext: (snap) => onUpdate?.(rows(snap)),
    onError: (err) => onError?.(mapSnapshotError(err)),
  })
}

/**
 * Compteur du badge « règlements à confirmer ».
 *
 * ⚠ Le filtre sur `creditorStoreId` n'est pas seulement fonctionnel : c'est LUI
 *   qui exclut les `settlements` du moteur de transactions client, qui partagent
 *   le nom de sous-collection sans porter ce champ. La règle Firestore exige la
 *   même condition — les deux doivent rester alignées.
 */
export function subscribePendingSettlementsCount({ storeId, onUpdate } = {}) {
  if (!storeId) { onUpdate?.(0); return noop }
  const q = query(
    collectionGroup(db, 'settlements'),
    where('creditorStoreId', '==', storeId),
    where('settlementStatus', '==', 'declared'),
  )
  return resilientOnSnapshot(q, { onNext: (snap) => onUpdate?.(snap.size) })
}

export { doc, parseAmount }
