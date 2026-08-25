/**
 * Formate un Timestamp Firestore, un objet Date, ou toute valeur date-like.
 * Retourne '—' pour toute valeur absente ou invalide.
 */
export function formatFirestoreDate(value) {
  if (value == null) return '—'
  const d = value?.toDate ? value.toDate() : new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
