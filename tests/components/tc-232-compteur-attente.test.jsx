import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'

/**
 * TC-232 — Le compteur d'attente dans les non terminées.
 *
 * CE QUE CE FICHIER PROTÈGE, ET QUE TC-231 NE COUVRE PAS
 * ─────────────────────────────────────────────────────
 * TC-231 vérifie le CALCUL, sur deux nombres, sans horloge. Ici on vérifie les
 * trois choses qui ne peuvent se voir qu'à l'écran :
 *
 *   1. le compteur AVANCE tout seul — un chiffre juste mais figé n'apprend rien
 *      de plus que l'horodatage posé juste à côté ;
 *   2. passé une demi-heure, la LIGNE se signale — sinon il faut relire six
 *      compteurs pour trouver celui qui dépasse ;
 *   3. une ligne sans origine lisible n'affiche RIEN, plutôt qu'un 00:00:00 qui
 *      ferait croire qu'elle vient d'arriver.
 *
 * ⚠ Et une propriété d'hygiène, TC-232-9 : le minuteur est ARRÊTÉ au démontage.
 *   Un intervalle laissé derrière continue d'appeler setState sur un composant
 *   démonté à chaque seconde, pour toujours.
 */

let transactionsValue

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

const MINUTE = 60_000
const DEBUT = new Date('2026-10-08T14:00:00Z').getTime()

const brouillon = (over = {}) => ({
  id: 'd-1',
  type: 'Dépôt',
  client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
  code: '000111',
  montant: 50_000,
  statut: 'Non terminée',
  date: '08/10/2026 14:00',
  createdAt: { toMillis: () => DEBUT },
  ...over,
})

const contexte = (brouillons) => ({
  pendingTransactions: brouillons,
  loading: false,
  getActionButtons: () => ({}),
  getTransactionStyles: () => ({ textColor: '' }),
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn(),
})

/** La rangée du tableau qui porte ce compteur. */
const rangeeDe = (id) => screen.getByTestId(`attente-${id}`).closest('tr')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(DEBUT)
  transactionsValue = contexte([brouillon()])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TC-232 — le compteur avance', () => {
  it('[TC-232-1] part de zéro sur une ligne qui vient d’arriver', () => {
    render(<TransactionTable />)
    expect(screen.getByTestId('attente-d-1')).toHaveTextContent('00:00:00')
  })

  /**
   * ⚠ LA PROPRIÉTÉ CENTRALE. Un compteur figé n'apporte rien par rapport à
   *   l'horodatage qu'il remplace : c'est le fait qu'il tourne qui fait qu'on
   *   le regarde.
   */
  it('[TC-232-2] avance seconde par seconde, sans rien toucher', () => {
    render(<TransactionTable />)

    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByTestId('attente-d-1')).toHaveTextContent('00:00:03')

    act(() => { vi.advanceTimersByTime(12 * MINUTE) })
    expect(screen.getByTestId('attente-d-1')).toHaveTextContent('00:12:03')
  })

  it('[TC-232-3] repart du bon instant pour une ligne déjà ancienne', () => {
    vi.setSystemTime(DEBUT + 45 * MINUTE)
    render(<TransactionTable />)

    expect(screen.getByTestId('attente-d-1')).toHaveTextContent('00:45:00')
  })

  /**
   * Sans createdAt ni date lisible, le compteur mentirait en affichant
   * 00:00:00. L'horodatage, lui, reste — c'est la seule chose vraie qu'on ait.
   */
  it('[TC-232-4] n’affiche aucun compteur quand l’origine est illisible', () => {
    transactionsValue = contexte([brouillon({ createdAt: undefined, date: undefined })])
    render(<TransactionTable />)

    expect(screen.queryByTestId('attente-d-1')).not.toBeInTheDocument()
    expect(screen.getByText('Aïssata Ouedraogo')).toBeInTheDocument()
  })
})

describe('TC-232 — le seuil de trente minutes', () => {
  it('[TC-232-5] la ligne reste neutre avant le seuil', () => {
    vi.setSystemTime(DEBUT + 29 * MINUTE)
    render(<TransactionTable />)

    expect(rangeeDe('d-1').className).not.toContain('bg-warn-soft')
  })

  it('[TC-232-6] la ligne s’allume une fois le seuil franchi', () => {
    vi.setSystemTime(DEBUT + 30 * MINUTE)
    render(<TransactionTable />)

    expect(rangeeDe('d-1').className).toContain('bg-warn-soft')
  })

  it('[TC-232-7] elle s’allume toute seule, sans rechargement', () => {
    vi.setSystemTime(DEBUT + 29 * MINUTE + 58_000)
    render(<TransactionTable />)
    expect(rangeeDe('d-1').className).not.toContain('bg-warn-soft')

    act(() => { vi.advanceTimersByTime(3000) })
    expect(rangeeDe('d-1').className).toContain('bg-warn-soft')
  })

  it('[TC-232-8] seule la ligne en retard s’allume', () => {
    transactionsValue = contexte([
      brouillon({ id: 'vieille', createdAt: { toMillis: () => DEBUT - 40 * MINUTE } }),
      brouillon({ id: 'neuve' }),
    ])
    render(<TransactionTable />)

    expect(rangeeDe('vieille').className).toContain('bg-warn-soft')
    expect(rangeeDe('neuve').className).not.toContain('bg-warn-soft')
  })
})

describe('TC-232 — l’hygiène du minuteur', () => {
  /**
   * ⚠ Un intervalle laissé derrière appelle setState sur un composant démonté,
   *   une fois par seconde, pour toujours. React le signale en console et la
   *   fuite grossit à chaque passage sur l'onglet.
   */
  it('[TC-232-9] le minuteur est arrêté au démontage', () => {
    const { unmount } = render(<TransactionTable />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  /** Aucune ligne à compter : inutile de réveiller le navigateur chaque seconde. */
  it('[TC-232-10] aucun minuteur ne tourne quand la liste est vide', () => {
    transactionsValue = contexte([])
    render(<TransactionTable />)

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('TC-232 — une pastille, pas une colonne', () => {
  /**
   * Le compteur est posé EN RELIEF sur la rangée, il ne la décrit pas : une
   * septième colonne l'aurait rangé avec le montant et le code, des valeurs
   * figées. Le tableau garde donc ses six colonnes, et l'horodatage sa place.
   */
  it('[TC-232-11] le tableau garde ses six colonnes, horodatage compris', () => {
    render(<TransactionTable />)

    expect(screen.getAllByRole('columnheader')).toHaveLength(6)
    const cellule = screen.getByTestId('attente-d-1').closest('td')
    expect(within(cellule).getByText(/08\/10\/2026/)).toBeInTheDocument()
  })
})
