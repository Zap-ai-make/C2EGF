/**
 * tc-110 — l'arrivée du plan de travail, et le montant qui se résout.
 *
 * Deux comportements que ni une capture ni un coup d'œil ne peuvent vérifier,
 * et dont l'un est une règle métier déguisée en détail d'animation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  construireTimelineArrivee,
  DUREE_ARRIVEE,
} from '../../src/motion/arrivee.js'
import { useMontantAnime } from '../../src/hooks/useMontantAnime.js'
import { formatAmount } from '../../src/constants/networkConfig.js'

let monte = null

/** Le shell réduit à ses repères `data-motion`. */
function poserShell({ avecNavigation = true, cartes = 2 } = {}) {
  const racine = document.createElement('div')
  racine.innerHTML = `
    <header data-motion="bandeau">
      <img data-motion="pastille" alt="" aria-hidden="true" />
      <span data-motion="onde" aria-hidden="true"></span>
      <p data-motion="wordmark">C2EGF BURKINA</p>
      <p data-motion="metier">Distribution mobile money · Burkina Faso</p>
    </header>
    ${avecNavigation ? '<div data-motion="navigation"></div>' : ''}
    ${Array.from({ length: cartes }, () => '<div data-motion="carte-solde"></div>').join('')}
  `
  document.body.append(racine)
  monte = racine
  return racine
}

afterEach(() => {
  monte?.remove()
  monte = null
  vi.useRealTimers()
})

describe('tc-110 — arrivée du plan de travail', () => {
  it('rend une timeline EN PAUSE, qui ne démarre pas seule', () => {
    const racine = poserShell()
    const { timeline, nettoyer } = construireTimelineArrivee({ racine })

    expect(timeline.paused()).toBe(true)
    expect(timeline.progress()).toBe(0)
    nettoyer()
  })

  it('tient dans le budget annoncé', () => {
    const racine = poserShell()
    const { timeline, nettoyer } = construireTimelineArrivee({ racine })

    expect(timeline.duration()).toBeLessThanOrEqual(DUREE_ARRIVEE)
    nettoyer()
  })

  /**
   * Le banc d'essai ne monte que le bandeau ; l'application monte les trois
   * bandes. Une chorégraphie qui exigerait tous ses nœuds obligerait à tenir
   * DEUX versions d'accord — et c'est toujours la seconde qui dérive.
   */
  it('anime ce qu’elle trouve, sans exiger toutes les zones', () => {
    const racine = poserShell({ avecNavigation: false, cartes: 0 })

    expect(() => {
      const { timeline, nettoyer } = construireTimelineArrivee({ racine })
      expect(timeline.duration()).toBeGreaterThan(0)
      nettoyer()
    }).not.toThrow()
  })

  it('restitue les styles si la séquence est interrompue', () => {
    const racine = poserShell()
    const carte = racine.querySelector('[data-motion="carte-solde"]')

    const { timeline, nettoyer } = construireTimelineArrivee({ racine })
    timeline.progress(0.4)
    nettoyer()

    // Sans restitution, le montage suivant lirait l'invisibilité comme l'état
    // naturel du nœud et animerait de 0 vers 0 — le défaut qui a coûté le logo.
    expect(carte.style.opacity).toBe('')
  })
})

describe('tc-110 — le montant se résout UNE SEULE FOIS', () => {
  /**
   * LA RÈGLE QUI COMPTE, ET CE N'EST PAS UNE RÈGLE D'ANIMATION.
   *
   * Les soldes viennent d'un abonnement Firestore : ils changent à chaque
   * opération de la journée. Si le décompte se rejouait à chaque mise à jour,
   * le chiffre deviendrait illisible au moment précis où on en a besoin — un
   * solde qui défile pendant qu'on saisit une transaction est une régression,
   * pas une animation.
   */
  it('affiche directement toute valeur qui n’est pas la première', () => {
    const { result, rerender } = renderHook(({ v }) => useMontantAnime(v), {
      initialProps: { v: 1000 },
    })

    // La deuxième valeur ne se compte pas : elle s'affiche.
    act(() => rerender({ v: 2_500_000 }))
    // On compare à `formatAmount`, jamais à une chaîne écrite à la main :
    // `Intl` sépare les milliers par une ESPACE FINE INSÉCABLE (U+202F), qu'aucune
    // relecture ne distingue d'une espace ordinaire. Une assertion littérale
    // réussirait ou échouerait pour des raisons invisibles. Et celle-ci vérifie
    // la vraie exigence : le montant passe par le formateur DU PRODUIT.
    expect(result.current).toBe(formatAmount(2_500_000))
  })

  it('rend zéro sans le compter — un décompte de 0 à 0 ressemble à un blocage', () => {
    const { result } = renderHook(() => useMontantAnime(0))
    expect(result.current).toBe('0')
  })

  it('traite une valeur absente comme zéro plutôt que de lever', () => {
    const { result } = renderHook(() => useMontantAnime(undefined))
    expect(result.current).toBe('0')
  })
})
