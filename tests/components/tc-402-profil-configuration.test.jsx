import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-402 — Le Profil allégé et sa carte Configuration
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Le Profil »).
 *
 * Demandé par l'utilisateur le 2026-11-23 : retirer « ID utilisateur »,
 * « Statut du compte » et la carte « Activité » ; regrouper ce qui se règle
 * dans une carte « Configuration », visible du seul compte boutique.
 */

vi.mock('../../src/services/numerosBoutiqueService.js', () => ({
  lireNumerosBoutique: () => Promise.resolve({ flotte: '', dealerOrange: '' }),
  enregistrerNumerosBoutique: vi.fn(),
}))
vi.mock('../../src/hooks/useEnLigne.js', () => ({ useEnLigne: () => true }))

let role = 'store_admin'
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1', email: 'b1@c2egf.test', emailVerified: false, metadata: {} },
    userProfile: { role, storeId: 'store-a', name: 'Awa' },
    activeStore: role === 'store_admin' ? { id: 'store-a', name: 'Boutique A' } : null,
    logout: vi.fn(),
  }),
}))
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ themeClasses: { text: 'text-gray-900', accent: 'bg-brand-500', tableHeader: 'bg-gray-100' } }),
}))

import Profil from '../../src/pages/Profil.jsx'

const monter = () => render(<MemoryRouter><Profil /></MemoryRouter>)

beforeEach(() => {
  role = 'store_admin'
})

describe('TC-402 — Profil et Configuration', () => {
  it('[TC-402-01] ni ID utilisateur, ni Statut du compte, ni Activité', async () => {
    monter()
    await screen.findByRole('heading', { name: 'Configuration' })
    expect(screen.queryByText('ID Utilisateur')).toBeNull()
    expect(screen.queryByText('u1')).toBeNull()
    expect(screen.queryByText('Statut du compte')).toBeNull()
    expect(screen.queryByText('Email non vérifié')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Activité' })).toBeNull()
    expect(screen.getByText('Date de création')).toBeInTheDocument()
    expect(screen.getByText('Dernière connexion')).toBeInTheDocument()
  })

  it('[TC-402-02] les numéros vivent dans la carte Configuration', async () => {
    monter()
    const carte = screen.getByRole('region', { name: 'Configuration' })
    expect(await within(carte).findByRole('heading', { name: 'Numéros de la boutique', level: 3 })).toBeInTheDocument()
  })

  it('[TC-402-03] system_manager : pas de carte Configuration', async () => {
    role = 'system_manager'
    monter()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profil' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Configuration' })).toBeNull()
  })
})
