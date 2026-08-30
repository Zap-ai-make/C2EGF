/**
 * TC-119 — La barre de navigation : deux groupes, un filet, et l'invariant des
 * compteurs.
 *
 * Ce que ce fichier verrouille, et pourquoi ça vaut un test :
 *
 *   • LES DEUX GROUPES sont une donnée, pas un ordre dans un tableau. Le groupe
 *     porte l'invariant « un compteur ne peut apparaître que sur `courant` » ;
 *     si le groupe devenait décoratif, l'invariant deviendrait décoratif avec lui.
 *
 *   • L'INVARIANT LUI-MÊME. Une règle écrite en commentaire est une intention ;
 *     une règle qui fait tomber le rendu en développement est une contrainte.
 *     C'est la seule chose qui empêchera, dans six mois, une pastille « nouveau
 *     client » de s'installer sur Clients et de vider les trois autres de leur
 *     sens.
 *
 *   • LE PANNEAU MOBILE remplace un <select>. On vérifie ce que le <select> ne
 *     savait pas faire : porter un total, grouper, s'annoncer comme replié ou
 *     déplié, et se refermer quand on navigue.
 *
 *   • QU'UN SEUL `store-pending-badge` EXISTE quand le panneau est fermé. TC-041
 *     s'appuie dessus ; le panneau porte donc des testid distincts. Sans ce
 *     test, le jour où le panneau serait rendu par défaut, TC-041 tomberait sans
 *     qu'on comprenne pourquoi.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

let pendingCount = 0

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { navbar: 'navbar-stub' } }),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', name: 'Swabo Hamadou' },
  }),
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStorePendingCount: ({ onUpdate }) => {
    onUpdate(pendingCount)
    return () => {}
  },
}))
vi.mock('../../src/components/PWAInstallButton', () => ({ default: () => null }))

import NavBar, { initiales } from '../../src/components/NavBar.jsx'
import {
  STORE_NAV_ITEMS,
  STORE_ACCOUNT_ITEM,
  NAV_GROUPS,
  navItemsOfGroup,
  assertCompteurAutorise,
} from '../../src/constants/navigation.js'

const DEALER_REQUESTS_PATH = '/dealer-requests'

const renderNav = (initial = '/') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <NavBar />
      <Routes>
        <Route path="*" element={<Link to="/clients">aller aux clients</Link>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  pendingCount = 0
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-119-A — les deux groupes', () => {
  it('[NAV-01] chaque destination appartient à un groupe connu', () => {
    const groupes = Object.values(NAV_GROUPS)
    for (const item of STORE_NAV_ITEMS) {
      expect(groupes, `« ${item.name} » : groupe inconnu`).toContain(item.group)
    }
  })

  it('[NAV-02] les deux groupes sont peuplés — un filet ne sépare rien s’il est au bout', () => {
    expect(navItemsOfGroup(NAV_GROUPS.COURANT).length).toBeGreaterThan(0)
    expect(navItemsOfGroup(NAV_GROUPS.REFERENTIEL).length).toBeGreaterThan(0)
  })

  it('[NAV-03] le courant précède le référentiel dans le DOM', () => {
    renderNav()
    const nav = screen.getByRole('navigation')
    const liens = within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))
    const dernierCourant = Math.max(
      ...navItemsOfGroup(NAV_GROUPS.COURANT).map((i) => liens.indexOf(i.path)),
    )
    const premierReferentiel = Math.min(
      ...navItemsOfGroup(NAV_GROUPS.REFERENTIEL).map((i) => liens.indexOf(i.path)),
    )
    expect(dernierCourant).toBeLessThan(premierReferentiel)
  })

  it('[NAV-04] le filet est décoratif : il est masqué de l’arbre d’accessibilité', () => {
    renderNav()
    const filet = screen.getByRole('navigation').querySelector('[aria-hidden="true"].bg-white\\/25')
    expect(filet).not.toBeNull()
  })
})

describe('TC-119-B — l’invariant des compteurs', () => {
  it('[NAV-05] un compteur est autorisé sur une destination du courant', () => {
    for (const item of navItemsOfGroup(NAV_GROUPS.COURANT)) {
      expect(assertCompteurAutorise(item.path)).toBe(true)
    }
  })

  it('[NAV-06] un compteur sur une destination de consultation fait tomber le rendu', () => {
    // C'est un défaut de conception, pas une variation d'affichage : une
    // nouveauté n'est pas une attente. On préfère l'apprendre au premier rendu
    // en développement qu'au bout de six mois de pastilles qui ne veulent
    // plus rien dire.
    for (const item of navItemsOfGroup(NAV_GROUPS.REFERENTIEL)) {
      expect(() => assertCompteurAutorise(item.path)).toThrow(/Compteur interdit/)
    }
  })

  it('[NAV-07] un chemin inconnu ne fait pas tomber la barre', () => {
    // La barre n'est pas un validateur de routes. Un chemin hors liste passe.
    expect(assertCompteurAutorise('/inconnu')).toBe(true)
  })
})

describe('TC-119-C — le compteur du bureau', () => {
  it('[NAV-08] sans attente, aucune pastille', () => {
    pendingCount = 0
    renderNav()
    expect(screen.queryByTestId('store-pending-badge')).not.toBeInTheDocument()
  })

  it('[NAV-09] la pastille se pose sur « Demandes Dealer », et sur elle seule', () => {
    pendingCount = 3
    renderNav()
    const badge = screen.getByTestId('store-pending-badge')
    expect(badge).toHaveTextContent('3')
    expect(badge.closest('a')).toHaveAttribute('href', DEALER_REQUESTS_PATH)
  })

  it('[NAV-10] panneau fermé → un seul élément porte ce testid (hypothèse de TC-041)', () => {
    pendingCount = 3
    renderNav()
    expect(screen.getAllByTestId('store-pending-badge')).toHaveLength(1)
  })
})

describe('TC-119-D — le panneau mobile', () => {
  it('[NAV-11] le bouton s’annonce replié, puis déplié', () => {
    renderNav()
    const bouton = screen.getByRole('button', { name: /Menu/ })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('nav-panneau-boutique')).toBeNull()

    fireEvent.click(bouton)
    expect(bouton).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('nav-panneau-boutique')).not.toBeNull()
  })

  it('[NAV-12] replié, le bouton porte le TOTAL des attentes', () => {
    // Trois compteurs ne tiennent pas sur un bouton ; leur somme, si. C'est
    // exactement ce que le <select> ne savait pas faire — il écrivait « (3) »
    // dans le texte d'une option.
    pendingCount = 4
    renderNav()
    const total = screen.getByTestId('nav-total-badge')
    expect(total).toHaveTextContent('4')
    expect(total).toHaveAccessibleName('4 demandes en attente')
  })

  it('[NAV-13] déplié, le panneau rend les deux groupes et le détail', () => {
    pendingCount = 2
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }))
    const panneau = document.getElementById('nav-panneau-boutique')

    expect(within(panneau).getByText('Aujourd’hui')).toBeInTheDocument()
    expect(within(panneau).getByText('Consulter')).toBeInTheDocument()
    expect(
      within(panneau).getByTestId(`nav-panneau-badge-${DEALER_REQUESTS_PATH}`),
    ).toHaveTextContent('2')
  })

  it('[NAV-14] Échap referme', () => {
    renderNav()
    const bouton = screen.getByRole('button', { name: /Menu/ })
    fireEvent.click(bouton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
  })

  it('[NAV-15] naviguer referme — sinon le panneau resterait sur la page demandée', () => {
    renderNav()
    const bouton = screen.getByRole('button', { name: /Menu/ })
    fireEvent.click(bouton)
    expect(bouton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('link', { name: 'aller aux clients' }))
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('TC-119-E — le compte, hors de la rangée', () => {
  it('[NAV-16] le lien du compte pointe le profil et n’est pas une destination de la rangée', () => {
    renderNav()
    const lien = screen.getByRole('link', { name: new RegExp(STORE_ACCOUNT_ITEM.name) })
    expect(lien).toHaveAttribute('href', STORE_ACCOUNT_ITEM.path)
    expect(STORE_NAV_ITEMS.some((i) => i.path === STORE_ACCOUNT_ITEM.path)).toBe(false)
  })

  it('[NAV-17] les initiales sont décoratives : le nom accessible reste « Profil »', () => {
    renderNav()
    expect(screen.getByRole('link', { name: 'Profil' })).toBeInTheDocument()
  })

  it('[NAV-18] les initiales couvrent le nom composé, le nom simple et l’absence de nom', () => {
    expect(initiales('Swabo Hamadou')).toBe('SH')
    expect(initiales('Swabo Ali Hamadou')).toBe('SH')
    expect(initiales('Swabo')).toBe('SW')
    expect(initiales('  ')).toBe('?')
    expect(initiales(undefined)).toBe('?')
    expect(initiales(null)).toBe('?')
  })
})
