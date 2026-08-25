/**
 * TC-090 — computeWindow : math pure du fenêtrage de lignes (virtualisation Historique).
 *
 * Fonction pure, indépendante du DOM (jsdom ne calcule aucun layout). On vérifie les
 * indices visibles, les hauteurs d'espaceurs et l'invariant de hauteur totale :
 *   topPad + (endIndex - startIndex) * rowHeight + bottomPad === itemCount * rowHeight.
 */

import { describe, it, expect } from 'vitest'
import { computeWindow } from '../../src/hooks/useWindowedRows.js'

const ROW = 50
const VIEW = 500 // 10 lignes visibles

describe('TC-090 — computeWindow', () => {
  it('liste vide → fenêtre complète, pads à 0', () => {
    expect(computeWindow({ itemCount: 0, rowHeight: ROW, scrollTop: 0, viewportHeight: VIEW })).toEqual({
      startIndex: 0, endIndex: 0, topPad: 0, bottomPad: 0,
    })
  })

  it('rowHeight <= 0 → fenêtre complète (dégradation sûre)', () => {
    const w = computeWindow({ itemCount: 100, rowHeight: 0, scrollTop: 0, viewportHeight: VIEW })
    expect(w).toEqual({ startIndex: 0, endIndex: 100, topPad: 0, bottomPad: 0 })
  })

  it('viewportHeight <= 0 → fenêtre complète (avant 1er paint)', () => {
    const w = computeWindow({ itemCount: 100, rowHeight: ROW, scrollTop: 0, viewportHeight: 0 })
    expect(w).toEqual({ startIndex: 0, endIndex: 100, topPad: 0, bottomPad: 0 })
  })

  it('scrollTop=0 → startIndex=0, topPad=0, endIndex = visibles + overscan', () => {
    const w = computeWindow({ itemCount: 1000, rowHeight: ROW, scrollTop: 0, viewportHeight: VIEW, overscan: 8 })
    expect(w.startIndex).toBe(0)
    expect(w.topPad).toBe(0)
    // ceil(500/50) + 8*2 = 10 + 16 = 26
    expect(w.endIndex).toBe(26)
    expect(w.bottomPad).toBe((1000 - 26) * ROW)
  })

  it('scroll au milieu → indices corrects + invariant de hauteur totale', () => {
    const itemCount = 1000
    const scrollTop = 5000 // ligne 100
    const w = computeWindow({ itemCount, rowHeight: ROW, scrollTop, viewportHeight: VIEW, overscan: 8 })
    expect(w.startIndex).toBe(Math.floor(scrollTop / ROW) - 8) // 100 - 8 = 92
    expect(w.topPad).toBe(w.startIndex * ROW)
    // Invariant : les 3 zones couvrent exactement la hauteur totale.
    const total = w.topPad + (w.endIndex - w.startIndex) * ROW + w.bottomPad
    expect(total).toBe(itemCount * ROW)
  })

  it('clamp en bas de liste : endIndex ≤ itemCount, bottomPad ≥ 0', () => {
    const itemCount = 30
    const w = computeWindow({ itemCount, rowHeight: ROW, scrollTop: 100000, viewportHeight: VIEW })
    expect(w.endIndex).toBeLessThanOrEqual(itemCount)
    expect(w.bottomPad).toBeGreaterThanOrEqual(0)
    expect(w.startIndex).toBeLessThanOrEqual(w.endIndex)
  })

  it('scroll au-delà de la fin → dernière fenêtre pleine (startIndex = maxStart)', () => {
    const itemCount = 1000
    // visible = ceil(500/50) + 8*2 = 26 ; maxStart = 1000 - 26 = 974
    const w = computeWindow({ itemCount, rowHeight: ROW, scrollTop: 100000, viewportHeight: VIEW, overscan: 8 })
    expect(w.startIndex).toBe(974)
    expect(w.endIndex).toBe(itemCount)
    expect(w.bottomPad).toBe(0)
  })

  it('pads cohérents à un scrollTop non aligné sur rowHeight', () => {
    const itemCount = 1000
    const scrollTop = 5017 // non multiple de 50
    const w = computeWindow({ itemCount, rowHeight: ROW, scrollTop, viewportHeight: VIEW, overscan: 8 })
    expect(w.topPad).toBe(w.startIndex * ROW)
    expect(w.bottomPad).toBe((itemCount - w.endIndex) * ROW)
  })
})
