/**
 * TC-321 — L'onglet Ravitaillement et la Corbeille chargent leurs lignes
 * plus anciennes, et disent jusqu'où elles remontent.
 *
 * BUG-08 de l'audit du 31 octobre 2026, requalifié mineur le 2 novembre : les
 * livraisons encore dues sont toujours là (écoute dédiée, TC-241 [1]), mais
 * ces deux onglets lisent la FENÊTRE de l'historique — cent lignes, plus ce
 * qu'on charge — sans le dire et sans moyen d'en charger davantage. Un retour
 * de la semaine dernière, saisi par erreur, ne s'y retrouvait pas pour être
 * annulé.
 *
 * Correction minimale, choisie par le responsable : le bouton de chargement de
 * l'onglet clients, dans ces deux onglets, avec la date jusqu'où la liste
 * remonte. Un clic charge cent lignes de tout type et peut n'ajouter aucun
 * mouvement : c'est la date qui recule qui dit à la caissière que le clic a
 * servi.
 *
 * L'onglet clients, lui, ne bouge pas (TC-116).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let transactionsValue

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ onUpdate }) => {
    onUpdate({ requests: [] })
    return () => {}
  },
}))
vi.mock('../../src/components/historique/DateFilter', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ClientSearch', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ActionButtons', () => ({ default: () => null }))
vi.mock('../../src/components/historique/DailyPagination', () => ({ default: () => null }))
vi.mock('../../src/components/historique/HistoriqueTable', () => ({ default: () => null }))

import Historique from '../../src/pages/Historique.jsx'
import { jourDeSaisie } from '../../src/utils/businessDate.js'

const afficher = (onglet) =>
  render(
    <MemoryRouter initialEntries={[`/historique?onglet=${onglet}`]}>
      <Historique />
    </MemoryRouter>,
  )

beforeEach(() => {
  transactionsValue = {
    completedTransactions: [],
    pendingTransactions: [],
    historyHasMore: true,
    historyLoadingMore: false,
    historyDepuis: '25/10/2026',
    loadMoreHistory: vi.fn(),
    trashTransaction: vi.fn(),
  }
})

describe('TC-321 — l’onglet Ravitaillement', () => {
  it('[CP-01] dit jusqu’où il remonte, et charge les mouvements précédents', () => {
    afficher('dealer')

    expect(screen.getByText(/Mouvements depuis le 25\/10\/2026/)).toBeInTheDocument()
    expect(screen.getByText(/livraisons encore dues sont toutes affichées/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Charger les mouvements précédents' }))
    expect(transactionsValue.loadMoreHistory).toHaveBeenCalledOnce()
  })
})

describe('TC-321 — la Corbeille', () => {
  it('[CP-02] dit jusqu’où elle remonte, et charge les lignes précédentes', () => {
    afficher('corbeille')

    expect(screen.getByText(/Lignes saisies depuis le 25\/10\/2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Charger les lignes précédentes' }))
    expect(transactionsValue.loadMoreHistory).toHaveBeenCalledOnce()
  })
})

describe('TC-321 — les cas limites', () => {
  it('[CP-03] tout est chargé : ni phrase ni bouton', () => {
    transactionsValue = { ...transactionsValue, historyHasMore: false, historyDepuis: null }
    for (const onglet of ['dealer', 'corbeille']) {
      const { unmount } = afficher(onglet)
      expect(screen.queryByRole('button', { name: /précédent/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/depuis le/)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('[CP-04] pendant le chargement, le bouton est inactif et le dit', () => {
    transactionsValue = { ...transactionsValue, historyLoadingMore: true }
    afficher('dealer')
    const bouton = screen.getByRole('button', { name: 'Chargement des mouvements précédents' })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveTextContent('Chargement…')
  })

  it('[CP-05] date inconnue : le bouton reste, la phrase se tait', () => {
    transactionsValue = { ...transactionsValue, historyDepuis: null }
    afficher('corbeille')
    expect(screen.getByRole('button', { name: 'Charger les lignes précédentes' })).toBeInTheDocument()
    expect(screen.queryByText(/depuis le/)).not.toBeInTheDocument()
  })

  it('[CP-06] l’onglet clients garde son seul bouton, sans phrase', () => {
    afficher('clients')
    expect(screen.getByRole('button', { name: 'Charger les transactions précédentes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mouvements|lignes précédentes/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/depuis le/)).not.toBeInTheDocument()
  })
})

describe('TC-321 — le jour de saisie d’une ligne', () => {
  it('[CP-07] lu sur createdAt, le champ qui ordonne les pages', () => {
    // Le champ texte dit le 1er novembre ; la pagination, elle, suit createdAt.
    const ligne = { createdAt: { toDate: () => new Date('2026-10-31T12:00:00Z') }, date: '01/11/2026' }
    expect(jourDeSaisie(ligne)).toBe('31/10/2026')
  })

  it('[CP-08] à défaut, sur l’ancien champ texte ; sinon, rien', () => {
    expect(jourDeSaisie({ date: '02/10/2026 15:07' })).toBe('02/10/2026')
    expect(jourDeSaisie({})).toBeNull()
    expect(jourDeSaisie(undefined)).toBeNull()
  })
})
