import { useLayoutEffect, useRef } from 'react'
import { construireTimelineArrivee } from '../motion/arrivee.js'
import { useReducedMotion } from './useReducedMotion.js'

/**
 * Joue l'arrivée du plan de travail sur la racine qu'on lui attache.
 *
 * UN SEUL PILOTE, DEUX POINTS DE MONTAGE, ET AUCUN DOM AJOUTÉ.
 * La séquence traverse trois composants FRÈRES — le bandeau, la navigation, les
 * cartes de solde. Aucun d'eux ne peut donc la conduire : elle appartient à ce
 * qui les contient. Mais un composant enveloppe aurait ajouté un `<div>` au
 * milieu du shell, entre autres au-dessus d'une bande `sticky` — on préfère un
 * hook, dont la référence se pose sur un élément QUI EXISTE DÉJÀ.
 *
 * `Layout` l'attache à sa racine ; le banc d'essai l'attache à la sienne, où
 * seul le bandeau est monté. La chorégraphie ne connaît que des sélecteurs
 * `data-motion` facultatifs : elle anime ce qu'elle trouve, et il n'existe donc
 * jamais deux versions à tenir d'accord.
 *
 * SOUS MOUVEMENT RÉDUIT, ON NE CONSTRUIT RIEN — pas de version dégradée, pas une
 * ligne de DOM touchée. Tout étant écrit en `.from()`, l'état statique EST déjà
 * l'état d'arrivée.
 *
 * `useLayoutEffect` et non `useEffect` : la timeline pose son état de départ à
 * la construction. Après la peinture, l'écran s'afficherait complet une image,
 * puis sauterait à son début pour s'animer.
 */
export function useArrivee() {
  const racine = useRef(null)
  const mouvementReduit = useReducedMotion()

  useLayoutEffect(() => {
    if (mouvementReduit) return undefined

    const { timeline, restaurerTexte, nettoyer } = construireTimelineArrivee({
      racine: racine.current,
    })

    // Le wordmark redevient un texte d'un seul tenant dès les lettres posées :
    // le découpage ne servait qu'à la séquence.
    timeline.eventCallback('onComplete', restaurerTexte)
    timeline.play()

    return nettoyer
  }, [mouvementReduit])

  return racine
}

export default useArrivee
