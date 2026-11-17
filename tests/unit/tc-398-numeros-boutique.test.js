import { describe, it, expect } from 'vitest'
import { dealerDe, flotteDe, normaliserNumero, numerosSaisis } from '../../functions/src/boutiques/numeros.js'

/**
 * TC-398 — Les numéros de la boutique, hors de Firestore : le numéro flotte
 * (pour l'appeler) et le numéro dealer (la SIM qui reçoit la monnaie des
 * agents). Spec : docs/superpowers/specs/2026-11-17-numeros-boutique-design.md.
 *
 * Contrat avec Oxygen (§9) : 8 chiffres, sans espace ni indicatif ; un numéro
 * absent n'est pas une erreur, sa clé est omise.
 */

describe('TC-398 — les numéros saisis', () => {
  it('[TC-398-01] les espaces tapés sont retirés ; rien devient une chaîne vide', () => {
    expect(normaliserNumero(' 70 12 34 56 ')).toBe('70123456')
    expect(normaliserNumero(undefined)).toBe('')
  })

  it('[TC-398-02] un champ vidé veut dire « effacer »', () => {
    expect(numerosSaisis({ flotte: '70 12 34 56', dealer: { Orange: '' } }, ['Orange']))
      .toEqual({ ok: true, flotte: '70123456', dealer: { Orange: null } })
  })

  it('[TC-398-02b] chaque refus dit lequel et pourquoi', () => {
    const refus = (donnee) => numerosSaisis(donnee, ['Orange'])
    expect(refus({ flotte: '7012345', dealer: {} })).toEqual({ ok: false, message: 'Numéro flotte : 8 chiffres.' })
    expect(refus({ flotte: '', dealer: { Orange: '7012345a' } })).toEqual({ ok: false, message: 'Numéro dealer Orange : 8 chiffres.' })
    expect(refus({ flotte: '', dealer: { Moov: '70123456' } })).toEqual({ ok: false, message: 'Réseau inconnu : Moov.' })
    expect(refus({ flotte: '', dealer: 'x' })).toEqual({ ok: false, message: 'Numéros invalides.' })
    expect(refus({ flotte: 5, dealer: {} })).toEqual({ ok: false, message: 'Numéros invalides.' })
  })
})

describe('TC-398 — les numéros relus sur la fiche', () => {
  it('[TC-398-03] seul un numéro conforme part vers Oxygen, et seulement celui du réseau demandé', () => {
    expect(flotteDe({ flotte: '70123456' })).toBe('70123456')
    // Une fiche retouchée à la main dans la console ne doit pas faire composer
    // un numéro faux : on ne rend rien plutôt qu'un numéro douteux.
    expect(flotteDe({ flotte: '70 12 34 56' })).toBeUndefined()
    expect(flotteDe({ flotte: '701234567' })).toBeUndefined()
    expect(flotteDe({})).toBeUndefined()
    expect(dealerDe({ dealer: { Orange: '76543210', Moov: '70000000' } }, 'Orange')).toBe('76543210')
    expect(dealerDe({ dealer: { Orange: '76543210' } }, 'Moov')).toBeUndefined()
    expect(dealerDe({ dealer: { Orange: 'abc' } }, 'Orange')).toBeUndefined()
    expect(dealerDe(null, 'Orange')).toBeUndefined()
  })
})
