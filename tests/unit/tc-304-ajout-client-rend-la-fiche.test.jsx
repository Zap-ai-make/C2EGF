import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'

/**
 * TC-304 — addClient rend la fiche créée.
 *
 * Le formulaire de transaction enregistre un client inconnu sans se fermer,
 * puis le reprend comme client de l'opération. Il lui faut la fiche telle que
 * le service l'a écrite — son identifiant, et le compte `orange` que le service
 * pose — et non un simple « c'est fait » suivi d'une attente de l'abonnement.
 */

const service = vi.hoisted(() => ({
  addClient: vi.fn(async (donnees) => ({ id: 'c-neuf', ...donnees, orange: donnees.numeroAgent })),
  subscribeToClients: vi.fn(() => () => {}),
  migrateLocalStorageData: vi.fn(async () => true),
  deleteClient: vi.fn(),
  updateClient: vi.fn(),
}))

vi.mock('../../src/services/firestore', () => ({ firestoreService: service }))

import { ClientsContext, ClientsProvider } from '../../src/context/ClientsContext.jsx'
import { AuthContext } from '../../src/context/AuthContext.jsx'

const AUTH = {
  user: { uid: 'u-1', email: 'caisse@c2egf.test' },
  userProfile: { storeId: 'b-1', storeName: 'Gounghin' },
  activeStore: { id: 'b-1', name: 'Gounghin' },
  loading: false,
}

describe('TC-304 — addClient rend la fiche créée', () => {
  it('[AC-01] le résultat du service remonte à l’appelant, identifiant compris', async () => {
    let rendu
    function Appelant() {
      const { addClient } = useContext(ClientsContext)
      useEffect(() => {
        addClient({ nom: 'OUEDRAOGO', prenom: 'Salif', numeroAgent: '87654321' }).then((fiche) => { rendu = fiche })
      }, [addClient])
      return null
    }

    render(
      <AuthContext.Provider value={AUTH}>
        <ClientsProvider><Appelant /></ClientsProvider>
      </AuthContext.Provider>,
    )

    await waitFor(() => expect(rendu).toBeDefined())
    expect(rendu).toMatchObject({ id: 'c-neuf', nom: 'OUEDRAOGO', orange: '87654321' })
  })
})
