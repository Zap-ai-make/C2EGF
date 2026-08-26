/**
 * TC-103 — TransactionTable : caractérisation avant refonte.
 *
 * L'écran de règlement des opérations en attente. Il porte 7 des 11 occurrences de
 * `themeClasses.tableHeader.split(' ')[1]` (lignes 220 à 240) et, surtout, un menu
 * d'actions rendu en portail avec un écouteur `click` posé sur `document` — la
 * mécanique la plus fragile de l'espace boutique, et celle que la refonte va toucher.
 *
 * Ce qu'on fige : intitulés de colonnes, contenu d'une ligne, états (chargement,
 * vide, règlement partiel), déduplication, et l'ouverture du menu d'actions.
 * Ce qu'on ne fige pas : la moindre classe CSS, et la position du portail.
 *
 * Le composant ne prend aucune prop — tout vient de `useTransactions()`, qui est
 * donc le seul point d'injection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

let contextValue

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => contextValue,
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import { PAYMENT_METHODS } from '../../src/utils/constants.js'

const makeTransaction = (over = {}) => ({
  id: 'tx-1',
  client: { nom: 'BANABA', prenom: 'Guafarou' },
  type: 'Dépôt',
  reseau: 'Orange',
  code: '123456',
  montant: 250000,
  statut: 'Non Terminées',
  date: '26/08/2026 10:30',
  ...over,
})

const baseContext = (over = {}) => ({
  pendingTransactions: [],
  loading: false,
  getActionButtons: () => ({ modifier: true, encaisser: true }),
  getTransactionStyles: () => ({ bgColor: '', textColor: '' }),
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  ...over,
})

const dataRows = () =>
  Array.from(document.querySelectorAll('tbody tr')).filter(
    (tr) => tr.querySelector('td')?.getAttribute('colSpan') === null,
  )

beforeEach(() => {
  contextValue = baseContext()
})

describe('TC-103 — structure du tableau', () => {
  it('porte le titre « Non Terminées »', () => {
    render(<TransactionTable />)
    expect(screen.getByRole('heading', { name: 'Non Terminées' })).toBeInTheDocument()
  })

  it('expose les 6 colonnes du contrat métier', () => {
    render(<TransactionTable />)
    const labels = screen.getAllByRole('columnheader').map((th) => th.textContent.trim())
    expect(labels).toEqual(['Date & heure', 'Client', 'Type', 'Réseau', 'Montant', 'Actions'])
  })
})

describe('TC-103 — états', () => {
  it('en chargement → squelettes, et aucun message de vide', () => {
    contextValue = baseContext({ loading: true })
    render(<TransactionTable />)
    expect(screen.queryByText('Aucune transaction en attente')).not.toBeInTheDocument()
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
  })

  it('aucune opération en attente → message dédié', () => {
    render(<TransactionTable />)
    expect(screen.getByText('Aucune transaction en attente')).toBeInTheDocument()
  })

  it('déduplique les opérations partageant un identifiant', () => {
    contextValue = baseContext({
      pendingTransactions: [makeTransaction(), makeTransaction(), makeTransaction({ id: 'tx-2' })],
    })
    render(<TransactionTable />)
    expect(dataRows()).toHaveLength(2)
  })
})

describe('TC-103 — contenu d’une ligne', () => {
  beforeEach(() => {
    contextValue = baseContext({ pendingTransactions: [makeTransaction()] })
  })

  it('affiche le nom du client, le type, le réseau avec son code', () => {
    render(<TransactionTable />)
    const row = dataRows()[0]
    expect(within(row).getByText('Guafarou BANABA')).toBeInTheDocument()
    expect(within(row).getByText('Dépôt')).toBeInTheDocument()
    expect(within(row).getByText('Orange (123456)')).toBeInTheDocument()
  })

  it('affiche le montant formaté en FCFA', () => {
    render(<TransactionTable />)
    expect(
      screen.getByText((c) => c.replace(/\s/g, ' ') === '250 000 FCFA'),
    ).toBeInTheDocument()
  })

  it('règlement partiel → affiche le reste dû', () => {
    contextValue = baseContext({
      pendingTransactions: [
        makeTransaction({ settlementStatus: 'partial', remainingAmount: 90000 }),
      ],
    })
    render(<TransactionTable />)
    expect(
      screen.getByText((c) => c.replace(/\s/g, ' ') === 'Reste : 90 000 FCFA'),
    ).toBeInTheDocument()
  })
})

describe('TC-103 — actions', () => {
  it('n’affiche que les actions autorisées pour l’opération', () => {
    contextValue = baseContext({
      pendingTransactions: [makeTransaction()],
      getActionButtons: () => ({ modifier: true, encaisser: true }),
    })
    render(<TransactionTable />)
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Payer par' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rembourser' })).not.toBeInTheDocument()
  })

  it('un retrait propose « Payer par »', () => {
    contextValue = baseContext({
      pendingTransactions: [makeTransaction({ type: 'Retrait' })],
      getActionButtons: () => ({ payerPar: true }),
    })
    render(<TransactionTable />)
    expect(screen.getByRole('button', { name: 'Payer par' })).toBeInTheDocument()
  })

  it('cliquer une action de règlement ouvre le choix des méthodes de paiement', () => {
    contextValue = baseContext({
      pendingTransactions: [makeTransaction()],
      getActionButtons: () => ({ encaisser: true }),
    })
    render(<TransactionTable />)

    // Le menu est rendu en portail : avant le clic, aucune méthode n'est proposée.
    expect(screen.queryByText(PAYMENT_METHODS[0])).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))

    // Profil C2EGF : Orange Money et Cash.
    for (const method of PAYMENT_METHODS) {
      expect(screen.getByText(method)).toBeInTheDocument()
    }
  })
})
