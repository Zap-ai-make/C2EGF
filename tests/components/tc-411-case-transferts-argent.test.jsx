import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * TC-411 — la case « Western Union, Ria, MoneyGram et autres » de
 * Profil → Configuration (docs/superpowers/specs/2026-11-23-transferts-argent-design.md,
 * « Profil → Configuration »). Elle enregistre au clic, par le réseau, jamais
 * par la file ; sans réseau elle reste dans son état d'avant.
 */

const enregistrer = vi.fn()
vi.mock('../../src/services/reglagesBoutiqueService.js', () => ({
  enregistrerTransfertsArgent: (...a) => enregistrer(...a),
  rafraichirFicheBoutique: () => Promise.resolve(),
}))
let enLigne = true
vi.mock('../../src/hooks/useEnLigne.js', () => ({ useEnLigne: () => enLigne }))
let actifProfil = true
vi.mock('../../src/utils/transfertArgent.js', async (original) => ({
  ...(await original()),
  get TRANSFERT_ARGENT_ACTIF() { return actifProfil },
}))
let boutique
const mettreAJourBoutique = vi.fn((champs) => { boutique = { ...boutique, ...champs } })
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ activeStore: boutique, mettreAJourBoutique }),
}))

import CaseTransfertsArgent from '../../src/components/profil/CaseTransfertsArgent.jsx'

const LIBELLE = 'Western Union, Ria, MoneyGram et autres'
const caseACocher = () => screen.getByRole('checkbox', { name: LIBELLE })

beforeEach(() => {
  enregistrer.mockReset().mockImplementation(async (actif) => ({ transfertsArgent: actif }))
  mettreAJourBoutique.mockClear()
  enLigne = true
  actifProfil = true
  boutique = { id: 'store-a', name: 'Boutique A', transfertsArgent: true }
})

describe('TC-411 — la case de Configuration', () => {
  it('[TC-411-01] cochée d’après la fiche ; un clic enregistre, le dit, et met la boutique à jour', async () => {
    render(<CaseTransfertsArgent />)
    expect(caseACocher()).toBeChecked()
    expect(screen.getByText('Ajoute un onglet dans « Enregistrer une transaction ».')).toBeInTheDocument()
    fireEvent.click(caseACocher())
    expect(await screen.findByText('Enregistré.')).toBeInTheDocument()
    expect(enregistrer).toHaveBeenCalledWith(false)
    expect(mettreAJourBoutique).toHaveBeenCalledWith({ transfertsArgent: false })
  })

  it('[TC-411-02] hors ligne : « Connexion nécessaire. », rien n’est envoyé, la case ne bouge pas', () => {
    enLigne = false
    render(<CaseTransfertsArgent />)
    fireEvent.click(caseACocher())
    expect(screen.getByText('Connexion nécessaire.')).toBeInTheDocument()
    expect(enregistrer).not.toHaveBeenCalled()
    expect(caseACocher()).toBeChecked()
  })

  it('[TC-411-03] refus du serveur : son message, la case revient', async () => {
    enregistrer.mockRejectedValueOnce(new Error('Seul le compte boutique modifie ses réglages.'))
    render(<CaseTransfertsArgent />)
    fireEvent.click(caseACocher())
    expect(await screen.findByText('Seul le compte boutique modifie ses réglages.')).toBeInTheDocument()
    expect(caseACocher()).toBeChecked()
    expect(mettreAJourBoutique).not.toHaveBeenCalled()
  })

  it('[TC-411-04] drapeau de profil éteint : rien n’est rendu', () => {
    actifProfil = false
    const { container } = render(<CaseTransfertsArgent />)
    expect(container).toBeEmptyDOMElement()
  })
})
