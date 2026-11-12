/**
 * TC-374 — La page Historique dit ce qu'elle ne montre pas, et compte ce qu'elle
 * montre (correctif du 2026-11-12).
 *
 * LES DEUX PHRASES
 * ────────────────
 * Le contexte sait désormais deux choses qu'aucun écran ne disait (TC-373) : une
 * écoute de l'historique arrêtée pour de bon, et une période lue sur l'appareil
 * faute de réseau. Une phrase chacune, courte, sur les onglets qui lisent
 * l'historique. Rien de plus quand tout va bien.
 *
 * LES CARTES DE JOUR
 * ──────────────────
 * Elles comptaient tout l'historique du jour : ravitaillements, retours,
 * clôtures, lignes supprimées. Le tableau, lui, ne montre que les transactions
 * clients encore valables. Le 11/11/2026, la carte annonçait 18 transactions et
 * le tableau en montrait 3. Les deux comptent maintenant la même chose.
 *
 *   [PA-01] un historique arrêté se dit, sur chaque onglet qui le lit ;
 *   [PA-02] une période lue sans réseau se dit ;
 *   [PA-03] quand tout va bien, aucune des deux phrases ;
 *   [CJ-01] la carte d'un jour compte les lignes du tableau ;
 *   [CJ-02] un jour sans transaction client n'a pas de carte.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let contextValue

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin', storeId: 'store-a' } }),
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribeOutgoingCollaborations: () => () => {},
  subscribeIncomingCollaborations: () => () => {},
  subscribeMyDebts: () => () => {},
  subscribeMyCredits: () => () => {},
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ onUpdate } = {}) => {
    onUpdate?.({ requests: [] })
    return () => {}
  },
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => contextValue,
}))

import Historique from '../../src/pages/Historique.jsx'

const tx = (id, date, over = {}) => ({
  id,
  client: { nom: `CLIENT-${id}`, prenom: 'X' },
  type: 'Dépôt',
  reseau: 'Orange',
  code: '123456',
  montant: 100000,
  statut: 'Validée',
  date,
  ...over,
})

const contexte = (over = {}) => ({
  completedTransactions: [],
  pendingTransactions: [],
  periode: null,
  periodeEnChargement: false,
  erreurPeriode: null,
  periodeHorsLigne: false,
  historiqueArrete: false,
  chargerPeriode: vi.fn(),
  revenirAuJour: vi.fn(),
  getTransactionStyles: () => ({ bgColor: '', textColor: '' }),
  addTransaction: vi.fn(),
  trashTransaction: vi.fn(),
  ...over,
})

const afficher = (onglet = 'clients') => render(
  <MemoryRouter initialEntries={[`/historique?onglet=${onglet}`]}>
    <Historique />
  </MemoryRouter>,
)

const lignesDuTableau = () =>
  Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelectorAll('td').length > 1)
const comptesDesCartes = () => screen.queryAllByText(/^\d+ transactions?$/).map((n) => n.textContent)

const ARRETE = 'L’historique ne se met plus à jour. Rechargez la page.'
const HORS_LIGNE = 'Hors ligne : liste peut-être incomplète.'

beforeEach(() => {
  contextValue = contexte()
})

describe('TC-374 — ce que la page ne montre pas se dit', () => {
  it.each(['clients', 'dealer', 'corbeille'])('[PA-01] un historique arrêté se dit (onglet %s)', (onglet) => {
    contextValue = contexte({ historiqueArrete: true })
    afficher(onglet)
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent(ARRETE)
  })

  it.each(['clients', 'dealer', 'corbeille'])('[PA-02] une période lue sans réseau se dit (onglet %s)', (onglet) => {
    contextValue = contexte({ periode: { from: '2026-11-11', to: '2026-11-11' }, periodeHorsLigne: true })
    afficher(onglet)
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent(HORS_LIGNE)
  })

  it('[PA-03] quand tout va bien, aucune des deux phrases', () => {
    contextValue = contexte({ periode: { from: '2026-11-11', to: '2026-11-11' } })
    afficher('clients')
    const zone = screen.getByTestId('periode-affichee')
    expect(zone).not.toHaveTextContent(ARRETE)
    expect(zone).not.toHaveTextContent(HORS_LIGNE)
  })
})

describe('TC-374 — les cartes de jour comptent ce que montre le tableau', () => {
  it('[CJ-01] le 11/11 : 3 transactions clients, et 15 autres lignes qui ne sont pas les leurs', () => {
    const jour = '11/11/2026'
    contextValue = contexte({
      completedTransactions: [
        tx('c1', `${jour} 09:33`),
        tx('c2', `${jour} 09:26`, { type: 'Retrait' }),
        tx('c3', `${jour} 09:20`, { type: 'Retrait' }),
        ...Array.from({ length: 6 }, (_, i) => tx(`r${i}`, jour, { type: 'Ravitaillement', client: undefined })),
        ...Array.from({ length: 6 }, (_, i) => tx(`t${i}`, jour, { type: 'Retour', client: undefined })),
        tx('k1', jour, { type: 'Clôture', client: undefined }),
        tx('s1', `${jour} 10:00`, { statut: 'Supprimée', deletedAt: new Date('2026-11-11T10:05:00Z') }),
        tx('s2', `${jour} 11:00`, { statut: 'Supprimée', deletedAt: new Date('2026-11-11T11:05:00Z') }),
      ],
    })
    afficher('clients')

    expect(lignesDuTableau()).toHaveLength(3)
    expect(comptesDesCartes()).toEqual(['3 transactions'])
  })

  it('[CJ-02] un jour sans transaction client n\'a pas de carte', () => {
    contextValue = contexte({
      completedTransactions: [
        tx('c1', '12/11/2026 08:00'),
        tx('r1', '11/11/2026', { type: 'Ravitaillement', client: undefined }),
        tx('s1', '10/11/2026 10:00', { deletedAt: new Date('2026-11-10T10:05:00Z') }),
      ],
    })
    afficher('clients')

    expect(comptesDesCartes()).toEqual(['1 transaction'])
  })
})
