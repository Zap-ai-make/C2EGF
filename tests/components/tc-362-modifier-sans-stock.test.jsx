/**
 * TC-362 — modifier une ligne quand le stock est à sec (lot G4b,
 * docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Le formulaire comparait le nouveau montant au stock restant, sans compter ce que
 * la ligne avait déjà pris. Un dépôt de 30 000 qui avait vidé le stock ne pouvait
 * plus être corrigé à 25 000 : « Stock insuffisant », alors que la correction rend
 * 5 000. Sans réseau, personne ne peut ravitailler à la place du serveur : la
 * caissière restait bloquée sur sa propre erreur.
 *
 * Le contrôle reste entier pour une nouvelle saisie.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let transactionsValue
let stock

vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => transactionsValue }))
vi.mock('../../src/hooks/useNetworkCards', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => stock,
    getLiquidite: () => 1_000_000,
    getNetworkLiquidite: () => 1_000_000,
    formatAmount: (v) => String(v),
  }),
}))

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'
import { stockDejaPris } from '../../src/utils/financialImpact.js'

const CLIENT = { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020' }
const LIGNE = { id: 'd-1', client: CLIENT, clientId: 'c-1', type: 'Dépôt', reseau: 'Orange', montant: 30000, statut: 'Non Terminées' }

const monter = (editingTransaction) => {
  transactionsValue = {
    addTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    saveReopenedCorrection: vi.fn(),
    clearEditTransaction: vi.fn(),
    editingTransaction,
  }
  render(<TransactionForm clients={[CLIENT]} embedded />)
}
const montant = (valeur) => fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: String(valeur) } })
const sauvegarder = () => screen.getByRole('button', { name: 'Sauvegarder' })

beforeEach(() => { stock = 0 })

describe('TC-362 — le contrôle de stock en modification', () => {
  it('[MS-01] stock à sec : on peut baisser, garder le montant, mais pas monter au-delà de ce que la ligne a pris', () => {
    monter(LIGNE)
    montant(25000)
    expect(sauvegarder()).toBeEnabled()
    montant(30000)
    expect(sauvegarder()).toBeEnabled()
    montant(30001)
    expect(sauvegarder()).toBeDisabled()
  })

  it('[MS-02] il reste du stock : la hausse peut aller jusqu’à ce qu’il en reste, en plus de ce que la ligne a pris', () => {
    stock = 10000
    monter(LIGNE)
    montant(40000)
    expect(sauvegarder()).toBeEnabled()
    montant(40001)
    expect(sauvegarder()).toBeDisabled()
  })

  it('[MS-03] une ligne validée porte ce qu’elle a pris, calculé à l’ouverture', () => {
    monter({ ...LIGNE, reopenedFromHistoryId: 'h-1', stockDejaPris: 0 })
    montant(25000)
    expect(sauvegarder()).toBeDisabled()
  })

  it('[MS-04] une nouvelle saisie est contrôlée comme avant, sans marge', () => {
    stock = 10000
    monter(null)
    fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: '45441020' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt' }))
    montant(10001)
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeDisabled()
    montant(10000)
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeEnabled()
  })
})

describe('TC-362 — stockDejaPris', () => {
  it.each([
    ['un dépôt en attente a pris son montant', LIGNE, 30000],
    ['encaissé en Cash, il l’a toujours pris', { ...LIGNE, paymentMethod: 'Cash', effectiveNetwork: 'Liquidite' }, 30000],
    ['encaissé en Orange Money, le stock est revenu', { ...LIGNE, paymentMethod: 'Orange Money', effectiveNetwork: 'Orange' }, 0],
    ['réglé en deux tranches, seule celle du réseau revient', { ...LIGNE, paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', settlementSummary: { netByNetwork: { Orange: { paid: 10000, refunded: 0 }, Liquidite: { paid: 20000, refunded: 0 } } } }, 20000],
    ['un remboursement redonne ce qu’il a repris', { ...LIGNE, settlementSummary: { netByNetwork: { Orange: { paid: 10000, refunded: 4000 } } } }, 24000],
    ['un retrait n’a rien pris, il a ajouté', { ...LIGNE, type: 'Retrait' }, 0],
  ])('[MS-05] %s', (_nom, ligne, attendu) => {
    expect(stockDejaPris(ligne)).toBe(attendu)
  })
})
