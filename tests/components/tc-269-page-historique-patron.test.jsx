import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * TC-269 — l'historique d'un client est une PAGE, pas un panneau.
 *
 * Un panneau se ferme d'un geste accidentel et n'a pas d'adresse. Une page a un
 * retour, survit à une rotation d'écran, et se recharge.
 *
 * ⚠ RONDE DE CORRECTION 1 (I-3) — LE MOCK GARDE LA RÉFÉRENCE AU CALLBACK, IL NE
 *   L'APPELLE PLUS TOUT SEUL. La version précédente appelait `cb(clients)`
 *   dans `subscribeToAllClients` lui-même : impossible, avec ça, d'observer un
 *   état « abonné mais pas encore de réponse » (chargement) ni de déclencher
 *   `.onError`. `clientsCb` capture le callback posé par la page ; chaque test
 *   décide s'il le déclenche, et quand — enveloppé dans `act()`, motif de
 *   `tc-122-page-dettes-internes.test.jsx:81-85`.
 */

let etatHook = {
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
}
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({
  useHistoriqueClient: () => etatHook,
}))

let clientsCb = null
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: { subscribeToAllClients: (cb) => { clientsCb = cb; return vi.fn() } },
}))

const { default: PatronHistoriqueClient } = await import('../../src/pages/admin/PatronHistoriqueClient.jsx')

const page = (id = 'c1') => render(
  <MemoryRouter initialEntries={[`/admin/clients/${id}/historique`]}>
    <Routes>
      <Route path="/admin/clients/:clientId/historique" element={<PatronHistoriqueClient />} />
    </Routes>
  </MemoryRouter>,
)

/** Fait arriver la liste des clients, comme le ferait Firestore. */
const pousserClients = (data) => act(() => { clientsCb(data) })
/** Fait tomber l'abonnement — `permission-denied`, coupure réseau, etc. */
const echouerClients = (err) => act(() => { clientsCb.onError(err) })

const JOUR = 24 * 60 * 60 * 1000
const debut = new Date('2026-10-01T08:00:00Z')
// ⚠ `typePlie: 'depot'` PAR DÉFAUT (I-2) : `delaiMoyen` ne mesure plus que les
//   dépôts, et ces lignes servent précisément à exercer cette mesure.
const op = (jours, typePlie = 'depot') => ({
  id: 'h' + jours, montant: 500000, type: 'Ravitaillement', statut: 'Validée',
  storeName: 'FADA', typePlie, createdAt: debut, validatedAt: new Date(debut.getTime() + jours * JOUR),
})

afterEach(cleanup)

describe('TC-269 — la fiche et le verdict', () => {
  it('[TC-269-01] le nom du client est affiché', () => {
    etatHook = { ...etatHook, lignes: [op(4)] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887' }])
    expect(screen.getByText(/OUEDRAOGO Salif/)).toBeInTheDocument()
  })

  it('[TC-269-02] le délai moyen dit sur combien d’opérations il porte', () => {
    etatHook = { ...etatHook, lignes: [op(4), { id: 'h9', typePlie: 'depot', createdAt: debut }] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    const bloc = screen.getByTestId('delai-moyen')
    expect(bloc).toHaveTextContent(/4\s*j/)
    expect(bloc).toHaveTextContent(/1 .* 2/)
  })

  /** Aucune mesure n'est un résultat, et l'écran ne doit pas écrire « 0 j ». */
  it('[TC-269-03] sans mesure, il le dit au lieu d’afficher zéro', () => {
    etatHook = { ...etatHook, lignes: [{ id: 'h1', typePlie: 'depot', createdAt: debut }] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByTestId('delai-moyen')).not.toHaveTextContent(/\b0\s*j\b/)
  })
})

/**
 * ⚠ REVIEW FOCUS 2 — une adresse qui désigne une fiche inexistante. Signet
 *   périmé, URL tapée, fiche supprimée entre-temps. La page doit le dire.
 */
describe('TC-269 — un client introuvable', () => {
  it('[TC-269-04] la page le dit et ne plante pas', () => {
    etatHook = { ...etatHook, lignes: [] }
    page('inconnu')
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })

  it('[TC-269-05] et elle offre le retour au tableau', () => {
    page('inconnu')
    pousserClients([])
    expect(screen.getByRole('link', { name: /retour|tableau/i })).toBeInTheDocument()
  })
})

/**
 * ⚠ RONDE DE CORRECTION 1 (I-3) — LES DEUX BRANCHES AJOUTÉES PAR LA PRÉCÉDENTE
 *   RONDE N'AVAIENT AUCUN TEST. Supprimer `onClients.onError` en entier
 *   laissait les 5 tests ci-dessus verts : rien ne distinguait « pas encore de
 *   réponse » de « introuvable », et rien n'exerçait la branche d'erreur.
 */
describe('TC-269 — l’abonnement clients peut être lent ou tomber', () => {
  it('[TC-269-06] tant que rien n’est arrivé, l’écran dit qu’il charge — jamais « fiche introuvable »', () => {
    page('c1')
    // Aucun `pousserClients(...)` : l'abonnement est posé, rien n'a encore répondu.
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByText(/fiche introuvable/i)).not.toBeInTheDocument()
  })

  it('[TC-269-07] une erreur d’abonnement affiche une alerte, pas un chargement perpétuel', () => {
    page('c1')
    echouerClients(Object.assign(new Error('Accès refusé.'), { code: 'permission-denied' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/^chargement…$/i)).not.toBeInTheDocument()
  })

  it('[TC-269-08] une liste vide reçue pour un id inconnu dit « fiche introuvable »', () => {
    page('inconnu')
    pousserClients([])
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })
})
