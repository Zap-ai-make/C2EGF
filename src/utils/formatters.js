/**
 * formatters.js — Formatage d'affichage partagé (dates).
 *
 * Centralise les fonctions de formatage de date jusque-là dupliquées à
 * l'identique dans une dizaine de pages admin/dealer/store. Comportement
 * strictement identique aux copies d'origine (mêmes gardes, même locale) :
 *   - entrée falsy → '—'
 *   - Firestore Timestamp (méthode .toDate()) ou Date/número/string
 *   - date invalide → '—'
 *
 * Deux variantes historiques :
 *   - formatDateTime : jour/mois/année + heure:minute (la plus répandue)
 *   - formatDateShort : jour/mois/année seulement
 */

// Convertit une valeur (Timestamp Firestore, Date, number, string) en Date
// valide, ou null si la valeur est absente/invalide.
function toValidDate(ts) {
  if (!ts) return null
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Date + heure au format fr-FR (jj/mm/aaaa hh:mm). Entrée invalide → '—'. */
export function formatDateTime(ts) {
  const d = toValidDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Date seule au format fr-FR (jj/mm/aaaa). Entrée invalide → '—'. */
export function formatDateShort(ts) {
  const d = toValidDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
