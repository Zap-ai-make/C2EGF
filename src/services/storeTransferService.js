/**
 * storeTransferService.js — Transferts boutique → dealer (retours stock/liquidité).
 *
 * Écritures : exclusivement via Cloud Functions (httpsCallable). Aucun write
 * Firestore direct ici — le backend reste autoritatif (débit/crédit/restauration
 * des soldes). Lectures : abonnements temps réel filtrés par rôle (les règles
 * Firestore cloisonnent : boutique voit ses transferts, dealer voit les siens).
 *
 * Région Functions : europe-west1 (config dans src/config/firebase.js).
 */

import { httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { functions, db } from '../config/firebase'
import { STORE_TRANSFERS_PAGE_SIZE } from '../constants/dealerConstants'
import { parseStrictInteger as parseAmountLocal } from '../utils/parseStrictInteger'
import { shapeDealerInventory, emptyDealerInventory } from '../utils/dealerInventory'

const TRANSFERS_COLLECTION = 'storeDealerTransfers'

// ── Mapping des codes métier → messages UI ───────────────────────────────────
const ERROR_MESSAGES = {
  UNAUTHENTICATED:            'Votre session a expiré. Reconnectez-vous.',
  PROFILE_NOT_FOUND:          'Votre profil est introuvable.',
  PROFILE_INACTIVE:           'Votre compte est inactif.',
  ROLE_FORBIDDEN:             "Vous n'avez pas l'autorisation d'effectuer cette action.",
  STORE_ID_REQUIRED:          'Identifiant de boutique manquant dans votre profil.',
  INVALID_TRANSFER_TYPE:      'Type de transfert invalide.',
  INVALID_TRANSFER_AMOUNT:    'Montant invalide : entier strictement positif requis.',
  INVALID_TRANSFER_ID:        'Identifiant de transfert invalide.',
  INVALID_TRANSFER_NETWORK:   'Réseau invalide pour ce profil.',
  INVALID_INVENTORY_RESOURCE: 'Ressource invalide (stock ou liquidité).',
  INVALID_PARTNER:            'Partenaire invalide.',
  INVALID_TRANSFER_DATA:      'Les données de ce transfert sont invalides.',
  INVALID_REJECTION_REASON:   'Le motif de rejet est invalide.',
  TRANSFER_NOT_FOUND:         'Ce transfert est introuvable.',
  TRANSFER_NOT_PENDING:       'Ce transfert a déjà été traité.',
  TRANSFER_DEALER_MISMATCH:   'Ce transfert ne vous est pas destiné.',
  INSUFFICIENT_STORE_BALANCE: 'Solde insuffisant pour ce transfert.',
  INSUFFICIENT_DEALER_BALANCE:'Solde insuffisant : la diminution dépasse votre inventaire.',
  DEALER_NOT_FOUND:           'Aucun dealer disponible pour le moment.',
  MULTIPLE_DEALERS_ACTIVE:    'Configuration invalide : plusieurs dealers actifs. Contactez un administrateur.',
  BALANCE_NOT_FOUND:          'Le solde est introuvable.',
  INVALID_BALANCE_DATA:       'Le solde actuel est invalide. Contactez un administrateur.',
  BALANCE_OVERFLOW:           'Le nouveau solde dépasse la limite autorisée.',
  TRANSACTION_FAILED:         "L'opération n'a pas pu être finalisée.",
}

export function mapTransferError(err) {
  // Le code métier (details.code) est prioritaire et distingue précisément les
  // cas (solde insuffisant, déjà traité, etc.). On ne retombe JAMAIS sur un
  // message spécifique trompeur : le repli par catégorie reste neutre.
  const detailCode = err?.details?.code
  if (detailCode) {
    const mapped = new Error(ERROR_MESSAGES[detailCode] || "L'opération n'a pas pu être finalisée.")
    mapped.code = detailCode
    return mapped
  }
  const funcCode = String(err?.code || '')
  let message = "Une erreur inattendue s'est produite."
  let code = ''
  if (funcCode.includes('unauthenticated'))          { message = ERROR_MESSAGES.UNAUTHENTICATED;  code = 'UNAUTHENTICATED' }
  else if (funcCode.includes('permission-denied'))   { message = ERROR_MESSAGES.ROLE_FORBIDDEN;    code = 'ROLE_FORBIDDEN' }
  else if (funcCode.includes('not-found'))           { message = ERROR_MESSAGES.TRANSFER_NOT_FOUND; code = 'TRANSFER_NOT_FOUND' }
  else if (funcCode.includes('failed-precondition')) { message = "Opération impossible dans l'état actuel."; code = 'FAILED_PRECONDITION' }
  else if (funcCode.includes('invalid-argument'))    { message = 'Données invalides.'; code = 'INVALID_ARGUMENT' }
  const mapped = new Error(message)
  mapped.code = code
  return mapped
}

// Validation locale minimale (le backend reste autoritatif) : parseAmountLocal
// est parseStrictInteger (import ci-dessus).

// ── Commandes (callable) ─────────────────────────────────────────────────────

/** Boutique : initie un retour (débit immédiat côté serveur). */
export async function createStoreDealerTransfer({ transferType, amount, network } = {}) {
  const parsed = parseAmountLocal(amount)
  if (parsed === null) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_AMOUNT)
  const callable = httpsCallable(functions, 'createStoreDealerTransfer')
  try {
    // network transmis uniquement s'il est fourni (multi-réseaux) — deploy-safe :
    // en mono le payload reste { transferType, amount }, inchangé.
    const payload = { transferType, amount: parsed }
    if (network) payload.network = network
    const result = await callable(payload)
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

/** Dealer : confirme la réception (crédit inventaire dealer). */
export async function confirmStoreDealerTransfer(transferId) {
  const id = String(transferId ?? '').trim()
  if (!id) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_ID)
  const callable = httpsCallable(functions, 'confirmStoreDealerTransfer')
  try {
    const result = await callable({ transferId: id })
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

// network n'est transmis au serveur QUE s'il est fourni (dealer multi-réseaux).
// En mono-réseau, le payload reste { resource, amount } — strictement inchangé et
// compatible avec des functions non encore déployées (le serveur applique alors
// le défaut mono-réseau via resolveTransferNetwork).
function buildInventoryPayload(resource, parsed, network) {
  const payload = { resource, amount: parsed }
  if (network) payload.network = network
  return payload
}

/** Dealer : approvisionne son inventaire (crédit stock ou liquidité). */
export async function replenishDealerInventory({ resource, amount, network } = {}) {
  if (resource !== 'stock' && resource !== 'liquidite') throw new Error('Ressource invalide (stock ou liquidité).')
  const parsed = parseAmountLocal(amount)
  if (parsed === null) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_AMOUNT)
  const callable = httpsCallable(functions, 'replenishDealerInventory')
  try {
    const result = await callable(buildInventoryPayload(resource, parsed, network))
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

/** Dealer : diminue son inventaire (débit stock ou liquidité, bloqué sous zéro). */
export async function decreaseDealerInventory({ resource, amount, network } = {}) {
  if (resource !== 'stock' && resource !== 'liquidite') throw new Error('Ressource invalide (stock ou liquidité).')
  const parsed = parseAmountLocal(amount)
  if (parsed === null) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_AMOUNT)
  const callable = httpsCallable(functions, 'decreaseDealerInventory')
  try {
    const result = await callable(buildInventoryPayload(resource, parsed, network))
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

/** Dealer : rejette (restaure le solde boutique). Motif 3–500 caractères. */
export async function rejectStoreDealerTransfer(transferId, rejectionReason) {
  const id = String(transferId ?? '').trim()
  if (!id) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_ID)
  const reason = String(rejectionReason ?? '').trim()
  if (reason.length < 3) throw new Error('Le motif doit comporter au moins 3 caractères.')
  if (reason.length > 500) throw new Error('Le motif ne peut pas dépasser 500 caractères.')
  const callable = httpsCallable(functions, 'rejectStoreDealerTransfer')
  try {
    const result = await callable({ transferId: id, rejectionReason: reason })
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

/**
 * Dealer : opération partenaire (1:1 sur son inventaire).
 *   - 'deposit'    (dépôt)  : −stock +liquidité
 *   - 'withdrawal' (retrait): +stock −liquidité
 */
export async function createPartnerDeposit({ partner, amount, operation = 'deposit', network } = {}) {
  if (!partner || !partner.id) throw new Error(ERROR_MESSAGES.INVALID_PARTNER)
  if (operation !== 'deposit' && operation !== 'withdrawal') throw new Error(ERROR_MESSAGES.INVALID_PARTNER)
  const parsed = parseAmountLocal(amount)
  if (parsed === null) throw new Error(ERROR_MESSAGES.INVALID_TRANSFER_AMOUNT)
  const callable = httpsCallable(functions, 'createPartnerDeposit')
  try {
    const callablePayload = {
      partnerId: partner.id,
      partnerNom: partner.nom ?? '',
      partnerPrenom: partner.prenom ?? '',
      partnerNumeroDA: partner.numeroDA ?? '',
      partnerLocalite: partner.localite ?? '',
      amount: parsed,
      operation,
    }
    // network transmis uniquement s'il est fourni (multi-réseaux) — deploy-safe.
    if (network) callablePayload.network = network
    const result = await callable(callablePayload)
    return result.data
  } catch (err) {
    throw mapTransferError(err)
  }
}

// ── Lectures temps réel ──────────────────────────────────────────────────────

/** Dealer : ses dépôts partenaires (première page, temps réel). */
export function subscribePartnerDeposits({ dealerUid, onUpdate, onError } = {}) {
  if (!dealerUid) { onUpdate?.([]); return () => {} }
  const q = query(
    collection(db, 'dealerPartnerDeposits'),
    where('dealerUid', '==', dealerUid),
    orderBy('createdAt', 'desc'),
    limit(STORE_TRANSFERS_PAGE_SIZE),
  )
  return onSnapshot(
    q,
    (snap) => onUpdate?.(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(mapTransferError(err)),
  )
}

/** Boutique : ses propres transferts (première page, temps réel). */
export function subscribeStoreTransfers({ storeId, onUpdate, onError } = {}) {
  if (!storeId) { onUpdate?.([]); return () => {} }
  const q = query(
    collection(db, TRANSFERS_COLLECTION),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(STORE_TRANSFERS_PAGE_SIZE),
  )
  return onSnapshot(
    q,
    (snap) => onUpdate?.(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(mapTransferError(err)),
  )
}

/** Dealer : transferts entrants qui le ciblent (optionnellement filtrés par statut). */
export function subscribeIncomingTransfers({ dealerUid, statusFilter = null, onUpdate, onError } = {}) {
  if (!dealerUid) { onUpdate?.([]); return () => {} }
  const constraints = [where('dealerUid', '==', dealerUid)]
  if (statusFilter) constraints.push(where('status', '==', statusFilter))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(STORE_TRANSFERS_PAGE_SIZE))
  const q = query(collection(db, TRANSFERS_COLLECTION), ...constraints)
  return onSnapshot(
    q,
    (snap) => onUpdate?.(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(mapTransferError(err)),
  )
}

/** Dealer : compteur léger des transferts entrants en attente. */
export function subscribeIncomingTransfersCount({ dealerUid, onUpdate } = {}) {
  if (!dealerUid) { onUpdate?.(0); return () => {} }
  const q = query(
    collection(db, TRANSFERS_COLLECTION),
    where('dealerUid', '==', dealerUid),
    where('status', '==', 'pending'),
  )
  return onSnapshot(q, (snap) => onUpdate?.(snap.size), () => onUpdate?.(0))
}

/**
 * Dealer : son inventaire (dealerBalances/{uid}) en temps réel.
 * Renvoie la forme façonnée { byNetwork, stock, liquidite, totalLiquidite } :
 *   - `stock`/`liquidite` = réseau primaire → vue mono-réseau inchangée ;
 *   - `byNetwork`/`totalLiquidite` = vue multi-réseaux (cartes par réseau).
 */
export function subscribeDealerBalance({ dealerUid, onUpdate, onError } = {}) {
  if (!dealerUid) { onUpdate?.(emptyDealerInventory()); return () => {} }
  return onSnapshot(
    doc(db, 'dealerBalances', dealerUid),
    (snap) => onUpdate?.(shapeDealerInventory(snap.exists() ? snap.data() : null)),
    (err) => onError?.(mapTransferError(err)),
  )
}
