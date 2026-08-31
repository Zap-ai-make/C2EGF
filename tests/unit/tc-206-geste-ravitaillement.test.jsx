/**
 * TC-206 — Le geste de ravitaillement (spec S5, « Le geste »).
 *
 * Trois choses, dans cet ordre :
 *   §CU — la projection des cuves, PURE. C'est elle qui décide si l'écran
 *         alerte, et c'est elle qui pourrait mentir : une cuve annoncée
 *         suffisante alors qu'elle ne l'est pas envoie le dealer se faire
 *         refuser par la boutique ; l'inverse l'envoie reconstituer une cuve qui
 *         n'en a pas besoin.
 *   §GE — le geste sur l'écran : arriver pré-rempli, ne plus voir de champ
 *         « Réseau » en mono, et lire l'état de ses cuves avant de confirmer.
 *   §AC — le raccourci depuis les lignes de l'accueil, retenu en S4 tant que le
 *         formulaire ne voyait que 20 boutiques sur 84.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  projeterRavitaillement,
  projeterOperationPartenaire,
  champDebite,
  ETATS_CUVE,
  MOMENTS,
} from '../../src/utils/cuvesApresEnvoi'
import { shapeDealerInventory } from '../../src/utils/dealerInventory'

const SEUIL = 500000

/** Un inventaire réel, tel que `subscribeDealerBalance` le livre à l'UI. */
const inventaire = ({ stock = 0, liquidite = 0, envoye = 0, revenu = 0 } = {}) =>
  shapeDealerInventory({
    balances: { Orange: { stock, liquidite } },
    flux: { envoyeCumul: envoye, revenuCumul: revenu },
  })

// ===========================================================================
// §CU — la projection des cuves (pure)
// ===========================================================================

