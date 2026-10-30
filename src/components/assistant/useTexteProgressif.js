import { useEffect, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

/**
 * Le texte de l'assistant s'écrit LETTRE PAR LETTRE.
 *
 * Le modèle livre par paquets d'une ou deux phrases : affichés tels quels, ils
 * tombaient « en vrac ». On les dévide à une vitesse de lecture, et on
 * accélère seulement si la réponse prend trop d'avance — attendre une minute
 * qu'un long bilan finisse de s'écrire serait pire que le vrac.
 *
 * « Mouvement réduit » demandé : tout s'affiche d'un coup. Un message ancien
 * (`actif` faux) aussi : on ne réécrit pas ce qu'on a déjà lu.
 */
export const INTERVALLE_MS = 16

/** Combien de lettres ajouter à ce tic, selon le retard sur le texte reçu. */
export function pasDEcriture(retard) {
  if (retard <= 0) return 0
  if (retard < 60) return 1
  if (retard < 300) return 2
  return Math.ceil(retard / 120)
}

/**
 * @param {string} cible   tout ce qui a été reçu jusqu'ici
 * @param {boolean} actif  ce message est-il celui qu'on est en train d'écrire ?
 * @param {() => void} [surAvance]  appelé à chaque lettre : pour suivre le bas
 * @returns {{texte: string, fini: boolean}}
 */
export function useTexteProgressif(cible, actif, surAvance) {
  const reduit = useReducedMotion()
  const anime = actif && !reduit
  const [longueur, setLongueur] = useState(() => (anime ? 0 : cible.length))

  useEffect(() => {
    if (!anime || longueur >= cible.length) return undefined
    const minuterie = setTimeout(() => {
      setLongueur((l) => Math.min(cible.length, l + pasDEcriture(cible.length - l)))
      surAvance?.()
    }, INTERVALLE_MS)
    return () => clearTimeout(minuterie)
  }, [anime, cible, longueur, surAvance])

  const visible = anime ? Math.min(longueur, cible.length) : cible.length
  return { texte: cible.slice(0, visible), fini: visible >= cible.length }
}
