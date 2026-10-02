/**
 * financialUtils.js — Fonctions financières pures pour Cloud Functions.
 *
 * Clone ciblé de src/utils/financialImpact.js (fonctions nécessaires aux
 * settlements uniquement). Aucune dépendance externe — utilisable dans
 * l'environnement Node.js des Cloud Functions sans bundler.
 *
 * Fonctions exportées :
 *   normalizeNetworkBalances  — normalise les soldes réseau
 *   mapPaymentMethodToNetwork — convertit méthode → réseau
 *   applySettlementImpact     — applique un paiement sur les soldes
 *   reverseSettlementImpact   — inverse un règlement (remboursement)
 *
 * ⚠️  DIVERGENCE DOCUMENTÉE vs src/utils/financialImpact.js
 * ─────────────────────────────────────────────────────────
 * Ce fichier duplique volontairement les fonctions communes pour s'exécuter
 * dans Node.js (Cloud Functions) sans bundler ni alias Vite.
 *
 * Différences intentionnelles :
 *   • normalizeNetworkBalances : utilise JSON.parse/JSON.stringify (deep copy)
 *     au lieu de { ...DEFAULT_NETWORK_BALANCES } (shallow) — comportement identique
 *     car les objets réseau sont à un seul niveau.
 *   • applySettlementImpact : utilise txData.montant directement (entier déjà validé
 *     par le handler) au lieu de validateFcfaAmount() — équivalent car la CF valide
 *     avant d'appeler cette fonction.
 *   • reverseSettlementImpact : ajoutée ici (absente de financialImpact.js).
 *
 * Parité front↔functions verrouillée par TC-081 (tests-unit/tc-081-financial-parity) :
 * mêmes entrées → mêmes sorties/erreurs sur les deux implémentations. (TC-060-F ne teste que
 * cette version functions ; il ne garantit PAS la parité — c'est le rôle de TC-081.)
 * Toute modification de la logique financière doit être répercutée dans les DEUX fichiers.
 */

const DEFAULT_NETWORK_BALANCES = {
  Orange:   { stock: 0, liquidite: 0 },
  Moov:     { stock: 0, liquidite: 0 },
  Telecel:  { stock: 0, liquidite: 0 },
  Coris:    { stock: 0, liquidite: 0 },
  Sank:     { stock: 0, liquidite: 0 },
}

function normalizeType(type) {
  return String(type || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function isRetrait(type) { return normalizeType(type) === 'retrait' }
function isDepot(type) { return normalizeType(type) === 'depot' }
function isCredit(type) { return normalizeType(type) === 'credit' }

/**
 * Normalise les soldes réseau (valeurs manquantes → 0, négatives → 0).
 *
 * @param {object} [data={}] - Document networkBalances brut
 * @returns {object} Balances normalisées
 */
export function normalizeNetworkBalances(data = {}) {
  const source = data.balances || data
  const normalized = JSON.parse(JSON.stringify(DEFAULT_NETWORK_BALANCES))

  Object.entries(source || {}).forEach(([network, value]) => {
    if (!value || typeof value !== 'object') return
    normalized[network] = {
      stock:     Math.max(0, Number(value.stock)     || 0),
      liquidite: Math.max(0, Number(value.liquidite) || 0),
    }
  })

  return normalized
}

/**
 * Applique un delta à un champ d'un réseau.
 * Lance une erreur si le solde résultant serait négatif.
 */
function adjustBalanceValue(balances, network, field, delta) {
  const next = { ...balances }
  const current = next[network] || { stock: 0, liquidite: 0 }
  const currentValue = Number(current[field]) || 0

  if (delta < 0 && currentValue + delta < 0) {
    const label = field === 'stock' ? 'Stock' : 'Liquidite'
    const target = field === 'stock' ? ` pour ${network}` : ''
    throw new Error(`${label} insuffisant${target}. Disponible: ${currentValue.toLocaleString('fr-FR')} FCFA`)
  }

  next[network] = { ...current, [field]: currentValue + delta }
  return next
}

/**
 * Applique un delta de liquidité distribué sur tous les réseaux.
 * Delta positif → premier réseau. Delta négatif → consomme progressivement.
 */
function applyLiquidityDelta(balances, delta) {
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
      (sum, d) => sum + (Number(d?.liquidite) || 0), 0
    )
    throw new Error(`Liquidite insuffisante. Disponible: ${totalLiquidity.toLocaleString('fr-FR')} FCFA`)
  }

  return next
}

/**
 * Le ravitaillement de la centrale.
 *
 * C'est la seule opération qui fait MONTER la somme stock + liquidité. Une
 * transaction client ne fait que la déplacer d'un vase à l'autre : un dépôt
 * vide le stock et remplit la liquidité, un retrait l'inverse. Ici, de la
 * valeur entre dans la boutique — d'où une fonction nommée à part plutôt
 * qu'un `adjustBalanceValue` appelé au milieu d'un handler, pour que la
 * relecture d'un solde anormal mène droit à la bonne porte.
 *
 * Le montant est toujours positif : vider un vase n'est pas un ravitaillement
 * et n'a pas à passer par ce chemin.
 */
export function applyReplenishmentImpact(balances, network, field, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Montant de ravitaillement invalide.')
  if (field !== 'stock' && field !== 'liquidite') throw new Error('Vase de ravitaillement inconnu.')
  return adjustBalanceValue(balances, network, field, amount)
}