describe('TC-206-CU — projection des cuves du dealer', () => {
  it('[CU-01] stock_add débite le stock, liquidity_add la liquidité', () => {
    expect(champDebite('stock_add')).toBe('stock')
    expect(champDebite('liquidity_add')).toBe('liquidite')
    expect(champDebite('open_day')).toBeNull()
  })

  it('[CU-02] cuve confortable → un seul mouvement, à la confirmation', () => {
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 1_000_000,
      inventaire: inventaire({ stock: 12_000_000, liquidite: 4_000_000, envoye: 3_000_000 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.SUFFISANT)
    expect(p.moment).toBe(MOMENTS.CONFIRMATION)
    expect(p.mouvements).toHaveLength(1)
    expect(p.mouvements[0]).toMatchObject({ champ: 'stock', avant: 12_000_000, apres: 11_000_000 })
    expect(p.manque).toBeNull()
  })

  it('[CU-03] la liquidité ne bouge PAS sur un ajout de stock', () => {
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 500_000,
      inventaire: inventaire({ stock: 9_000_000, liquidite: 77, envoye: 1 }),
    })
    expect(p.mouvements.map(m => m.champ)).toEqual(['stock'])
  })

  it('[CU-04] montant supérieur à la cuve → INSUFFISANT et le manque exact', () => {
    const p = projeterRavitaillement({
      requestType: 'liquidity_add',
      montant: 2_000_000,
      inventaire: inventaire({ stock: 9_000_000, liquidite: 1_660_000, envoye: 1 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.INSUFFISANT)
    expect(p.manque).toBe(340_000)
  })

  it('[CU-05] l’insuffisance PRIME sur le seuil bas (un refus n’est pas un conseil)', () => {
    // 100 000 restant serait « sous le seuil » ; mais la cuve ne couvre même pas
    // le montant, donc c'est le refus qui doit être annoncé.
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 900_000,
      inventaire: inventaire({ stock: 800_000, envoye: 1 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.INSUFFISANT)
  })

  it('[CU-06] passe juste sous le seuil bas → SOUS_SEUIL, l’envoi reste possible', () => {
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 600_000,
      inventaire: inventaire({ stock: 1_000_000, envoye: 1 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.SOUS_SEUIL)
    expect(p.mouvements[0].apres).toBe(400_000)
    expect(p.seuil).toBe(SEUIL)
  })

  it('[CU-07] pile SUR le seuil n’est pas sous le seuil (borne stricte)', () => {
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 500_000,
      inventaire: inventaire({ stock: 1_000_000, envoye: 1 }),
    })
    expect(p.mouvements[0].apres).toBe(SEUIL)
    expect(p.etat).toBe(ETATS_CUVE.SUFFISANT)
  })

  it('[CU-08] cuve à zéro SANS flux amorcé → INCONNU, on n’affirme rien', () => {
    // Un document absent et une cuve vide se ressemblent exactement dans l'UI,
    // et mènent à des issues opposées côté serveur. On ne tranche pas.
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 100_000,
      inventaire: inventaire({ stock: 0 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.INCONNU)
    expect(p.manque).toBeNull()
  })

  it('[CU-09] cuve à zéro AVEC flux amorcé → le document existe, donc INSUFFISANT', () => {
    // Les compteurs de flux ne s'écrivent que sur un document existant : leur
    // présence prouve que le zéro est une vraie cuve vide.
    const p = projeterRavitaillement({
      requestType: 'stock_add',
      montant: 100_000,
      inventaire: inventaire({ stock: 0, envoye: 5_000_000, revenu: 5_000_000 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.INSUFFISANT)
    expect(p.manque).toBe(100_000)
  })

  it('[CU-10] montant invalide → aucun mouvement inventé', () => {
    for (const montant of [null, 0, -1, 1000.5, NaN, Infinity]) {
      const p = projeterRavitaillement({
        requestType: 'stock_add', montant, inventaire: inventaire({ stock: 9_000_000, envoye: 1 }),
      })
      expect(p.mouvements).toHaveLength(0)
      expect(p.etat).toBe(ETATS_CUVE.INCONNU)
    }
  })

  it('[CU-11] dépôt partenaire : stock −M, liquidité +M, IMMÉDIAT', () => {
    const p = projeterOperationPartenaire({
      operation: 'deposit', montant: 300_000, inventaire: inventaire({ stock: 2_000_000, liquidite: 700_000 }),
    })
    expect(p.moment).toBe(MOMENTS.IMMEDIAT)
    expect(p.mouvements).toEqual([
      { champ: 'stock', avant: 2_000_000, apres: 1_700_000, debitee: true },
      { champ: 'liquidite', avant: 700_000, apres: 1_000_000, debitee: false },
    ])
  })

  it('[CU-12] retrait partenaire : le sens s’inverse, et c’est la liquidité qui doit suffire', () => {
    const p = projeterOperationPartenaire({
      operation: 'withdrawal', montant: 800_000, inventaire: inventaire({ stock: 2_000_000, liquidite: 700_000 }),
    })
    expect(p.mouvements).toEqual([
      { champ: 'stock', avant: 2_000_000, apres: 2_800_000, debitee: false },
      { champ: 'liquidite', avant: 700_000, apres: -100_000, debitee: true },
    ])
    expect(p.etat).toBe(ETATS_CUVE.INSUFFISANT)
    expect(p.manque).toBe(100_000)
  })

  it('[CU-13] partenaire : un zéro est un refus, amorçage ou non (aucune garde côté serveur)', () => {
    const p = projeterOperationPartenaire({
      operation: 'deposit', montant: 10_000, inventaire: inventaire({ stock: 0 }),
    })
    expect(p.etat).toBe(ETATS_CUVE.INSUFFISANT)
  })
})

// ===========================================================================
// §GE — le geste sur l'écran
// ===========================================================================

const mocks = vi.hoisted(() => ({
  listAllActiveStores: vi.fn(),
  createDealerRequest: vi.fn(),
  createPartnerDeposit: vi.fn(),
  parseDealerAmount: vi.fn(),
  subscribeDealerBalance: vi.fn(),
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
  listActiveStores: vi.fn(),
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  createPartnerDeposit: mocks.createPartnerDeposit,
  subscribeDealerBalance: mocks.subscribeDealerBalance,
}))
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => mocks.useAuth() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import NewDealerRequest from '../../src/pages/dealer/NewDealerRequest'
import CaissesReseau, { phraseAccessible } from '../../src/components/dealer/CaissesReseau'

const BOUTIQUES = Array.from({ length: 84 }, (_, i) => ({
  id: `store-${i}`, name: `BOUTIQUE ${i}`, active: true,
}))

/** Pose l'inventaire que le hook recevra. */
function poserCuves(inv) {
  mocks.subscribeDealerBalance.mockImplementation(({ onUpdate }) => {
    onUpdate?.(inv)
    return vi.fn()
  })
}

function ouvrir(url = '/dealer/requests/new') {
  return render(
    <MemoryRouter initialEntries={[url]}><NewDealerRequest /></MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue({
    currentUser: { uid: 'dealer-1' },
    userProfile: { role: 'dealer', active: true, email: 'd@t.test', name: 'D' },
  })
  mocks.listAllActiveStores.mockResolvedValue({ stores: BOUTIQUES })
  mocks.createDealerRequest.mockResolvedValue({ id: 'req-1' })
  mocks.parseDealerAmount.mockImplementation(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  })
  poserCuves(inventaire({ stock: 12_000_000, liquidite: 8_000_000, envoye: 40_000_000, revenu: 31_000_000 }))
})

describe('TC-206-GE — le formulaire pré-rempli', () => {
  it('[GE-01] ?storeId=&type= → boutique ET ressource déjà choisies, montant seul à saisir', async () => {
    ouvrir('/dealer/requests/new?storeId=store-57&type=liquidity_add')
    await waitFor(() => screen.getByTestId('select-store'))

    expect(screen.getByTestId('select-store').value).toBe('store-57')
    expect(screen.getByTestId('input-amount').value).toBe('')
    const radio = within(screen.getByTestId('radio-type-liquidity_add')).getByRole('radio')
    expect(radio.checked).toBe(true)
  })

  it('[GE-02] le curseur arrive dans le champ Montant', async () => {
    ouvrir('/dealer/requests/new?storeId=store-57&type=stock_add')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('input-amount')))
  })

  it('[GE-03] le saut de focus est ANNONCÉ, il ne laisse pas le lecteur d’écran sans contexte', async () => {
    ouvrir('/dealer/requests/new?storeId=store-57&type=stock_add')
    const annonce = await screen.findByTestId('pre-rempli')
    expect(annonce.getAttribute('role')).toBe('status')
    expect(annonce.textContent).toContain('BOUTIQUE 57')
    expect(annonce.textContent.toLowerCase()).toContain('ajout de stock')
  })

  it('[GE-04] sans pré-remplissage : ni annonce, ni saut de focus', async () => {
    ouvrir('/dealer/requests/new')
    await waitFor(() => screen.getByTestId('select-store'))
    expect(screen.queryByTestId('pre-rempli')).toBeNull()
    expect(document.activeElement).not.toBe(screen.getByTestId('input-amount'))
  })

  it('[GE-05] ?type= inconnu → rien n’est pré-choisi, et surtout rien d’inventé', async () => {
    ouvrir('/dealer/requests/new?storeId=store-3&type=open_day')
    await waitFor(() => screen.getByTestId('select-store'))
    expect(screen.queryByTestId('pre-rempli')).toBeNull()
    expect(within(screen.getByTestId('radio-type-stock_add')).getByRole('radio').checked).toBe(false)
    expect(within(screen.getByTestId('radio-type-liquidity_add')).getByRole('radio').checked).toBe(false)
  })

  it('[GE-07] l’action est suivie d’un message, avec le MÊME MOT que le bouton', async () => {
    // Le bouton dit « Confirmer » ; le message dit « confirmé ». Un
    // « Opération réussie » obligerait à faire le rapprochement soi-même.
    ouvrir('/dealer/requests/new?storeId=store-9&type=liquidity_add')
    await waitFor(() => screen.getByTestId('select-store'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '750000' } })
    fireEvent.click(screen.getByTestId('btn-review'))
    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    const [chemin, options] = mocks.navigate.mock.calls.at(-1)
    expect(chemin).toBe('/dealer/requests')
    expect(options.replace).toBe(true)
    expect(options.state.message).toMatch(/confirmé/i)
    expect(options.state.message).toMatch(/BOUTIQUE 9/)
    expect(options.state.message).toMatch(/750.000/)
  })

  it('[GE-06] mono-réseau : aucun champ Réseau, et la valeur part quand même', async () => {
    ouvrir('/dealer/requests/new?storeId=store-2&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))
    expect(screen.queryByTestId('network-display')).toBeNull()
    expect(screen.queryByTestId('select-network')).toBeNull()

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '250000' } })
    fireEvent.click(screen.getByTestId('btn-review'))
    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))

    await waitFor(() => {
      expect(mocks.createDealerRequest).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'Orange', targetStoreId: 'store-2', requestType: 'stock_add', amount: 250000 }),
      )
    })
  })
})

