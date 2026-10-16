import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-267 — le tableau du patron : celui du gérant, en lecture seule, sur toute
 * la base.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

let recoit = null
const desabonner = vi.fn()
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: {
    subscribeToAllClients: (cb) => { recoit = cb; return desabonner },
  },
}))

const { default: PatronClients } = await import('../../src/pages/admin/PatronClients.jsx')

const fiche = (over = {}) => ({
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', registeredStoreName: 'FADA',
  numeroIdentite: 'B 029', numeroPersonnel: '76548890', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga', agentCommercial: 'SORE',
  dateAjout: '04/02/2026', ...over,
})

const ecran = () => render(<MemoryRouter><PatronClients /></MemoryRouter>)

beforeEach(() => { navigate.mockClear(); recoit = null })
afterEach(cleanup)

describe('TC-267 — ce que le tableau montre', () => {
  it('[TC-267-01] 11 en-têtes, et pas de colonne Actions', () => {
    ecran()
    recoit([fiche()])
    const entetes = screen.getAllByRole('columnheader')
    expect(entetes).toHaveLength(11)
    expect(entetes.map(e => e.textContent)).not.toContain('Actions')
  })

  it('[TC-267-02] aucun bouton Modifier : le patron n’écrit rien', () => {
    ecran()
    recoit([fiche()])
    expect(screen.queryByRole('button', { name: /modifier/i })).toBeNull()
  })

  it('[TC-267-03] ni export ni import Excel', () => {
    ecran()
    recoit([fiche()])
    expect(screen.queryByRole('button', { name: /export|import/i })).toBeNull()
  })

  /**
   * ⚠ REVIEW FOCUS 3 — une fiche d'avant la séparation des champs agent. Son
   *   code dort dans `orange` ; `champsAgent` le range à la lecture. La ligne
   *   doit s'afficher, et la recherche doit la trouver.
   */
  it('[TC-267-04] une fiche ancienne (code dans `orange`) s’affiche et se trouve', () => {
    ecran()
    recoit([fiche({ codeAgent: '', numeroAgent: '', orange: '6412887' })])
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '6412887' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
  })
})

describe('TC-267 — la recherche est celle de l’application', () => {
  it('[TC-267-05] un nom complet trouve, nom et prénom étant deux champs', () => {
    ecran()
    recoit([fiche(), fiche({ id: 'c2', nom: 'KABORE', prenom: 'Alimata', codeAgent: '6503112' })])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'ouedraogo salif' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
    expect(screen.queryByText('KABORE')).toBeNull()
  })

  it('[TC-267-06] un numéro espacé égale le même numéro collé', () => {
    ecran()
    recoit([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '70 11 22 33' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
  })

  it('[TC-267-07] rien trouvé le dit', () => {
    ecran()
    recoit([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'zzzz' } })
    expect(screen.getByText(/rien trouvé|aucun/i)).toBeInTheDocument()
  })
})

describe('TC-267 — l’historique est une page', () => {
  it('[TC-267-08] le bouton navigue vers la page du client', () => {
    ecran()
    recoit([fiche()])
    fireEvent.click(screen.getByRole('button', { name: /historique de OUEDRAOGO/i }))
    expect(navigate).toHaveBeenCalledWith('/admin/clients/c1/historique')
  })
})

describe('TC-267 — le cycle de l’abonnement', () => {
  it('[TC-267-09] il se coupe au démontage', () => {
    const { unmount } = ecran()
    unmount()
    expect(desabonner).toHaveBeenCalled()
  })
})
