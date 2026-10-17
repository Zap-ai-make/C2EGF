import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * TC-269 — l'historique d'un client est une PAGE, pas un panneau.
 *
 * Un panneau se ferme d'un geste accidentel et n'a pas d'adresse. Une page a un
 * retour, survit à une rotation d'écran, et se recharge.
 */

let etatHook = {
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
}
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({
  useHistoriqueClient: () => etatHook,
}))

let clients = []
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: { subscribeToAllClients: (cb) => { cb(clients); return vi.fn() } },
}))

const { default: PatronHistoriqueClient } = await import('../../src/pages/admin/PatronHistoriqueClient.jsx')

const page = (id = 'c1') => render(
  <MemoryRouter initialEntries={[`/admin/clients/${id}/historique`]}>
    <Routes>
      <Route path="/admin/clients/:clientId/historique" element={<PatronHistoriqueClient />} />
    </Routes>
  </MemoryRouter>,
)

const JOUR = 24 * 60 * 60 * 1000
const debut = new Date('2026-10-01T08:00:00Z')
const op = (jours) => ({
  id: 'h' + jours, montant: 500000, type: 'Ravitaillement', statut: 'Validée',
  storeName: 'FADA', createdAt: debut, validatedAt: new Date(debut.getTime() + jours * JOUR),
})

afterEach(cleanup)

describe('TC-269 — la fiche et le verdict', () => {
  it('[TC-269-01] le nom du client est affiché', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887' }]
    etatHook = { ...etatHook, lignes: [op(4)] }
    page()
    expect(screen.getByText(/OUEDRAOGO Salif/)).toBeInTheDocument()
  })

  it('[TC-269-02] le délai moyen dit sur combien d’opérations il porte', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [op(4), { id: 'h9', createdAt: debut }] }
    page()
    const bloc = screen.getByTestId('delai-moyen')
    expect(bloc).toHaveTextContent(/4\s*j/)
    expect(bloc).toHaveTextContent(/1 .* 2/)
  })

  /** Aucune mesure n'est un résultat, et l'écran ne doit pas écrire « 0 j ». */
  it('[TC-269-03] sans mesure, il le dit au lieu d’afficher zéro', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [{ id: 'h1', createdAt: debut }] }
    page()
    expect(screen.getByTestId('delai-moyen')).not.toHaveTextContent(/\b0\s*j\b/)
  })
})

/**
 * ⚠ REVIEW FOCUS 2 — une adresse qui désigne une fiche inexistante. Signet
 *   périmé, URL tapée, fiche supprimée entre-temps. La page doit le dire.
 */
describe('TC-269 — un client introuvable', () => {
  it('[TC-269-04] la page le dit et ne plante pas', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [] }
    page('inconnu')
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })

  it('[TC-269-05] et elle offre le retour au tableau', () => {
    clients = []
    page('inconnu')
    expect(screen.getByRole('link', { name: /retour|tableau/i })).toBeInTheDocument()
  })
})
