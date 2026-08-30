/**
 * TC-122 — La page Dettes internes.
 *
 * Le fléau est déjà prouvé seul (TC-121) et le croisement des deux listes aussi
 * (TC-120). Ce fichier ne les rejoue pas : il verrouille ce que la page seule
 * décide, c'est-à-dire SES ÉTATS — et ce sont eux qui font la différence entre
 * un écran honnête et un écran qui ment.
 *
 * Les trois qui comptent :
 *
 *   • PÉRIMÉ. Un `onSnapshot` qui tombe est terminal. Sans bandeau, la page
 *     afficherait indéfiniment des chiffres morts, plausibles, et sans le dire.
 *     C'est le pire mode de défaillance d'un écran qui porte de l'argent :
 *     silencieux et crédible.
 *
 *   • REFUSÉ. `permission-denied` ne se réessaie pas. Le montrer comme une
 *     coupure passagère enverrait le gérant attendre un retour qui n'arrivera
 *     jamais. La page bascule sur un état plein, et elle le dit.
 *
 *   • DEUX FLUX, UN ÉCRAN. Un succès efface le bandeau, mais un échec DÉFINITIF
 *     ne s'efface pas : sinon le premier snapshot de l'autre flux ferait croire
 *     que la page est complète alors qu'il lui manque une moitié.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const flux = { debts: null, credits: null }
let profil = { role: 'store_admin', storeId: 'store-a', name: 'Admin' }

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: profil }),
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribeMyDebts: (options) => { flux.debts = options; return () => {} },
  subscribeMyCredits: (options) => { flux.credits = options; return () => {} },
}))

import StoreInternalDebts from '../../src/pages/store/StoreInternalDebts.jsx'
import { formatCurrency } from '../../src/utils/formatCurrency.js'

const MOI = 'store-a'

const dette = (partner, remainingAmount, extra = {}) => ({
  id: `d-${partner}-${remainingAmount}`,
  debtorStoreId: MOI,
  creditorStoreId: partner,
  creditorStoreName: partner,
  originalAmount: remainingAmount,
  settledAmount: 0,
  remainingAmount,
  status: 'open',
  createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  ...extra,
})

const creance = (partner, remainingAmount, extra = {}) => ({
  id: `c-${partner}-${remainingAmount}`,
  debtorStoreId: partner,
  debtorStoreName: partner,
  creditorStoreId: MOI,
  originalAmount: remainingAmount,
  settledAmount: 0,
  remainingAmount,
  status: 'open',
  createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  ...extra,
})

/** Fait arriver les deux flux, comme le ferait Firestore. */
const arriver = ({ debts = [], credits = [] } = {}) => {
  act(() => { flux.debts.onUpdate(debts) })
  act(() => { flux.credits.onUpdate(credits) })
}

const echouer = (err, cle = 'debts') => act(() => { flux[cle].onError(err) })

const transitoire = () => Object.assign(new Error('Coupure'), { permanent: false })
const definitive = () =>
  Object.assign(new Error('Vous n’avez pas accès à ces données.'), { permanent: true })

beforeEach(() => {
  flux.debts = null
  flux.credits = null
  profil = { role: 'store_admin', storeId: 'store-a', name: 'Admin' }
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-122-A — le chargement et le contenu', () => {
  it('[PD-01] s’abonne aux DEUX sens, pour ma boutique', () => {
    render(<StoreInternalDebts />)
    expect(flux.debts.storeId).toBe(MOI)
    expect(flux.credits.storeId).toBe(MOI)
  })

  it('[PD-02] tant qu’un seul flux est arrivé, l’écran reste en chargement', () => {
    // Rendre à moitié afficherait une position fausse — « je dois 220 000, on
    // me doit 0 » — pendant le temps que met la seconde requête.
    render(<StoreInternalDebts />)
    act(() => { flux.debts.onUpdate([dette('gounghin', 180_000)]) })
    expect(screen.queryByTestId('fleau-ligne-gounghin')).not.toBeInTheDocument()
  })

  it('[PD-03] les deux arrivés, la position est rendue', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('gounghin', 180_000)], credits: [creance('gounghin', 45_000)] })
    expect(screen.getByTestId('fleau-ligne-gounghin')).toHaveAccessibleName(
      `gounghin : je dois ${formatCurrency(135_000)}`,
    )
  })

  it('[PD-04] sans boutique au profil, aucun abonnement n’est ouvert', () => {
    profil = { role: 'store_admin', name: 'Admin' }
    render(<StoreInternalDebts />)
    expect(flux.debts).toBeNull()
  })
})

