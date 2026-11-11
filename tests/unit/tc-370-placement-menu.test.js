/**
 * TC-370 — le menu « Encaisser / Payer par » s'ouvre vers le haut, et sa
 * validation reste à l'écran (retour du terrain, 2026-11-10).
 */

import { describe, it, expect } from 'vitest'
import { placerMenu, ECART, MARGE, HAUTEUR_UTILE } from '../../src/utils/placementMenu.js'

const ecran = { hauteurFenetre: 800, largeurFenetre: 1280 }
const bouton = (top, left = 900) => ({ top, bottom: top + 28, left })

describe('TC-370 — où s’ouvre le menu de règlement', () => {
  it('[PM-01] au-dessus du bouton, ancré par son bas', () => {
    const p = placerMenu(bouton(600), ecran)
    expect(p.sens).toBe('haut')
    expect(p.bottom).toBe(800 - 600 + ECART)
    expect(p.top).toBeUndefined()
    expect(p.maxHeight).toBe(600 - ECART - MARGE)
  })

  it('[PM-02] en coordonnées de l’écran : le défilement de la page n’entre pas dans le calcul', () => {
    // Le rectangle d'un bouton est déjà relatif à l'écran ; la page peut avoir
    // défilé de 2 000 px, le menu se place au même endroit.
    const p = placerMenu(bouton(500), ecran)
    expect(p.bottom + p.maxHeight).toBeLessThanOrEqual(ecran.hauteurFenetre)
  })

  it('[PM-03] trop près du haut de l’écran : vers le bas, borné à la place qui reste', () => {
    const p = placerMenu(bouton(90), ecran)
    expect(p.sens).toBe('bas')
    expect(p.top).toBe(90 + 28 + ECART)
    expect(p.top + p.maxHeight).toBe(800 - MARGE)
  })

  it('[PM-04] vers le haut dès qu’il y tient en entier, même si le bas offre plus', () => {
    const p = placerMenu(bouton(HAUTEUR_UTILE + ECART + MARGE), { hauteurFenetre: 1400, largeurFenetre: 1280 })
    expect(p.sens).toBe('haut')
  })

  it('[PM-05] ne déborde ni à gauche ni à droite', () => {
    expect(placerMenu(bouton(600, 20), ecran).left).toBe(MARGE)
    expect(placerMenu(bouton(600, 1270), ecran).left).toBe(1280 - 240)
  })
})
