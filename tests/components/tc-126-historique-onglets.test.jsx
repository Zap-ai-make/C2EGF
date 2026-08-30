/**
 * TC-126 — L'Historique à quatre sources.
 *
 * TC-116 fige déjà l'onglet « Transactions clients », y compris ses absences ;
 * ce fichier ne le rejoue pas. Il verrouille ce que le passage aux onglets
 * ajoute, et une règle que rien d'autre ne protège :
 *
 *   UNE ARCHIVE N'AGIT PAS. Les mêmes documents que la file « Demandes
 *   Dealer », mais sans un seul bouton. Ce ne sont pas deux pages pour la même
 *   chose : c'est une donnée sous deux jobs — on agit dans la file, on relit
 *   dans l'archive. Le jour où un bouton apparaîtrait ici, l'archive
 *   redeviendrait une file, et la distinction que porte toute la navigation
 *   tomberait avec elle.
 *
 * L'autre piège tenu ici : les deux sens sont DEUX requêtes. Sans re-tri sur la
 * réunion, les reçues se rangeraient toutes après les émises quelle que soit
 * leur date — un « historique » qui ment sur la chronologie.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const srv = vi.hoisted(() => ({
  emises: [], recues: [], dettes: [], creances: [], dealer: [],
  filtreDealer: 'jamais appele',
  statutsDemandes: null,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ completedTransactions: [], loading: false }),
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { background: '', text: '' } }),
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribeOutgoingCollaborations: ({ statuses, onUpdate }) => {
    srv.statutsDemandes = statuses
    onUpdate(srv.emises)
    return () => {}
  },
  subscribeIncomingCollaborations: ({ onUpdate }) => { onUpdate(srv.recues); return () => {} },
  subscribeMyDebts: ({ onUpdate }) => { onUpdate(srv.dettes); return () => {} },
  subscribeMyCredits: ({ onUpdate }) => { onUpdate(srv.creances); return () => {} },
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ statusFilter, onUpdate }) => {
    srv.filtreDealer = statusFilter
    onUpdate({ requests: srv.dealer, lastDoc: null, hasMore: false })
    return () => {}
  },
}))

import Historique from '../../src/pages/Historique.jsx'

const jour = (n) => ({ seconds: 1_700_000_000 + n * 86_400, nanoseconds: 0 })

const poser = (recherche = '') =>
  render(
    <MemoryRouter initialEntries={[`/historique${recherche}`]}>
      <Historique />
    </MemoryRouter>,
  )

beforeEach(() => {
  srv.emises = []
  srv.recues = []
  srv.dettes = []
  srv.creances = []
  srv.dealer = []
  srv.filtreDealer = 'jamais appele'
  srv.statutsDemandes = null
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-126-A — les onglets', () => {
  it('[HI-01] les quatre sources sont proposées sous le profil réel', () => {
    poser()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Transactions clients', 'Dealer', 'Collaborations', 'Dettes internes',
    ])
  })

  it('[HI-02] sans paramètre, on ouvre sur les transactions clients', () => {
    poser()
    expect(screen.getByTestId('onglet-historique-clients')).toHaveAttribute('aria-selected', 'true')
  })

  it('[HI-03] l’URL décide de l’onglet', () => {
    poser('?onglet=dettes')
    expect(screen.getByTestId('onglet-historique-dettes')).toHaveAttribute('aria-selected', 'true')
  })

  it('[HI-04] un onglet inconnu retombe sur le premier, sans écran vide', () => {
    poser('?onglet=nimportequoi')
    expect(screen.getByTestId('onglet-historique-clients')).toHaveAttribute('aria-selected', 'true')
  })

  it('[HI-05] cliquer un onglet bascule la vue', () => {
    poser()
    fireEvent.click(screen.getByTestId('onglet-historique-collaborations'))
    expect(screen.getByTestId('onglet-historique-collaborations')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('TC-126-B — le filtre reste là où il a un sens', () => {
  it('[HI-06] l’onglet Clients garde sa recherche client', () => {
    poser('?onglet=clients')
    expect(screen.getByRole('button', { name: /Filtrer/i })).toBeInTheDocument()
  })

  it('[HI-07] les autres onglets ne l’affichent pas', () => {
    // Le partager voudrait dire soit le vider de sa moitié utile, soit afficher
    // un champ mort : « client » n'existe ni pour une dette ni pour un
    // ravitaillement.
    poser('?onglet=dettes')
    expect(screen.queryByRole('button', { name: /Filtrer/i })).not.toBeInTheDocument()
  })
})

describe('TC-126-C — une archive n’agit pas', () => {
  it('[HI-08] l’archive dealer ne propose AUCUN bouton', () => {
    srv.dealer = [
      { id: 'r1', type: 'stock_add', network: 'Orange', amount: 500_000, status: 'pending', createdAt: jour(0) },
    ]
    poser('?onglet=dealer')
    const liste = screen.getByRole('list', { name: 'Demandes au dealer' })
    expect(within(liste).queryAllByRole('button')).toHaveLength(0)
  })

  it('[HI-09] l’archive collaborations non plus', () => {
    srv.emises = [
      { id: 'c1', operationType: 'deposit', amount: 40_000, status: 'confirmed', supplierStoreName: 'Zogona', createdAt: jour(0) },
    ]
    poser('?onglet=collaborations')
    const liste = screen.getByRole('list', { name: 'Collaborations terminées' })
    expect(within(liste).queryAllByRole('button')).toHaveLength(0)
  })

  it('[HI-10] l’archive dealer ne filtre AUCUN statut : elle montre tout', () => {
    poser('?onglet=dealer')
    expect(srv.filtreDealer).toBeNull()
  })

  it('[HI-11] l’archive collaborations ne demande QUE les statuts terminaux', () => {
    // Une collaboration en attente appartient à la file, pas à l'archive.
    poser('?onglet=collaborations')
    expect(srv.statutsDemandes).toEqual(['confirmed', 'rejected'])
  })
})

describe('TC-126-D — la chronologie de deux requêtes', () => {
  it('[HI-12] les deux sens sont re-triés par date, jamais concaténés', () => {
    // Sans re-tri, toutes les reçues se rangeraient après toutes les émises,
    // quelle que soit leur date — un « historique » qui ment.
    srv.emises = [
      { id: 'vieille', operationType: 'deposit', amount: 1, status: 'confirmed', supplierStoreName: 'A', createdAt: jour(0) },
    ]
    srv.recues = [
      { id: 'recente', operationType: 'deposit', amount: 2, status: 'confirmed', requestingStoreName: 'B', createdAt: jour(5) },
    ]
    poser('?onglet=collaborations')
    const noms = within(screen.getByRole('list', { name: 'Collaborations terminées' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(noms[0]).toContain('B')
    expect(noms[1]).toContain('A')
  })

  it('[HI-13] dettes et créances se mêlent aussi par date', () => {
    srv.dettes = [
      { id: 'd1', originalAmount: 10, status: 'open', creditorStoreName: 'Dette', createdAt: jour(0) },
    ]
    srv.creances = [
      { id: 'c1', originalAmount: 20, status: 'settled', debtorStoreName: 'Creance', createdAt: jour(3) },
    ]
    poser('?onglet=dettes')
    const lignes = within(screen.getByRole('list', { name: 'Dettes internes' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lignes[0]).toContain('Creance')
    expect(lignes[1]).toContain('Dette')
  })

  it('[HI-14] une dette montre son montant INITIAL, pas son reste dû', () => {
    // L'archive raconte ce qui s'est passé ; le reste dû est l'affaire de la
    // page des dettes, qui, elle, sert à agir.
    srv.dettes = [
      { id: 'd1', originalAmount: 180_000, remainingAmount: 45_000, status: 'partially_settled', creditorStoreName: 'Gounghin', createdAt: jour(0) },
    ]
    poser('?onglet=dettes')
    const ligne = within(screen.getByRole('list', { name: 'Dettes internes' })).getAllByRole('listitem')[0]
    expect(ligne).toHaveTextContent('180 000 FCFA')
    expect(ligne).not.toHaveTextContent('45 000')
  })
})

describe('TC-126-E — les états vides', () => {
  it('[HI-15] chaque archive vide dit ce qui manque, sans laisser un trou', () => {
    for (const [onglet, titre] of [
      ['dealer', 'Aucune demande au dealer'],
      ['collaborations', 'Aucune collaboration terminée'],
      ['dettes', 'Aucune dette interne'],
    ]) {
      const { unmount } = poser(`?onglet=${onglet}`)
      expect(screen.getByText(titre)).toBeInTheDocument()
      unmount()
    }
  })
})
