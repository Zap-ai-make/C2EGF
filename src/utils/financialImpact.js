/**
 * financialImpact.js — Fonctions financières pures
 *
 * Ce module contient exclusivement des fonctions sans effet de bord :
 * - aucun accès Firestore (db, runTransaction, etc.)
 * - aucun accès au réseau
 * - aucune dépendance à l'état de la boutique
 *
 * Les signatures, formules et messages d'erreur sont identiques à ceux
 * de FirestoreService. Ce module est la source de vérité ; FirestoreService
 * délègue à ces fonctions.
 */

import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'
import { parseFcfaAmount } from './fcfaAmount.js'

// ---------------------------------------------------------------------------
// Constantes locales (répliquées depuis firestore.js pour éviter l'import circulaire)
// ---------------------------------------------------------------------------

const DEFAULT_NETWORK_BALANCES = {
  Orange:   { stock: 0, liquidite: 0 },
  Moov:     { stock: 0, liquidite: 0 },
  Telecel:  { stock: 0, liquidite: 0 },
  Coris:    { stock: 0, liquidite: 0 },
  Sank:     { stock: 0, liquidite: 0 }
}

// ---------------------------------------------------------------------------
// Validation du montant FCFA
// ---------------------------------------------------------------------------

/**
 * Valide et convertit un montant FCFA brut en entier strictement positif.
 * Lance une erreur si le montant est invalide.
 *
 * @param {*} raw - Valeur brute (string ou number)
 * @param {string} [context=''] - Nom du contexte pour le message d'erreur
 * @returns {number} Montant entier valide
 */
export function validateFcfaAmount(raw, context = '') {
  const amount = parseFcfaAmount(raw)
  if (amount === null) {
    throw new Error(
      `Montant FCFA invalide${context ? ' dans ' + context : ''} : ${JSON.stringify(raw)}. ` +
      'Le montant doit être un entier strictement positif.'
    )
  }
  return amount
}

// ---------------------------------------------------------------------------
// Normalisation des balances réseau
// ---------------------------------------------------------------------------

/**
 * Normalise un objet de balances réseau.
 * Les champs manquants sont remplacés par les valeurs par défaut.
 * Les valeurs négatives sont ramenées à zéro.
 *
 * @param {object} [data={}] - Données brutes (avec ou sans champ .balances)
 * @returns {object} Balances normalisées
 */
export function normalizeNetworkBalances(data = {}) {
  const source = data.balances || data
  const normalized = { ...DEFAULT_NETWORK_BALANCES }

  Object.entries(source || {}).forEach(([network, value]) => {
    if (!value || typeof value !== 'object') return

    normalized[network] = {
      stock: Math.max(0, Number(value.stock) || 0),
      liquidite: Math.max(0, Number(value.liquidite) || 0)
    }
  })

  return normalized
}

// ---------------------------------------------------------------------------
// Manipulation des balances
// ---------------------------------------------------------------------------

/**
 * Applique un delta à un champ (stock ou liquidite) d'un réseau.
 * Lance une erreur si le solde devient négatif.
 *
 * @param {object} balances - Balances courantes
 * @param {string} network - Nom du réseau (ex: 'Orange')
 * @param {string} field - 'stock' ou 'liquidite'
 * @param {number} delta - Variation (positive ou négative)
 * @returns {object} Nouvelles balances
 */
export function adjustBalanceValue(balances, network, field, delta) {
  const next = { ...balances }
  const current = next[network] || { stock: 0, liquidite: 0 }
  const currentValue = Number(current[field]) || 0

  if (delta < 0 && currentValue + delta < 0) {
    const label = field === 'stock' ? 'Stock' : 'Liquidite'
    const target = field === 'stock' ? ` pour ${network}` : ''
    throw new Error(`${label} insuffisant${target}. Disponible: ${currentValue.toLocaleString('fr-FR')} FCFA`)
  }

  next[network] = {
    ...current,
    [field]: currentValue + delta
  }

  return next
}

/**
 * Applique un delta de liquidité en distribuant sur tous les réseaux.
 * Pour un delta positif, applique sur le premier réseau.
 * Pour un delta négatif, consomme progressivement sur chaque réseau.
 *
 * @param {object} balances - Balances courantes
 * @param {number} delta - Variation de liquidité
 * @returns {object} Nouvelles balances
 */
