/**
 * TC-101 — Shell boutique (Layout + NavBar) : caractérisation avant refonte.
 *
 * Le lot 7 va démonter ce shell : suppression du héros de 200 px et de son image de
 * fond, la barre des soldes devenant l'en-tête collant. Ce fichier fige ce qui doit
 * SURVIVRE à cette refonte — les repères de structure et les points d'entrée de la
 * navigation — sans figer la mise en page qui, elle, va changer.
 *
 * Aucune assertion sur une classe CSS, aucune sur la position (sticky/fixed) : ce
 * sont précisément les décisions que le lot 7 doit pouvoir reprendre.
 *
 * Piège documenté ici parce qu'aucun test ne le couvrait : Layout.jsx:21 fait un
 * `document.querySelector('nav')` dans un effet pour mesurer la hauteur de la barre.
 * C'est une dépendance structurelle silencieuse — si la refonte retire l'élément
 * <nav> ou en introduit un second avant lui, la mesure casse sans bruit. Le test
 * « un seul repère de navigation » ci-dessous garde cette hypothèse explicite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let pendingCount = 0

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { navbar: 'navbar-stub', background: 'bg-stub', text: 'text-stub' },
  }),
}))
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin' } }),
}))
vi.mock('../../src/services/storeAdminDealerService.js', () => ({
  subscribeStorePendingCount: ({ onUpdate }) => {
    onUpdate(pendingCount)
    return () => {}
  },
}))
vi.mock('../../src/components/PWAInstallButton.jsx', () => ({
  default: () => null,
}))
vi.mock('../../src/hooks/useSimpleNetworkData.js', () => ({
  useSimpleNetworkData: () => ({
    networkData: {
      Orange: { stock: 140631529, liquidite: 0 },
      Liquidite: { stock: 0, liquidite: 341515014 },
    },
  }),
}))
vi.mock('../../src/components/network/NetworkCard.jsx', () => ({
  default: ({ network }) => <div data-testid={`carte-${network}`}>{network}</div>,
}))

import Layout from '../../src/components/Layout.jsx'
import { APP_NAME } from '../../src/constants/branding.js'
import { STORE_NAV_ITEMS } from '../../src/constants/navigation.js'

const renderShell = (children = <p>CONTENU</p>) =>
  render(<MemoryRouter><Layout>{children}</Layout></MemoryRouter>)

beforeEach(() => {
  pendingCount = 0
})

describe('TC-101 — repères de structure du shell', () => {
  it('affiche le wordmark du client dans la bannière', () => {
    renderShell()
    expect(within(screen.getByRole('banner')).getByText(APP_NAME)).toBeInTheDocument()
  })

  it('le wordmark vaut « C2EGF BURKINA » sous le profil réel', () => {
    renderShell()
    expect(
      within(screen.getByRole('banner')).getByText('C2EGF BURKINA'),
    ).toBeInTheDocument()
  })

  it('la page ne porte qu’un seul titre de niveau 1 : le sien', () => {
    // Le shell affichait le nom du produit en <h1>, alors que chaque page porte
    // déjà le sien (« Tableau de bord », « Liste des clients »…). Cela faisait
    // deux titres de niveau 1 par page, dont un identique partout. La marque est
    // une bannière, pas le titre du document.
    renderShell(<h1>Tableau de bord</h1>)
    const titres = screen.getAllByRole('heading', { level: 1 })
    expect(titres).toHaveLength(1)
    expect(titres[0]).toHaveTextContent('Tableau de bord')
  })

  it('expose un repère de navigation et un repère de contenu principal', () => {
    renderShell()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('un seul <nav> — hypothèse dont dépend la mesure de hauteur de Layout.jsx:21', () => {
    renderShell()
    expect(document.querySelectorAll('nav')).toHaveLength(1)
  })

  it('rend les enfants dans le contenu principal', () => {
    renderShell(<p>CONTENU BOUTIQUE</p>)
    expect(within(screen.getByRole('main')).getByText('CONTENU BOUTIQUE')).toBeInTheDocument()
  })

  it('affiche la barre des soldes opérationnels, avec une carte par réseau du profil', () => {
    renderShell()
    const soldes = screen.getByLabelText('Soldes opérationnels')
    expect(soldes).toBeInTheDocument()
    // Profil C2EGF : un seul réseau (Orange) + la carte Liquidité, toujours présente.
    expect(within(soldes).getByTestId('carte-Orange')).toBeInTheDocument()
    expect(within(soldes).getByTestId('carte-Liquidite')).toBeInTheDocument()
  })
})

describe('TC-101 — points d’entrée de la navigation', () => {
  it('propose les 7 destinations de l’espace boutique', () => {
    renderShell()
    const nav = screen.getByRole('navigation')
    for (const item of STORE_NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(item.name) })).toHaveAttribute(
        'href',
        item.path,
      )
    }
    expect(STORE_NAV_ITEMS).toHaveLength(7)
  })

  it('offre un équivalent mobile nommé, couvrant les mêmes destinations', () => {
    renderShell()
    const select = screen.getByLabelText('Navigation principale')
    // 7 destinations + l'option de consigne désactivée.
    expect(within(select).getAllByRole('option')).toHaveLength(STORE_NAV_ITEMS.length + 1)
  })

  it('sans demande en attente → aucun compteur affiché', () => {
    pendingCount = 0
    renderShell()
    expect(screen.queryByTestId('store-pending-badge')).not.toBeInTheDocument()
  })

  it('avec des demandes en attente → compteur nommé sur « Demandes Dealer »', () => {
    pendingCount = 3
    renderShell()
    const badge = screen.getByTestId('store-pending-badge')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAccessibleName('3 demandes en attente')
  })

  it('au-delà de 99 demandes → le compteur est plafonné à « 99+ »', () => {
    pendingCount = 250
    renderShell()
    expect(screen.getByTestId('store-pending-badge')).toHaveTextContent('99+')
  })
})