describe('TC-122-B — le dépliage', () => {
  it('[PD-05] déplier une poutre rend ses dettes ET ses créances', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('gounghin', 180_000)], credits: [creance('gounghin', 45_000)] })
    act(() => { screen.getByTestId('fleau-ligne-gounghin').click() })

    const detail = screen.getByLabelText('Dettes et créances avec gounghin')
    expect(detail).toHaveTextContent('Dette')
    expect(detail).toHaveTextContent('Créance')
  })

  it('[PD-06] une dette partiellement réglée montre son montant initial', () => {
    render(<StoreInternalDebts />)
    arriver({
      debts: [dette('g', 90_000, { originalAmount: 180_000, settledAmount: 90_000 })],
    })
    act(() => { screen.getByTestId('fleau-ligne-g').click() })
    expect(screen.getByLabelText('Dettes et créances avec g')).toHaveTextContent(
      /sur\s+180/,
    )
  })

  it('[PD-07] une dette intacte ne répète pas son montant', () => {
    // Répéter le même chiffre deux fois sur chaque ligne noierait l'information
    // dans sa propre redite.
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    act(() => { screen.getByTestId('fleau-ligne-g').click() })
    expect(screen.getByLabelText('Dettes et créances avec g')).not.toHaveTextContent(/sur/)
  })

  it('[PD-08] recliquer replie', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    const poutre = screen.getByTestId('fleau-ligne-g')
    act(() => { poutre.click() })
    act(() => { poutre.click() })
    expect(poutre).toHaveAttribute('aria-expanded', 'false')
  })

  it('[PD-09] déplier une autre poutre referme la première', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('a', 90_000), dette('b', 40_000)] })
    act(() => { screen.getByTestId('fleau-ligne-a').click() })
    act(() => { screen.getByTestId('fleau-ligne-b').click() })
    expect(screen.getByTestId('fleau-ligne-a')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('fleau-ligne-b')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('TC-122-C — périmé : on le dit', () => {
  it('[PD-10] une coupure passagère pose un bandeau, sans effacer les montants', () => {
    // Les derniers chiffres connus restent lisibles — ils sont encore la
    // meilleure information disponible. Ce qui manquait, c'est de dire qu'ils
    // ne bougent plus.
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    echouer(transitoire())

    expect(screen.getByRole('status')).toHaveTextContent(/ne se mettent plus à jour/)
    expect(screen.getByTestId('fleau-ligne-g')).toBeInTheDocument()
  })

  it('[PD-11] le bandeau donne l’heure de la dernière lecture réussie', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    echouer(transitoire())
    expect(screen.getByRole('status')).toHaveTextContent(/dernière lecture à \d/)
  })

  it('[PD-12] le retour des données efface le bandeau', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    echouer(transitoire())
    act(() => { flux.debts.onUpdate([dette('g', 40_000)]) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('TC-122-D — refusé : ça ne reviendra pas tout seul', () => {
  it('[PD-13] une erreur définitive bascule sur un état plein, pas un bandeau', () => {
    render(<StoreInternalDebts />)
    arriver({ debts: [dette('g', 40_000)] })
    echouer(definitive())

    expect(screen.getByRole('alert')).toHaveTextContent('Ces données ne s’affichent pas')
    expect(screen.queryByTestId('fleau-ligne-g')).not.toBeInTheDocument()
  })

  it('[PD-14] elle porte le message du service, qui dit que réessayer ne sert à rien', () => {
    render(<StoreInternalDebts />)
    arriver()
    echouer(definitive())
    expect(screen.getByRole('alert')).toHaveTextContent('Vous n’avez pas accès à ces données.')
  })

  it('[PD-15] un succès sur l’AUTRE flux ne l’efface pas', () => {
    // Le piège : deux abonnements, un seul état d'erreur. Si le snapshot du
    // second flux effaçait l'échec définitif du premier, la page se dirait
    // complète en n'ayant qu'une moitié des dettes — et personne ne le verrait.
    render(<StoreInternalDebts />)
    echouer(definitive(), 'debts')
    act(() => { flux.credits.onUpdate([creance('g', 40_000)]) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('[PD-16] une erreur passagère survenue après ne l’écrase pas non plus', () => {
    render(<StoreInternalDebts />)
    echouer(definitive(), 'debts')
    echouer(transitoire(), 'credits')
    expect(screen.getByRole('alert')).toHaveTextContent('Ces données ne s’affichent pas')
  })
})

describe('TC-122-E — l’écran vide', () => {
  it('[PD-17] sans dette ouverte, l’écran invite au lieu de laisser un trou', () => {
    render(<StoreInternalDebts />)
    arriver()
    expect(screen.getByText('Aucune dette ouverte')).toBeInTheDocument()
  })

  it('[PD-18] le titre et son sous-titre disent le job de la page', () => {
    render(<StoreInternalDebts />)
    arriver()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dettes internes')
    expect(screen.getByText(/ce qu’elles vous doivent/i)).toBeInTheDocument()
  })
})
