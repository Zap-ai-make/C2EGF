/**
 * TC-345 — L'ouverture ne paie plus la première page deux fois (lot A3a).
 *
 * Avant ce lot, l'ouverture lisait les cent dernières lignes par `getDocs`, puis
 * écoutait ces mêmes lignes. Un `getDocs` en ligne repart toujours au serveur :
 * 101 lectures à chaque ouverture, même quand l'écoute reprise par la
 * persistance n'en facturait aucune (docs/rester-dans-le-quota-gratuit.md §A3).
 *
 * Désormais, la première page est le premier résultat CONFIRMÉ PAR LE SERVEUR de
 * l'écoute de la fenêtre. Ce que l'écran affiche ne change pas : TC-344 le
 * vérifie, avant et après le lot. Ce fichier-ci fixe ce qui change :
 *   - aucune lecture `getDocs` à l'ouverture ;
 *   - le curseur de « plus » vient du serveur, jamais du cache ;
 *   - `loading` retombe à la première réponse de la fenêtre.
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
import { fauxHistorique, ligne, serie } from '../fixtures/fauxHistorique.js'

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
const ANCIENNES = serie('h', 150, '2026-11-05T11:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  for (const nom of Object.keys(service)) delete service[nom]
  ctx = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TC-345 — une seule lecture de la première page', () => {
  it('[UL-01] l\'ouverture n\'appelle pas getHistoryPage, et n\'écoute la fenêtre qu\'une fois', async () => {
    const faux = fauxHistorique(ANCIENNES)
    monter(faux.api)

    await waitFor(() => expect(affichees()).toHaveLength(100))
    expect(faux.api.getHistoryPage).not.toHaveBeenCalled()
    expect(faux.api.subscribeToHistoryWindow).toHaveBeenCalledOnce()
    // `subscribeToHistory` ne sert plus qu'à la journée : plus d'écoute des cent
    // dernières lignes en double de la fenêtre.
    for (const [, filtres] of faux.api.subscribeToHistory.mock.calls) {
      expect(filtres?.dateRange?.start).toBeInstanceOf(Date)
    }
  })

  it('[UL-02] « plus » part du curseur du serveur, pas de celui du cache', async () => {
    // Le cache ne connaît que les quarante dernières lignes : à l'en croire, il
    // n'y aurait rien de plus, et le curseur serait h039.
    const faux = fauxHistorique(ANCIENNES, { cache: ANCIENNES.slice(0, 40) })
    monter(faux.api)
    await waitFor(() => expect(affichees()).toHaveLength(40))
    expect(ctx.historyHasMore).toBe(false)

    await faux.synchroniser()
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))
    await act(() => ctx.loadMoreHistory())

    expect(faux.api.getHistoryPage).toHaveBeenCalledOnce()
    expect(faux.api.getHistoryPage.mock.calls[0][0].lastDoc.id).toBe('h099')
    await waitFor(() => expect(affichees()).toHaveLength(150))
  })

  it('[UL-03] loading tient jusqu\'à la première réponse de la fenêtre, cache compris', async () => {
    const faux = fauxHistorique(ANCIENNES, { cache: ANCIENNES })
    let repondre
    monter({
      ...faux.api,
      subscribeToHistoryWindow: (cb) => { repondre = cb; return () => {} },
    })
    await waitFor(() => expect(repondre).toBeTypeOf('function'))
    expect(ctx.loading).toBe(true)

    act(() => repondre({ transactions: ANCIENNES.slice(0, 100), lastDoc: null, hasMore: true, fromCache: true }))

    await waitFor(() => expect(ctx.loading).toBe(false))
  })

  it('[UL-04] une fenêtre en erreur le dit, sans couper les autres écoutes', async () => {
    const dette = ligne('dette', '2026-10-01T09:00:00Z', { type: 'Ravitaillement', replenishmentStatus: 'open' })
    const faux = fauxHistorique([...ANCIENNES, dette])
    monter({
      ...faux.api,
      subscribeToHistoryWindow: (cb) => { cb.onError(new Error('permission-denied')); return () => {} },
    })

    await waitFor(() => expect(ctx.error).toBe('permission-denied'))
    expect(ctx.loading).toBe(false)
    await waitFor(() => expect(affichees()).toContain('dette'))
  })
})
