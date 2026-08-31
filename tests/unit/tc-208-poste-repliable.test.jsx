/**
 * TC-208 — Le poste dealer se replie en rail.
 *
 * ⚠ CE QUE CE FICHIER PEUT ET NE PEUT PAS VÉRIFIER. jsdom n'applique aucune
 *   feuille Tailwind : `lg:hidden` n'y cache rien, et une assertion « le
 *   libellé n'est plus visible » y serait fausse pour la seule raison qu'aucune
 *   règle CSS n'existe. Ce fichier vérifie donc le CONTRAT — les attributs, les
 *   noms accessibles, la persistance, la largeur réservée au contenu — et le
 *   rendu se regarde à la capture, comme l'exige DESIGN.md §14.
 *
 * Le point qui compte le plus est [RP-07] : replier ne doit jamais faire taire
 * une cuve à sec.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { DEALER_NAV_ITEMS } from '../../src/constants/navigation'

const mocks = vi.hoisted(() => ({
  subscribeDealerPendingCount: vi.fn(),
  subscribeIncomingTransfersCount: vi.fn(),
  subscribeDealerBalance: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})), collection: vi.fn(), collectionGroup: vi.fn(),
  doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(),
  orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), onSnapshot: vi.fn(() => vi.fn()),
  runTransaction: vi.fn(), serverTimestamp: vi.fn(() => 'SERVER_TS'),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))
vi.mock('../../src/services/dealerService', () => ({
  subscribeDealerPendingCount: mocks.subscribeDealerPendingCount,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  subscribeIncomingTransfersCount: mocks.subscribeIncomingTransfersCount,
  subscribeDealerBalance: mocks.subscribeDealerBalance,
  replenishDealerInventory: vi.fn(),
  decreaseDealerInventory: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
  AuthContext: React.createContext(null),
  AuthProvider: ({ children }) => children,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import DealerLayout from '../../src/layouts/DealerLayout'

const CLE = 'dealer:barre-repliee'

const abonnement = (v) => ({ onUpdate }) => { onUpdate?.(v); return vi.fn() }

const cuves = ({ stock, liquidite }) => ({
  byNetwork: { Orange: { stock, liquidite } },
  stock, liquidite, totalLiquidite: liquidite,
  flux: { envoyeCumul: 1, revenuCumul: 0, dehors: 1, amorce: true },
})

function monter() {
  return render(<MemoryRouter initialEntries={['/dealer']}><DealerLayout /></MemoryRouter>)
}

const barre = () => document.getElementById('poste-dealer')
const bascule = () => screen.getByTestId('dealer-bascule-repli')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.useAuth.mockReturnValue({
    currentUser: { uid: 'dealer-1' },
    userProfile: { role: 'dealer', active: true, name: 'Ousmane Sawadogo', email: 'o@c2egf.bf' },
    logout: vi.fn(),
  })
  mocks.subscribeDealerPendingCount.mockImplementation(abonnement(0))
  mocks.subscribeIncomingTransfersCount.mockImplementation(abonnement(0))
  mocks.subscribeDealerBalance.mockImplementation(abonnement(cuves({ stock: 8_420_000, liquidite: 3_150_000 })))
})

describe('TC-208-RP — le repli', () => {
  it('[RP-01] dépliée par défaut : le bouton propose de replier', () => {
    monter()
    expect(barre()).toHaveAttribute('data-replie', 'false')
    expect(bascule()).toHaveAccessibleName('Replier le menu')
    expect(bascule()).toHaveAttribute('aria-expanded', 'true')
  })

  it('[RP-02] un clic replie, un autre déplie', () => {
    monter()
    fireEvent.click(bascule())
    expect(barre()).toHaveAttribute('data-replie', 'true')
    expect(bascule()).toHaveAccessibleName('Déplier le menu')
    expect(bascule()).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(bascule())
    expect(barre()).toHaveAttribute('data-replie', 'false')
    expect(bascule()).toHaveAccessibleName('Replier le menu')
  })

  it('[RP-03] le choix est écrit, et relu au montage suivant', () => {
    const vue = monter()
    fireEvent.click(bascule())
    expect(localStorage.getItem(CLE)).toBe('1')

    vue.unmount()
    monter()
    // Replier sa barre à chaque page serait un réglage qui ne se règle jamais.
    expect(barre()).toHaveAttribute('data-replie', 'true')
  })

  it('[RP-04] un stockage indisponible n’empêche pas de replier', () => {
    const vrai = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('accès refusé') },
    })
    try {
      monter()
      fireEvent.click(bascule())
      expect(barre()).toHaveAttribute('data-replie', 'true')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', vrai)
    }
  })

  it('[RP-05] le contenu récupère la largeur rendue', () => {
    const { container } = monter()
    const zone = () => container.querySelector('div:has(> main)')
    expect(zone().className).toContain('lg:pl-56')
    fireEvent.click(bascule())
    expect(zone().className).toContain('lg:pl-14')
  })
})

describe('TC-208-NOM — repliée, rien ne perd son nom', () => {
  it('[RP-06] chaque destination garde son nom complet', () => {
    monter()
    fireEvent.click(bascule())
    for (const item of DEALER_NAV_ITEMS) {
      expect(screen.getByRole('link', { name: item.name })).toBeInTheDocument()
    }
  })

  it('[RP-07] un compteur en attente reste dit, même sans chiffre affiché', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(abonnement(4))
    monter()
    fireEvent.click(bascule())
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ravitaillements — 4 ravitaillements en attente' }))
        .toBeInTheDocument(),
    )
  })

  it('[RP-08] ⚠ une cuve sous le seuil survit au repli', async () => {
    // Le seul vrai danger de ce lot : les cuves conditionnent chaque action du
    // poste. Le rail n'en montre plus les chiffres — il doit donc, au minimum,
    // continuer de DIRE qu'une cuve est à sec, et donner les deux montants à
    // qui lit à la voix.
    mocks.subscribeDealerBalance.mockImplementation(abonnement(cuves({ stock: 8_420_000, liquidite: 310_000 })))
    monter()
    fireEvent.click(bascule())
    const marqueur = await screen.findByRole('button', { name: /^Cuves :/ })
    expect(marqueur).toHaveAccessibleName(/liquidité[^;]*sous le seuil bas/)
    // Les espaces de `Intl.NumberFormat('fr-FR')` sont des insécables étroites
    // (U+202F) ; on les nomme par leur code plutôt que de les coller ici, où
    // elles seraient invisibles à la relecture.
    expect(marqueur).toHaveAccessibleName(/8[\s\u202f\u00a0]420[\s\u202f\u00a0]000/)
  })

  it('[RP-09] le marqueur des cuves déplie la barre', async () => {
    monter()
    fireEvent.click(bascule())
    fireEvent.click(await screen.findByRole('button', { name: /^Cuves :/ }))
    expect(barre()).toHaveAttribute('data-replie', 'false')
  })

  it('[RP-10] l’action principale et la déconnexion gardent leur nom', () => {
    monter()
    fireEvent.click(bascule())
    expect(screen.getByRole('link', { name: 'Nouveau ravitaillement' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
  })

  it('[RP-11] les intertitres de groupe restent dans l’arbre, ils ne sont pas supprimés', () => {
    monter()
    fireEvent.click(bascule())
    // `sr-only`, pas `display:none` : le groupe porte l'invariant des compteurs
    // (cf. navigation.js), et qui ne voit pas le rail perdrait la structure.
    expect(screen.getByText('Distribuer')).toBeInTheDocument()
    expect(screen.getByText('Consulter')).toBeInTheDocument()
  })
})

describe('TC-208-ICO — le rail ne peut pas avoir de trou', () => {
  it('[RP-12] toute destination du menu a une icône', () => {
    // Un rail est une colonne d'icônes : une destination sans icône y est une
    // case vide et cliquable. L'assertion vit aussi dans le module, en
    // développement ; ici elle est tenue par le test.
    const { container } = monter()
    const liens = DEALER_NAV_ITEMS.map(i =>
      container.querySelector(`a[href="${i.path}"]`) ?? screen.getByRole('link', { name: i.name }),
    )
    for (const [i, lien] of liens.entries()) {
      expect(lien.querySelector('svg'), `« ${DEALER_NAV_ITEMS[i].name} » n’a pas d’icône`).toBeTruthy()
    }
  })
})
