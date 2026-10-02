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
    pendingTransactions: [
      { id: 'tx-1', type: 'Retrait' },
      { id: 'tx-1', type: 'Retrait' },
    ],
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
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
  default: ({ title, subtitle, actions }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
    </header>
  ),
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
    // Le tableau de bord a quitté la rangée : le gérant C2EGF travaille dans
    // Transactions, et le profil le masque (storeWorkspace.navigation.dashboard).
    // Sa route reste servie — seule l'entrée disparaît.
    expect(STORE_NAV_ITEMS.map((item) => item.name)).toEqual([
      'Transactions',
      'Clients',
      'Historique',
    ])
  })

  it('affiche la liste et ouvre le formulaire client dans une modale', () => {
    render(
      <MemoryRouter initialEntries={['/transactions?tab=dealer']}>
        <Transactions />
      </MemoryRouter>,
    )

    expect(screen.getByText('1 transaction non terminée · 0 dépôt, 1 retrait')).toBeInTheDocument()
    expect(screen.getByTestId('onglet-client')).toHaveTextContent('Transaction client1')
    expect(screen.getByRole('button', { name: 'Enregistrer une transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exporter/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('contenu-transaction-client')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contenu-operation-dealer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contenu-collaborations')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une transaction' }))

    expect(screen.getByRole('dialog', { name: 'Enregistrer une transaction' })).toBeInTheDocument()
    expect(screen.getByTestId('contenu-transaction-client')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
