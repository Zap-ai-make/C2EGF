import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [] }) }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({
    historyHasMore: false,
    historyLoadingMore: false,
    loadMoreHistory: vi.fn(),
  }),
}))
vi.mock('../../src/hooks/useIncomingCollaborationsCount', () => ({
  useIncomingCollaborationsCount: () => 7,
}))
vi.mock('../../src/hooks/useHistoriqueFilters', () => ({
  useHistoriqueFilters: () => ({
    filteredTransactions: [],
    allTransactions: [],
    applyDateFilter: vi.fn(),
    applySearchFilter: vi.fn(),
    handleSearchChange: vi.fn(),
    resetToToday: vi.fn(),
    resetFilters: vi.fn(),
  }),
}))

vi.mock('../../src/components/transactions/TransactionForm', () => ({
  default: () => <div data-testid="contenu-transaction-client" />,
}))
vi.mock('../../src/components/transactions/TransactionTable', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/DealerTransferForm', () => ({
  default: () => <div data-testid="contenu-operation-dealer" />,
}))
vi.mock('../../src/components/transactions/CollaborationsPanel', () => ({
  default: () => <div data-testid="contenu-collaborations" />,
}))
vi.mock('../../src/components/ui/PageHeader', () => ({
  default: ({ title }) => <h1>{title}</h1>,
}))

vi.mock('../../src/components/historique/DateFilter', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ClientSearch', () => ({ default: () => null }))
vi.mock('../../src/components/historique/HistoriqueTable', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ActionButtons', () => ({ default: () => null }))
vi.mock('../../src/components/historique/DailyPagination', () => ({ default: () => null }))
vi.mock('../../src/components/historique/HistoriqueArchives', () => ({
  ArchiveDealer: () => <div data-testid="archive-ravitaillement" />,
  ArchiveCollaborations: () => <div data-testid="archive-collaborations" />,
  ArchiveDettes: () => <div data-testid="archive-dettes" />,
}))

import { STORE_NAV_ITEMS } from '../../src/constants/navigation.js'
import Transactions from '../../src/pages/Transactions.jsx'
import Historique from '../../src/pages/Historique.jsx'

describe('TC-127 — espace boutique simplifié pour le démarrage C2EGF', () => {
  it('masque les demandes dealer et les dettes internes de la navigation', () => {
    expect(STORE_NAV_ITEMS.map((item) => item.name)).toEqual([
      'Tableau de bord',
      'Transactions',
      'Formulaire',
      'Clients',
      'Historique',
    ])
  })

  it('ne propose que la transaction client, même avec une ancienne URL dealer', () => {
    render(
      <MemoryRouter initialEntries={['/transactions?tab=dealer']}>
        <Transactions />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Transaction client',
    ])
    expect(screen.getByTestId('contenu-transaction-client')).toBeInTheDocument()
    expect(screen.queryByTestId('contenu-operation-dealer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contenu-collaborations')).not.toBeInTheDocument()
  })

  it('garde les clients et remplace les trois archives avancées par Ravitaillement', () => {
    render(
      <MemoryRouter initialEntries={['/historique?onglet=dettes']}>
        <Historique />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Transactions clients',
      'Ravitaillement',
    ])
    expect(screen.getByTestId('onglet-historique-clients')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('onglet-historique-collaborations')).not.toBeInTheDocument()
    expect(screen.queryByTestId('onglet-historique-dettes')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('onglet-historique-dealer'))
    expect(screen.getByTestId('archive-ravitaillement')).toBeInTheDocument()
  })
})
