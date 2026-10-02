import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const clientActions = vi.hoisted(() => ({
  addClient: vi.fn(),
  editClient: vi.fn(),
}))

vi.mock('../../src/hooks/useClients', () => ({
  useClients: () => ({
    clients: [{ id: 'client-1', nom: 'DOE', prenom: 'Awa' }],
    addClient: clientActions.addClient,
    editClient: clientActions.editClient,
  }),
}))

vi.mock('../../src/components/ClientsTable', () => ({
  default: ({ onAddClient }) => (
    <button type="button" onClick={onAddClient}>Ajouter un client</button>
  ),
}))

import Clients from '../../src/pages/Clients.jsx'

const renderPage = () => render(
  <MemoryRouter>
    <Clients />
  </MemoryRouter>,
)

describe('TC-128 — ajout d’un client depuis la liste', () => {
  beforeEach(() => {
    clientActions.addClient.mockReset()
    clientActions.editClient.mockReset()
    clientActions.addClient.mockResolvedValue(undefined)
  })

  it('ouvre une modale accessible qui décrit les champs obligatoires', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un client' }))

    const dialog = screen.getByRole('dialog', { name: 'Ajouter un client' })
    expect(dialog).toHaveAccessibleDescription("Les champs marqués d'une étoile sont obligatoires")
    expect(screen.getByLabelText(/^Nom \*/)).toBeRequired()
    expect(screen.getByLabelText(/^Prénom \*/)).toBeRequired()
    expect(screen.getByLabelText("Numéro d'identité")).toBeInTheDocument()
    expect(screen.getByLabelText('Numéro personnel')).toBeInTheDocument()
  })

  it('ferme la modale sans enregistrer avec le bouton de fermeture', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un client' }))

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clientActions.addClient).not.toHaveBeenCalled()
  })

  it('enregistre avec le formulaire existant puis revient à la liste', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un client' }))
    fireEvent.change(screen.getByLabelText(/^Nom \*/), { target: { value: 'OUEDRAOGO' } })
    fireEvent.change(screen.getByLabelText(/^Prénom \*/), { target: { value: 'Awa' } })

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(clientActions.addClient).toHaveBeenCalledWith(expect.objectContaining({
      nom: 'OUEDRAOGO',
      prenom: 'Awa',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
