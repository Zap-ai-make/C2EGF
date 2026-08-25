/**
 * Fusionne deux listes de demandes sans doublon.
 *
 * Règles :
 *   - Priorité au snapshot temps réel pour un même id.
 *   - Les extras ne contribuent qu'avec des ids absents du snapshot.
 *   - Les doublons internes aux extras sont éliminés (premier gagner).
 *   - Aucune mutation des tableaux d'entrée.
 *
 * @param {Array} realtimeList  - Première page snapshot (source de vérité)
 * @param {Array} extraList     - Pages supplémentaires getDocs
 * @returns {Array}
 */
export function mergeUniqueRequests(realtimeList, extraList) {
  const seen = new Set()
  for (const r of realtimeList) {
    if (r.id && typeof r.id === 'string') seen.add(r.id)
  }
  const uniqueExtras = []
  for (const req of extraList) {
    if (!req.id || typeof req.id !== 'string') {
      // id absent ou invalide → toujours conserver, ne pas dédupliquer via Set
      uniqueExtras.push(req)
    } else if (!seen.has(req.id)) {
      seen.add(req.id)
      uniqueExtras.push(req)
    }
  }
  return [...realtimeList, ...uniqueExtras]
}
