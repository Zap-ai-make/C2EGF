import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

/**
 * TC-246 — « Annuler » à l'écran, et le chronomètre arrêté dans l'historique.
 *
 * LE MOT DE LA BOUTIQUE
 * ─────────────────────
 * La boutique dit « annuler ». Le registre, lui, continue d'écrire deux statuts
 * distincts — « Supprimée » pour une saisie fausse qu'on corrige, « Annulée »
 * pour une décision métier assumée. Ces tests figent le VOCABULAIRE VISIBLE ;
 * les statuts stockés sont protégés ailleurs (TC-222, TC-223), et ce partage
 * est délibéré : confondre les deux en base effacerait une information que
 * personne ne pourrait reconstituer ensuite.
 *
 * ⚠ LE PIÈGE QUE CE FICHIER GARDE FERMÉ.
 *   Le bouton qui REFERME une confirmation s'appelait « Annuler ». Le geste qui
 *   AGIT s'appelle désormais ainsi. Deux « Annuler » côte à côte, dont l'un
 *   détruit et l'autre renonce, est un piège à clic — et « Fermer » ne marchait
 *   pas non plus, la croix du dialogue le portant déjà. D'où « Garder ».
 */

let transactionsValue

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import CorbeilleTable from '../../src/components/historique/CorbeilleTable.jsx'

const CLIENT = { nom: 'Ouedraogo', prenom: 'Aïssata' }
const DEPART = Date.parse('2026-10-08T14:24:00Z')

const horodatage = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })

const terminee = (over = {}) => ({
  id: 'h-1',
  clientId: 'c-1',
  client: CLIENT,
  type: 'Dépôt',
  code: '000111',
  montant: 10_000,
  statut: 'Encaissé par Cash',
  date: '08/10/2026 14:24',
  createdAt: horodatage(DEPART),
  validatedAt: horodatage(DEPART + 7 * 60_000 + 12_000),
  ...over,
})

const brouillon = (over = {}) => ({
  id: 'd-1',
  clientId: 'c-1',
  client: CLIENT,
  type: 'Dépôt',
  montant: 10_000,
  statut: 'Non terminée',
  date: '08/10/2026 14:24',
  createdAt: horodatage(Date.now()),
  ...over,
})

const contexteHistorique = (lignes) => ({
  completedTransactions: lignes,
  trashTransaction: vi.fn().mockResolvedValue(true),
  getTransactionStyles: () => ({ textColor: '' }),
})

const contexteAttente = (lignes) => ({
  pendingTransactions: lignes,
  loading: false,
  getActionButtons: () => ({ encaisser: true }),
  getTransactionStyles: () => ({ textColor: '' }),
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn().mockResolvedValue(true),
})

const corps = () => document.querySelector('tbody')

beforeEach(() => { transactionsValue = null })

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-246 — le mot « Annuler » a remplacé « Supprimer »', () => {
  it('[TC-246-1] sur une transaction non terminée', () => {
    transactionsValue = contexteAttente([brouillon()])
    render(<TransactionTable />)

    expect(screen.getByTestId('supprimer-non-terminee')).toHaveTextContent('Annuler')
    expect(within(corps()).queryByText('Supprimer')).not.toBeInTheDocument()
  })

  it('[TC-246-2] sur une ligne d’historique', () => {
    transactionsValue = contexteHistorique([terminee()])
    render(<HistoriqueTable transactions={[terminee()]} />)

    expect(screen.getByTestId('supprimer-historique')).toHaveTextContent('Annuler')
  })

  it('[TC-246-3] et dans la corbeille, sur la colonne qui horodate le geste', () => {
    transactionsValue = contexteHistorique([])
    render(<CorbeilleTable transactions={[terminee({ deletedAt: horodatage(DEPART), origin: 'history' })]} />)

    const entetes = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    expect(entetes).toContain('Annulée')
    expect(entetes).not.toContain('Supprimée')
  })
})

describe('TC-246 — la confirmation ne propose pas deux fois le même mot', () => {
  const ouvrirDepuisHistorique = () => {
    transactionsValue = contexteHistorique([terminee()])
    render(<HistoriqueTable transactions={[terminee()]} />)
    fireEvent.click(screen.getByTestId('supprimer-historique'))
  }

  it('[TC-246-4] un seul bouton porte « Annuler » comme action', () => {
    ouvrirDepuisHistorique()

    // La croix du dialogue porte « Fermer », le bouton de renoncement
    // « Garder », et l'action nomme son sujet.
    expect(screen.getByTestId('confirmer-supprimer')).toHaveTextContent('Annuler la transaction')
    expect(screen.getByRole('button', { name: 'Garder' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument()
  })

  it('[TC-246-5] renoncer ne défait rien', () => {
    ouvrirDepuisHistorique()
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }))

    expect(transactionsValue.trashTransaction).not.toHaveBeenCalled()
  })

  it('[TC-246-6] même chose sur les non terminées', () => {
    transactionsValue = contexteAttente([brouillon()])
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('supprimer-non-terminee'))

    expect(screen.getByTestId('confirmer-supprimer-non-terminee')).toHaveTextContent('Annuler la transaction')
    expect(screen.getByRole('button', { name: 'Garder' })).toBeInTheDocument()
  })
})

describe('TC-246 — la durée dans l’historique', () => {
  /**
   * Le chronomètre qui tournait dans les non terminées s'arrête quand la
   * transaction est réglée. C'est cette mesure-là qu'on veut relire : sans
   * elle, le seul chiffre que la boutique voulait — combien de temps ça a
   * pris — disparaissait à l'instant où il devenait définitif.
   */
  it('[TC-246-7] une transaction qui a attendu montre sa durée', () => {
    transactionsValue = contexteHistorique([terminee()])
    render(<HistoriqueTable transactions={[terminee()]} />)

    expect(screen.getByTestId('duree-transaction')).toHaveTextContent('00:07:12')
  })

  it('[TC-246-8] et le départ comme l’arrivée', () => {
    transactionsValue = contexteHistorique([terminee()])
    render(<HistoriqueTable transactions={[terminee()]} />)

    const cellule = screen.getByTestId('duree-transaction').textContent
    expect(cellule).toContain('14:24')
    expect(cellule).toContain('14:31')
  })

  /**
   * ⚠ UNE VALIDATION DIRECTE N'A PAS DE DURÉE, et c'est le point de tout le
   *   lot : elle n'est jamais passée par les non terminées, donc aucun
   *   chronomètre n'a tourné. Le serveur l'écrit sans `validatedAt` — la
   *   marque est déjà dans les données, aucun seuil n'a eu à être inventé.
   */
  it('[TC-246-9] une validation directe n’en montre aucune', () => {
    const directe = terminee({ validatedAt: undefined, directValidation: true, statut: 'Validée' })
    transactionsValue = contexteHistorique([directe])
    render(<HistoriqueTable transactions={[directe]} />)

    expect(screen.queryByTestId('duree-transaction')).not.toBeInTheDocument()
  })

  it('[TC-246-10] la colonne existe quand même, pour que le tableau reste droit', () => {
    const directe = terminee({ validatedAt: undefined, directValidation: true })
    transactionsValue = contexteHistorique([directe])
    render(<HistoriqueTable transactions={[directe]} />)

    const entetes = Array.from(document.querySelectorAll('thead th'))
    const cellules = Array.from(document.querySelectorAll('tbody tr')[0].querySelectorAll('td'))
    expect(cellules).toHaveLength(entetes.length)
  })
})
