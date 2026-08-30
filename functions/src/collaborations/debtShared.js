/**
 * Helpers purs des dettes internes et de la compensation — aucune I/O.
 *
 * Sémantique métier :
 *   Une dette naît d'une collaboration confirmée. La boutique DÉBITRICE déclare
 *   des tranches de remboursement ; la CRÉANCIÈRE les confirme ou les rejette.
 *   Une tranche déclarée n'impute RIEN : elle réserve seulement du montant.
 *
 *   La COMPENSATION solde une dette D1 (A→B) contre la dette opposée D2 (B→A).
 *   Aucun float ne bouge : seuls les restes dus des deux dettes.
 *
 * Conventions maison : les validations retournent la valeur normalisée ou lancent
 * DealerRequestError ; jamais de HttpsError ici.
 */

import { DealerRequestError } from '../errors.js'
import { mapPaymentMethodToNetwork } from '../settlements/financialUtils.js'
import { STORE_NETWORKS, DEBT_SETTLEMENT_METHODS } from '../config/storeProfile.js'

export const DEBT_STATUSES = Object.freeze({
  OPEN: 'open',
  PARTIALLY_SETTLED: 'partially_settled',
  SETTLED: 'settled',
})

export const SETTLEMENT_STATUSES = Object.freeze({
  DECLARED: 'declared',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
})

// Méthode réservée au circuit de compensation. Elle n'est JAMAIS déclarable par
// le chemin des règlements : c'est le handler de compensation qui la pose.
export const COMPENSATION_METHOD = 'compensation'

// Préfixes d'identifiant obligatoires : ils garantissent qu'un règlement, une
// compensation et un miroir ne peuvent jamais entrer en collision dans la même
// sous-collection.
export const SETTLEMENT_ID_PREFIXES = Object.freeze({
  SETTLEMENT: 'dst_',
  COMPENSATION: 'dcp_',
  MIRROR: 'comp_',
})

// ---------------------------------------------------------------------------
// Validation des entrées
// ---------------------------------------------------------------------------

export function validateDebtId(debtId) {
  if (typeof debtId !== 'string' || debtId.trim() === '') {
    throw new DealerRequestError('INVALID_DEBT_ID', 'Dette invalide.')
  }
  return debtId.trim()
}

export function validateSettlementId(settlementId) {
  if (typeof settlementId !== 'string' || settlementId.trim() === '') {
    throw new DealerRequestError('INVALID_SETTLEMENT_ID', 'Règlement invalide.')
  }
  return settlementId.trim()
}

export function validateSettlementAmount(amount) {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError(
      'INVALID_SETTLEMENT_AMOUNT',
      'Montant invalide : entier strictement positif requis.',
    )
  }
  return amount
}

/**
 * Méthode de règlement déclarable = méthodes du profil + « Banque ».
 *
 * ⚠ Cette validation ne s'applique QU'À LA DÉCLARATION. Une tranche déjà écrite,
 * portant un code historique (`especes`, `transfert`…), doit rester confirmable :
 * refuser sa confirmation la figerait pour toujours dans la file d'attente.
 * `compensation` est exclue ici — elle a son propre circuit.
 */
export function validateSettlementMethod(method, methods = DEBT_SETTLEMENT_METHODS) {
  const allowed = Array.isArray(methods) ? methods : [...methods]
  if (typeof method !== 'string' || !allowed.includes(method)) {
    throw new DealerRequestError('INVALID_SETTLEMENT_METHOD', 'Méthode de règlement invalide.')
  }
  return method
}