describe('TC-206-CV — les cuves avant de confirmer', () => {
  async function allerAConfirmation({ montant, type = 'stock_add' }) {
    ouvrir(`/dealer/requests/new?storeId=store-4&type=${type}`)
    await waitFor(() => screen.getByTestId('select-store'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: montant } })
    fireEvent.click(screen.getByTestId('btn-review'))
    return screen.findByTestId('cuves-apres-envoi')
  }

  it('[CV-01] la confirmation montre le stock avant et après', async () => {
    const bloc = await allerAConfirmation({ montant: '1000000' })
    expect(bloc.dataset.etat).toBe(ETATS_CUVE.SUFFISANT)
    expect(bloc.textContent).toMatch(/12.000.000/)
    expect(bloc.textContent).toMatch(/11.000.000/)
  })

  it('[CV-02] elle dit que le débit n’a lieu qu’à la confirmation de la boutique', async () => {
    const bloc = await allerAConfirmation({ montant: '1000000' })
    // Le moment est la chose qu'on lit de travers : le solde ne bouge pas à
    // l'envoi, et peut ne jamais bouger si la boutique rejette.
    expect(bloc.textContent).toMatch(/confirmera/i)
  })

  it('[CV-03] envoi qui passe sous le seuil bas → le mot « seuil » est écrit', async () => {
    poserCuves(inventaire({ stock: 900_000, liquidite: 8_000_000, envoye: 1 }))
    const bloc = await allerAConfirmation({ montant: '600000' })
    expect(bloc.dataset.etat).toBe(ETATS_CUVE.SOUS_SEUIL)
    expect(screen.getByTestId('cuves-sous-seuil').textContent).toMatch(/seuil bas/i)
  })

  it('[CV-04] cuve insuffisante → le manque est chiffré, et le refus annoncé', async () => {
    poserCuves(inventaire({ stock: 1_660_000, liquidite: 8_000_000, envoye: 1 }))
    const bloc = await allerAConfirmation({ montant: '2000000' })
    expect(bloc.dataset.etat).toBe(ETATS_CUVE.INSUFFISANT)
    expect(screen.getByTestId('cuves-insuffisant').textContent).toMatch(/340.000/)
    expect(bloc.textContent).toMatch(/ne pourra pas confirmer/i)
  })

  it('[CV-04b] cuve insuffisante → AUCUN solde résultant n’est affiché', async () => {
    // Le défaut que ce test fige : le bloc chiffrait le « après » dans tous les
    // cas, et annonçait donc « 1 660 000 → -340 000 FCFA ». Une cuve ne devient
    // pas négative — le serveur refuse l'opération et le solde ne bouge pas.
    // Ce nombre décrivait un état qui n'existera jamais.
    poserCuves(inventaire({ stock: 1_660_000, liquidite: 8_000_000, envoye: 1 }))
    const bloc = await allerAConfirmation({ montant: '2000000' })
    expect(bloc.textContent).not.toMatch(/-\s?340/)
    expect(bloc.textContent).not.toMatch(/−/)
    expect(bloc.querySelector('.sr-only')).toBeNull() // pas de « passe à »
    expect(bloc.textContent).toMatch(/1.660.000/)     // la cuve réelle, elle, est là
  })

  it('[CV-05] inventaire sans aucun mouvement → le bloc dit qu’il ne sait pas', async () => {
    poserCuves(inventaire({ stock: 0, liquidite: 0 }))
    await allerAConfirmation({ montant: '2000000' })
    expect(screen.getByTestId('cuves-inconnu')).toBeInTheDocument()
    expect(screen.queryByTestId('cuves-insuffisant')).toBeNull()
  })

  it('[CV-06] le bloc informe, il n’interrompt pas (status, pas alert)', async () => {
    const bloc = await allerAConfirmation({ montant: '1000000' })
    expect(bloc.getAttribute('role')).toBe('status')
  })

  it('[CV-07] une cuve insuffisante ne bloque PAS l’envoi : c’est un avertissement', async () => {
    poserCuves(inventaire({ stock: 100_000, liquidite: 8_000_000, envoye: 1 }))
    await allerAConfirmation({ montant: '2000000' })
    expect(screen.getByTestId('btn-submit-confirm')).not.toBeDisabled()
  })
})