export function applyInitialTransactionImpact(balances, transaction) {
  const amount = transaction.montant
  const pending = ['non terminees'].includes(normalizeType(transaction.statut))
  const validated = ['validee'].includes(normalizeType(transaction.statut))
  if (pending) {
    if (isDepot(transaction.type) || isCredit(transaction.type)) return adjustBalanceValue(balances, transaction.reseau, 'stock', -amount)
    if (isRetrait(transaction.type)) return adjustBalanceValue(balances, transaction.reseau, 'stock', amount)
  }
  if (validated) {
    if (isCredit(transaction.type)) throw new Error('Les crédits doivent être remboursés via une méthode de paiement.')
    if (isDepot(transaction.type)) return applyLiquidityDelta(adjustBalanceValue(balances, transaction.reseau, 'stock', -amount), amount)
    if (isRetrait(transaction.type)) return adjustBalanceValue(applyLiquidityDelta(balances, -amount), transaction.reseau, 'stock', amount)
  }
  return balances
}

export function reversePendingOnlyImpact(balances, type, network, amount) {
  if (isDepot(type) || isCredit(type)) return adjustBalanceValue(balances, network, 'stock', amount)
  if (isRetrait(type)) return adjustBalanceValue(balances, network, 'stock', -amount)
  throw new Error('Type de transaction non reconnu.')
}

export function reverseInitialTransactionImpact(balances, transaction) {
  return reversePendingOnlyImpact(balances, transaction.type, transaction.reseau, transaction.montant)
}

export function reverseHistoryTransactionImpact(balances, history) {
  if (normalizeType(history.statut) === 'annulee') throw new Error('Cette transaction est déjà annulée.')
  const { type, reseau, montant } = history
  if (!type || !reseau || !Number.isSafeInteger(montant) || montant <= 0) throw new Error('Historique financier incomplet.')
  let next = { ...balances }
  const summary = history.settlementSummary?.netByNetwork
  if (summary && Object.keys(summary).length) {
    for (const [network, values] of Object.entries(summary)) {
      const net = (values.paid || 0) - (values.refunded || 0)
      const delta = isRetrait(type) ? -net : net
      next = network === 'Liquidite' ? applyLiquidityDelta(next, -delta) : adjustBalanceValue(next, network, 'stock', -delta)
    }
    return reversePendingOnlyImpact(next, type, reseau, montant)
  }
  if (history.paymentMethod) {
    const network = history.effectiveNetwork || mapPaymentMethodToNetwork(history.paymentMethod)
    const delta = isRetrait(type) ? -montant : montant
    next = network === 'Liquidite' ? applyLiquidityDelta(next, -delta) : adjustBalanceValue(next, network, 'stock', -delta)
    return reversePendingOnlyImpact(next, type, reseau, montant)
  }
  if (history.validatedAt) return reversePendingOnlyImpact(next, type, reseau, montant)
  if (isDepot(type)) return applyLiquidityDelta(adjustBalanceValue(next, reseau, 'stock', montant), -montant)
  if (isRetrait(type)) throw new Error("L'annulation automatique de ce retrait historique n'est pas sûre.")
  return adjustBalanceValue(next, reseau, 'stock', montant)
}

/**
 * Convertit une méthode de paiement en nom de réseau interne.
 *
 * @param {string} paymentMethod - ex: 'Orange Money', 'Cash'
 * @returns {string} Nom de réseau (ex: 'Orange', 'Liquidite')
 */
export function mapPaymentMethodToNetwork(paymentMethod) {
  const mapping = {
    'Orange Money':  'Orange',
    'Moov Money':    'Moov',
    'Sank Money':    'Sank',
    'Coris Money':   'Coris',
    'Telecel Money': 'Telecel',
    'Cash':          'Liquidite',
  }
  return mapping[paymentMethod] || paymentMethod
}

/**
 * Applique l'impact financier d'un paiement (settlement) sur les soldes.
 *
 * Retrait → delta négatif (le client retire de la liquidité/stock)
 * Dépôt/Crédit → delta positif (on reçoit de la liquidité/stock)
 *
 * @param {object} balances
 * @param {{ type: string, montant: number }} txData
 * @param {string} paymentMethod
 * @returns {object} Nouvelles balances
 */
export function applySettlementImpact(balances, txData, paymentMethod) {
  const amount = txData.montant
  const targetNetwork = mapPaymentMethodToNetwork(paymentMethod)
  const delta = isRetrait(txData.type) ? -amount : amount

  if (targetNetwork === 'Liquidite') return applyLiquidityDelta(balances, delta)
  return adjustBalanceValue(balances, targetNetwork, 'stock', delta)
}

/**
 * Inverse l'impact d'un paiement (utilisé pour les remboursements).
 *
 * Retrait → delta positif (le client rend les fonds)
 * Dépôt/Crédit → delta négatif (on rend ce qu'on a reçu)
 *
 * @param {object} balances
 * @param {{ type: string, montant: number }} txData
 * @param {string} paymentMethod
 * @returns {object} Nouvelles balances
 */
export function reverseSettlementImpact(balances, txData, paymentMethod) {
  const amount = txData.montant
  const targetNetwork = mapPaymentMethodToNetwork(paymentMethod)
  const delta = isRetrait(txData.type) ? amount : -amount

  if (targetNetwork === 'Liquidite') return applyLiquidityDelta(balances, delta)
  return adjustBalanceValue(balances, targetNetwork, 'stock', delta)
}
