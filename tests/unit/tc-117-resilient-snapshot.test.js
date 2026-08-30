/**
 * TC-117 — resilientOnSnapshot : un abonnement qui se relève, sauf quand c'est vain.
 *
 * Un `onSnapshot` qui tombe en erreur est TERMINAL. Sans wrapper, la page cesse
 * de se mettre à jour et continue d'afficher des données mortes, sans que rien
 * ne le signale. Sur des écrans qui portent de l'argent, c'est le pire mode de
 * défaillance : silencieux et crédible.
 *
 * Ce qui est verrouillé ici :
 *   • le backoff exponentiel 4 s → 8 s → 16 s → 32 s → plafond 60 s ;
 *   • sa réinitialisation dès qu'un snapshot passe ;
 *   • l'ABSENCE de réabonnement sur permission-denied et failed-precondition,
 *     qui exigent un déploiement — réessayer ne ferait que marteler le backend ;
 *   • l'appelant prévenu AVANT toute tentative de reprise ;
 *   • l'unsubscribe qui annule le minuteur ET le listener.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  resilientOnSnapshot,
  isPermanentSnapshotError,
  RESILIENT_BASE_DELAY_MS,
  RESILIENT_MAX_DELAY_MS,
} from '../../src/services/resilientOnSnapshot.js'

/**
 * Faux onSnapshot pilotable : on capture les callbacks de chaque abonnement pour
 * déclencher succès et erreurs à la main, et on compte les réabonnements.
 */
function makeHarness() {
  const subs = []
  const timers = []
  const subscribe = vi.fn((query, onNext, onError) => {
    const unsub = vi.fn()
    subs.push({ onNext, onError, unsub })
    return unsub
  })
  const setTimeoutFn = vi.fn((fn, delay) => {
    timers.push({ fn, delay, cancelled: false })
    return timers.length - 1
  })
  const clearTimeoutFn = vi.fn((id) => { if (timers[id]) timers[id].cancelled = true })

  return {
    subs, timers, subscribe, setTimeoutFn, clearTimeoutFn,
    last: () => subs[subs.length - 1],
    // Fait s'écouler le minuteur en attente (le dernier programmé).
    fireTimer: () => {
      const t = timers[timers.length - 1]
      if (t && !t.cancelled) t.fn()
    },
    delays: () => timers.map((t) => t.delay),
  }
}

const err = (code) => Object.assign(new Error(code), { code })

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-117-A — abonnement nominal', () => {
  it('s’abonne immédiatement et relaie les snapshots', () => {
    const h = makeHarness()
    const onNext = vi.fn()
    resilientOnSnapshot('Q', { onNext, ...h })

    expect(h.subscribe).toHaveBeenCalledTimes(1)
    h.last().onNext({ size: 3 })
    expect(onNext).toHaveBeenCalledWith({ size: 3 })
  })

  it('ne programme aucun minuteur tant que tout va bien', () => {
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), ...h })
    h.last().onNext({ size: 1 })
    expect(h.setTimeoutFn).not.toHaveBeenCalled()
  })
})

describe('TC-117-B — erreur transitoire : on prévient, puis on se relève', () => {
  it('l’appelant est prévenu AVANT toute tentative de reprise', () => {
    const h = makeHarness()
    const order = []
    const onError = vi.fn(() => order.push('onError'))
    h.setTimeoutFn.mockImplementation((fn, delay) => {
      order.push('setTimeout')
      h.timers.push({ fn, delay, cancelled: false })
      return h.timers.length - 1
    })
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError, ...h })
    h.last().onError(err('unavailable'))

    expect(order).toEqual(['onError', 'setTimeout'])
  })

  it('se réabonne après le délai', () => {
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('unavailable'))
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    h.fireTimer()
    expect(h.subscribe).toHaveBeenCalledTimes(2)
  })

  it('backoff exponentiel 4 s → 8 s → 16 s → 32 s', () => {
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    for (let i = 0; i < 4; i += 1) {
      h.last().onError(err('unavailable'))
      h.fireTimer()
    }
    expect(h.delays()).toEqual([4000, 8000, 16000, 32000])
  })

  it('le backoff plafonne à 60 s et n’explose pas', () => {
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    for (let i = 0; i < 8; i += 1) {
      h.last().onError(err('unavailable'))
      h.fireTimer()
    }
    expect(Math.max(...h.delays())).toBe(RESILIENT_MAX_DELAY_MS)
    expect(h.delays().at(-1)).toBe(RESILIENT_MAX_DELAY_MS)
  })

  it('un snapshot réussi RÉINITIALISE le backoff', () => {
    // Une coupure passagère ne doit pas laisser la suivante dans une fenêtre
    // d'attente d'une minute.
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    for (let i = 0; i < 4; i += 1) {
      h.last().onError(err('unavailable'))
      h.fireTimer()
    }
    h.last().onNext({ size: 1 })
    h.last().onError(err('unavailable'))
    expect(h.delays().at(-1)).toBe(RESILIENT_BASE_DELAY_MS)
  })
})