// ===========================================================================
// §AC — le raccourci depuis les lignes de l'accueil
// ===========================================================================

const CAISSES = [
  { storeId: 'store-0', name: 'POUYTENGA', stock: 180000, liquidite: 2940000 },
  { storeId: 'store-1', name: 'FADA', stock: 1200000, liquidite: 640000 },
]

const monterCaisses = (props = {}) =>
  render(<MemoryRouter><CaissesReseau caisses={CAISSES} {...props} /></MemoryRouter>)

describe('TC-206-AC — ravitailler depuis la ligne', () => {
  it('[AC-01] chaque ligne porte les deux ressources, avec la boutique dans l’URL', () => {
    monterCaisses()
    const stock = screen.getByRole('link', { name: 'Ravitailler POUYTENGA en stock' })
    const liquidite = screen.getByRole('link', { name: 'Ravitailler FADA en liquidité' })
    expect(stock.getAttribute('href')).toBe('/dealer/requests/new?storeId=store-0&type=stock_add')
    expect(liquidite.getAttribute('href')).toBe('/dealer/requests/new?storeId=store-1&type=liquidity_add')
  })

  it('[AC-02] le nom accessible porte SA ligne — jamais quatre-vingt-quatre fois « Stock »', () => {
    monterCaisses()
    // Deux boutiques, quatre liens, quatre noms tous différents.
    const noms = screen.getAllByRole('link').map(a => a.getAttribute('aria-label'))
    expect(noms).toHaveLength(4)
    expect(new Set(noms).size).toBe(4)
  })

  it('[AC-03] aucun élément focusable ne se cache dans un sous-arbre aria-hidden', () => {
    // Le piège que l'ajout de ces liens rendait possible : la ligne entière
    // était `aria-hidden`, un lien y aurait été atteignable au clavier tout en
    // étant absent de l'arbre d'accessibilité.
    const { container } = monterCaisses()
    const pieges = [...container.querySelectorAll('[aria-hidden="true"] a, [aria-hidden="true"] button')]
    expect(pieges).toEqual([])
  })

  it('[AC-04] la phrase de la ligne reste intacte : le masque a bougé, pas le sens', () => {
    const { container } = monterCaisses()
    const phrases = [...container.querySelectorAll('li .sr-only')].map(p => p.textContent)
    // Comparées à la fonction pure elle-même (figée par tc-202) : c'est
    // exactement ce que « rien n'a changé » veut dire ici. Les lignes sont
    // triées par nom, donc FADA précède POUYTENGA.
    expect(phrases).toEqual(
      [...CAISSES].sort((a, b) => a.name.localeCompare(b.name)).map(phraseAccessible),
    )
  })

  it('[AC-05] le squelette réserve la colonne d’actions (pas de saut à l’arrivée des données)', () => {
    const { container: chargement } = render(
      <MemoryRouter><CaissesReseau caisses={CAISSES} loading /></MemoryRouter>,
    )
    const { container: charge } = monterCaisses()
    // Le gabarit est déclaré une seule fois et partagé ; on vérifie qu'il est
    // bien LE MÊME des deux côtés, sans supposer sur quel élément il est posé
    // (le squelette le porte sur le `li`, la ligne chargée sur son `div`).
    const gabarit = (c) => c.innerHTML.match(/sm:grid-cols-\[[^\]]+\]/)?.[0]
    expect(gabarit(chargement)).toBeTruthy()
    expect(gabarit(chargement)).toBe(gabarit(charge))
  })
})
