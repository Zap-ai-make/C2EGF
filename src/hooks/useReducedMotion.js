import { useSyncExternalStore } from 'react'

/**
 * `useReducedMotion` — le réglage système « mouvement réduit », lisible depuis
 * React.
 *
 * POURQUOI CE HOOK ALORS QUE `motion-safe:` EXISTE DÉJÀ.
 * La variante Tailwind couvre tout ce que le CSS anime, et c'est la convention
 * du dépôt (tc-094 la fait tenir). Mais elle agit par classe, et une timeline
 * GSAP n'écrit pas de classe : elle écrit des styles en ligne, image par image.
 * Aucune media query ne peut l'arrêter. La décision doit donc exister aussi en
 * JavaScript — et à un seul endroit, pour que les deux surfaces ne puissent
 * jamais diverger.
 *
 * POURQUOI `useSyncExternalStore` ET PAS `useState` + `useEffect`.
 * Le couple habituel lit le réglage APRÈS le premier rendu : l'animation part,
 * puis se fait couper. Sur un garde-fou d'accessibilité, ce battement est
 * exactement ce qu'on cherchait à éviter — la personne voit précisément le
 * mouvement dont elle ne veut pas. `useSyncExternalStore` fournit la valeur
 * juste dès le premier rendu, et React se charge de l'abonnement.
 *
 * Les trois fonctions vivent au niveau du module, et non dans le corps du hook :
 * `useSyncExternalStore` se réabonne dès que `souscrire` change d'identité. Les
 * définir à l'intérieur provoquerait un désabonnement/réabonnement à chaque
 * rendu — le genre de fuite silencieuse qu'aucun écran ne montre.
 */

const REQUETE = '(prefers-reduced-motion: reduce)'

/**
 * `matchMedia` peut manquer : navigateur ancien, environnement sans DOM. Un
 * garde-fou d'accessibilité qui lève est pire que pas de garde-fou du tout.
 */
function liste() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REQUETE)
    : null
}

function souscrire(surChangement) {
  const media = liste()
  if (!media) return () => {}

  media.addEventListener('change', surChangement)
  return () => media.removeEventListener('change', surChangement)
}

/**
 * La même décision, hors de React — pour les gestes IMPÉRATIFS : un défilement
 * déclenché au clic, une timeline construite à la volée. Ceux-là ne se rendent
 * pas, ils s'exécutent ; ils n'ont donc pas de rendu où lire un état.
 *
 * Lire au moment de l'appel est ici plus juste que fermer sur une valeur rendue :
 * le geste obéit au réglage tel qu'il est À L'INSTANT où il part.
 *
 * Rend un booléen, donc comparable par identité — `useSyncExternalStore` l'exige.
 */
export function prefereMouvementReduit() {
  return liste()?.matches ?? false
}

const lire = prefereMouvementReduit

/**
 * Sans information — pas de DOM —, on répond `false` : on n'impose pas le calme
 * à qui n'a rien demandé, on l'accorde à qui le demande.
 */
function lireSansDom() {
  return false
}

export function useReducedMotion() {
  return useSyncExternalStore(souscrire, lire, lireSansDom)
}

export default useReducedMotion