/**
 * Clé d'idempotence — 1 à 100 caractères.
 *
 * ⚠ Le jeu de caractères est restreint à [A-Za-z0-9_-] parce que cette clé entre
 * TELLE QUELLE dans un identifiant de document Firestore (voir les fonctions
 * déterministes plus bas). Une clé contenant « / » fabriquerait un chemin de
 * sous-collection au lieu d'un document, et « __x__ » heurterait les identifiants
 * réservés de Firestore. Le front génère du base36, donc conforme par construction.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

export function validateIdempotencyKey(key) {
  if (typeof key !== 'string') {
    throw new DealerRequestError('INVALID_IDEMPOTENCY_KEY', 'Clé de règlement invalide.')
  }
  const trimmed = key.trim()
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw new DealerRequestError('INVALID_IDEMPOTENCY_KEY', 'Clé de règlement invalide.')
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Identifiants déterministes — le socle de l'idempotence
// ---------------------------------------------------------------------------

// Même acteur + même dette + même clé ⇒ même identifiant ⇒ un retry légitime
// retombe sur le document déjà écrit au lieu d'en créer un second.
export function deterministicSettlementId(debtId, actorUid, idempotencyKey) {
  return `${SETTLEMENT_ID_PREFIXES.SETTLEMENT}${validateDebtId(debtId)}_${actorUid}_${validateIdempotencyKey(idempotencyKey)}`
}

export function deterministicCompensationId(debtId, actorUid, idempotencyKey) {
  return `${SETTLEMENT_ID_PREFIXES.COMPENSATION}${validateDebtId(debtId)}_${actorUid}_${validateIdempotencyKey(idempotencyKey)}`
}

// Le miroir vit sous D2 mais porte l'id de D1 : c'est ce qui le rend traçable
// jusqu'à la tranche source, et unique même si D2 reçoit plusieurs compensations.
export function deterministicMirrorId(sourceDebtId, settlementId) {
  return `${SETTLEMENT_ID_PREFIXES.MIRROR}${validateDebtId(sourceDebtId)}_${validateSettlementId(settlementId)}`
}

// ---------------------------------------------------------------------------
// État d'une dette
// ---------------------------------------------------------------------------

/**
 * Relit l'état financier d'une dette en vérifiant son invariant permanent :
 *   settledAmount + remainingAmount === originalAmount, et remainingAmount >= 0.
 * Une dette qui ne le respecte pas est corrompue : on refuse d'opérer dessus
 * plutôt que de propager l'incohérence.
 */
export function readDebtState(debtData) {
  if (!debtData || typeof debtData !== 'object') {
    throw new DealerRequestError('INVALID_DEBT_DATA', 'Données de dette invalides.')
  }
  const isAmount = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const { originalAmount, settledAmount, remainingAmount, status } = debtData

  if (!isAmount(originalAmount) || !isAmount(settledAmount) || !isAmount(remainingAmount)) {
    throw new DealerRequestError('INVALID_DEBT_DATA', 'Montants de dette invalides.')
  }
  if (settledAmount + remainingAmount !== originalAmount) {
    throw new DealerRequestError(
      'INVALID_DEBT_DATA',
      'Dette incohérente : réglé + reste dû doit égaler le montant initial.',
    )
  }
  return { originalAmount, settledAmount, remainingAmount, status }
}

/**
 * Impute un montant sur une dette et recalcule son statut.
 * Le statut est DÉRIVÉ du reste dû, jamais transmis : une dette dont le reste
 * tombe à 0 est réglée, point.
 */
export function nextDebtState(debtData, amount) {
  const { originalAmount, settledAmount, remainingAmount } = readDebtState(debtData)
  validateSettlementAmount(amount)

  const newRemaining = remainingAmount - amount
  if (newRemaining < 0) {
    throw new DealerRequestError(
      'SETTLEMENT_EXCEEDS_REMAINING',
      'Le montant dépasse le reste dû (des règlements sont peut-être déjà en attente).',
    )
  }
  return {
    originalAmount,
    settledAmount: settledAmount + amount,
    remainingAmount: newRemaining,
    status: newRemaining === 0 ? DEBT_STATUSES.SETTLED : DEBT_STATUSES.PARTIALLY_SETTLED,
  }
}

export function assertDebtOpen(debtData) {
  const { remainingAmount, status } = readDebtState(debtData)
  if (status === DEBT_STATUSES.SETTLED || remainingAmount <= 0) {
    throw new DealerRequestError('DEBT_ALREADY_SETTLED', 'Cette dette est déjà réglée.')
  }
  return remainingAmount
}

