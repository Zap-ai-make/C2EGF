import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-220 — Ravitaillements et clôtures quittent l'onglet des clients.
 *
 * Ces deux mouvements n'ont pas de client : ils s'affichaient sous « Client
 * inconnu », avec une colonne Code vide, au milieu des dépôts et des retraits
 * d'agents. Ce ne sont pas des transactions clients — ce sont les mouvements de
 * la boutique elle-même. Ils vont dans l'onglet « Ravitaillement », qui est
 * exactement l'endroit prévu pour ça.
 */

let transactionsValue

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ onUpdate }) => {
    onUpdate({ requests: [] })
    return () => {}
  },
}))
vi.mock('../../src/components/historique/DateFilter', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ClientSearch', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ActionButtons', () => ({ default: () => null }))
vi.mock('../../src/components/historique/DailyPagination', () => ({ default: () => null }))
vi.mock('../../src/components/historique/HistoriqueTable', () => ({
  default: ({ transactions }) => (
    <ul data-testid="table-clients">
      {transactions.map((t) => (
        <li key={t.id}>{`${t.type} ${t.montant}`}</li>
      ))}
    </ul>
  ),
}))

import Historique from '../../src/pages/Historique.jsx'

const LIGNES = [
  { id: 't-1', type: 'Dépôt', reseau: 'Orange', montant: 1_000, statut: 'Validée', clientId: 'c-1', date: '02/10/2026 15:07' },
  { id: 't-2', type: 'Ravitaillement', reseau: 'Orange', montant: 100_000, statut: 'Validée', date: '02/10/2026 15:06' },
  { id: 't-3', type: 'Clôture', reseau: 'Orange', montant: 1_002_000, statut: 'Validée', date: '02/10/2026 16:36' },
]

const afficher = (onglet) =>
  render(
    <MemoryRouter initialEntries={[`/historique?onglet=${onglet}`]}>
      <Historique />
    </MemoryRouter>,
  )

beforeEach(() => {
  transactionsValue = {
    completedTransactions: LIGNES,
    pendingTransactions: [],
    historyHasMore: false,
    historyLoadingMore: false,
    loadMoreHistory: vi.fn(),
  }
})

describe('TC-220 — les mouvements de la boutique', () => {
  it('ne figurent plus parmi les transactions clients', () => {
    afficher('clients')
    const table = within(screen.getByTestId('table-clients'))
    expect(table.getByText('Dépôt 1000')).toBeInTheDocument()
    expect(table.queryByText(/Ravitaillement/)).not.toBeInTheDocument()
    expect(table.queryByText(/Clôture/)).not.toBeInTheDocument()
  })

  it('apparaissent dans l’onglet Ravitaillement, avec leur montant', () => {
    afficher('dealer')
    const liste = screen.getByLabelText('Mouvements de la boutique')
    expect(within(liste).getByText('Ravitaillement')).toBeInTheDocument()
    expect(within(liste).getByText('Clôture')).toBeInTheDocument()
    expect(within(liste).getByText('100 000 FCFA')).toBeInTheDocument()
    expect(within(liste).getByText('1 002 000 FCFA')).toBeInTheDocument()
  })

  it('n’y fait pas apparaître les transactions clients', () => {
    afficher('dealer')
    const liste = screen.getByLabelText('Mouvements de la boutique')
    expect(within(liste).queryByText('Dépôt')).not.toBeInTheDocument()
  })
})
