/**
 * Les initiales d'une personne, pour la pastille du compte (gérant ou dealer).
 *
 * Deux mots → première lettre du premier et du dernier ; un seul mot → ses deux
 * premières lettres. Un nom vide rend « ? » plutôt qu'une pastille muette : le
 * compte reste identifiable même quand le profil n'a pas de nom.
 */
export function initiales(nom) {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
