/**
 * gestes.js — lit ce que le modèle veut faire à l'écran → une INTENTION, ou un
 * refus lisible.
 *
 * PUR. Il n'a ni routeur ni boutique, et ne doit pas en avoir. Il rend une
 * intention ; seul le composant l'exécute.
 *
 * ⚠ Aucun clic simulé, aucune valeur posée dans le DOM. React ne voit pas une
 *   valeur écrite dans le DOM : l'écran afficherait « 1 200 000 » et le
 *   formulaire enverrait zéro. Un geste est un appel de fonction, pas un pixel.
 */

import { resoudreDestination } from './destinations.js'

export const GESTES = Object.freeze({
  ALLER: 'aller',
  PROPOSER: 'proposer',
  FERMER: 'fermer',
})

/**
 * @returns {{ok: true, geste: string, chemin?: string, libelle?: string}
 *          | {ok: false, raison: string}}
 */
export function lireGeste(nomOutil, arguments_ = {}) {
  switch (nomOutil) {
    case 'fermer_l_assistant':
      return { ok: true, geste: GESTES.FERMER }

    case 'aller_a':
    case 'proposer_l_ecran': {
      const resolution = resoudreDestination(arguments_?.ecran)
      if (!resolution.ok) return resolution
      return {
        ok: true,
        geste: nomOutil === 'aller_a' ? GESTES.ALLER : GESTES.PROPOSER,
        chemin: resolution.destination.chemin,
        libelle: resolution.destination.libelle,
      }
    }

    default:
      return { ok: false, raison: `Geste inconnu : ${nomOutil}.` }
  }
}
