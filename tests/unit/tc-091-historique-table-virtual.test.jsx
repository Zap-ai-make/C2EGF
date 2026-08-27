/**
 * TC-091 — HistoriqueTable : fenêtrage (virtualisation) au-delà du seuil.
 *
 * Caractérisation : sous le seuil (VIRTUALIZE_THRESHOLD = 60), toutes les lignes sont
 * rendues (comportement historique inchangé). Au-delà, seule une tranche est rendue,
 * encadrée de lignes-espaceurs. jsdom ne calculant pas le layout, la hauteur de ligne
 * retombe sur le défaut → la tranche est déterministe (bornée, < itemCount).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ getTransactionStyles: () => ({ bgColor: '', textColor: '' }) }),
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-800' } }),
}))

import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'

const makeTxns = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `tx-${i}`,
    client: `Client ${i}`,
    type: i % 2 === 0 ? 'Dépôt' : 'Retrait',
    reseau: 'Orange',
    code: String(1000 + i),
    montant: (i + 1) * 1000,
    statut: 'Validée',
    date: '04/08/2026 06:23',
  }))

const dataRows = () =>
  // Lignes de données = <tr> qui contiennent une cellule de bordure (exclut espaceurs & en-tête).
  Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td.border'))

describe('TC-091 — HistoriqueTable virtualisation', () => {
  it('liste vide → message dédié', () => {
    render(<HistoriqueTable transactions={[]} />)
    expect(screen.getByText("Aucune transaction dans l'historique")).toBeInTheDocument()
  })

  it('sous le seuil (30 lignes) → toutes les lignes rendues (non-régression)', () => {
    render(<HistoriqueTable transactions={makeTxns(30)} />)
    expect(dataRows()).toHaveLength(30)
    // En-têtes toujours présents.
    expect(screen.getByText('Date & heure')).toBeInTheDocument()
    expect(screen.getByText('Email utilisateur')).toBeInTheDocument()
  })

  it('au-dessus du seuil (500 lignes) → tranche fenêtrée (moins que le total)', () => {
    render(<HistoriqueTable transactions={makeTxns(500)} />)
    const rows = dataRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(500)
  })

  it('au-dessus du seuil → lignes-espaceurs présentes (aria-hidden avec height)', () => {
    render(<HistoriqueTable transactions={makeTxns(500)} />)
    const spacers = Array.from(document.querySelectorAll('tbody tr[aria-hidden="true"]'))
    expect(spacers.length).toBeGreaterThan(0)
    // La hauteur est portée par la <td colSpan> interne (markup valide) ; au moins un
    // espaceur a une hauteur non nulle (bottomPad pour une longue liste au top).
    const spacerCells = spacers.map((tr) => tr.querySelector('td'))
    expect(spacerCells.every(Boolean)).toBe(true)
    expect(spacerCells.some((td) => parseFloat(td.style.height) > 0)).toBe(true)
  })

  it('formate correctement le contenu d’une ligne (client + montant en FCFA)', () => {
    render(<HistoriqueTable transactions={makeTxns(5)} />)
    expect(screen.getByText('Client 0')).toBeInTheDocument()
    // Insensible au type d'espace des milliers (U+202F selon l'ICU).
    expect(
      screen.getByText((content) => content.replace(/\s/g, ' ') === '1 000 FCFA'),
    ).toBeInTheDocument()
  })
})
