const formatter = new Intl.NumberFormat('fr-FR', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Formate un montant entier en FCFA.
 * Retourne '—' pour toute valeur non numérique finie.
 *
 * Exemples : formatCurrency(5000000) → '5 000 000 FCFA'
 *            formatCurrency(0)       → '0 FCFA'
 *            formatCurrency(null)    → '—'
 */
export function formatCurrency(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  return formatter.format(Number(amount)) + ' FCFA'
}

/**
 * Vérifie qu'une valeur est un montant Firestore valide.
 * Seuls les entiers sûrs >= 0 sont valides.
 * Refuse : strings, booleans, null, NaN, Infinity, décimaux, négatifs.
 */
export function isValidStoredAmount(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
}

/**
 * Formate un montant stocké dans Firestore.
 * Retourne 'Montant indisponible' pour toute valeur non valide.
 */
export function formatStoredAmount(value) {
  return isValidStoredAmount(value) ? formatCurrency(value) : 'Montant indisponible'
}
