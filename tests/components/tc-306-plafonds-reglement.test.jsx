import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-306 — Caractérisation des PLAFONDS d'un règlement.
 *
 * Avant de sortir ces règles du tableau pour que l'assistant les partage, on
 * fige ce que « Encaisser », « Payer par » et « Rembourser » acceptent ou
 * refusent aujourd'hui, et le montant proposé d'office. L'extraction ne doit
 * changer aucune de ces lignes.
 */

let transactionsValue
const addPaymentTranche = vi.fn()
const addRefundTranche = vi.fn()

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

const brouillon = (over = {}) => ({
  id: 'd-1',
  type: 'Dépôt',
  client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
  code: '000111',
  montant: 50_000,
  statut: 'Non terminée',
  date: '08/10/2026 14:00',
  createdAt: { toMillis: () => Date.now() },
  ...over,
})

const monter = (ligne, actions) => {
  transactionsValue = {
    pendingTransactions: [ligne],
    loading: false,
    getActionButtons: () => actions,
    getTransactionStyles: () => ({ textColor: '' }),
    addPaymentTranche,
    addRefundTranche,
    startEditTransaction: vi.fn(),
    trashTransaction: vi.fn(),
  }
  render(<TransactionTable />)
}

/** Ouvre le menu, choisit Cash, et rend le champ du montant. */
const ouvrir = (bouton) => {
  fireEvent.click(screen.getByRole('button', { name: bouton }))
  fireEvent.click(screen.getByText('Cash'))
  return screen.getByRole('spinbutton')
}

const confirmerAvec = (montant) => {
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: montant } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
}

// La page sépare les milliers par une espace fine insécable ; Testing Library
// la ramène à une espace simple avant de comparer, pas la chaîne attendue.
const fcfa = (n) => n.toLocaleString('fr-FR').replace(/\s/g, ' ')

beforeEach(() => {
  addPaymentTranche.mockReset().mockResolvedValue(true)
  addRefundTranche.mockReset().mockResolvedValue(true)
})

describe('TC-306 — le montant proposé d’office', () => {
  it('[PR-01] le montant entier quand rien n’est encore réglé', () => {
    monter(brouillon(), { encaisser: true })
    expect(ouvrir('Encaisser')).toHaveValue(50000)
  })

  it('[PR-02] le reste dû quand une tranche est déjà passée', () => {
    monter(brouillon({ settlementStatus: 'partial', paidAmount: 20000, remainingAmount: 30000 }), { encaisser: true })
    expect(ouvrir('Encaisser')).toHaveValue(30000)
  })
})

describe('TC-306 — encaisser et payer', () => {
  it('[PR-03] refuse moins de 500 FCFA', () => {
    monter(brouillon(), { encaisser: true })
    ouvrir('Encaisser')
    confirmerAvec('400')
    expect(screen.getByText('Montant invalide (minimum 500 FCFA, entier)')).toBeInTheDocument()
    expect(addPaymentTranche).not.toHaveBeenCalled()
  })

  it('[PR-04] refuse plus que le reste dû', () => {
    monter(brouillon({ settlementStatus: 'partial', paidAmount: 20000, remainingAmount: 30000 }), { encaisser: true })
    ouvrir('Encaisser')
    confirmerAvec('35000')
    expect(screen.getByText(`Maximum : ${fcfa(30000)} FCFA (reste dû)`)).toBeInTheDocument()
    expect(addPaymentTranche).not.toHaveBeenCalled()
  })

  it('[PR-05] une tranche partielle part avec la méthode et le montant', async () => {
    monter(brouillon(), { encaisser: true })
    ouvrir('Encaisser')
    confirmerAvec('20000')
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    const [id, montant, methode, cle, code] = addPaymentTranche.mock.calls[0]
    expect([id, montant, methode, code]).toEqual(['d-1', 20000, 'Cash', undefined])
    expect(typeof cle).toBe('string')
  })

  it('[PR-06] « Payer par » suit les mêmes plafonds', async () => {
    monter(brouillon({ type: 'Retrait' }), { payerPar: true })
    ouvrir('Payer par')
    confirmerAvec('60000')
    expect(screen.getByText(`Maximum : ${fcfa(50000)} FCFA (reste dû)`)).toBeInTheDocument()
    confirmerAvec('50000')
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    expect(addPaymentTranche.mock.calls[0][1]).toBe(50000)
  })
})

describe('TC-306 — rembourser', () => {
  it('[PR-07] au plus ce qui a été payé, net des remboursements', () => {
    monter(brouillon({ type: 'Crédit', paidAmount: 20000, refundedAmount: 5000 }), { rembourser: true })
    ouvrir('Rembourser')
    confirmerAvec('16000')
    expect(screen.getByText(`Maximum remboursable : ${fcfa(15000)} FCFA`)).toBeInTheDocument()
    expect(addRefundTranche).not.toHaveBeenCalled()
  })

  it('[PR-08] rien de payé : le maximum dit zéro', () => {
    monter(brouillon({ type: 'Crédit', paidAmount: 0 }), { rembourser: true })
    ouvrir('Rembourser')
    confirmerAvec('1000')
    expect(screen.getByText('Maximum remboursable : 0 FCFA')).toBeInTheDocument()
  })

  it('[PR-09] sans trace de paiement, aucun plafond n’est posé', async () => {
    monter(brouillon({ type: 'Crédit' }), { rembourser: true })
    ouvrir('Rembourser')
    confirmerAvec('80000')
    await waitFor(() => expect(addRefundTranche).toHaveBeenCalled())
    expect(addRefundTranche.mock.calls[0][1]).toBe(80000)
  })
})
