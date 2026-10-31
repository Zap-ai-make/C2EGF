import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * TC-317 — Dans l'historique, un règlement en deux moyens se lit en deux.
 *
 * « Une transaction non terminée réglée par Orange Money et Cash apparaît
 * comme une seule méthode, Orange Money, avec le code. On doit avoir les
 * détails : 50 000 par Orange Money avec le code, et 50 000 par Cash. »
 * (31 octobre 2026). Le calcul est figé par TC-316 ; ici, ce que l'œil lit.
 */

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))
vi.mock('../../src/services/firestore', () => ({ firestoreService: {} }))
vi.mock('../../src/services/settlementService', () => ({ addTransactionPayment: vi.fn(), addTransactionRefund: vi.fn() }))
vi.mock('../../src/context/AuthContext', async () => {
  const { createContext } = await import('react')
  return { AuthContext: createContext(null) }
})

import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import { TransactionsContext } from '../../src/context/transactions.jsx'

/** Le formatage FR sépare les milliers d'une espace fine insécable. */
const fr = (texte) => texte.replace(/\s/g, ' ')

const retraitRegle = (over = {}) => ({
  id: 'h-1',
  type: 'Retrait',
  client: { prenom: 'Salif', nom: 'OUEDRAOGO' },
  code: '4544102',
  montant: 100000,
  statut: 'Payé par Cash',
  settlementAgentCode: '7777777',
  settlementSummary: {
    netByNetwork: { Orange: { paid: 50000, refunded: 0 }, Liquidite: { paid: 50000, refunded: 0 } },
    agentCodes: ['7777777'],
    agentCodesByNetwork: { Orange: ['7777777'] },
  },
  date: '31/10/2026 10:00',
  ...over,
})

const afficher = (transactions) => render(
  <TransactionsContext.Provider value={{ getTransactionStyles: () => ({ textColor: '' }), trashTransaction: vi.fn() }}>
    <HistoriqueTable transactions={transactions} onReopen={vi.fn()} />
  </TransactionsContext.Provider>,
)

describe('TC-317 — le détail du règlement dans le tableau', () => {
  it('[HR-01] le statut cite les deux moyens, et chaque montant suit le sien', () => {
    afficher([retraitRegle()])
    const ligne = screen.getByText('Salif OUEDRAOGO').closest('tr')

    expect(within(ligne).getByText('Payé par Orange Money et Cash')).toBeInTheDocument()
    const detail = within(ligne).getByTestId('detail-reglement')
    const lignes = within(detail).getAllByRole('listitem').map((li) => fr(li.textContent))
    expect(lignes).toEqual(['50 000 FCFA par Orange Money → 7777777', '50 000 FCFA par Cash'])
  })

  it('[HR-02] le code n’est plus répété sous le code client : il est avec son moyen', () => {
    afficher([retraitRegle()])
    expect(screen.queryByTestId('code-agent-reglement')).not.toBeInTheDocument()
  })

  it('[HR-03] un seul moyen : la ligne d’avant, inchangée', () => {
    afficher([retraitRegle({
      statut: 'Payé par Orange Money',
      settlementSummary: { netByNetwork: { Orange: { paid: 100000, refunded: 0 } }, agentCodes: ['7777777'] },
    })])

    expect(screen.getByText('Payé par Orange Money')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-reglement')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-agent-reglement')).toHaveTextContent('→ 7777777')
  })
})