// ---------------------------------------------------------------------------
// Réservation par les tranches déclarées
// ---------------------------------------------------------------------------

/**
 * Somme des montants des tranches DÉCLARÉES (donc en attente de confirmation).
 * C'est ce total qui « réserve » du reste dû : sans lui, une boutique pourrait
 * déclarer trois fois la totalité de sa dette et la solder au triple.
 *
 * Accepte des snapshots Firestore comme des objets bruts.
 */
export function sumDeclaredAmounts(docs) {
  const list = Array.isArray(docs) ? docs : (docs?.docs ?? [])
  return list.reduce((total, entry) => {
    const data = typeof entry?.data === 'function' ? entry.data() : entry
    if (data?.settlementStatus !== SETTLEMENT_STATUSES.DECLARED) return total
    return total + validateSettlementAmount(data.amount)
  }, 0)
}

/** Ce qu'il reste RÉELLEMENT déclarable : le reste dû moins ce qui est réservé. */
export function availableToDeclare(remainingAmount, pendingAmount) {
  return Math.max(0, remainingAmount - pendingAmount)
}

// ---------------------------------------------------------------------------
// Mouvement de stock : la règle la plus subtile du module
// ---------------------------------------------------------------------------

/**
 * Un remboursement par MOBILE MONEY déplace réellement du float : la dette ne se
 * solde pas que comptablement, le stock passe de la débitrice à la créancière.
 * Un remboursement en CASH ou par BANQUE ne bouge aucun solde de l'application —
 * l'argent circule hors système — mais la dette est quand même imputée.
 *
 * On s'appuie sur mapPaymentMethodToNetwork, qui existe déjà et est en parité
 * verrouillée avec le front (TC-081) : Orange Money → Orange, Cash → Liquidite,
 * et tout code inconnu se renvoie lui-même. « Liquidite » et « Banque » ne sont
 * pas des réseaux → aucun mouvement.
 */
export function settlementNetwork(method) {
  return mapPaymentMethodToNetwork(method)
}

export function settlementMovesStock(method, storeNetworks = STORE_NETWORKS) {
  if (method === COMPENSATION_METHOD) return false
  const list = Array.isArray(storeNetworks) ? storeNetworks : [...storeNetworks]
  return list.includes(settlementNetwork(method))
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

/**
 * D2 doit lier les deux MÊMES boutiques que D1, en sens inverse.
 * Sans ce contrôle, on solderait une dette contre la créance d'un tiers.
 */
export function validateOppositeDebtPair(debt1, debt2) {
  if (
    !debt1 || !debt2 ||
    debt2.debtorStoreId !== debt1.creditorStoreId ||
    debt2.creditorStoreId !== debt1.debtorStoreId
  ) {
    throw new DealerRequestError(
      'NOT_OPPOSITE_PAIR',
      'La dette opposée doit lier les deux mêmes boutiques en sens inverse.',
    )
  }
  return true
}

export function assertDistinctDebts(debtId, oppositeDebtId) {
  if (validateDebtId(debtId) === validateDebtId(oppositeDebtId)) {
    throw new DealerRequestError('INVALID_OPPOSITE_DEBT', 'Dette opposée invalide.')
  }
  return true
}

/**
 * Plafond compensable : le plus petit des deux « restes réellement disponibles ».
 * On ne peut pas compenser plus que ce que l'une OU l'autre des dettes porte encore.
 */
export function compensationCapacity({ remainingD1, pendingD1 = 0, remainingD2, pendingD2 = 0 }) {
  return Math.max(0, Math.min(
    availableToDeclare(remainingD1, pendingD1),
    availableToDeclare(remainingD2, pendingD2),
  ))
}

export function assertCompensationWithinCapacity(amount, capacity) {
  validateSettlementAmount(amount)
  if (amount > capacity) {
    throw new DealerRequestError(
      'COMPENSATION_EXCEEDS_REMAINING',
      'Le montant dépasse ce qui est compensable.',
    )
  }
  return amount
}
