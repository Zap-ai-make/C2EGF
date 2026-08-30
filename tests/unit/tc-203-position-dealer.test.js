/**
 * TC-203 — Le rapprochement de la position dealer (spec S4)
 *
 * L'identité que cet écran affiche :
 *
 *     somme des caisses + en transit = fonds d'ouverture + envoyé − revenu
 *
 * Elle a trois termes et non deux, et c'est la découverte de S2 : la boutique
 * est débitée à la CRÉATION d'un retour, le compteur du dealer n'avance qu'à sa
 * CONFIRMATION. Ces tests tiennent le troisième terme, et surtout les trois cas
 * où l'écran doit REFUSER de se prononcer — un total faux qui s'annonce juste
 * est pire que pas de total.
 */

import { describe, it, expect } from 'vitest'
import { rapprocherPosition, ETATS, RAISONS } from '../../src/utils/positionDealer'

const flux = (envoyeCumul, revenuCumul) => ({
  envoyeCumul,
  revenuCumul,
  dehors: envoyeCumul - revenuCumul,
  amorce: envoyeCumul > 0 || revenuCumul > 0,
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-A — « mon argent dehors »', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[PO-01] vaut envoyé moins revenu, et n’est jamais découpé par ressource', () => {
    const p = rapprocherPosition({ flux: flux(341200000, 142800000) })

    expect(p.envoye).toBe(341200000)
    expect(p.revenu).toBe(142800000)
    expect(p.dehors).toBe(198400000)
    // Un seul chiffre : au comptoir, le stock envoyé DEVIENT de la liquidité.
    expect(p).not.toHaveProperty('dehorsStock')
  })

  it('[PO-02] les deux termes affichés font EXACTEMENT le montant affiché', () => {
    const p = rapprocherPosition({ flux: flux(500000000, 100000000) })
    expect(p.envoye - p.revenu).toBe(p.dehors)
  })

  it('[PO-03] laisse « dehors » négatif au lieu de le masquer', () => {
    // Compteurs mis en service alors que des retours étaient en cours : le
    // revenu peut dépasser l'envoyé. Forcer à 0 fabriquerait une donnée fausse.
    expect(rapprocherPosition({ flux: flux(1000, 5000) }).dehors).toBe(-4000)
  })

  it('[PO-04] traite NaN et les valeurs absentes comme zéro, jamais comme NaN', () => {
    const p = rapprocherPosition({ flux: { envoyeCumul: 'x', revenuCumul: undefined } })
    expect(p.envoye).toBe(0)
    expect(p.revenu).toBe(0)
    expect(p.dehors).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-B — le rapprochement, quand il se prononce', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RA-01] concorde quand caisses + transit égalent l’argent dehors', () => {
    const p = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 500000,
    })

    expect(p.sommeCaisses).toBe(7500000)
    expect(p.ecart).toBe(0)
    expect(p.etat).toBe(ETATS.CONCORDANT)
  })

  it('[RA-02] RÈGLE — le transit est le terme qui ferme l’identité', () => {
    // Le même jeu SANS le transit ne concorde plus. C'est la preuve que la
    // ligne « en transit » n'est pas décorative : la retirer casse l'égalité
    // à chaque retour créé et pas encore confirmé.
    const sansTransit = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 0,
    })

    expect(sansTransit.ecart).toBe(-500000)
    expect(sansTransit.etat).toBe(ETATS.ANOMALIE)
  })

  it('[RA-03] nomme un écart POSITIF : les caisses tiennent plus que les compteurs', () => {
    const p = rapprocherPosition({
      flux: flux(198400000, 0),
      sommeStock: 128242009,
      sommeLiquidite: 128863283,
      enTransit: 2150000,
    })

    expect(p.etat).toBe(ETATS.ANTERIEUR)
    expect(p.ecart).toBe(128242009 + 128863283 + 2150000 - 198400000)
    expect(p.ecart).toBeGreaterThan(0)
  })

  it('[RA-04] distingue l’écart NÉGATIF, qu’aucun fonds d’ouverture n’explique', () => {
    const p = rapprocherPosition({
      flux: flux(300000000, 0),
      sommeStock: 100000000,
      sommeLiquidite: 50000000,
      enTransit: 0,
    })

    expect(p.etat).toBe(ETATS.ANOMALIE)
    expect(p.ecart).toBe(-150000000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-C — les trois refus de se prononcer', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RA-05] refuse tant que les compteurs n’ont rien enregistré', () => {
    const p = rapprocherPosition({
      flux: flux(0, 0),
      sommeStock: 128000000,
      sommeLiquidite: 128000000,
    })

    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
    expect(p.ecart).toBeNull()
  })

  it('[RA-06] refuse tant qu’une caisse est illisible', () => {
    const p = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 500000,
      illisibles: 1,
    })

    // Le jeu concorderait à l'euro près (cf. RA-01) : c'est précisément le cas
    // dangereux, celui où un total incomplet s'annoncerait juste.
    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.CAISSES_INCOMPLETES)
    expect(p.ecart).toBeNull()
  })

  it('[RA-07] refuse quand la lecture du réseau a échoué, et rend « null » — pas 0', () => {
    const p = rapprocherPosition({ flux: flux(198400000, 0), caissesLues: false })

    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.CAISSES_INDISPONIBLES)
    // Zéro se lirait « les caisses sont vides » : c'est un montant, et il est
    // faux. `null` s'affiche « — » et ne se confond avec rien.
    expect(p.sommeCaisses).toBeNull()
    expect(p.sommeStock).toBeNull()
    expect(p.sommeLiquidite).toBeNull()
    // L'argent dehors, lui, reste juste : il ne vient pas du réseau.
    expect(p.dehors).toBe(198400000)
  })

  it('[RA-08] la lecture échouée l’emporte sur toutes les autres raisons', () => {
    const p = rapprocherPosition({ flux: flux(0, 0), illisibles: 3, caissesLues: false })
    expect(p.raison).toBe(RAISONS.CAISSES_INDISPONIBLES)
  })

  it('[RA-09] « compteurs neufs » passe avant « caisses incomplètes »', () => {
    // Les deux sont vrais le jour de la mise en service. C'est le premier qui
    // explique l'écran ; l'autre serait un détail technique là où l'utilisateur
    // attend « ça vient de démarrer ».
    const p = rapprocherPosition({ flux: flux(0, 0), illisibles: 2 })
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
  })

  it('[RA-10] ne casse pas sans argument du tout', () => {
    const p = rapprocherPosition()
    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
    expect(p.dehors).toBe(0)
  })
})
