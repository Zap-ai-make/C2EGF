/**
 * TC-102 — ClientsTable : caractérisation avant refonte.
 *
 * Ce composant porte 3 des 11 occurrences de `themeClasses.tableHeader.split(' ')[1]`
 * (ClientsTable.jsx:86, 91, 95) — de la chirurgie de chaîne pour extraire une classe
 * de bordure. Le lot 4 la remplace par une clé `tableBorder` explicite, à sortie
 * rendue identique. Ce filet doit donc exister AVANT le lot 4.
 *
 * On fige le comportement : en-têtes, pagination, filtres, état vide. Volontairement
 * aucune assertion sur une classe — c'est ce que les lots 1 à 4 vont réécrire.
 *
 * Note de vocabulaire : le client appelle ces comptes « des agents » (distributeur
 * B2B, ce sont des points de vente enrôlés, pas des consommateurs). L'interface dit
 * encore « clients » ; les libellés figés ci-dessous sont donc ceux d'aujourd'hui, et
 * un éventuel renommage sera un lot déclaré, avec ce test mis à jour dans le même
 * commit.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/AuthContext.jsx', async () => {
  const { createContext } = await import('react')
  return { AuthContext: createContext({ activeStore: { id: 's1', name: 'OUAGA' } }) }
})
// xlsx est lourd et hors sujet ici : on neutralise la couche export/import.
vi.mock('../../src/hooks/useExcelOperations.js', () => ({
  useExcelOperations: () => ({
    isImporting: false,
    fileInputRef: { current: null },
    handleExport: vi.fn(),
    handleImportClick: vi.fn(),
    handleFileImport: vi.fn(),
  }),
}))

import ClientsTable from '../../src/components/ClientsTable.jsx'
import { TABLE_HEADERS, PAGINATION } from '../../src/constants/index.js'

const makeClients = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c-${i}`,
    registeredStoreName: 'AKAYIS OUAGA',
    nom: `NOM${i}`,
    prenom: `Prenom${i}`,
    numeroIdentite: `B1012385${i}`,
    numeroPersonnel: `7696582${i}`,
    orange: `4544102${i}`,
    localite: 'OUAGADOUGOU',
    agentCommercial: 'OUEDRAOGO S.',
    dateAjout: '26/08/2026 10:00',
  }))

const renderTable = (clients) =>
  render(<ClientsTable clients={clients} onEdit={vi.fn()} onImportClients={vi.fn()} />)

const dataRows = () => Array.from(document.querySelectorAll('tbody tr'))

describe('TC-102 — en-têtes et structure du tableau', () => {
  it('porte un titre de section', () => {
    renderTable(makeClients(3))
    expect(screen.getByRole('heading', { name: 'Liste des clients' })).toBeInTheDocument()
  })

  it('rend les 9 colonnes de données, plus une colonne Actions', () => {
    renderTable(makeClients(3))
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(TABLE_HEADERS.length + 1)
    expect(headers.at(-1)).toHaveTextContent('Actions')
  })

  it('les intitulés de colonnes sont ceux du contrat métier', () => {
    renderTable(makeClients(1))
    for (const header of TABLE_HEADERS) {
      expect(screen.getByRole('columnheader', { name: header.label })).toBeInTheDocument()
    }
    // Le code agent est la clé d'identification d'un point de vente : on la fige.
    expect(screen.getByRole('columnheader', { name: 'Numéro agent / Code agent' })).toBeInTheDocument()
  })

  it('affiche les données d’une ligne', () => {
    renderTable(makeClients(1))
    const row = dataRows()[0]
    expect(within(row).getByText('NOM0')).toBeInTheDocument()
    expect(within(row).getByText('Prenom0')).toBeInTheDocument()
    expect(within(row).getByText('45441020')).toBeInTheDocument()
    expect(within(row).getByText('OUAGADOUGOU')).toBeInTheDocument()
  })
})

describe('TC-102 — pagination', () => {
  it('n’affiche qu’une page de lignes à la fois', () => {
    renderTable(makeClients(PAGINATION.DEFAULT_PAGE_SIZE + 25))
    expect(dataRows()).toHaveLength(PAGINATION.DEFAULT_PAGE_SIZE)
  })

  it('sous la taille de page → toutes les lignes sont rendues', () => {
    renderTable(makeClients(4))
    expect(dataRows()).toHaveLength(4)
  })
})

describe('TC-102 — filtres', () => {
  it('la recherche restreint les lignes affichées', () => {
    renderTable(makeClients(10))
    const search = screen.getByPlaceholderText(/Rechercher nom, prénom/)

    fireEvent.change(search, { target: { value: 'NOM7' } })
    expect(dataRows()).toHaveLength(1)
    expect(screen.getByText('NOM7')).toBeInTheDocument()
  })

  it('une recherche sans résultat bascule sur l’état vide', () => {
    renderTable(makeClients(10))
    fireEvent.change(screen.getByPlaceholderText(/Rechercher nom, prénom/), {
      target: { value: 'INTROUVABLE' },
    })
    expect(dataRows()).toHaveLength(0)
    expect(screen.getByText('Aucun client trouvé.')).toBeInTheDocument()
  })

  it('propose un filtre par mois, ouvert sur « Tous les mois »', () => {
    renderTable(makeClients(3))
    expect(screen.getByRole('option', { name: 'Tous les mois' }).selected).toBe(true)
  })
})

describe('TC-102 — états et actions', () => {
  it('liste vide → invitation à enregistrer, et aucune ligne', () => {
    // MISE À JOUR (lot des états) : « rien » et « rien qui corresponde » ne sont
    // plus le même écran. Une base vide invite à enregistrer un premier client ;
    // une recherche infructueuse propose d'effacer les filtres (cas ci-dessus).
    // Un seul message servait les deux, et le tableau restait affiché, vide,
    // surmonté d'une pagination qui comptait zéro page.
    renderTable([])
    expect(screen.getByText('Aucun client enregistré')).toBeInTheDocument()
    expect(dataRows()).toHaveLength(0)
  })

  it('liste vide → l’issue proposée par la page est rendue', () => {
    render(
      <ClientsTable
        clients={[]}
        onEdit={vi.fn()}
        onImportClients={vi.fn()}
        emptyAction={<button type="button">Enregistrer un client</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Enregistrer un client' })).toBeInTheDocument()
  })

  it('recherche infructueuse → l’issue est d’effacer les filtres', () => {
    renderTable(makeClients(10))
    fireEvent.change(screen.getByPlaceholderText(/Rechercher nom, prénom/), {
      target: { value: 'INTROUVABLE' },
    })
    expect(screen.getByRole('button', { name: 'Effacer les filtres' })).toBeInTheDocument()
  })

  it('le bouton d’export annonce le nombre d’éléments concernés', () => {
    renderTable(makeClients(12))
    expect(screen.getByRole('button', { name: /Exporter \(XLSM\) \(12\)/ })).toBeInTheDocument()
  })

  it('liste vide → l’export n’annonce aucun compte', () => {
    renderTable([])
    expect(screen.getByRole('button', { name: 'Exporter (XLSM)' })).toBeInTheDocument()
  })

  it('propose l’import de fichier', () => {
    renderTable(makeClients(2))
    expect(screen.getByRole('button', { name: 'Importer (XLSM)' })).toBeInTheDocument()
  })
})
