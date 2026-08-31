/**
 * TC-205 — Le formulaire de ravitaillement voit TOUT le réseau (spec S5)
 *
 * LE DÉFAUT QUE CE FICHIER A FIGÉ, PUIS CORRIGÉ
 * ─────────────────────────────────────────────
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
 * Le commit `fd8edc2` a d'abord FIGÉ ce défaut : les cinq tests ci-dessous
 * passaient au vert en décrivant le comportement fautif. Ce commit-ci les
 * retourne un par un, et chacun nomme ce qu'il remplace — c'est la seule façon
 * de prouver qu'un défaut a été corrigé, et non déplacé.
 *
 * `git show fd8edc2 -- tests/unit/tc-205-ravitaillement-toutes-boutiques.test.jsx`
 * rend la version qui décrivait le défaut.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  listAllActiveStores: vi.fn(),
  listActiveStores: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }),
  subscribeDealerBalance: vi.fn(() => vi.fn()),
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
  listAllActiveStores: mocks.listAllActiveStores,
  listActiveStores: mocks.listActiveStores,
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  createPartnerDeposit: mocks.createPartnerDeposit,
  // Ajouté en S5 : l'écran projette les cuves du dealer avant confirmation, via
  // `useDealerInventory`. CÂBLAGE seul — aucune assertion de ce fichier ne
  // dépend de l'inventaire, et l'abonnement muet laisse la projection à son
  // état « inconnu », qui est justement celui qui n'affirme rien.
  subscribeDealerBalance: mocks.subscribeDealerBalance,
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

/** Ce que `listAllActiveStores()` rend : le réseau entier, sans curseur. */
const toutLeReseau = () => ({ stores: RESEAU })

/**
 * Ce que rendait `listActiveStores()`, gardé pour l'assertion qui compte :
 * une page de 20 et un `hasMore` que l'écran ignorait.
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
  mocks.listAllActiveStores.mockResolvedValue(toutLeReseau())
  mocks.listActiveStores.mockResolvedValue(premierePage())
  mocks.createDealerRequest.mockResolvedValue({ id: 'req-1' })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-205 — le formulaire de ravitaillement atteint tout le réseau', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RV-01] CORRIGÉ — le menu propose les 84 boutiques, plus seulement 20', async () => {
    // Figé : « le menu ne propose que 20 boutiques sur 84 ».
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    expect(optionsBoutique()).toHaveLength(RESEAU.length)
    expect(optionsBoutique()).not.toHaveLength(DEALER_STORES_PAGE_SIZE)
  })

  it('[RV-02] CORRIGÉ — la 21e et la 84e boutique sont dans le menu', async () => {
    // Figé : « la 21e boutique du réseau est absente du menu ».
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    const noms = optionsBoutique().map(o => o.textContent)
    expect(noms).toContain('BOUTIQUE 20')
    expect(noms).toContain('BOUTIQUE 21')
    expect(noms).toContain('BOUTIQUE 84')
  })

  it('[RV-03] CORRIGÉ — l’écran n’appelle plus le service PAGINÉ du tout', async () => {
    // Figé : « le service n'est appelé qu'une fois : aucun curseur n'est suivi ».
    // La correction ne suit pas le curseur : elle change de requête. Boucler
    // sur `lastDoc` aurait fait cinq allers-retours pour reconstruire une liste
    // que Firestore rend en un seul — et aurait laissé en place le piège, qui
    // est d'appeler une fonction paginée là où il faut un choix complet.
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    expect(mocks.listAllActiveStores).toHaveBeenCalledTimes(1)
    expect(mocks.listActiveStores).not.toHaveBeenCalled()
  })

  it('[RV-04] CORRIGÉ — un ?storeId= au-delà de la 20e est pré-sélectionné', async () => {
    // Figé : « un ?storeId= au-delà de la page est SILENCIEUSEMENT effacé ».
    // C'est le cas qui bloquera l'action « ravitailler cette boutique » posée
    // sur les lignes de l'accueil : 64 des 84 liens ouvraient un formulaire
    // vide, sans un mot d'explication.
    renderFormulaire('/dealer/requests/new?storeId=store-40&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))

    expect(screen.getByTestId('select-store').value).toBe('store-40')
    expect(screen.queryByTestId('pre-store-introuvable')).toBeNull()
  })

  it('[RV-05] INCHANGÉ — un ?storeId= de la première page marche toujours', async () => {
    // Cette assertion était vraie AVANT la correction et doit le rester : le
    // mécanisme de pré-remplissage n'était pas en cause, seulement sa portée.
    // C'est elle qui prouve qu'on n'a pas « corrigé » ce qui marchait.
    renderFormulaire('/dealer/requests/new?storeId=store-5&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))

    expect(screen.getByTestId('select-store').value).toBe('store-5')
  })

  it('[RV-06] une boutique vraiment introuvable le DIT, au lieu de vider en silence', async () => {
    // La garde d'existence reste nécessaire — un lien peut désigner une
    // boutique fermée depuis. Ce qui change, c'est qu'elle ne se déclenche plus
    // par accident de pagination, et que lorsqu'elle se déclenche, elle parle.
    renderFormulaire('/dealer/requests/new?storeId=store-inexistante&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))

    expect(await screen.findByTestId('pre-store-introuvable')).toBeTruthy()
    expect(screen.getByTestId('select-store').value).toBe('')
  })

  it('[RV-07] le compte annoncé sous le menu est celui du réseau entier', async () => {
    renderFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))

    expect(screen.getByText(/84 boutiques actives du réseau sont listées/)).toBeTruthy()
  })
})
