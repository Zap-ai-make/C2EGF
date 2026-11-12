/**
 * TC-373 — Ce que l'historique ne montre pas se dit (correctif du 2026-11-12).
 *
 * UN HISTORIQUE ARRÊTÉ
 * ────────────────────
 * Les écoutes de l'historique se relèvent seules d'une coupure (TC-372) : la
 * caissière n'a rien à en savoir, le bandeau du bas dit déjà quand le réseau
 * manque. Un refus des règles ou un index manquant, eux, les arrêtent pour de
 * bon. L'erreur allait dans `error`, qu'aucun écran ne lit : l'historique
 * cessait de bouger sans un mot.
 *
 * UN JOUR PASSÉ LU SANS RÉSEAU
 * ────────────────────────────
 * Hors ligne, la lecture d'une période ne lève pas : Firestore répond avec ce
 * que l'appareil a gardé, sans prévenir. La liste paraît complète et ne l'est
 * peut-être pas. Le contexte le sait (`depuisServeur`) et le dit.
 *
 *   [HA-01] une erreur passagère ne dit rien, et la journée reste affichée ;
 *   [HA-02] un arrêt définitif de la journée est signalé ;
 *   [HA-03] celui d'une écoute de complément aussi ;
 *   [HA-04] une erreur avant toute réponse ne laisse pas l'écran en chargement ;
 *   [PH-01] une période lue sur l'appareil est signalée, et revenir au jour l'oublie ;
 *   [PH-02] une période lue au serveur ne l'est pas.
 *
 * L'horloge est fixée au 6 novembre 2026, 12 h, à Ouagadougou (UTC+0).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'

const service = {}

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
}))
vi.mock('../../src/services/settlementService', () => ({
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: React.createContext(null),
}))

import { TransactionsProvider, useTransactions } from '../../src/context/transactions.jsx'
import { AuthContext } from '../../src/context/AuthContext'
import { fauxHistorique, serie } from '../fixtures/fauxHistorique.js'

const AUTH = {
  currentUser: { uid: 'u1' },
  userProfile: { role: 'store_admin', storeId: 'store-a' },
  activeStore: { id: 'store-a' },
  loading: false,
}

let ctx
function Lecteur() {
  ctx = useTransactions()
  return null
}

function monter(api) {
  Object.assign(service, api)
  render(
    <AuthContext.Provider value={AUTH}>
      <TransactionsProvider>
        <Lecteur />
      </TransactionsProvider>
    </AuthContext.Provider>,
  )
}

const affichees = () => ctx.completedTransactions.map((l) => l.id)
const erreur = (code) => Object.assign(new Error(code), { code })

/** Une écoute du faux historique, dont on peut provoquer l'échec à la main. */
function ecouteQuiEchoue(api, nom) {
  let abonne
  const espion = vi.fn((cb, ...args) => {
    abonne = cb
    return api[nom](cb, ...args)
  })
  return {
    api: { ...api, [nom]: espion },
    echouer: (code) => act(() => abonne.onError(erreur(code))),
  }
}

const DU_JOUR = serie('t', 3, '2026-11-06T11:00:00Z')
const ANCIENNES = serie('h', 5, '2026-11-05T11:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  for (const nom of Object.keys(service)) delete service[nom]
  ctx = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TC-373 — un historique arrêté se voit', () => {
  it('[HA-01] une erreur passagère ne dit rien, et la journée reste affichée', async () => {
    const { api, echouer } = ecouteQuiEchoue(fauxHistorique(DU_JOUR).api, 'subscribeToHistory')
    monter(api)
    await waitFor(() => expect(affichees()).toHaveLength(3))

    echouer('unavailable')

    expect(ctx.historiqueArrete).toBe(false)
    expect(affichees()).toHaveLength(3)
  })

  it('[HA-02] un refus des règles sur la journée est signalé', async () => {
    const { api, echouer } = ecouteQuiEchoue(fauxHistorique(DU_JOUR).api, 'subscribeToHistory')
    monter(api)
    await waitFor(() => expect(affichees()).toHaveLength(3))
    expect(ctx.historiqueArrete).toBe(false)

    echouer('permission-denied')

    expect(ctx.historiqueArrete).toBe(true)
  })

  it.each([
    'subscribeToValidatedSince',
    'subscribeToDeletedSince',
    'subscribeToOpenReplenishments',
  ])('[HA-03] un index manquant sur %s est signalé aussi', async (nom) => {
    const { api, echouer } = ecouteQuiEchoue(fauxHistorique(DU_JOUR).api, nom)
    monter(api)
    await waitFor(() => expect(affichees()).toHaveLength(3))

    echouer('failed-precondition')

    expect(ctx.historiqueArrete).toBe(true)
  })

  it('[HA-04] une erreur avant toute réponse ne laisse pas l\'écran en chargement', async () => {
    let abonne
    monter({ ...fauxHistorique(DU_JOUR).api, subscribeToHistory: (cb) => { abonne = cb; return () => {} } })
    await waitFor(() => expect(abonne).toBeTypeOf('function'))
    expect(ctx.loading).toBe(true)

    act(() => abonne.onError(erreur('unavailable')))

    await waitFor(() => expect(ctx.loading).toBe(false))
    expect(ctx.historiqueArrete).toBe(false)
  })

  /**
   * L'écoute ne meurt plus au bout de 30 s (TC-372), mais l'écran, lui, cesse
   * d'attendre au même moment qu'avant : `loading` tient les non terminées en
   * squelettes, et la caissière ne doit pas attendre le réseau pour les voir.
   */
  it('[HA-05] sans réponse de la journée en 30 s, l\'écran cesse d\'attendre, et la journée arrive ensuite', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
    let repondre
    monter({ ...fauxHistorique(DU_JOUR).api, subscribeToHistory: (cb) => { repondre = cb; return () => {} } })
    expect(ctx.loading).toBe(true)

    act(() => { vi.advanceTimersByTime(29_000) })
    expect(ctx.loading).toBe(true)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(ctx.loading).toBe(false)
    expect(ctx.historiqueArrete).toBe(false)

    act(() => repondre(DU_JOUR))
    expect(affichees()).toHaveLength(3)
  })
})

describe('TC-373 — un jour passé lu sans réseau se voit', () => {
  it('[PH-01] une période lue sur l\'appareil est signalée, et revenir au jour l\'oublie', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter({
      ...faux.api,
      lirePeriode: vi.fn(async () => ({ lignes: ANCIENNES.slice(0, 2), depuisServeur: false })),
    })
    await waitFor(() => expect(affichees()).toHaveLength(3))
    expect(ctx.periodeHorsLigne).toBe(false)

    await act(() => ctx.chargerPeriode({ from: '2026-11-05', to: '2026-11-05' }))

    expect(affichees()).toHaveLength(5)
    expect(ctx.periodeHorsLigne).toBe(true)

    act(() => ctx.revenirAuJour())
    expect(ctx.periodeHorsLigne).toBe(false)
  })

  it('[PH-02] une période lue au serveur ne l\'est pas', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await waitFor(() => expect(affichees()).toHaveLength(3))

    await act(() => ctx.chargerPeriode({ from: '2026-11-05', to: '2026-11-05' }))

    expect(affichees()).toHaveLength(8)
    expect(ctx.periodeHorsLigne).toBe(false)
  })
})
