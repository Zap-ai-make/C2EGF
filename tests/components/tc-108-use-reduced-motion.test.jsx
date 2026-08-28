/**
 * tc-108 — `useReducedMotion` : la décision de mouvement, côté JavaScript.
 *
 * La variante `motion-safe:` de Tailwind couvre ce que le CSS anime (tc-094).
 * Elle ne peut RIEN pour une timeline pilotée en JavaScript : GSAP n'écrit pas
 * de classe, il écrit des styles en ligne. Il faut donc la même décision,
 * lisible depuis React — c'est tout le rôle de ce hook, et sa seule raison
 * d'exister.
 *
 * Quatre exigences, dont deux qu'on oublie systématiquement :
 *
 *   • le réglage peut changer EN COURS DE SESSION — on ne le lit pas une fois
 *     au montage, on s'y abonne ;
 *   • l'abonnement se retire au démontage, sinon chaque écran monté fuit un
 *     écouteur sur un objet qui, lui, vit aussi longtemps que l'onglet ;
 *   • `matchMedia` peut manquer (environnement de test, navigateur ancien) —
 *     un garde-fou d'accessibilité qui LÈVE est pire que pas de garde-fou ;
 *   • sans information, on répond false : on n'impose pas le calme à qui n'a
 *     rien demandé, on l'accorde à qui le demande.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReducedMotion, prefereMouvementReduit } from '../../src/hooks/useReducedMotion.js'

const REQUETE = '(prefers-reduced-motion: reduce)'

/**
 * Une fausse MediaQueryList pilotable, qui compte ses abonnés — c'est ce
 * comptage qui permet d'observer la fuite d'écouteur, invisible autrement.
 */
function poserMatchMedia({ matches = false } = {}) {
  const ecouteurs = new Set()
  const liste = {
    matches,
    media: REQUETE,
    addEventListener: (type, fn) => { if (type === 'change') ecouteurs.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'change') ecouteurs.delete(fn) },
  }
  const matchMedia = vi.fn(() => liste)
  window.matchMedia = matchMedia
  return {
    matchMedia,
    get abonnes() { return ecouteurs.size },
    basculer(valeur) {
      liste.matches = valeur
      ecouteurs.forEach(fn => fn({ matches: valeur }))
    },
  }
}

const matchMediaInitial = window.matchMedia
afterEach(() => { window.matchMedia = matchMediaInitial })

describe('tc-108 — useReducedMotion', () => {
  it('rend false quand rien ne demande le calme', () => {
    poserMatchMedia({ matches: false })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('rend true quand le système demande le mouvement réduit', () => {
    poserMatchMedia({ matches: true })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('interroge bien `prefers-reduced-motion: reduce`', () => {
    const media = poserMatchMedia()
    renderHook(() => useReducedMotion())
    expect(media.matchMedia).toHaveBeenCalledWith(REQUETE)
  })

  it('suit le réglage quand il change en cours de session', () => {
    const media = poserMatchMedia({ matches: false })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => { media.basculer(true) })
    expect(result.current).toBe(true)

    act(() => { media.basculer(false) })
    expect(result.current).toBe(false)
  })

  it('retire son écouteur au démontage', () => {
    const media = poserMatchMedia()
    const { unmount } = renderHook(() => useReducedMotion())
    expect(media.abonnes).toBe(1)

    unmount()
    expect(media.abonnes).toBe(0)
  })

  it('ne lève pas là où `matchMedia` n’existe pas', () => {
    delete window.matchMedia
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})

/**
 * La lecture impérative sert les gestes qui ne se rendent pas : un défilement
 * déclenché au clic (`TransactionTable`), une timeline construite à la volée.
 * Elle lit AU MOMENT DE L'APPEL — c'est ce qui la distingue du hook, et c'est
 * ce que ce bloc vérifie.
 */
describe('tc-108 — prefereMouvementReduit (hors React)', () => {
  it('rend le réglage courant, sans rendu React', () => {
    const media = poserMatchMedia({ matches: false })
    expect(prefereMouvementReduit()).toBe(false)

    media.basculer(true)
    expect(prefereMouvementReduit()).toBe(true)
  })

  it('rend false là où `matchMedia` n’existe pas', () => {
    delete window.matchMedia
    expect(prefereMouvementReduit()).toBe(false)
  })
})
