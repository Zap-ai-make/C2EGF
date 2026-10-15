import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-266 — le shell du patron : deux destinations, et les anciennes qui mènent
 * quelque part.
 *
 * ⚠ POURQUOI DES REDIRECTIONS PLUTÔT QUE DES 404. Un signet, un raccourci PWA
 *   ou un simple rechargement visent encore `/admin/reports`. La racine d'une
 *   application doit toujours mener quelque part — c'est le raisonnement déjà
 *   écrit dans App.jsx pour le tableau de bord boutique.
 */

vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: { Provider: ({ children }) => children },
  useAuth: () => ({ logout: vi.fn(), userProfile: { name: 'Le Patron', role: 'system_manager' } }),
}))

const { default: AdminLayout } = await import('../../src/layouts/AdminLayout.jsx')
const { ADMIN_NAV_ITEMS } = await import('../../src/constants/navigation.js')

afterEach(cleanup)

const shell = () => render(<MemoryRouter initialEntries={['/admin']}><AdminLayout /></MemoryRouter>)

describe('TC-266 — deux destinations, pas neuf', () => {
  it('[TC-266-01] la navigation ne déclare que Clients et Boutiques', () => {
    expect(ADMIN_NAV_ITEMS.map(i => i.path)).toEqual(['/admin', '/admin/boutiques'])
  })

  it('[TC-266-02] aucune entrée ne pointe vers un écran supprimé', () => {
    const partis = ['/admin/stores', '/admin/users', '/admin/dealer',
                    '/admin/dealer-inventory', '/admin/clients',
                    '/admin/history', '/admin/reports', '/admin/profile']
    const chemins = ADMIN_NAV_ITEMS.map(i => i.path)
    for (const p of partis) expect(chemins).not.toContain(p)
  })

  /** Le pouce atteint le bas de l'écran sans déplacer la main. */
  it('[TC-266-03] les onglets sont une barre, pas une barre latérale', () => {
    shell()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByLabelText(/barre latérale/i)).toBeNull()
  })

  it('[TC-266-04] aucun bouton hamburger', () => {
    shell()
    expect(screen.queryByLabelText(/ouvrir le menu/i)).toBeNull()
  })

  it('[TC-266-05] le nom et la déconnexion vivent dans le shell', () => {
    shell()
    expect(screen.getByText('Le Patron')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /déconnecter|quitter/i })).toBeInTheDocument()
  })
})

describe('TC-266 — les anciennes adresses mènent quelque part', () => {
  it('[TC-266-06] App.jsx redirige les huit anciennes vers /admin', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/App.jsx', 'utf8')
    const partis = ['stores', 'users', 'dealer', 'dealer-inventory',
                    'clients', 'history', 'reports', 'profile']
    for (const p of partis) {
      expect(source).toMatch(new RegExp(`path="/admin/${p}"[^>]*Navigate`, 's'))
    }
  })

  it('[TC-266-07] aucune page admin supprimée n’est encore importée', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/App.jsx', 'utf8')
    // Chemin d'import entier, pas le seul nom : une chaîne nue comme
    // « AdminDealer » est aussi une sous-chaîne de « StoreAdminDealerRequests »,
    // un écran boutique sans rapport qui reste importé plus haut dans ce fichier.
    for (const nom of ['pages/admin/AdminDashboard', 'pages/admin/AdminStores', 'pages/admin/AdminUsers',
                       'pages/admin/AdminDealer', 'pages/admin/AdminHistory', 'pages/admin/AdminReports',
                       'pages/admin/AdminProfile']) {
      expect(source).not.toContain(nom)
    }
  })
})
