/**
 * TC-423 — Le compteur des demandes d'agent sur « Transactions » (demandé par
 * l'utilisateur le 2026-11-27) : rouge, il monte à chaque demande qui arrive
 * et ne compte QUE les demandes d'agent. La caissière le voit depuis
 * n'importe quel écran de la caisse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { navbar: 'navbar-stub' } }),
}))
// Le profil de C2EGF : ni demandes dealer, ni dettes internes, ni collaborations.
vi.mock('../../src/constants/storeWorkspace.js', () => ({
  STORE_NAVIGATION_VISIBILITY: { dashboard: false, standaloneClientForm: false, dealerRequests: false, internalDebts: false },
  STORE_TRANSACTION_VISIBILITY: { dealerOperations: false, collaborations: false },
  STORE_HISTORY_CONFIG: { dealer: true, dealerLabel: 'Ravitaillement', collaborations: false, internalDebts: false },
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', name: 'Awa Kabore', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStorePendingCount: () => () => {},
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribePendingSettlementsCount: () => () => {},
  subscribeIncomingCollaborationsCount: () => () => {},
}))
vi.mock('../../src/components/PWAInstallButton', () => ({ default: () => null }))

import NavBar from '../../src/components/NavBar.jsx'
import { DemandesAgentContext } from '../../src/context/demandesAgentContexte.js'

let demandes
beforeEach(() => {
  demandes = []
})

const renderNav = () =>
  render(
    <MemoryRouter initialEntries={['/historique']}>
      <DemandesAgentContext.Provider value={{ demandes, arrivees: new Map(), marquerVues: () => {} }}>
        <NavBar />
      </DemandesAgentContext.Provider>
    </MemoryRouter>,
  )

const BADGE = 'store-demandes-agent-badge'

describe('TC-423 — le compteur des demandes d’agent', () => {
  it('[TC-423-14] rouge, sur « Transactions », il compte les demandes d’agent en attente', () => {
    demandes = [{ id: 'd1' }, { id: 'd2' }, { id: 'r1', nature: 'remboursement' }]
    renderNav()
    const pastille = screen.getByTestId(BADGE)
    expect(pastille).toHaveTextContent('3')
    expect(pastille).toHaveAttribute('aria-label', '3 demandes d’agent en attente')
    expect(pastille.className).toContain('bg-danger')
    // Le compteur mène là où les demandes se traitent.
    expect(pastille.closest('a')).toHaveAttribute('href', '/transactions')
    expect(pastille.closest('a')).toHaveTextContent('Transactions')
  })

  it('[TC-423-15] aucune demande : aucune pastille ; une seule : au singulier', () => {
    renderNav()
    expect(screen.queryByTestId(BADGE)).toBeNull()
  })

  it('[TC-423-15b] une seule demande : au singulier', () => {
    demandes = [{ id: 'd1' }]
    renderNav()
    expect(screen.getByTestId(BADGE)).toHaveAttribute('aria-label', '1 demande d’agent en attente')
  })

  it('[TC-423-16] le bouton Menu du téléphone les compte aussi', () => {
    demandes = [{ id: 'd1' }, { id: 'd2' }]
    renderNav()
    expect(screen.getByTestId('nav-total-badge')).toHaveTextContent('2')
  })

  it('[TC-423-17] l’application monte l’écoute une fois pour toute la session boutique', () => {
    // Hors du fournisseur, la caisse ne verrait plus aucune demande, sans
    // erreur ni bandeau : rien d'autre ne dirait qu'il manque.
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const app = readFileSync(path.join(racine, 'src', 'App.jsx'), 'utf8')
    expect(app).toMatch(/<DemandesAgentProvider>[\s\S]*<AppContent \/>[\s\S]*<\/DemandesAgentProvider>/)
  })
})
