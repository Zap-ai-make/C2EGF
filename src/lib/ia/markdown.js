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
 * paragraphes, titres, listes à puces ou numérotées, et gras en ligne. Le
 * reste reste du texte.
 *
 * Les titres ont été ajoutés après le premier essai réel : le modèle écrit
 * « ### Répartition par type », et l'écran montrait les dièses.
 */

/**
 * @param {string} texte
 * @returns {Array<{type: 'paragraphe'|'titre'|'liste', ordonnee?: boolean, fragments?: Array, elements?: Array}>}
 */
export function analyserMarkdown(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return []

  const blocs = []
  let listeEnCours = null

  for (const ligneBrute of texte.split('\n')) {
    const ligne = ligneBrute.trimEnd()
    const puce = /^\s*[-*•]\s+(.*)$/.exec(ligne)
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(ligne)

    if (puce || numero) {
      const ordonnee = Boolean(numero && !puce)
      if (!listeEnCours || listeEnCours.ordonnee !== ordonnee) {
        listeEnCours = { type: 'liste', ordonnee, elements: [] }
        blocs.push(listeEnCours)
      }
      listeEnCours.elements.push(analyserFragments((puce ?? numero)[1]))
      continue
    }

    listeEnCours = null
    if (ligne.trim() === '') continue

    const titre = /^\s*#{1,6}\s+(.*)$/.exec(ligne)
    if (titre) {
      // Un titre déjà en gras (« ### **Bilan** ») ne se met pas en gras deux fois.
      blocs.push({ type: 'titre', fragments: analyserFragments(titre[1].replace(/^\*\*(.*)\*\*$/, '$1')) })
      continue
    }
    blocs.push({ type: 'paragraphe', fragments: analyserFragments(ligne) })
  }

  return blocs
}

/**
 * Le texte tel qu'on peut l'afficher PENDANT qu'il s'écrit.
 *
 * Coupé au milieu d'un gras, « **Total enc » montrerait ses deux astérisques
 * jusqu'à ce que la fermeture arrive. On retire le dernier `**` resté seul, et
 * un dièse de titre encore sans texte.
 */
export function texteEnCoursDEcriture(partiel) {
  let texte = String(partiel ?? '')
  const marques = texte.split('**').length - 1
  if (marques % 2 === 1) {
    const derniere = texte.lastIndexOf('**')
    texte = texte.slice(0, derniere) + texte.slice(derniere + 2)
  }
  return texte.replace(/(^|\n)\s*#{1,6}\s*$/, '$1')
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
