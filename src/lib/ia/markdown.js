/**
 * markdown.js — le balisage du modèle → une STRUCTURE à afficher.
 *
 * PUR, et volontairement minuscule.
 *
 * ⚠ JAMAIS DE HTML. Aucun `dangerouslySetInnerHTML` nulle part dans la chaîne.
 *   Le modèle peut répéter ce qu'il a lu, et une note client peut contenir
 *   `<img onerror=...>`. On analyse ici, React rend et échappe.
 *
 * On ne gère que ce qu'un assistant de comptoir produit réellement :
 * paragraphes, listes à puces, et gras en ligne. Le reste reste du texte.
 */

/**
 * @param {string} texte
 * @returns {Array<{type: 'paragraphe'|'liste', fragments?: Array, elements?: Array}>}
 */
export function analyserMarkdown(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return []

  const blocs = []
  let listeEnCours = null

  for (const ligneBrute of texte.split('\n')) {
    const ligne = ligneBrute.trimEnd()
    const puce = /^\s*[-*•]\s+(.*)$/.exec(ligne)

    if (puce) {
      if (!listeEnCours) {
        listeEnCours = { type: 'liste', elements: [] }
        blocs.push(listeEnCours)
      }
      listeEnCours.elements.push(analyserFragments(puce[1]))
      continue
    }

    listeEnCours = null
    if (ligne.trim() === '') continue
    blocs.push({ type: 'paragraphe', fragments: analyserFragments(ligne) })
  }

  return blocs
}

/**
 * Découpe une ligne en fragments normaux / gras.
 * @returns {Array<{gras: boolean, texte: string}>}
 */
export function analyserFragments(ligne) {
  const fragments = []
  const motif = /\*\*([^*]+)\*\*/g
  let position = 0
  let trouve

  while ((trouve = motif.exec(ligne)) !== null) {
    if (trouve.index > position) {
      fragments.push({ gras: false, texte: ligne.slice(position, trouve.index) })
    }
    fragments.push({ gras: true, texte: trouve[1] })
    position = trouve.index + trouve[0].length
  }

  if (position < ligne.length) {
    fragments.push({ gras: false, texte: ligne.slice(position) })
  }

  return fragments.length > 0 ? fragments : [{ gras: false, texte: ligne }]
}
