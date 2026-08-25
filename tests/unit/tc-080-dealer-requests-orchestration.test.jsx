/**
 * TC-080 — Caractérisation de l'orchestration DealerRequests (audit dealer/gérant)
 *
 * Complète TC-041 (temps réel, dédup simple, unsubscribe) sur les zones non
 * couvertes : bascule des curseurs realtime/pagination, protection de hasMore
 * après pagination (hasLoadedExtraPagesRef), reset au changement de filtre,
 * états erreur/vide, et cas limites de mergeUniqueRequests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  subscribeDealerRequests: vi.fn(),
  listDealerRequests: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../../src/services/dealerService', () => ({
  subscribeDealerRequests: mocks.subscribeDealerRequests,
  listDealerRequests: mocks.listDealerRequests,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

import DealerRequests from '../../src/pages/dealer/DealerRequests'
import { mergeUniqueRequests } from '../../src/utils/mergeRequests'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_AUTH = {
  currentUser: { uid: 'dealer-uid' },
  userProfile: { role: 'dealer', active: true, email: 'd@test.com', name: 'Dealer Test' },
}

function req(id, over = {}) {
  return {
    id, targetStoreName: `Boutique ${id}`, requestType: 'stock_add', amount: 1000,
    network: 'Orange', status: 'pending', createdAt: new Date('2024-01-01'), ...over,
  }
}

const RT_CURSOR = { id: 'rt-last' }
const P1_CURSOR = { id: 'p1-last' }

function renderPage() {
  mocks.useAuth.mockReturnValue(DEALER_AUTH)
  return render(<MemoryRouter><DealerRequests /></MemoryRouter>)
}

// Capture l'onUpdate du dernier subscribe pour pousser des snapshots à la demande.
function captureSubscription() {
  const captured = { onUpdate: null, onError: null, unsub: vi.fn() }
  mocks.subscribeDealerRequests.mockImplementation(({ onUpdate, onError }) => {
    captured.onUpdate = onUpdate
    captured.onError = onError
    return captured.unsub
  })
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// §1 — mergeUniqueRequests : cas limites (fonction pure)
// ---------------------------------------------------------------------------

describe('TC-080-MG — mergeUniqueRequests cas limites', () => {
  it('[MG-01] priorité au snapshot pour un même id (extra ignoré)', () => {
    const rt = [req('a', { amount: 999 })]
    const extra = [req('a', { amount: 1 }), req('b')]
    const out = mergeUniqueRequests(rt, extra)
    expect(out).toHaveLength(2)
    expect(out[0].amount).toBe(999)
  })

  it('[MG-02] doublons internes aux extras : premier gagne', () => {
    const out = mergeUniqueRequests([], [req('x', { amount: 1 }), req('x', { amount: 2 })])
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(1)
  })

  it('[MG-03] id absent ou non-string → toujours conservé (pas de dédup possible)', () => {
    const out = mergeUniqueRequests([], [{ amount: 1 }, { id: 42, amount: 2 }, { amount: 3 }])
    expect(out).toHaveLength(3)
  })

  it('[MG-04] aucune mutation des tableaux d\'entrée', () => {
    const rt = [req('a')]
    const extra = [req('b')]
    const rtCopy = [...rt]
    const extraCopy = [...extra]
    mergeUniqueRequests(rt, extra)
    expect(rt).toEqual(rtCopy)
    expect(extra).toEqual(extraCopy)
  })
})

// ---------------------------------------------------------------------------
// §2 — Bascule des curseurs realtime → pagination
// ---------------------------------------------------------------------------

describe('TC-080-CU — curseurs et hasMore', () => {
  it('[CU-01] enchaînement : 1er loadMore = curseur snapshot, 2e = curseur pagination, fin = bouton masqué et protégé', async () => {
    const sub = captureSubscription()
    renderPage()

    // Snapshot initial : 2 demandes, hasMore
    act(() => sub.onUpdate({ requests: [req('r1'), req('r2')], lastDoc: RT_CURSOR, hasMore: true }))
    await waitFor(() => expect(screen.getByTestId('requests-table')).toBeInTheDocument())
    expect(screen.getByTestId('btn-load-more')).toBeInTheDocument()

    // 1er "Voir plus" → curseur du snapshot
    mocks.listDealerRequests.mockResolvedValueOnce({ requests: [req('r3')], lastDoc: P1_CURSOR, hasMore: true })
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => expect(screen.getByTestId('request-row-r3')).toBeInTheDocument())
    expect(mocks.listDealerRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastDoc: RT_CURSOR })
    )

    // 2e "Voir plus" → curseur de la page précédente, dernière page
    mocks.listDealerRequests.mockResolvedValueOnce({ requests: [req('r4')], lastDoc: null, hasMore: false })
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => expect(screen.getByTestId('request-row-r4')).toBeInTheDocument())
    expect(mocks.listDealerRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastDoc: P1_CURSOR })
    )
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()

    // Un nouveau snapshot hasMore=true ne doit PAS réafficher le bouton
    // (hasLoadedExtraPagesRef : après pagination, hasMore appartient au loadMore).
    act(() => sub.onUpdate({ requests: [req('r1'), req('r2')], lastDoc: RT_CURSOR, hasMore: true }))
    await waitFor(() => expect(screen.getByTestId('request-row-r1')).toBeInTheDocument())
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    // Les pages extra restent affichées après le nouveau snapshot
    expect(screen.getByTestId('request-row-r3')).toBeInTheDocument()
    expect(screen.getByTestId('request-row-r4')).toBeInTheDocument()
  })

  it('[CU-02] changement de filtre statut → re-souscription avec le filtre et extras vidés', async () => {
    const sub = captureSubscription()
    renderPage()

    act(() => sub.onUpdate({ requests: [req('r1')], lastDoc: RT_CURSOR, hasMore: true }))
    mocks.listDealerRequests.mockResolvedValueOnce({ requests: [req('rX')], lastDoc: null, hasMore: false })
    fireEvent.click(await screen.findByTestId('btn-load-more'))
    await waitFor(() => expect(screen.getByTestId('request-row-rX')).toBeInTheDocument())

    // Changement de filtre → nouvelle souscription (2e appel) avec statusFilter
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })
    await waitFor(() => expect(mocks.subscribeDealerRequests).toHaveBeenCalledTimes(2))
    expect(mocks.subscribeDealerRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusFilter: 'pending' })
    )
    // L'ancien listener est fermé
    expect(sub.unsub).toHaveBeenCalled()

    // Nouveau snapshot : la page extra rX du contexte précédent a disparu
    act(() => sub.onUpdate({ requests: [req('r9', { status: 'pending' })], lastDoc: null, hasMore: false }))
    await waitFor(() => expect(screen.getByTestId('request-row-r9')).toBeInTheDocument())
    expect(screen.queryByTestId('request-row-rX')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// §3 — États erreur / vide / recherche boutique
// ---------------------------------------------------------------------------

describe('TC-080-ET — états', () => {
  it('[ET-01] onError → alerte avec message, Réessayer relance la souscription', async () => {
    const sub = captureSubscription()
    renderPage()

    act(() => sub.onError(new Error('Accès refusé. Vérifiez vos permissions.')))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Accès refusé. Vérifiez vos permissions.')
    )

    fireEvent.click(screen.getByText('Réessayer'))
    await waitFor(() => expect(mocks.subscribeDealerRequests).toHaveBeenCalledTimes(2))
  })

  it('[ET-02] liste vide sans filtre → message générique', async () => {
    const sub = captureSubscription()
    renderPage()
    act(() => sub.onUpdate({ requests: [], lastDoc: null, hasMore: false }))
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('Vous n\'avez pas encore de demande.')
    )
  })

  it('[ET-03] liste vide avec filtre → message avec libellé français du statut', async () => {
    const sub = captureSubscription()
    renderPage()
    act(() => sub.onUpdate({ requests: [], lastDoc: null, hasMore: false }))
    await waitFor(() => screen.getByTestId('empty-state'))

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'rejected' } })
    act(() => sub.onUpdate({ requests: [], lastDoc: null, hasMore: false }))
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('Aucune demande avec le statut « Rejetée »')
    )
  })

  it('[ET-04] recherche boutique filtre côté client sans re-requête', async () => {
    const sub = captureSubscription()
    renderPage()
    act(() => sub.onUpdate({
      requests: [req('r1', { targetStoreName: 'Alpha' }), req('r2', { targetStoreName: 'Beta' })],
      lastDoc: null, hasMore: false,
    }))
    await waitFor(() => expect(screen.getByTestId('request-row-r1')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('filter-store'), { target: { value: 'bet' } })
    expect(screen.queryByTestId('request-row-r1')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-row-r2')).toBeInTheDocument()
    // Pas de nouvelle souscription ni de fetch : filtrage purement local
    expect(mocks.subscribeDealerRequests).toHaveBeenCalledTimes(1)
    expect(mocks.listDealerRequests).not.toHaveBeenCalled()
  })
})
