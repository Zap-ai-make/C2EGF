/**
 * TC-205 — Le formulaire de ravitaillement voit-il tout le réseau ? (spec S5)
 *
 * DÉFAUT FIGÉ, TROUVÉ EN S4
 * ─────────────────────────
 * `NewDealerRequest` appelle `listActiveStores()` UNE SEULE FOIS, sans boucle de
 * pagination. Or ce service pagine à `DEALER_STORES_PAGE_SIZE = 20`. Sur le
 * réseau réel de 84 boutiques, le menu du formulaire n'en propose donc que 20,
 * et sa garde d'existence efface silencieusement un `?storeId=` qui viserait
 * l'une des 64 autres.
 *
 * Autrement dit : **le geste central de l'espace dealer ne peut pas atteindre
 * les trois quarts du réseau.** Ce n'est pas un défaut de dessin, c'est une
 * capacité manquante — et c'est pour cette raison qu'il se corrige dans son
 * propre commit, avant tout changement d'apparence (AGENTS.md : jamais
 * refactoriser et changer le comportement métier dans le même lot).
 *
 * Ce fichier FIGE le défaut tel qu'il est aujourd'hui. Le commit suivant
 * retourne chaque assertion et nomme ce qu'elle remplace : c'est la seule
 * façon de prouver qu'un défaut a été corrigé, et non déplacé.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  listActiveStores: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }),
  createPartnerDeposit: vi.fn(() => Promise.resolve({ success: true })),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})), collection: vi.fn(), collectionGroup: vi.fn(),
  doc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
  limit: vi.fn(), startAfter: vi.fn(), onSnapshot: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/dealerService', () => ({
  listActiveStores: mocks.listActiveStores,
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  createPartnerDeposit: mocks.createPartnerDeposit,
}))
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => mocks.useAuth() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import NewDealerRequest from '../../src/pages/dealer/NewDealerRequest'
import { DEALER_STORES_PAGE_SIZE } from '../../src/constants/dealerConstants'

// ---------------------------------------------------------------------------
// Le réseau réel : 84 boutiques actives.
// ---------------------------------------------------------------------------
const RESEAU = Array.from({ length: 84 }, (_, i) => ({
  id: `store-${i + 1}`,
  name: `BOUTIQUE ${i + 1}`,
  active: true,
}))

/**
 * Ce que `listActiveStores()` rend RÉELLEMENT : une page de 20, et `hasMore`.
 * Le composant ne rappelle jamais le service avec le curseur.
 */
function premierePage() {
  const page = RESEAU.slice(0, DEALER_STORES_PAGE_SIZE)
  return { stores: page, lastDoc: { id: String(page.length) }, hasMore: true }
}

const renderFormulaire = (adresse = '/dealer/requests/new') =>
  render(<MemoryRouter initialEntries={[adresse]}><NewDealerRequest /></MemoryRouter>)

const optionsBoutique = () =>
  [...screen.getByTestId('select-store').querySelectorAll('option')]
    .filter(o => o.value !== '')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue({
    currentUser: { uid: 'dealer-1' },
    userProfile: { role: 'dealer', active: true, name: 'Ousmane', email: 'o@c2egf.bf' },
  })
  mocks.listActiveStores.mockResolvedValue(premierePage())
  mocks.createDealerRequest.mockResolvedValue({ id: 'req-1' })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-205 — DÉFAUT FIGÉ : le formulaire ne voit qu’une page du réseau', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RV-01] le menu ne propose que 20 boutiques sur 84', async () => {
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    expect(optionsBoutique()).toHaveLength(DEALER_STORES_PAGE_SIZE)
    expect(optionsBoutique()).not.toHaveLength(RESEAU.length)
  })

  it('[RV-02] la 21e boutique du réseau est absente du menu', async () => {
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    const noms = optionsBoutique().map(o => o.textContent)
    expect(noms).toContain('BOUTIQUE 20')
    expect(noms).not.toContain('BOUTIQUE 21')
    expect(noms).not.toContain('BOUTIQUE 84')
  })

  it('[RV-03] le service n’est appelé QU’UNE FOIS : aucun curseur n’est suivi', async () => {
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    expect(mocks.listActiveStores).toHaveBeenCalledTimes(1)
    // `hasMore` vaut pourtant `true`, et `lastDoc` est fourni : le composant les
    // reçoit et n'en fait rien.
    expect(mocks.listActiveStores).toHaveBeenCalledWith()
  })

  it('[RV-04] un ?storeId= au-delà de la page est SILENCIEUSEMENT effacé', async () => {
    // Le pire cas : l'utilisateur arrive d'un lien qui désignait une boutique
    // précise, et le formulaire s'ouvre vide sans rien dire. Il n'y a même pas
    // de message — juste une sélection qui ne s'est pas faite.
    renderFormulaire('/dealer/requests/new?storeId=store-40&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))

    await waitFor(() => expect(screen.getByTestId('select-store').value).toBe(''))
    expect(screen.getByTestId('new-dealer-request').textContent).not.toMatch(/introuvable|indisponible/i)
  })

  it('[RV-05] un ?storeId= DANS la page est bien pré-sélectionné', async () => {
    // Le pré-remplissage fonctionne — c'est bien sa PORTÉE qui est le défaut,
    // pas le mécanisme. Cette assertion doit rester vraie après correction.
    renderFormulaire('/dealer/requests/new?storeId=store-5&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))

    expect(screen.getByTestId('select-store').value).toBe('store-5')
  })
})