describe('TC-117-C — erreurs PERMANENTES : aucun réabonnement', () => {
  for (const code of ['permission-denied', 'failed-precondition']) {
    it(`${code} : l’appelant est prévenu, mais on n’insiste pas`, () => {
      const h = makeHarness()
      const onError = vi.fn()
      resilientOnSnapshot('Q', { onNext: vi.fn(), onError, ...h })
      h.last().onError(err(code))

      expect(onError).toHaveBeenCalledTimes(1)
      expect(h.setTimeoutFn).not.toHaveBeenCalled()
      expect(h.subscribe).toHaveBeenCalledTimes(1)
    })
  }

  it('reconnaît les codes préfixés par Firestore', () => {
    expect(isPermanentSnapshotError(err('firestore/permission-denied'))).toBe(true)
    expect(isPermanentSnapshotError(err('failed-precondition'))).toBe(true)
    expect(isPermanentSnapshotError(err('unavailable'))).toBe(false)
    expect(isPermanentSnapshotError(err('deadline-exceeded'))).toBe(false)
    expect(isPermanentSnapshotError(undefined)).toBe(false)
  })

  it('une règle refusée ne martèle jamais le backend, même après plusieurs erreurs', () => {
    const h = makeHarness()
    resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('permission-denied'))
    h.last().onError(err('permission-denied'))
    expect(h.subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('TC-117-D — nettoyage au démontage', () => {
  it('annule le listener courant', () => {
    const h = makeHarness()
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), ...h })
    const listener = h.last().unsub
    unsubscribe()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('annule AUSSI le minuteur en attente', () => {
    const h = makeHarness()
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('unavailable'))
    unsubscribe()
    expect(h.clearTimeoutFn).toHaveBeenCalled()
  })

  it('un minuteur qui aurait survécu ne ressuscite rien', () => {
    // Filet : même si le minuteur se déclenchait, l'abonnement est arrêté.
    const h = makeHarness()
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('unavailable'))
    unsubscribe()
    h.timers.at(-1).fn()
    expect(h.subscribe).toHaveBeenCalledTimes(1)
  })

  it('une erreur survenue APRÈS le démontage ne relance rien', () => {
    const h = makeHarness()
    const sub = h.last
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    unsubscribe()
    sub().onError(err('unavailable'))
    expect(h.setTimeoutFn).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TC-117-E — LE DÉMONTAGE NE PEUT PAS FAIRE TOMBER L'ÉCRAN
//
// Observé en conditions réelles : le SDK Firestore échoue sur une assertion
// interne (`ca9`), puis TOUTE opération enfilée ensuite relance cet échec
// (`b815`) — y compris `unsubscribe()`. Notre démontage étant appelé depuis un
// nettoyage d'effet React, l'exception traversait le nettoyage, React traitait
// ça comme une erreur de composant, démontait l'arbre et le confiait à la
// frontière d'erreur — emportant la page ET la barre de navigation. Le
// remontage rouvrait les mêmes abonnements, qui relevaient la même exception :
// en boucle.
//
// Un incident de fond devenait donc un écran mort. C'est très exactement le
// mode de défaillance que ce fichier existe pour éviter, en plus bruyant.
// ═════════════════════════════════════════════════════════════════════════════

import { safeUnsubscribe } from '../../src/services/resilientOnSnapshot.js'

describe('TC-117-E — un démontage total', () => {
  const explose = () => { throw new Error('INTERNAL ASSERTION FAILED (ID: b815)') }

  it('un unsubscribe qui lève ne remonte pas jusqu’à React', () => {
    const h = makeHarness()
    h.subscribe.mockImplementation(() => explose)
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), ...h })
    expect(() => unsubscribe()).not.toThrow()
  })

  it('un clearTimeout qui lève non plus', () => {
    const h = makeHarness()
    h.clearTimeoutFn.mockImplementation(explose)
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('unavailable'))
    expect(() => unsubscribe()).not.toThrow()
  })

  it('malgré l’échec du démontage, l’abonnement est bien ARRÊTÉ', () => {
    // Avaler l'exception ne doit pas avaler l'intention : plus aucun
    // réabonnement ne doit repartir.
    const h = makeHarness()
    const vrai = h.subscribe.getMockImplementation()
    h.subscribe.mockImplementation((...args) => { vrai(...args); return explose })
    const unsubscribe = resilientOnSnapshot('Q', { onNext: vi.fn(), onError: vi.fn(), ...h })
    h.last().onError(err('unavailable'))
    unsubscribe()
    h.timers.at(-1)?.fn?.()
    expect(h.subscribe).toHaveBeenCalledTimes(1)
  })

  it('un onSnapshot qui LÈVE au lieu de rapporter est traité comme une erreur', () => {
    // La file du SDK peut être tombée avant même qu'on s'abonne : `onSnapshot`
    // lève alors de façon synchrone. Sans garde, l'exception traverserait
    // l'effet React qui monte l'abonnement.
    const h = makeHarness()
    const onError = vi.fn()
    h.subscribe.mockImplementation(explose)
    expect(() => resilientOnSnapshot('Q', { onNext: vi.fn(), onError, ...h })).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(h.setTimeoutFn).toHaveBeenCalledTimes(1)
  })

  it('safeUnsubscribe rend total n’importe quel écouteur brut', () => {
    expect(() => safeUnsubscribe(explose)()).not.toThrow()
    expect(() => safeUnsubscribe(undefined)()).not.toThrow()
    expect(() => safeUnsubscribe(null)()).not.toThrow()
  })

  it('safeUnsubscribe appelle bien l’écouteur quand tout va bien', () => {
    const unsub = vi.fn()
    safeUnsubscribe(unsub)()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