export function applyLiquidityDelta(balances, delta) {
  const networks = Object.keys(balances)
  const firstNetwork = networks[0] || 'Orange'

  if (delta >= 0) {
    return adjustBalanceValue(balances, firstNetwork, 'liquidite', delta)
  }

  let remaining = Math.abs(delta)
  let next = { ...balances }

  for (const network of networks) {
    if (remaining <= 0) break

    const currentLiquidity = Number(next[network]?.liquidite) || 0
    const amountToRemove = Math.min(currentLiquidity, remaining)
    next = adjustBalanceValue(next, network, 'liquidite', -amountToRemove)
    remaining -= amountToRemove
  }

  if (remaining > 0) {
    const totalLiquidity = Object.values(balances).reduce(
      (sum, data) => sum + (Number(data?.liquidite) || 0),
      0
    )
    throw new Error(`Liquidite insuffisante. Disponible: ${totalLiquidity.toLocaleString('fr-FR')} FCFA`)
  }

  return next
}

// ---------------------------------------------------------------------------
// Normalisation et classification des types de transaction
// ---------------------------------------------------------------------------

/**
 * Normalise un libellé de transaction : supprime accents, espaces de début/fin,
 * met en minuscules.
 *
 * @param {*} value - Valeur à normaliser
 * @returns {string} Libellé normalisé
 */
