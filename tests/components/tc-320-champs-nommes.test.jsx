/**
 * TC-320 — Chaque champ de saisie porte un nom accessible.
 *
 * Constat UI-03 de l'audit du 31 octobre 2026, relevé au banc : le champ
 * « Montant (FCFA) » de la saisie avait un libellé VISIBLE, mais non relié
 * (ni `htmlFor` ni `id`). Un lecteur d'écran annonçait « zone d'édition,
 * nombre », et rien d'autre, sur le champ le plus important du comptoir. Même
 * chose pour la recherche client, les filtres de la liste des clients, les
 * dates de l'historique et le montant d'une tranche.
 *
 * Deux gardes :
 *   - [CN-01] lit les sources, à la manière de TC-225 : un champ ajouté demain
 *     sans nom fait échouer ce test le jour où on l'écrit ;
 *   - [CN-02] et suivants MONTENT les composants et cherchent chaque champ par
 *     son libellé (`getByLabelText`) : c'est la seule preuve que le lien
 *     libellé → champ existe vraiment, et pas seulement un attribut `id`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let transactionsValue

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/hooks/useNetworkCards.js', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => 500000,
    getLiquidite: () => 500000,
    getNetworkLiquidite: () => 500000,
    formatAmount: (n) => Number(n).toLocaleString('fr-FR'),
  }),
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableHeader: '', tableBorder: '', text: '' } }),
}))
vi.mock('../../src/context/AuthContext.jsx', async () => {
  const { createContext } = await import('react')
  return { AuthContext: createContext({ activeStore: { id: 's1', name: 'OUAGA' } }) }
})
vi.mock('../../src/hooks/useExcelOperations.js', () => ({
  useExcelOperations: () => ({
    isImporting: false,
    fileInputRef: { current: null },
    handleExport: vi.fn(),
    handleImportClick: vi.fn(),
    handleFileImport: vi.fn(),
  }),
}))

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import ClientsTable from '../../src/components/ClientsTable.jsx'
import Pagination from '../../src/components/Pagination.jsx'
import DateFilter from '../../src/components/historique/DateFilter.jsx'
import ClientSearchHistorique from '../../src/components/historique/ClientSearch.jsx'

// ─── [CN-01] Les sources ─────────────────────────────────────────────────────

const RACINE = process.cwd()
const TYPES_SANS_LIBELLE_PROPRE = /type=["'](hidden|radio|checkbox|submit|button|file)["']/

function sources(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return nom === 'preview-doubles' ? [] : sources(chemin)
    return /\.jsx$/.test(nom) && nom !== 'preview.jsx' ? [chemin] : []
  })
}

/** Les champs dont la balise n'a ni aria-label, ni aria-labelledby, ni id, hors d'un <label>. */
function champsSansNom(source) {
  // Un `<select>` cité dans un commentaire n'est pas un champ.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const trouves = []
  // `=>` ne ferme pas la balise : un `onChange={e => …}` la coupait avant
  // l'aria-label qui suit.
  const motif = /<(input|select|textarea)\b((?:=>|[^>])*)>/g
  let m
  while ((m = motif.exec(code))) {
    const attributs = m[2]
    if (TYPES_SANS_LIBELLE_PROPRE.test(attributs)) continue
    if (/aria-label|aria-labelledby|\bid=/.test(attributs)) continue
    const avant = code.slice(0, m.index)
    if (avant.lastIndexOf('<label') > avant.lastIndexOf('</label>')) continue
    trouves.push(`<${m[1]}> ${(attributs.match(/placeholder=["']([^"']{0,40})/) || [])[1] ?? ''}`.trim())
  }
  return trouves
}

describe('TC-320 — aucun champ anonyme dans les sources', () => {
  it('[CN-01] chaque input, select et textarea de src/ a un nom accessible', () => {
    const anonymes = sources(join(RACINE, 'src')).flatMap((fichier) =>
      champsSansNom(readFileSync(fichier, 'utf8')).map((champ) => `${relative(RACINE, fichier)} : ${champ}`))

    expect(anonymes, `Champs sans nom accessible :\n${anonymes.join('\n')}`).toEqual([])
  })
})

// ─── [CN-02…] Les composants montés ──────────────────────────────────────────

const transactions = (surcharge = {}) => ({
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  saveReopenedCorrection: vi.fn(),
  editingTransaction: null,
  clearEditTransaction: vi.fn(),
  pendingTransactions: [],
  loading: false,
  getActionButtons: () => ({}),
  getTransactionStyles: () => ({ textColor: '' }),
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn(),
  ...surcharge,
})

describe('TC-320 — la saisie au comptoir', () => {
  it('[CN-02] le montant et la recherche client se trouvent par leur nom', () => {
    transactionsValue = transactions()
    render(<TransactionForm clients={[]} />)

    expect(screen.getByLabelText(/Montant \(FCFA\)/)).toBe(screen.getByPlaceholderText('Saisir le montant'))
    expect(screen.getByLabelText('Rechercher un client')).toBe(screen.getByPlaceholderText(/code agent/i))
  })

  it('[CN-03] le montant d’une tranche et ses deux boutons sont nommés', () => {
    transactionsValue = transactions({
      pendingTransactions: [{
        id: 'd-1', type: 'Dépôt', client: { nom: 'Ouedraogo', prenom: 'Aïssata' }, code: '000111',
        montant: 50_000, statut: 'Non terminée', date: '08/10/2026 14:00', createdAt: { toMillis: () => Date.now() },
      }],
      getActionButtons: () => ({ encaisser: true }),
    })
    render(<TransactionTable />)
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))
    fireEvent.click(screen.getByText('Cash'))

    expect(screen.getByLabelText(/Montant \(FCFA\)/)).toBe(screen.getByRole('spinbutton'))
    expect(screen.getByRole('button', { name: 'Retirer 500 FCFA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajouter 500 FCFA' })).toBeInTheDocument()
  })
})

describe('TC-320 — les listes et leurs filtres', () => {
  it('[CN-04] la recherche et le mois de la liste des clients', () => {
    render(<ClientsTable clients={[]} onEdit={vi.fn()} onImportClients={vi.fn()} onAddClient={vi.fn()} />)

    expect(screen.getByLabelText('Rechercher un client')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Mois d’ajout').tagName).toBe('SELECT')
  })

  it('[CN-05] « Éléments par page » est relié à sa liste', () => {
    render(
      <Pagination
        currentPage={1} totalPages={3} totalItems={60} pageSize={20} startIndex={1} endIndex={20}
        onPageChange={vi.fn()} onPageSizeChange={vi.fn()} hasNextPage hasPrevPage={false}
      />,
    )
    expect(screen.getByLabelText(/Éléments par page/).tagName).toBe('SELECT')
  })

  it('[CN-06] les deux dates et la recherche de l’historique', () => {
    render(<DateFilter onDateChange={vi.fn()} onResetToToday={vi.fn()} />)
    expect(screen.getByLabelText(/^Du\s*:/)).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText(/^Au\s*:/)).toHaveAttribute('type', 'date')

    render(<ClientSearchHistorique onSearch={vi.fn()} onSearchChange={vi.fn()} />)
    expect(screen.getByLabelText('Rechercher un client')).toBe(screen.getByPlaceholderText(/code réseau/))
  })
})
