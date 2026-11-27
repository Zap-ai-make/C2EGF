import { describe, it, expect, vi, beforeEach } from 'vitest'
import { creerSonnerie, ECART_MS } from '../../src/utils/sonDemande.js'

/**
 * TC-423 — Le petit son d'une demande d'agent qui arrive (demandé par
 * l'utilisateur le 2026-11-27) : beaucoup de transactions, plusieurs demandes
 * à la fois, et la caissière doit le savoir sans regarder l'écran.
 */

let oscillateurs
let etatInitial
let reprise

class FauxContexte {
  constructor() {
    this.state = etatInitial
    this.currentTime = 0
    this.destination = {}
  }

  resume() {
    return reprise(this)
  }

  createOscillator() {
    const oscillateur = { type: '', frequency: { value: 0 }, connect: (n) => n, start: vi.fn(), stop: vi.fn() }
    oscillateurs.push(oscillateur)
    return oscillateur
  }

  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (n) => n }
  }
}

beforeEach(() => {
  oscillateurs = []
  etatInitial = 'running'
  reprise = (contexte) => { contexte.state = 'running'; return Promise.resolve() }
})

describe('TC-423 — le son', () => {
  it('[TC-423-01] une demande arrive : deux notes courtes', async () => {
    const sonner = creerSonnerie({ Contexte: FauxContexte, horloge: () => 0 })
    expect(await sonner()).toBe(true)
    expect(oscillateurs).toHaveLength(2)
    for (const o of oscillateurs) expect(o.start).toHaveBeenCalled()
  })

  it('[TC-423-02] plusieurs demandes à la fois : un seul son ; la suivante sonne à nouveau', async () => {
    let t = 0
    const sonner = creerSonnerie({ Contexte: FauxContexte, horloge: () => t })
    await sonner()
    t = ECART_MS - 1
    expect(await sonner()).toBe(false)
    expect(oscillateurs).toHaveLength(2)
    t = ECART_MS * 2
    expect(await sonner()).toBe(true)
    expect(oscillateurs).toHaveLength(4)
  })

  it('[TC-423-03] un navigateur sans son : muet, sans erreur', async () => {
    const sonner = creerSonnerie({ Contexte: undefined, horloge: () => 0 })
    expect(await sonner()).toBe(false)
  })

  it('[TC-423-04] le navigateur refuse le son (page jamais touchée) : muet, et pas de son en retard au premier clic', async () => {
    etatInitial = 'suspended'
    let permettre
    reprise = (contexte) => new Promise((resolve) => {
      permettre = () => { contexte.state = 'running'; resolve() }
    })
    let t = 0
    const sonner = creerSonnerie({ Contexte: FauxContexte, horloge: () => t })
    const resultat = sonner()
    // La caissière touche l'écran une minute plus tard : la demande est déjà
    // en tête depuis longtemps, un son maintenant ne dirait plus rien.
    t = 60_000
    permettre()
    expect(await resultat).toBe(false)
    expect(oscillateurs).toHaveLength(0)
  })

  it('[TC-423-04b] le son refusé pour de bon : muet, sans erreur', async () => {
    etatInitial = 'suspended'
    reprise = () => Promise.reject(new Error('NotAllowedError'))
    const sonner = creerSonnerie({ Contexte: FauxContexte, horloge: () => 0 })
    expect(await sonner()).toBe(false)
    expect(oscillateurs).toHaveLength(0)
  })
})
