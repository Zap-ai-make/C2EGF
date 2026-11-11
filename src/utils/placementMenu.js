/**
 * Où ouvrir le menu « Encaisser / Payer par / Rembourser » d'une non terminée.
 *
 * ⚠ LE MENU EST EN `position: fixed`, DONC EN COORDONNÉES DE L'ÉCRAN. L'ancien
 *   calcul ajoutait le défilement de la page (`window.scrollY`) : dès que la
 *   page avait défilé, le menu tombait sous le bouton, puis était remonté à
 *   300 px du bas — moins que la hauteur de sa seconde étape. Le bouton de
 *   validation sortait de l'écran (retour du terrain, 2026-11-10).
 *
 * ⚠ IL S'OUVRE VERS LE HAUT, ancré par son BAS au-dessus du bouton : la seconde
 *   étape, plus haute que la première, grandit alors vers le haut sans quitter
 *   le bouton. Vers le bas seulement quand la ligne est trop près du haut de
 *   l'écran pour qu'il y tienne. Dans les deux cas, sa hauteur est bornée à la
 *   place disponible et il défile à l'intérieur : la validation reste atteignable.
 */

export const ECART = 8
export const MARGE = 10
/** La hauteur de la seconde étape (montant, code agent, validation), à peu près. */
export const HAUTEUR_UTILE = 340
export const LARGEUR_MENU = 240

export function placerMenu(bouton, { hauteurFenetre, largeurFenetre }) {
  const left = Math.max(MARGE, Math.min(bouton.left - 50, largeurFenetre - LARGEUR_MENU))
  const auDessus = bouton.top - ECART - MARGE
  const enDessous = hauteurFenetre - bouton.bottom - ECART - MARGE

  if (auDessus >= HAUTEUR_UTILE || auDessus >= enDessous) {
    return { sens: 'haut', bottom: hauteurFenetre - bouton.top + ECART, left, maxHeight: Math.max(0, auDessus) }
  }
  return { sens: 'bas', top: bouton.bottom + ECART, left, maxHeight: Math.max(0, enDessous) }
}
