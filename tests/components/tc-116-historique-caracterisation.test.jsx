/**
 * TC-116 — Page Historique : caractérisation AVANT la mise en sous-onglets.
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * Le chantier « collaborations / dettes internes » ajoute trois surfaces au
 * produit. Une seule page EXISTANTE en sort transformée : celle-ci, qui passe à
 * quatre sous-onglets avec des filtres remontés au niveau de la page.
 *
 * C'est donc le seul endroit qui exige un test de caractérisation écrit AVANT la
 * modification. Il fige le comportement d'aujourd'hui pour qu'on puisse prouver,
 * après, que le sous-onglet « Transactions clients » se comporte exactement pareil.
 *
 * ⚠ Ce qu'on fige est le comportement RÉEL de ce dépôt, pas celui décrit au §11.7
 *   du cahier des charges. En particulier, il n'y a ICI ni « Voir plus » ni
 *   `history.pageSize` : tout l'historique est chargé en mémoire et virtualisé
 *   au-delà de 60 lignes. Figer la description plutôt que le code inventerait une
 *   régression qui n'existe pas.
 *
 * Ce qu'on fige : les filtres de date (bornes incluses, cadran LOCAL), la
 * recherche, la navigation par jour (7 jours/page), les colonnes du tableau,
 * l'export, et l'état vide.
 * Ce qu'on ne fige pas : la moindre classe CSS, ni la structure du DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let contextValue

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => contextValue,
}))

import Historique from '../../src/pages/Historique.jsx'

// `date` est au format « JJ/MM/AAAA HH:mm » — c'est ce format que parse le filtre.
const tx = (over = {}) => ({
  id: 'tx-1',
  client: { nom: 'BANABA', prenom: 'Guafarou' },
  type: 'Dépôt',
  reseau: 'Orange',
  code: '123456',
  montant: 250000,
  statut: 'Validée',
  date: '26/08/2026 10:30',
  utilisateur: 'Caissière',
  emailUtilisateur: 'caisse@test.test',
  ...over,
})

const baseContext = (completedTransactions = []) => ({
  completedTransactions,
  getTransactionStyles: () => ({ bgColor: '', textColor: '' }),
  addTransaction: vi.fn(),
})

const dataRows = () =>
  Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelectorAll('td').length > 1)

const clientCells = () => dataRows().map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim())

const setDates = (from, to) => {
  const inputs = document.querySelectorAll('input[type="date"]')
  if (from !== null) fireEvent.change(inputs[0], { target: { value: from } })
  if (to !== null) fireEvent.change(inputs[1], { target: { value: to } })
}

beforeEach(() => {
  contextValue = baseContext()
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-116-A — structure de la page', () => {
  it('porte le titre « Historique »', () => {
    render(<Historique />)
    expect(screen.getByRole('heading', { name: 'Historique' })).toBeInTheDocument()
  })

  it('expose les 9 colonnes du tableau, dans cet ordre', () => {
    contextValue = baseContext([tx()])
    render(<Historique />)
    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    expect(headers).toEqual([
      'Date & heure', 'Client', 'Type', 'Réseau', 'Code', 'Montant', 'Statut', 'Utilisateur', 'Email utilisateur',
    ])
  })

  it('offre les commandes de filtre attendues', () => {
    render(<Historique />)
    expect(screen.getByRole('button', { name: 'Filtrer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rechercher' })).toBeInTheDocument()
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2)
  })

  it('offre l’export et l’import', () => {
    render(<Historique />)
    expect(screen.getByRole('button', { name: /Exporter/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Importer/i })).toBeInTheDocument()
  })

  it('sans transaction, affiche l’état vide et aucune ligne', () => {
    render(<Historique />)
    expect(screen.getByText("Aucune transaction dans l'historique")).toBeInTheDocument()
    expect(dataRows()).toHaveLength(0)
  })

  it('affiche toutes les transactions terminées quand aucun filtre n’est appliqué', () => {
    contextValue = baseContext([
      tx({ id: 'a', client: { nom: 'ALPHA', prenom: 'Un' } }),
      tx({ id: 'b', client: { nom: 'BETA', prenom: 'Deux' } }),
    ])
    render(<Historique />)
    expect(dataRows()).toHaveLength(2)
  })

  it('la source est completedTransactions du contexte, rien d’autre', () => {
    contextValue = baseContext([tx({ client: { nom: 'SEULE', prenom: 'Ligne' } })])
    render(<Historique />)
    expect(clientCells()).toEqual(['Ligne SEULE'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-116-B — filtre de dates : bornes INCLUSES, cadran LOCAL', () => {
  const jeu = () => [
    tx({ id: 'j1', client: { nom: 'LUNDI', prenom: 'X' }, date: '24/08/2026 08:00' }),
    tx({ id: 'j2', client: { nom: 'MARDI', prenom: 'X' }, date: '25/08/2026 09:00' }),
    tx({ id: 'j3', client: { nom: 'MERCREDI', prenom: 'X' }, date: '26/08/2026 10:00' }),
  ]

  it('la borne « Du » est incluse', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    setDates('2026-08-25', null)
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(clientCells()).toEqual(['X MARDI', 'X MERCREDI'])
  })

  it('la borne « Au » est incluse', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    setDates(null, '2026-08-25')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(clientCells()).toEqual(['X LUNDI', 'X MARDI'])
  })

  it('une seule journée ne retient que cette journée', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    setDates('2026-08-25', '2026-08-25')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(clientCells()).toEqual(['X MARDI'])
  })

  it('l’heure de la transaction est ignorée : seul le jour compte', () => {
    // 23:59 le 25 doit passer un filtre borné au 25, ce qui ne serait pas le cas
    // si on comparait des instants plutôt que des jours.
    contextValue = baseContext([tx({ id: 'tard', client: { nom: 'TARD', prenom: 'X' }, date: '25/08/2026 23:59' })])
    render(<Historique />)
    setDates('2026-08-25', '2026-08-25')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(clientCells()).toEqual(['X TARD'])
  })

  it('une ligne sans date exploitable est EXCLUE dès qu’un filtre est posé', () => {
    contextValue = baseContext([
      tx({ id: 'ok', client: { nom: 'DATEE', prenom: 'X' }, date: '25/08/2026 09:00' }),
      tx({ id: 'ko', client: { nom: 'SANSDATE', prenom: 'X' }, date: '' }),
    ])
    render(<Historique />)
    expect(dataRows()).toHaveLength(2)
    setDates('2026-08-25', '2026-08-25')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(clientCells()).toEqual(['X DATEE'])
  })

  it('« Filtrer » reste inerte tant qu’aucune date n’est saisie', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    expect(screen.getByRole('button', { name: 'Filtrer' })).toBeDisabled()
  })

  it('une plage inversée n’est pas applicable', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    setDates('2026-08-26', '2026-08-24')
    expect(screen.getByRole('button', { name: 'Filtrer' })).toBeDisabled()
  })

  it('« Aujourd’hui » vide les champs de date', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    setDates('2026-08-25', '2026-08-25')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }))
    fireEvent.click(screen.getByRole('button', { name: "Aujourd'hui" }))
    const inputs = document.querySelectorAll('input[type="date"]')
    expect(inputs[0].value).toBe('')
    expect(inputs[1].value).toBe('')
  })

  it('« Aujourd’hui » ne retient que la journée courante', () => {
    const now = new Date()
    const jj = String(now.getDate()).padStart(2, '0')
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    contextValue = baseContext([
      tx({ id: 'today', client: { nom: 'AUJOURD', prenom: 'HUI' }, date: `${jj}/${mm}/${now.getFullYear()} 10:00` }),
      tx({ id: 'old', client: { nom: 'VIEUX', prenom: 'X' }, date: '01/01/2020 10:00' }),
    ])
    render(<Historique />)
    fireEvent.click(screen.getByRole('button', { name: "Aujourd'hui" }))
    expect(clientCells()).toEqual(['HUI AUJOURD'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-116-C — recherche', () => {
  const jeu = () => [
    tx({ id: 'a', client: { nom: 'BANABA', prenom: 'Guafarou' }, code: '111111', reseau: 'Orange' }),
    tx({ id: 'b', client: { nom: 'OUEDRAOGO', prenom: 'Awa' }, code: '222222', reseau: 'Moov' }),
  ]

  it('cherche sur le nom du client, insensible à la casse', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: 'ouedraogo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(clientCells()).toEqual(['Awa OUEDRAOGO'])
  })

  it('cherche sur le prénom', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: 'guafarou' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(clientCells()).toEqual(['Guafarou BANABA'])
  })

  it('cherche sur le code réseau', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: '222222' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(clientCells()).toEqual(['Awa OUEDRAOGO'])
  })

  it('cherche sur le réseau', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: 'moov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(clientCells()).toEqual(['Awa OUEDRAOGO'])
  })

  it('ne cherche PAS sur le montant (comportement actuel, à ne pas « corriger » par mégarde)', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: '250000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(dataRows()).toHaveLength(0)
  })

  it('une recherche vide ramène tout', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher par nom/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(dataRows()).toHaveLength(2)
  })

  it('la touche Entrée déclenche la recherche', () => {
    contextValue = baseContext(jeu())
    render(<Historique />)
    const input = screen.getByPlaceholderText(/Rechercher par nom/i)
    fireEvent.change(input, { target: { value: 'awa' } })
    fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 })
    expect(clientCells()).toEqual(['Awa OUEDRAOGO'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-116-D — navigation par jour', () => {
  const joursDistincts = (n) =>
    Array.from({ length: n }, (_, i) =>
      tx({ id: `d${i}`, client: { nom: `J${i}`, prenom: 'X' }, date: `${String(i + 1).padStart(2, '0')}/07/2026 10:00` }),
    )

  it('groupe par jour et titre la section', () => {
    contextValue = baseContext(joursDistincts(3))
    render(<Historique />)
    expect(screen.getByText('Navigation par jour')).toBeInTheDocument()
  })

  it('affiche 7 jours par page', () => {
    contextValue = baseContext(joursDistincts(10))
    render(<Historique />)
    expect(screen.getByText(/Page 1 sur 2/)).toBeInTheDocument()
  })

  it('chaque carte annonce son compte de transactions', () => {
    contextValue = baseContext([
      tx({ id: 'a', date: '01/07/2026 10:00' }),
      tx({ id: 'b', date: '01/07/2026 11:00' }),
    ])
    render(<Historique />)
    // Pluriel géré à la main : « 1 transaction », « 2 transactions ».
    expect(screen.getByText(/^2 transactions$/)).toBeInTheDocument()
  })

  it('cliquer une carte filtre sur cette seule journée', () => {
    contextValue = baseContext([
      tx({ id: 'a', client: { nom: 'PREMIER', prenom: 'X' }, date: '01/07/2026 10:00' }),
      tx({ id: 'b', client: { nom: 'SECOND', prenom: 'X' }, date: '02/07/2026 10:00' }),
    ])
    render(<Historique />)
    fireEvent.click(screen.getByText('01/07/2026'))
    expect(clientCells()).toEqual(['X PREMIER'])
  })

  it('Précédent / Suivant naviguent entre les pages de jours', () => {
    contextValue = baseContext(joursDistincts(10))
    render(<Historique />)
    const suivant = screen.getByRole('button', { name: /Suivant/i })
    fireEvent.click(suivant)
    expect(screen.getByText(/Page 2 sur 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Précédent/i }))
    expect(screen.getByText(/Page 1 sur 2/)).toBeInTheDocument()
  })

  it('sans transaction, la navigation annonce l’absence de données', () => {
    render(<Historique />)
    expect(screen.getByText('Aucune transaction disponible')).toBeInTheDocument()
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-116-E — ce qui N’EXISTE PAS aujourd’hui', () => {
  // Ces absences sont volontairement figées : le §11.7 du cahier des charges
  // décrit un « Voir plus » et un `history.pageSize` que CE dépôt n'a pas. La
  // mise en sous-onglets ne doit pas les inventer au passage.

  it('aucun bouton « Voir plus » / « Charger plus »', () => {
    contextValue = baseContext(Array.from({ length: 80 }, (_, i) => tx({ id: `t${i}` })))
    render(<Historique />)
    expect(screen.queryByRole('button', { name: /Voir plus|Charger plus/i })).toBeNull()
  })

  it('l’historique n’est pas plafonné : aucune notion de page de lignes', () => {
    // 80 lignes réparties sur 3 jours : la seule pagination de la page porte sur
    // les JOURS, jamais sur les lignes du tableau.
    contextValue = baseContext(
      Array.from({ length: 80 }, (_, i) => tx({ id: `t${i}`, date: `0${(i % 3) + 1}/07/2026 10:00` })),
    )
    render(<Historique />)
    expect(dataRows().length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Voir plus|Charger plus|Page suivante/i })).toBeNull()
  })

  it('aucun sous-onglet aujourd’hui : la page est mono-vue', () => {
    contextValue = baseContext([tx()])
    render(<Historique />)
    for (const nom of ['Transactions clients', 'Opérations dealer', 'Collaborations', 'Dettes internes']) {
      expect(screen.queryByRole('button', { name: nom })).toBeNull()
    }
  })
})
