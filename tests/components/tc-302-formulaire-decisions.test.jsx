import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-302 — Caractérisation des DÉCISIONS du formulaire de transaction.
 *
 * Avant d'extraire la préparation d'une transaction dans un module que
 * l'assistant partagera, on fige ce que le formulaire décide aujourd'hui :
 * ce qu'il refuse, ce qu'il permet, et l'opération exacte qu'il envoie.
 * L'extraction ne doit rien changer à aucune de ces lignes.
 *
 * Seules les cartes de solde sont simulées (`useNetworkCards`) : la vraie
 * règle de stock de `useSimpleNetworkData` s'exécute.
 */

let stock = 500000
let especes = 500000
let transactionsValue

vi.mock('../../src/hooks/useNetworkCards.js', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => stock,
    getLiquidite: () => especes,
    getNetworkLiquidite: () => especes,
    formatAmount: (n) => Number(n).toLocaleString('fr-FR'),
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'

const CLIENT = { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020', numeroPersonnel: '76965827' }

const saisir = ({ code = '45441020', montant = '5000', type = 'Dépôt' } = {}) => {
  fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: code } })
  fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: montant } })
  fireEvent.click(screen.getByRole('radio', { name: type }))
}

const confirmer = async (bouton) => {
  fireEvent.click(screen.getByRole('button', { name: bouton }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
  await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalled())
  return transactionsValue.addTransaction.mock.calls[0][0]
}

beforeEach(() => {
  stock = 500000
  especes = 500000
  transactionsValue = {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    updateTransaction: vi.fn().mockResolvedValue(undefined),
    saveReopenedCorrection: vi.fn().mockResolvedValue(undefined),
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }
})

describe('TC-302 — ce que le formulaire refuse', () => {
  it('[TD-01] un dépôt au-delà du stock : aucune des deux voies, et il dit pourquoi', () => {
    stock = 3000
    render(<TransactionForm clients={[CLIENT]} />)
    saisir({ montant: '5000', type: 'Dépôt' })

    const valider = screen.getByRole('button', { name: 'Valider' })
    expect(valider).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeDisabled()
    expect(valider).toHaveAttribute('title', expect.stringContaining('Stock insuffisant'))
  })

  it('[TD-02] un retrait au-delà des espèces : non terminé permis, validation refusée', () => {
    especes = 2000
    render(<TransactionForm clients={[CLIENT]} />)
    saisir({ montant: '5000', type: 'Retrait' })

    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeEnabled()
    const valider = screen.getByRole('button', { name: 'Valider' })
    expect(valider).toBeDisabled()
    expect(valider).toHaveAttribute('title', expect.stringContaining('Liquidité insuffisante'))
  })
})

describe('TC-302 — l’opération exacte qu’il envoie', () => {
  it('[TD-03] un dépôt non terminé pour un client choisi dans la liste', async () => {
    render(<TransactionForm clients={[CLIENT]} />)
    fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: 'BANABA' } })
    fireEvent.mouseDown((await screen.findByText(/BANABA/, { selector: 'li *' })).closest('li'))
    fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt' }))

    expect(await confirmer('Non Terminées')).toEqual({
      client: CLIENT,
      clientId: 'c-1',
      type: 'Dépôt',
      reseau: 'Orange',
      code: '45441020',
      montant: 5000,
      statut: 'Non Terminées',
    })
  })

  // Avant le 30 octobre 2026, ce geste enregistrait l'opération sur un client
  // « Non enregistré » : code gardé, lien à la fiche perdu. Corrigé à la demande
  // du responsable — un identifiant tapé en entier désigne sa fiche.
  it('[TD-03b] code complet tapé sans choisir dans la liste : la fiche est reconnue', async () => {
    render(<TransactionForm clients={[CLIENT]} />)
    saisir({ code: '45441020', montant: '5000', type: 'Dépôt' })

    expect(await confirmer('Non Terminées')).toEqual({
      client: CLIENT,
      clientId: 'c-1',
      type: 'Dépôt',
      reseau: 'Orange',
      code: '45441020',
      montant: 5000,
      statut: 'Non Terminées',
    })
  })

  it('[TD-05] un téléphone partagé par deux fiches : rien ne part, il faut choisir', () => {
    const X = { id: 'x', nom: 'ZIDA', prenom: 'Kassoum', orange: '11111111', numeroPersonnel: '76000000' }
    const Y = { id: 'y', nom: 'KINDA', prenom: 'Adjara', orange: '22222222', numeroPersonnel: '76000000' }
    render(<TransactionForm clients={[X, Y]} />)
    saisir({ code: '76000000', montant: '5000', type: 'Dépôt' })

    const valider = screen.getByRole('button', { name: 'Valider' })
    expect(valider).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeDisabled()
    expect(valider).toHaveAttribute('title', expect.stringContaining('choisissez'))
  })

  it('[TD-04] un retrait validé sur un code sans fiche : le client « Non enregistré »', async () => {
    render(<TransactionForm clients={[CLIENT]} />)
    fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: '1234567' } })
    fireEvent.mouseDown(await screen.findByRole('button', { name: /Utiliser ce code sans client enregistré/ }))
    fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '7000' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Retrait' }))

    const envoye = await confirmer('Valider')

    expect(envoye).toMatchObject({
      clientId: 'manual-Orange-1234567',
      type: 'Retrait',
      reseau: 'Orange',
      code: '1234567',
      montant: 7000,
      statut: 'Validée',
    })
    expect(envoye.client).toMatchObject({
      id: 'manual-Orange-1234567',
      nom: 'Client',
      prenom: 'Non enregistré',
      orange: '1234567',
      isManual: true,
    })
  })
})
