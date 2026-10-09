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

/**
 * Le retour : la boutique rend au dealer ce qu'il lui avait envoyé.
 *
 * UNE SEULE JAMBE, ET C'EST TOUT L'INTÉRÊT
 * ──────────────────────────────────────
 * Un dépôt validé fait DEUX choses — il sort du stock et remplit la liquidité.
 * C'est précisément pour ça qu'il ne pouvait pas servir à rendre : la boutique
 * voulait sortir un montant, pas en faire entrer un autre au passage.
 *
 * Le retour est l'inverse exact du ravitaillement, au signe près. Rien d'autre
 * ne bouge, et c'est ce qui le rend aussi trivialement annulable : aucune
 * cascade de liquidité à reconstituer, contrairement au retrait client.
 *
 * Le refus « réserve insuffisante » n'est pas écrit ici : `adjustBalanceValue`
 * le porte déjà pour tout delta négatif, avec le disponible dans le message.
 */
export function applyReplenishmentReturnImpact(balances, network, field, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Montant de retour invalide.')
  if (field !== 'stock' && field !== 'liquidite') throw new Error('Vase de retour inconnu.')
  return adjustBalanceValue(balances, network, field, -amount)
}

/**
 * Defait une cloture : chaque reserve balayee revient d'ou elle venait.
 *
 * LA CLOTURE PORTE SON PROPRE INVERSE
 * ───────────────────────────────────
 * Elle enregistre `soldes` — le stock et la liquidite de CHAQUE reseau au
 * moment ou elle les a mis a zero. Rien n'est donc recalcule ici : on rend
 * exactement ce qui a ete pris, reseau par reseau. Reconstituer ces montants
 * autrement (depuis le total, depuis les transactions du jour) donnerait un
 * chiffre plausible et faux des que deux reseaux sont en jeu.
 *
 * ⚠ ON AJOUTE, ON NE RESTAURE PAS UN ETAT. L'effet d'une cloture fut un delta
 *   negatif ; son inverse est le delta positif. Ecraser les soldes courants
 *   avec ceux d'avant la cloture effacerait tout ce qui s'est passe depuis.
 *   C'est la meme regle que pour toutes les autres inversions du dossier.
 */
export function reverseClosureImpact(balances, soldes) {
  if (!Array.isArray(soldes) || soldes.length === 0) {
    throw new Error('Cloture sans detail des soldes : son inverse est inconnaissable.')
  }

  return soldes.reduce((courant, solde) => {
    const network = solde?.network
    if (typeof network !== 'string' || !network) {
      throw new Error('Cloture mal formee : un solde sans reseau.')
    }
    const stock = Number(solde.stock) || 0
    const liquidite = Number(solde.liquidite) || 0
    if (stock < 0 || liquidite < 0) {
      throw new Error('Cloture mal formee : un solde negatif.')
    }

    const avecStock = stock > 0 ? adjustBalanceValue(courant, network, 'stock', stock) : courant
    return liquidite > 0 ? adjustBalanceValue(avecStock, network, 'liquidite', liquidite) : avecStock
  }, balances)
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

// Une ligne dont l'impact a DÉJÀ été défait ne doit pas pouvoir le défaire une
// seconde fois : elle rendrait un montant que la boutique a déjà récupéré, et
// les cartes gonfleraient d'un dépôt fantôme. « Annulée » couvrait ce cas ;
// « Supprimée » — la corbeille — le couvre pour la même raison et au même titre.
const DEJA_DEFAIT = ['annulee', 'supprimee']

export function reverseHistoryTransactionImpact(balances, history) {
  if (DEJA_DEFAIT.includes(normalizeType(history.statut))) throw new Error('Cette transaction est déjà annulée.')
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
  // `directValidation` marque une ligne passée par le bouton « Valider » du
  // formulaire : validée d'un geste, sans règlement. Le test vient AVANT celui
  // de `validatedAt`, que ces lignes portent aussi — sans quoi on ne défairait
  // que la jambe du brouillon et la liquidité resterait échouée dans les soldes.
  if (history.directValidation) return reverseDirectValidation(next, type, reseau, montant, history.liquiditySplit)
  if (history.validatedAt) return reversePendingOnlyImpact(next, type, reseau, montant)
  if (isDepot(type) || isRetrait(type)) return reverseDirectValidation(next, type, reseau, montant, history.liquiditySplit)
  return adjustBalanceValue(next, reseau, 'stock', montant)
}

/**
 * La répartition EXACTE d'une consommation de liquidité, réseau par réseau.
 *
 * `applyLiquidityDelta` consomme un delta négatif EN CASCADE : il vide le
 * premier réseau, puis entame le suivant, et ainsi de suite. L'opération n'est
 * donc pas réversible à partir du seul montant — rendre la somme au premier
 * réseau recréerait un total juste sur une répartition fausse.
 *
 * Cette fonction rejoue la même boucle mais RETOURNE la répartition au lieu de
 * l'appliquer, pour qu'on puisse l'écrire dans le document d'historique au
 * moment de la création. C'est la seule façon de pouvoir défaire le geste plus
 * tard, et c'est exactement ce que la limitation documentée de TC-013-F
 * appelait de ses vœux.
 */
export function liquidityConsumptionSplit(balances, amount) {
  const split = {}
  let remaining = amount

  for (const network of Object.keys(balances)) {
    if (remaining <= 0) break
    const available = Number(balances[network]?.liquidite) || 0
    const taken = Math.min(available, remaining)
    if (taken > 0) split[network] = taken
    remaining -= taken
  }

  if (remaining > 0) {
    const total = Object.values(balances).reduce((sum, d) => sum + (Number(d?.liquidite) || 0), 0)
    throw new Error(`Liquidite insuffisante. Disponible: ${total.toLocaleString('fr-FR')} FCFA`)
  }

  return split
}

/**
 * Défait une ligne validée SANS règlement : ses deux jambes d'un coup.
 *
 * L'inverse de la branche « validée » d'`applyInitialTransactionImpact` : un
 * dépôt y vide le stock et remplit la liquidité, un retrait fait l'inverse.
 *
 * LE RETRAIT EXIGE SA RÉPARTITION, ET CE N'EST PAS UNE PRÉCAUTION DE PRINCIPE
 * ──────────────────────────────────────────────────────────────────────────
 * Un retrait consomme la liquidité en cascade sur plusieurs réseaux. Rendre le
 * montant au premier réseau produirait un TOTAL juste sur une répartition
 * fausse — l'erreur la plus coûteuse qui soit, parce qu'elle ne se voit pas.
 *
 * Avec `split`, écrit à la création, l'inversion est exacte : chaque réseau
 * récupère ce qu'il avait donné. Sans lui — les lignes d'avant ce lot — le
 * refus demeure, parce que l'information est réellement perdue. Le dépôt n'a
 * pas ce problème : sa liquidité est entrée d'un bloc sur un seul réseau.
 */
function reverseDirectValidation(balances, type, reseau, montant, split) {
  if (isDepot(type)) return applyLiquidityDelta(adjustBalanceValue(balances, reseau, 'stock', montant), -montant)
  if (isRetrait(type)) {
    if (!split || typeof split !== 'object' || !Object.keys(split).length) {
      throw new Error("L'annulation automatique de ce retrait historique n'est pas sûre.")
    }
    let next = adjustBalanceValue(balances, reseau, 'stock', -montant)
    for (const [network, amount] of Object.entries(split)) {
      next = adjustBalanceValue(next, network, 'liquidite', Number(amount) || 0)
    }
    return next
  }
  throw new Error('Type de transaction non reconnu.')
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
