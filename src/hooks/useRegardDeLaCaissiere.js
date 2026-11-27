import { useEffect } from 'react'

const GESTES = Object.freeze(['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'])

/**
 * Le premier geste de la caissière devant le tableau, quand une demande
 * arrivée attend son regard (correction de l'utilisateur, le 2026-11-27) :
 * c'est là que commencent les 20 s de pulsation (`PULSATION_MS`), pas à
 * l'arrivée. Un écran en veille, ou la caissière au comptoir, et la ligne
 * pulse jusqu'à son retour.
 *
 * Un geste, et pas l'écran visible : un moniteur éteint laisse la page
 * « visible ». Mais un geste sur une page cachée ne compte pas non plus.
 *
 * Les écouteurs ne vivent que tant qu'une arrivée attend : le reste du temps,
 * pas un appel par mouvement de souris.
 *
 * @param {Map<string, {le: number, vueLe: number|null}>} arrivees
 * @param {() => void} [marquerVues]
 */
export function useRegardDeLaCaissiere(arrivees, marquerVues) {
  const attendSonRegard = [...arrivees.values()].some((a) => a.vueLe === null)

  useEffect(() => {
    if (!attendSonRegard || typeof marquerVues !== 'function') return undefined
    const voir = () => {
      if (document.visibilityState === 'visible') marquerVues()
    }
    for (const geste of GESTES) window.addEventListener(geste, voir, { passive: true })
    return () => {
      for (const geste of GESTES) window.removeEventListener(geste, voir)
    }
  }, [attendSonRegard, marquerVues])
}
