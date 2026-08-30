/**
 * Le parse d'un montant saisi — pur, et seul de son espèce.
 *
 * Il vivait dans `collaborationService.js`, qui importe la configuration
 * Firebase. Tout composant qui voulait VALIDER une saisie avant d'ouvrir le
 * réseau tirait donc Firestore et Functions derrière lui, et chaque test de ce
 * composant devait doubler le service entier pour une fonction de dix lignes —
 * en la réécrivant dans le double, c'est-à-dire en testant la copie.
 *
 * Il est ici, sans dépendance. Le service le ré-exporte : les appelants
 * existants et TC-118 ne bougent pas.
 *
 * ⚠ Ce parse VALIDE, il ne convertit pas pour l'envoi. La valeur transmise au
 *   serveur reste la saisie brute, dont le service est la source unique de
 *   conversion — deux conversions finiraient par diverger.
 */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export default parseAmount