export function normalizeTransactionLabel(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** @param {string} type @returns {boolean} */
export function isDepositType(type) {
  return normalizeTransactionLabel(type) === 'depot'
}

/** @param {string} type @returns {boolean} */
export function isWithdrawalType(type) {
  return normalizeTransactionLabel(type) === 'retrait'
}

/** @param {string} type @returns {boolean} */
export function isCreditType(type) {
  return normalizeTransactionLabel(type) === 'credit'
}

/** @param {string} status @returns {boolean} */
export function isPendingStatus(status) {
  return normalizeTransactionLabel(status) === normalizeTransactionLabel(FIRESTORE_CONFIG.STATUS.PENDING)
}

/** @param {string} status @returns {boolean} */
export function isValidatedStatus(status) {
  return normalizeTransactionLabel(status) === normalizeTransactionLabel(FIRESTORE_CONFIG.STATUS.VALIDATED)
}

// ---------------------------------------------------------------------------
// Mapping méthodes de paiement
// ---------------------------------------------------------------------------

/**
 * Convertit une méthode de paiement en nom de réseau interne.
 *
 * @param {string} paymentMethod - Ex: 'Orange Money'
 * @returns {string} Nom de réseau (ex: 'Orange', 'Liquidite')
 */
export function mapPaymentMethodToNetwork(paymentMethod) {
  const mapping = {
    'Orange Money': 'Orange',
    'Moov Money':   'Moov',
    'Sank Money':   'Sank',
    'Coris Money':  'Coris',
    'Telecel Money': 'Telecel',
    'Cash':         'Liquidite'
  }
  return mapping[paymentMethod] || paymentMethod
}

// ---------------------------------------------------------------------------
// Actions de règlement
// ---------------------------------------------------------------------------

/**
 * Extrait l'action de règlement à partir du statut d'une transaction.
 *
 * @param {string} status
 * @returns {'payerPar'|'rembourser'|'encaisser'|null}
 */
export function getSettlementActionFromStatus(status) {
  if (status?.startsWith('Payé par ')) return 'payerPar'
  if (status?.startsWith('Remboursé par ')) return 'rembourser'
  if (status?.startsWith('Encaissé par ')) return 'encaisser'
  return null
}

/**
 * Vérifie que l'action de règlement est cohérente avec le type de transaction.
 * Lance une erreur si incompatible.
 *
 * @param {string} transactionType
 * @param {'payerPar'|'rembourser'|'encaisser'|null} action
 */
export function validateSettlementAction(transactionType, action) {
  let expectedAction = null
  if (isWithdrawalType(transactionType)) expectedAction = 'payerPar'
  if (isCreditType(transactionType))    expectedAction = 'rembourser'
  if (isDepositType(transactionType))   expectedAction = 'encaisser'

  if (!action || expectedAction === action) {
    return
  }

  throw new Error(`Action ${action} non autorisee pour ${transactionType}`)
}

// ---------------------------------------------------------------------------
// Impact initial d'une transaction
// ---------------------------------------------------------------------------

/**
 * Applique l'impact d'une transaction nouvellement créée sur les balances.
 *
 * - Statut "Non Terminées" (pending) :
 *   Dépôt/Crédit → stock -= montant
 *   Retrait       → stock += montant
 *
 * - Statut "Validée" (direct) :
 *   Dépôt  → stock -= montant, liquidite += montant
 *   Retrait → liquidite -= montant, stock += montant
 *   Crédit  → interdit (doit passer par règlement)
 *
 * @param {object} balances
 * @param {object} transactionData - { type, statut, montant, reseau }
 * @returns {object} Nouvelles balances
 */
export function applyInitialTransactionImpact(balances, transactionData) {
  const amount = validateFcfaAmount(transactionData.montant, 'applyInitialTransactionImpact')
  const network = transactionData.reseau

  if (isPendingStatus(transactionData.statut)) {
    if (isDepositType(transactionData.type) || isCreditType(transactionData.type)) {
      return adjustBalanceValue(balances, network, 'stock', -amount)
    }

    if (isWithdrawalType(transactionData.type)) {
      return adjustBalanceValue(balances, network, 'stock', amount)
    }
  }

  if (isValidatedStatus(transactionData.statut)) {
    if (isCreditType(transactionData.type)) {
      throw new Error('Les credits doivent etre rembourses via une methode de paiement')
    }

    if (isDepositType(transactionData.type)) {
      return applyLiquidityDelta(
        adjustBalanceValue(balances, network, 'stock', -amount),
        amount
      )
    }

    if (isWithdrawalType(transactionData.type)) {
      const balancesAfterCashPayment = applyLiquidityDelta(balances, -amount)
      return adjustBalanceValue(balancesAfterCashPayment, network, 'stock', amount)
    }
  }

  return balances
}

/**
 * Inverse l'impact d'une transaction en statut "Non Terminées".
 * Utilisé lors de la suppression ou modification d'un brouillon.
 *
 * @param {object} balances
 * @param {object} transactionData - { type, statut, montant, reseau }
 * @returns {object} Nouvelles balances
 */
export function reverseInitialTransactionImpact(balances, transactionData) {
  const amount = validateFcfaAmount(transactionData.montant, 'reverseInitialTransactionImpact')
  const network = transactionData.reseau

  if (isPendingStatus(transactionData.statut)) {
    if (isDepositType(transactionData.type) || isCreditType(transactionData.type)) {
      return adjustBalanceValue(balances, network, 'stock', amount)
    }

    if (isWithdrawalType(transactionData.type)) {
      return adjustBalanceValue(balances, network, 'stock', -amount)
    }
  }

  return balances
}

// ---------------------------------------------------------------------------
// Renversement d'impact pending uniquement (Path 2 sans règlement)
// ---------------------------------------------------------------------------

/**
 * Inverse uniquement l'impact pending d'une transaction.
 *
 * @param {object} balances
 * @param {string} type
 * @param {string} reseau
 * @param {number} amount
 * @returns {object} Nouvelles balances
 */
export function reversePendingOnlyImpact(balances, type, reseau, amount) {
  if (isDepositType(type) || isCreditType(type)) {
    return adjustBalanceValue(balances, reseau, 'stock', amount)
  }
  if (isWithdrawalType(type)) {
    return adjustBalanceValue(balances, reseau, 'stock', -amount)
  }
  throw new Error(`Type de transaction non reconnu pour le renversement : ${type}`)
}

// ---------------------------------------------------------------------------
// Renversement d'impact direct validée (Path 1)
// ---------------------------------------------------------------------------

/**
 * Inverse l'impact d'une transaction directement validée (sans règlement intermédiaire).
 *
 * @param {object} balances
 * @param {string} type
 * @param {string} reseau
 * @param {number} amount
 * @returns {object} Nouvelles balances
 */
export function reverseDirectValidatedImpact(balances, type, reseau, amount) {
  if (isDepositType(type)) {
    return applyLiquidityDelta(
      adjustBalanceValue(balances, reseau, 'stock', amount),
      -amount
    )
  }
  if (isWithdrawalType(type)) {
    throw new Error('Renversement impossible : la répartition exacte de la liquidité consommée par ce retrait n\'est pas disponible. Cette transaction ne peut pas être annulée automatiquement.')
  }
  if (isCreditType(type)) {
    return adjustBalanceValue(balances, reseau, 'stock', amount)
  }
  throw new Error(`Type de transaction non reconnu pour le renversement : ${type}`)
}

// ---------------------------------------------------------------------------
// Renversement complet d'une transaction historique
// ---------------------------------------------------------------------------

/**
 * Inverse l'impact d'une transaction de l'historique sur les balances.
 *
 * Trois chemins possibles :
 * - Path 2 avec règlement (paymentMethod présent) : annuler le règlement puis l'impact pending
 * - Path 2 sans règlement (validatedAt présent) : annuler uniquement l'impact pending
 * - Path 1 direct validée : annuler applyInitialTransactionImpact(Validée)
 *
 * @param {object} currentBalances
 * @param {object} historyData - Document historique complet
 * @returns {object} Nouvelles balances
 */
export function reverseHistoryTransactionImpact(currentBalances, historyData) {
  const rawAmount = historyData.montant
  const reseau = historyData.reseau
  const type = historyData.type
  const paymentMethod = historyData.paymentMethod || null
  const effectiveNetwork = historyData.effectiveNetwork || null
  const statut = historyData.statut

  if (normalizeTransactionLabel(statut) === normalizeTransactionLabel(FIRESTORE_CONFIG.STATUS.CANCELLED)) {
    throw new Error('Cette transaction est déjà annulée')
  }

  const amount = validateFcfaAmount(rawAmount, 'reverseHistoryTransactionImpact')

  if (!reseau) {
    throw new Error('Données de transaction incomplètes pour le renversement financier')
  }

  if (!type) {
    throw new Error('Données de transaction incomplètes pour le renversement financier')
  }

  if (!isDepositType(type) && !isWithdrawalType(type) && !isCreditType(type)) {
    throw new Error(`Type de transaction non reconnu pour le renversement : ${type}`)
  }

  // Path 3 multi-tranches : utiliser settlementSummary.netByNetwork pour inverser exactement
  // chaque impact réseau (paid - refunded = impact net réel).
  const netByNetwork = historyData.settlementSummary?.netByNetwork
  if (netByNetwork && Object.keys(netByNetwork).length > 0) {
    let next = { ...currentBalances }
    for (const [network, { paid = 0, refunded = 0 }] of Object.entries(netByNetwork)) {
      const net = paid - refunded
      if (net === 0) continue
      // L'impact settlement initial : dépôt/crédit → stock[network] += net ; retrait → stock[network] -= net
      const settlementDelta = isWithdrawalType(type) ? -net : net
      if (network === 'Liquidite') {
        next = applyLiquidityDelta(next, -settlementDelta)
      } else {
        next = adjustBalanceValue(next, network, 'stock', -settlementDelta)
      }
    }
    // Inverser l'impact pending initial (stock du réseau d'origine)
    return reversePendingOnlyImpact(next, type, reseau, amount)
  }

  // Path 2 avec règlement mono-méthode : annuler le règlement puis l'impact pending
  if (paymentMethod) {
    const settlementDelta = isWithdrawalType(type) ? -amount : amount
    let next
    if (effectiveNetwork === 'Liquidite') {
      next = applyLiquidityDelta(currentBalances, -settlementDelta)
    } else {
      next = adjustBalanceValue(currentBalances, effectiveNetwork, 'stock', -settlementDelta)
    }
    return reversePendingOnlyImpact(next, type, reseau, amount)
  }

  // Path 2 sans règlement : annuler uniquement l'impact pending
  if (historyData.validatedAt) {
    return reversePendingOnlyImpact(currentBalances, type, reseau, amount)
  }

  // Path 1 direct validée : annuler applyInitialTransactionImpact(Validée)
  return reverseDirectValidatedImpact(currentBalances, type, reseau, amount)
}

// ---------------------------------------------------------------------------
// Impact du règlement d'une transaction
// ---------------------------------------------------------------------------

/**
 * Applique l'impact d'un règlement (validation avec méthode de paiement).
 *
 * @param {object} balances
 * @param {object} transactionData - { type, montant }
 * @param {string} paymentMethod - Ex: 'Orange Money', 'Cash'
 * @returns {object} Nouvelles balances
 */
export function applySettlementImpact(balances, transactionData, paymentMethod) {
  const amount = validateFcfaAmount(transactionData.montant, 'applySettlementImpact')
  const targetNetwork = mapPaymentMethodToNetwork(paymentMethod)
  const delta = isWithdrawalType(transactionData.type) ? -amount : amount

  if (targetNetwork === 'Liquidite') {
    return applyLiquidityDelta(balances, delta)
  }

  return adjustBalanceValue(balances, targetNetwork, 'stock', delta)
}
