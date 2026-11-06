/**
 * TC-349 — Les onglets Ravitaillement et Corbeille relisent par dates (lot G1).
 *
 * Ces deux onglets lisent l'historique du contexte, qui ne contient plus que
 * la journée en cours (docs/rester-dans-le-quota-gratuit.md §G). Leurs
 * boutons « Charger les mouvements / lignes précédent(e)s », qui relisaient
 * cent lignes à chaque clic (TC-321, retiré), laissent la place au choix des
 * dates. Une phrase dit ce qui est chargé : sans elle, un historique d'une
 * journée se lirait comme des données perdues.
 *
 * Les livraisons encore dues, elles, sont toujours toutes là, quelle que soit
 * la période (écoute dédiée, TC-347 [JC-03]).
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
vi.mock('../../src/components/historique/ClientSearch', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ActionButtons', () => ({ default: () => null }))
vi.mock('../../src/components/historique/DailyPagination', () => ({ default: () => null }))
vi.mock('../../src/components/historique/HistoriqueTable', () => ({ default: () => null }))

import Historique from '../../src/pages/Historique.jsx'

const afficher = (onglet) =>
  render(
    <MemoryRouter initialEntries={[`/historique?onglet=${onglet}`]}>
      <Historique />
    </MemoryRouter>,
  )

const choisirDates = (du, au) => {
  const [champDu, champAu] = document.querySelectorAll('input[type="date"]')
  fireEvent.change(champDu, { target: { value: du } })
  fireEvent.change(champAu, { target: { value: au } })
  fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
}

beforeEach(() => {
  transactionsValue = {
    completedTransactions: [],
    pendingTransactions: [],
    trashTransaction: vi.fn(),
    periode: null,
    periodeEnChargement: false,
    erreurPeriode: null,
    chargerPeriode: vi.fn(),
    revenirAuJour: vi.fn(),
  }
})

describe('TC-349 — Ravitaillement et Corbeille', () => {
  it('[PD-01] Ravitaillement : la journée, les livraisons dues, et des dates pour le reste', () => {
    afficher('dealer')

    expect(screen.getByTestId('periode-affichee')).toHaveTextContent(
      'Mouvements de la journée en cours. Les livraisons encore dues sont toutes affichées, même plus anciennes.',
    )
    choisirDates('2026-11-01', '2026-11-05')
    expect(transactionsValue.chargerPeriode).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-05' })

    fireEvent.click(screen.getByRole('button', { name: 'Aujourd\'hui' }))
    expect(transactionsValue.revenirAuJour).toHaveBeenCalledOnce()
  })

  it('[PD-02] Corbeille : ce qui a été supprimé aujourd’hui, puis la période choisie', () => {
    const { unmount } = afficher('corbeille')
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent('Lignes supprimées aujourd’hui.')
    unmount()

    transactionsValue = { ...transactionsValue, periode: { from: '2026-11-01', to: '2026-11-05' } }
    afficher('corbeille')
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent(
      'Lignes supprimées aujourd’hui, et celles saisies du 01/11/2026 au 05/11/2026.',
    )
  })

  it('[PD-03] un seul jour se dit au singulier', () => {
    transactionsValue = { ...transactionsValue, periode: { from: '2026-11-04', to: '2026-11-04' } }
    afficher('dealer')
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent('Mouvements du 04/11/2026 et de la journée en cours.')
  })

  it('[PD-04] une période refusée ou une lecture en échec : la raison s’affiche', () => {
    transactionsValue = { ...transactionsValue, erreurPeriode: 'Choisissez une période de 31 jours au plus.' }
    afficher('corbeille')
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez une période de 31 jours au plus.')
  })

  it('[PD-05] pendant la lecture, la phrase le dit', () => {
    transactionsValue = { ...transactionsValue, periodeEnChargement: true }
    afficher('dealer')
    expect(screen.getByTestId('periode-affichee')).toHaveTextContent('Lecture de la période…')
  })

  it('[PD-06] plus aucun bouton « Charger … précédent(e)s », sur aucun onglet', () => {
    for (const onglet of ['clients', 'dealer', 'corbeille']) {
      const { unmount } = afficher(onglet)
      expect(screen.queryByRole('button', { name: /^Charger les/ })).toBeNull()
      unmount()
    }
  })
})
