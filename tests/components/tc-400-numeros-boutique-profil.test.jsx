import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-400 — Les numéros de la boutique dans son Profil
 * (docs/superpowers/specs/2026-11-17-numeros-boutique-design.md).
 *
 * Décidé par l'utilisateur le 2026-11-17 : la boutique saisit elle-même son
 * numéro flotte et son numéro dealer Orange. Le geste passe par le réseau,
 * jamais par la file d'envoi.
 */

const lire = vi.fn()
const enregistrer = vi.fn()
vi.mock('../../src/services/numerosBoutiqueService.js', () => ({
  lireNumerosBoutique: (...a) => lire(...a),
  enregistrerNumerosBoutique: (...a) => enregistrer(...a),
}))
let enLigne = true
vi.mock('../../src/hooks/useEnLigne.js', () => ({ useEnLigne: () => enLigne }))

// Pour monter la page Profil entière (TC-400-05).
let role = 'store_admin'
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1', email: 'b1@c2egf.test', metadata: {} },
    userProfile: { role, storeId: 'store-a', name: 'Awa' },
    activeStore: role === 'store_admin' ? { id: 'store-a', name: 'Boutique A' } : null,
    logout: vi.fn(),
  }),
}))
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ themeClasses: { text: 'text-gray-900', accent: 'bg-brand-500', tableHeader: 'bg-gray-100' } }),
}))
vi.mock('../../src/hooks/useUserActivity', () => ({ useUserActivity: () => ({}) }))

import NumerosBoutique from '../../src/components/profil/NumerosBoutique.jsx'
import Profil from '../../src/pages/Profil.jsx'

const FLOTTE = 'Numéro flotte (pour appeler la boutique)'
const DEALER = 'Numéro dealer Orange (reçoit la monnaie des agents)'
const bouton = () => screen.getByRole('button', { name: 'Enregistrer' })

beforeEach(() => {
  lire.mockReset().mockResolvedValue({ flotte: '70123456', dealerOrange: '76543210' })
  enregistrer.mockReset().mockResolvedValue({ numeros: { flotte: '70998877', dealer: { Orange: '76543210' } } })
  enLigne = true
  role = 'store_admin'
})

describe('TC-400 — la carte des numéros', () => {
  it('[TC-400-01] montre les numéros lus ; rien à enregistrer tant que rien ne change', async () => {
    render(<NumerosBoutique storeId="store-a" />)
    expect(await screen.findByLabelText(FLOTTE)).toHaveValue('70123456')
    expect(screen.getByLabelText(DEALER)).toHaveValue('76543210')
    expect(lire).toHaveBeenCalledWith('store-a')
    expect(screen.getByText('L’app Oxygen les montre aux agents. Vide = rien n’est montré.')).toBeInTheDocument()
    expect(bouton()).toBeDisabled()
    // Des espaces seuls ne changent pas le numéro.
    fireEvent.change(screen.getByLabelText(FLOTTE), { target: { value: '70 12 34 56' } })
    expect(bouton()).toBeDisabled()
  })

  it('[TC-400-02] enregistre ce qui est tapé, puis le dit ; un refus du serveur s’affiche', async () => {
    render(<NumerosBoutique storeId="store-a" />)
    fireEvent.change(await screen.findByLabelText(FLOTTE), { target: { value: '70 99 88 77' } })
    fireEvent.click(bouton())
    expect(await screen.findByText('Enregistré.')).toBeInTheDocument()
    expect(enregistrer).toHaveBeenCalledWith({ flotte: '70 99 88 77', dealerOrange: '76543210' })
    // Le numéro rendu par le serveur devient la référence : plus rien à enregistrer.
    expect(screen.getByLabelText(FLOTTE)).toHaveValue('70998877')
    expect(bouton()).toBeDisabled()

    enregistrer.mockRejectedValueOnce(new Error('Numéro dealer Orange : 8 chiffres.'))
    fireEvent.change(screen.getByLabelText(DEALER), { target: { value: '7654' } })
    fireEvent.click(bouton())
    expect(await screen.findByText('Numéro dealer Orange : 8 chiffres.')).toBeInTheDocument()
    expect(screen.getByLabelText(DEALER)).toHaveValue('7654')
  })

  it('[TC-400-03] hors ligne, rien ne part', async () => {
    enLigne = false
    render(<NumerosBoutique storeId="store-a" />)
    fireEvent.change(await screen.findByLabelText(FLOTTE), { target: { value: '70998877' } })
    expect(bouton()).toBeDisabled()
  })

  it('[TC-400-04] numéros illisibles : un message, et aucun champ qu’on enregistrerait vide par-dessus les vrais', async () => {
    lire.mockRejectedValue(new Error('unavailable'))
    render(<NumerosBoutique storeId="store-a" />)
    expect(await screen.findByText('Numéros illisibles pour l’instant. Réessayez avec une connexion.')).toBeInTheDocument()
    expect(screen.queryByLabelText(FLOTTE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  })
})

describe('TC-400 — dans le Profil', () => {
  it('[TC-400-05] seul le compte boutique voit la carte', async () => {
    const { unmount } = render(<MemoryRouter><Profil /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Numéros de la boutique' })).toBeInTheDocument()
    unmount()
    role = 'system_manager'
    render(<MemoryRouter><Profil /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profil' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Numéros de la boutique' })).toBeNull()
  })
})
