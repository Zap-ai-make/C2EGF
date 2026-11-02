/**
 * TC-322 — Le contexte dit jusqu'où remonte la fenêtre de l'historique.
 *
 * Moitié « contexte » de TC-321 (BUG-08, requalifié mineur) : `historyDepuis`
 * est le jour de saisie de la plus ancienne ligne chargée, tant qu'il en
 * reste à charger, et rien quand tout est là. Il recule à chaque page : c'est
 * ce qui dit à la caissière qu'un clic a servi, même sans nouveau mouvement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

const service = {
  subscribeToDrafts: vi.fn(),
  getHistoryPage: vi.fn(),
  subscribeToHistory: vi.fn(),
  subscribeToOpenReplenishments: vi.fn(),
  subscribeToValidatedSince: vi.fn(),
}

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

const AUTH = {
  currentUser: { uid: 'u1' },
  userProfile: { role: 'store_admin', storeId: 'store-a' },
  activeStore: { id: 'store-a' },
  loading: false,
}

const saisieLe = (iso, id) => ({ id, type: 'Dépôt', montant: 1000, statut: 'Validée', createdAt: { toDate: () => new Date(iso) } })

function Lecteur() {
  const { historyDepuis, historyHasMore, loadMoreHistory } = useTransactions()
  return (
    <>
      <p data-testid="depuis">{historyDepuis ?? 'aucune'}</p>
      <p data-testid="encore">{String(historyHasMore)}</p>
      <button type="button" onClick={loadMoreHistory}>plus</button>
    </>
  )
}

const monter = () => render(
  <AuthContext.Provider value={AUTH}>
    <TransactionsProvider>
      <Lecteur />
    </TransactionsProvider>
  </AuthContext.Provider>,
)

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset())
  for (const nom of ['subscribeToDrafts', 'subscribeToHistory', 'subscribeToOpenReplenishments', 'subscribeToValidatedSince']) {
    service[nom].mockImplementation((cb) => { cb([]); return () => {} })
  }
})

describe('TC-322 — historyDepuis', () => {
  it('[FD-01] la plus ancienne ligne chargée, puis elle recule, puis plus rien', async () => {
    service.getHistoryPage
      .mockResolvedValueOnce({ transactions: [saisieLe('2026-10-31T10:00:00Z', 'a'), saisieLe('2026-10-25T10:00:00Z', 'b')], lastDoc: { id: 'b' }, hasMore: true })
      .mockResolvedValueOnce({ transactions: [saisieLe('2026-10-20T10:00:00Z', 'c')], lastDoc: { id: 'c' }, hasMore: true })
      .mockResolvedValueOnce({ transactions: [saisieLe('2026-10-12T10:00:00Z', 'd')], lastDoc: null, hasMore: false })
    monter()

    await waitFor(() => expect(screen.getByTestId('depuis')).toHaveTextContent('25/10/2026'))

    fireEvent.click(screen.getByRole('button', { name: 'plus' }))
    await waitFor(() => expect(screen.getByTestId('depuis')).toHaveTextContent('20/10/2026'))

    fireEvent.click(screen.getByRole('button', { name: 'plus' }))
    await waitFor(() => expect(screen.getByTestId('encore')).toHaveTextContent('false'))
    expect(screen.getByTestId('depuis')).toHaveTextContent('aucune')
  })

  it('[FD-02] tout tient dans la première page : rien à dire', async () => {
    service.getHistoryPage.mockResolvedValueOnce({ transactions: [saisieLe('2026-10-31T10:00:00Z', 'a')], lastDoc: null, hasMore: false })
    monter()

    await waitFor(() => expect(service.getHistoryPage).toHaveBeenCalled())
    expect(screen.getByTestId('depuis')).toHaveTextContent('aucune')
  })
})
