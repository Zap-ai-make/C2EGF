/**
 * TC-200 — Caractérisation des écrans dealer non couverts (spec S1)
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * L'espace dealer va être redessiné (specs S3 à S6). Avant d'y toucher, on fige
 * ce qu'il FAIT aujourd'hui, pour que le lot de dessin puisse prouver qu'il n'a
 * rien changé d'autre que l'apparence.
 *
 * Le relevé de couverture a montré que six écrans étaient déjà tenus par
 * tc-031, tc-041, tc-074, tc-080, tc-087 et tc-089. Quatre ne l'étaient par
 * AUCUN test — dont l'écran d'accueil. Ce fichier ne couvre que ces quatre-là :
 *
 *   DealerDashboard · DealerTransfers · DealerHistory · DealerProfile
 *
 * ⚠ AUCUNE ASSERTION NE PORTE SUR UNE CLASSE CSS.
 *   C'est la règle qui a tenu sur le lot boutique, et c'est ce qui distingue un
 *   test de caractérisation d'un test de peinture : un test qui casse au
 *   prochain lot parce qu'une couleur a changé est un test raté.
 *
 * ⚠ CE FICHIER FIGE AUSSI DES DÉFAUTS, VOLONTAIREMENT.
 *   Deux comportements ci-dessous sont faux et le disent :
 *     • `storeCount` rend « 2+ » dès que la première page est pleine — à
 *       84 boutiques, l'écran affiche donc « 20+ » en permanence (corrigé en S2) ;
 *     • « Mes demandes récentes » compte la longueur d'une liste plafonnée à 8,
 *       ce qui n'est pas un indicateur (retiré en S4).
 *   Les figer maintenant, c'est ce qui permettra de prouver qu'on les a bien
 *   corrigés — et non qu'on les a déplacés.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // dealerService
  listActiveStores: vi.fn(),
  listNetworkCaisses: vi.fn(),
  listDealerRequests: vi.fn(),
  subscribeDealerPendingCount: vi.fn(),
  // storeTransferService
  subscribeDealerBalance: vi.fn(),
  subscribeRetoursEnAttente: vi.fn(),
  subscribeIncomingTransfersCount: vi.fn(),
  subscribeIncomingTransfers: vi.fn(),
  subscribePartnerDeposits: vi.fn(),
  confirmStoreDealerTransfer: vi.fn(),
  rejectStoreDealerTransfer: vi.fn(),
  // contexte
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signOut: vi.fn(() => Promise.resolve()),
  setPersistence: vi.fn(() => Promise.resolve()),
  browserLocalPersistence: 'LOCAL',
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
  enableMultiTabIndexedDbPersistence: vi.fn(() => Promise.resolve()),
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  auth: {},
  db: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/dealerService', () => ({
  listActiveStores: mocks.listActiveStores,
  listNetworkCaisses: mocks.listNetworkCaisses,
  listDealerRequests: mocks.listDealerRequests,
  subscribeDealerPendingCount: mocks.subscribeDealerPendingCount,
}))

vi.mock('../../src/services/storeTransferService', () => ({
  subscribeDealerBalance: mocks.subscribeDealerBalance,
  subscribeRetoursEnAttente: mocks.subscribeRetoursEnAttente,
  subscribeIncomingTransfersCount: mocks.subscribeIncomingTransfersCount,
  subscribeIncomingTransfers: mocks.subscribeIncomingTransfers,
  subscribePartnerDeposits: mocks.subscribePartnerDeposits,
  confirmStoreDealerTransfer: mocks.confirmStoreDealerTransfer,
  rejectStoreDealerTransfer: mocks.rejectStoreDealerTransfer,
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

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import DealerDashboard from '../../src/pages/dealer/DealerDashboard'
import DealerTransfers from '../../src/pages/dealer/DealerTransfers'
import DealerHistory from '../../src/pages/dealer/DealerHistory'
import DealerProfile from '../../src/pages/dealer/DealerProfile'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_AUTH = {
  currentUser: { uid: 'dealer-uid' },
  userProfile: {
    role: 'dealer',
    active: true,
    email: 'ousmane@c2egf.bf',
    name: 'Ousmane Sawadogo',
  },
  isDealer: true,
}

const STORES = [
  { id: 'store-a', name: 'POUYTENGA', active: true },
  { id: 'store-b', name: 'ZORGHO', active: true },
]

const REQUESTS = [
  { id: 'r1', targetStoreName: 'POUYTENGA', requestType: 'stock_add', amount: 180000, status: 'pending', createdAt: new Date('2026-08-30T08:00:00Z') },
  { id: 'r2', targetStoreName: 'ZORGHO', requestType: 'liquidity_add', amount: 410000, status: 'confirmed', createdAt: new Date('2026-08-29T10:00:00Z') },
  { id: 'r3', targetStoreName: 'POUYTENGA', requestType: 'stock_add', amount: 90000, status: 'rejected', rejectionReason: 'Montant erroné', createdAt: new Date('2026-08-28T09:00:00Z') },
]

const TRANSFERS = [
  { id: 't1', storeName: 'OUAGA CENTRE', storeId: 'store-c', transferType: 'return_liquidity', amount: 640000, createdAt: new Date('2026-08-30T07:48:00Z') },
  { id: 't2', storeName: 'FADA', storeId: 'store-d', transferType: 'return_stock', amount: 1200000, createdAt: new Date('2026-08-29T17:20:00Z') },
]

/** Un abonnement qui pousse `value` puis rend sa fonction de désinscription. */
function pushOnce(value) {
  return ({ onUpdate }) => { onUpdate?.(value); return vi.fn() }
}

/**
 * Le réseau tel que le rend `listNetworkCaisses` (S2) : 84 boutiques, stock
 * croissant de 100 000 en 100 000, liquidité constante.
 *
 * QUATRE-VINGT-QUATRE, ET PAS TROIS. La pagination de l'ancien écran valait
 * 20 : un jeu de trois lignes laisserait passer sans broncher une recherche
 * qui ne porte que sur la première page, ou un compte qui s'arrête à vingt.
 * Les quatre premières boutiques sont sous le seuil bas (500 000).
 */
function reseauCaisses({ muettes = 0 } = {}) {
  const caisses = Array.from({ length: 84 }, (_, i) => ({
    storeId: `store-${i + 1}`,
    name: `BOUTIQUE ${i + 1}`,
    stock: i < muettes ? null : (i + 1) * 100000,
    liquidite: i < muettes ? null : 1000000,
  }))
  return {
    caisses,
    total: caisses.length,
    sommeStock: caisses.reduce((s, c) => s + (c.stock ?? 0), 0),
    sommeLiquidite: caisses.reduce((s, c) => s + (c.liquidite ?? 0), 0),
    illisibles: muettes,
  }
}

/** L'inventaire du dealer, façonné comme le rend `subscribeDealerBalance`. */
function inventaire({ envoyeCumul = 500000000, revenuCumul = 100000000 } = {}) {
  return {
    byNetwork: { Orange: { stock: 8000000, liquidite: 3000000 } },
    stock: 8000000,
    liquidite: 3000000,
    totalLiquidite: 3000000,
    flux: {
      envoyeCumul,
      revenuCumul,
      dehors: envoyeCumul - revenuCumul,
      amorce: envoyeCumul > 0 || revenuCumul > 0,
    },
  }
}

function renderDealer(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue(DEALER_AUTH)
  mocks.subscribeDealerPendingCount.mockImplementation(pushOnce(0))
  mocks.subscribeIncomingTransfersCount.mockImplementation(pushOnce(0))
  mocks.subscribePartnerDeposits.mockImplementation(pushOnce([]))
  mocks.subscribeIncomingTransfers.mockImplementation(pushOnce([]))
  mocks.listActiveStores.mockResolvedValue({ stores: STORES, lastDoc: null, hasMore: false })
  mocks.listNetworkCaisses.mockResolvedValue(reseauCaisses())
  mocks.subscribeDealerBalance.mockImplementation(pushOnce(inventaire()))
  mocks.subscribeRetoursEnAttente.mockImplementation(
    pushOnce({ nombre: 3, montant: 2150000, illisibles: 0 }),
  )
  mocks.listDealerRequests.mockResolvedValue({ requests: REQUESTS, lastDoc: null, hasMore: false })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-200-A — DealerDashboard : l’accueil, les caisses et la position', () => {
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠ CE BLOC A ÉTÉ RÉÉCRIT PAR S4, ET C'EST LE SEUL DU FICHIER.
//   Les trois autres écrans gardent leur caractérisation de S1 mot pour mot :
//   c'est ce qui prouve que ce lot n'a touché QUE l'accueil.
//
//   Les défauts que S1 avait FIGÉS ici sont maintenant tenus à l'envers — un
//   test EXIGE leur correction et nomme celui qu'il remplace. C'est la seule
//   façon de prouver qu'un défaut a été corrigé et non déplacé.

  /** Les séparateurs de `Intl.NumberFormat('fr-FR')` sont insécables. */
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

  it('affiche la position : l’argent dehors, la somme des caisses, et le transit', async () => {
    renderDealer(<DealerDashboard />)

    await waitFor(() => expect(txt(screen.getByTestId('montant-dehors'))).toBe('400 000 000 FCFA'))
    expect(txt(screen.getByTestId('montant-caisses'))).toBe('441 000 000 FCFA')
    expect(txt(screen.getByTestId('en-transit'))).toContain('2 150 000 FCFA en transit')
    expect(txt(screen.getByTestId('en-transit'))).toContain('3 retours')
  })

  it('CORRIGÉ (figé en S1) — le compte des boutiques est exact, et non « 20+ »', async () => {
    // Le défaut : l'accueil affichait la longueur de la PREMIÈRE PAGE suivie
    // d'un « + » — donc « 20+ » en permanence sur un réseau de 84 boutiques.
    // La requête unique de S2 rend le total ; il n'y a plus de page à compter.
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText(/84 boutiques en service/)).toBeTruthy()
    expect(screen.queryByText(/\d+\+/)).toBeNull()
  })

  it('CORRIGÉ (figé en S1) — ni tuiles d’indicateurs, ni table des demandes récentes', async () => {
    // Le défaut : « Mes demandes récentes » comptait la longueur d'une tranche
    // plafonnée à 8, donc ne bougeait plus au-delà de huit demandes. Les quatre
    // tuiles sont parties avec lui, et la table qu'elles surmontaient —
    // l'accueil ne redouble plus l'écran « Ravitaillements ».
    renderDealer(<DealerDashboard />)
    await screen.findByText(/84 boutiques en service/)

    expect(screen.queryByText('Mes demandes récentes')).toBeNull()
    expect(screen.queryByText('Boutiques partenaires')).toBeNull()
    expect(screen.queryByText('Mes dernières demandes')).toBeNull()
    expect(mocks.listDealerRequests).not.toHaveBeenCalled()
  })

  it('CORRIGÉ (figé en S1, par suppression) — plus aucun « Ajout stock » ici', async () => {
    // Le défaut : l'accueil définissait sa PROPRE table de libellés
    // (« Ajout stock ») là où le reste de l'espace dealer dit « Ajout de
    // stock ». Elle est partie avec la table de demandes qui la portait.
    // ⚠ Les trois écrans ADMIN gardent chacun leur copie : hors de ce chantier.
    renderDealer(<DealerDashboard />)
    await screen.findByText(/84 boutiques en service/)

    expect(screen.queryByText('Ajout stock')).toBeNull()
    expect(screen.queryByText('Ajout liquidité')).toBeNull()
  })

  it('rend les 84 caisses, et signale le seuil bas par un MOT', async () => {
    renderDealer(<DealerDashboard />)

    const liste = await screen.findByTestId('caisses-liste')
    expect(liste.querySelectorAll('li')).toHaveLength(84)

    // Quatre boutiques sous 500 000 : le mot « bas », jamais la seule couleur.
    expect(screen.getAllByText('bas')).toHaveLength(4)
    // Et la phrase lue par un lecteur d'écran porte le sens entier de la ligne.
    expect(screen.getByText(/^BOUTIQUE 3 : stock .+ sous le seuil bas ; liquidité .+\.$/)).toBeTruthy()
  })

  it('cherche sur les 84 boutiques, pas sur une page de 20', async () => {
    renderDealer(<DealerDashboard />)
    await screen.findByTestId('caisses-liste')

    // BOUTIQUE 70 est très au-delà de la première page de l'ancienne pagination.
    fireEvent.change(screen.getByTestId('caisses-recherche'), { target: { value: 'boutique 70' } })

    const liste = screen.getByTestId('caisses-liste')
    expect(liste.querySelectorAll('li')).toHaveLength(1)
    expect(within(liste).getByText('BOUTIQUE 70')).toBeTruthy()
  })

  it('trie par stock décroissant, et l’annonce', async () => {
    renderDealer(<DealerDashboard />)
    await screen.findByTestId('caisses-liste')

    fireEvent.change(screen.getByTestId('caisses-tri'), { target: { value: 'stock-desc' } })

    expect(txt(screen.getByTestId('caisses-liste').querySelector('li'))).toContain('BOUTIQUE 84')
    expect(screen.getByText(/Trié par stock, du plus haut au plus bas/)).toBeTruthy()
  })

  it('refuse de rapprocher tant qu’une caisse est illisible', async () => {
    mocks.listNetworkCaisses.mockResolvedValue(reseauCaisses({ muettes: 2 }))
    renderDealer(<DealerDashboard />)

    const bandeau = await screen.findByTestId('rapprochement')
    await waitFor(() => expect(txt(bandeau)).toContain('Rapprochement suspendu'))
    expect(txt(bandeau)).toContain('2 caisses')
  })

  it('refuse de rapprocher tant que les compteurs n’ont rien enregistré', async () => {
    mocks.subscribeDealerBalance.mockImplementation(
      pushOnce(inventaire({ envoyeCumul: 0, revenuCumul: 0 })),
    )
    renderDealer(<DealerDashboard />)

    const bandeau = await screen.findByTestId('rapprochement')
    expect(txt(bandeau)).toContain('Rapprochement indisponible')
  })

  it('nomme l’écart au lieu de le présenter comme une alerte', async () => {
    renderDealer(<DealerDashboard />)

    // 441 000 000 + 2 150 000 − 400 000 000
    const bandeau = await screen.findByTestId('rapprochement')
    await waitFor(() => expect(txt(bandeau)).toContain('43 150 000 FCFA de plus dans les caisses'))
    expect(txt(bandeau)).toContain('doit rester stable')
  })

  it('dit « — » et non « 0 » quand la lecture du réseau échoue', async () => {
    mocks.listNetworkCaisses.mockRejectedValueOnce(new Error('Firestore indisponible'))
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText(/Firestore indisponible/)).toBeTruthy()
    // Une somme de caisses à zéro se lirait « les caisses sont vides » : faux.
    expect(txt(screen.getByTestId('montant-caisses'))).toBe('—')
    expect(txt(screen.getByTestId('rapprochement'))).toContain('Rapprochement impossible')
    // L'argent dehors, lui, reste juste : il vient des compteurs, pas du réseau.
    expect(txt(screen.getByTestId('montant-dehors'))).toBe('400 000 000 FCFA')
  })

  it('invite sans laisser un trou quand aucune boutique n’est en service', async () => {
    mocks.listNetworkCaisses.mockResolvedValue({
      caisses: [], total: 0, sommeStock: 0, sommeLiquidite: 0, illisibles: 0,
    })
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText('Aucune boutique active')).toBeTruthy()
  })

  it('dit que l’échelle ne compare rien avec une seule boutique', async () => {
    const un = reseauCaisses()
    mocks.listNetworkCaisses.mockResolvedValue({
      ...un, caisses: un.caisses.slice(0, 1), total: 1,
    })
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText(/l’échelle ne compare rien/)).toBeTruthy()
  })

  it('recharge le réseau quand on actualise', async () => {
    renderDealer(<DealerDashboard />)
    await screen.findByTestId('caisses-liste')

    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }))

    await waitFor(() => expect(mocks.listNetworkCaisses).toHaveBeenCalledTimes(2))
  })

  it('n’ouvre aucune écoute des retours pour un non-dealer', async () => {
    mocks.useAuth.mockReturnValue({
      currentUser: { uid: 'gerant-uid' },
      userProfile: { role: 'gerant', active: true, name: 'Gérant' },
      isDealer: false,
    })
    renderDealer(<DealerDashboard />)
    await screen.findByTestId('caisses-liste')

    expect(mocks.subscribeRetoursEnAttente).toHaveBeenCalledWith(
      expect.objectContaining({ dealerUid: null }),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-200-B — DealerTransfers : traiter les retours des boutiques', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('n’attend rien de l’utilisateur quand aucun retour n’est en attente', async () => {
    renderDealer(<DealerTransfers />)

    expect(await screen.findByText('Aucun retour en attente')).toBeTruthy()
  })

  it('liste les retours avec leur boutique, leur type et leur montant', async () => {
    mocks.subscribeIncomingTransfers.mockImplementation(pushOnce(TRANSFERS))
    renderDealer(<DealerTransfers />)

    expect(await screen.findByText('OUAGA CENTRE')).toBeTruthy()
    expect(screen.getByText('FADA')).toBeTruthy()
    expect(screen.getByText('Envoi de liquidité')).toBeTruthy()
    expect(screen.getByText('Retour de stock')).toBeTruthy()
  })

  it('ne s’abonne qu’aux retours en attente', async () => {
    mocks.subscribeIncomingTransfers.mockImplementation(pushOnce(TRANSFERS))
    renderDealer(<DealerTransfers />)

    await screen.findByText('OUAGA CENTRE')
    expect(mocks.subscribeIncomingTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ dealerUid: 'dealer-uid', statusFilter: 'pending' }),
    )
  })

  it('confirme un retour par son identifiant', async () => {
    mocks.subscribeIncomingTransfers.mockImplementation(pushOnce(TRANSFERS))
    mocks.confirmStoreDealerTransfer.mockResolvedValue({})
    renderDealer(<DealerTransfers />)

    await screen.findByText('OUAGA CENTRE')
    fireEvent.click(screen.getByTestId('confirm-t1'))

    await waitFor(() => expect(mocks.confirmStoreDealerTransfer).toHaveBeenCalledWith('t1'))
  })

  it('exige un motif d’au moins trois caractères pour rejeter', async () => {
    mocks.subscribeIncomingTransfers.mockImplementation(pushOnce(TRANSFERS))
    renderDealer(<DealerTransfers />)

    await screen.findByText('OUAGA CENTRE')
    fireEvent.click(screen.getByTestId('reject-t1'))

    // « Rejeter » existe deux fois : sur la ligne, et dans la modale. On ne
    // vise que celui de la modale.
    const dialogue = await screen.findByRole('dialog')
    const motif = dialogue.querySelector('textarea')
    const rejeter = within(dialogue).getByRole('button', { name: 'Rejeter' })

    expect(rejeter.disabled).toBe(true)

    fireEvent.change(motif, { target: { value: 'ab' } })
    expect(rejeter.disabled).toBe(true)

    fireEvent.change(motif, { target: { value: 'Montant erroné' } })
    expect(rejeter.disabled).toBe(false)

    fireEvent.click(rejeter)
    await waitFor(() =>
      expect(mocks.rejectStoreDealerTransfer).toHaveBeenCalledWith('t1', 'Montant erroné'),
    )
  })

  it('affiche l’erreur de l’abonnement et le relance à la demande', async () => {
    mocks.subscribeIncomingTransfers.mockImplementation(({ onError }) => {
      onError?.(new Error('Connexion perdue'))
      return vi.fn()
    })
    renderDealer(<DealerTransfers />)

    expect(await screen.findByText(/Connexion perdue/)).toBeTruthy()

    mocks.subscribeIncomingTransfers.mockImplementation(pushOnce(TRANSFERS))
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }))

    expect(await screen.findByText('OUAGA CENTRE')).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-200-C — DealerHistory : ravitaillements et dépôts partenaires', () => {
// ═══════════════════════════════════════════════════════════════════════════

  const DEPOTS = [
    {
      id: 'd1', amount: 250000, operation: 'deposit', newStock: 8420000,
      partnerNom: 'KABORE', partnerPrenom: 'HAMIDOU', partnerLocalite: 'OUAGA',
      partnerNumeroDA: '54525263', createdAt: new Date('2026-08-31T12:00:00Z'),
    },
  ]

  it('fusionne les demandes et les dépôts partenaires dans une seule liste', async () => {
    mocks.subscribePartnerDeposits.mockImplementation(pushOnce(DEPOTS))
    renderDealer(<DealerHistory />)

    expect(await screen.findAllByText('Ajout de stock')).toHaveLength(2)
    expect(screen.getByText('Dépôt partenaire')).toBeTruthy()
    expect(screen.getByText(/KABORE/)).toBeTruthy()
  })

  it('trie la liste du plus récent au plus ancien, sources confondues', async () => {
    mocks.subscribePartnerDeposits.mockImplementation(pushOnce(DEPOTS))
    const { container } = renderDealer(<DealerHistory />)

    await screen.findByText('Dépôt partenaire')
    const premiereCellule = container.querySelectorAll('tbody tr td:first-child')

    // Le dépôt partenaire est daté du 31/08, la demande la plus récente du 30/08.
    expect(premiereCellule[0].textContent).toMatch(/KABORE/)
    expect(premiereCellule[1].textContent).toBe('POUYTENGA')
  })

  it('filtre par statut', async () => {
    const { container } = renderDealer(<DealerHistory />)
    await screen.findAllByText('Ajout de stock')

    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'rejected' } })

    // ⚠ On interroge le CORPS DU TABLEAU, pas l'écran : « Confirmée » est aussi
    //   le texte d'une <option> du sélecteur de filtre, qui ne disparaît jamais.
    //   Une requête globale passerait donc pour de mauvaises raisons.
    await waitFor(() => {
      const lignes = container.querySelector('tbody')
      expect(lignes.textContent).not.toMatch('Confirmée')
      expect(lignes.textContent).toMatch('Rejetée')
    })
  })

  it('filtre par nom de boutique ou de partenaire', async () => {
    renderDealer(<DealerHistory />)
    await screen.findByText('ZORGHO')

    fireEvent.change(screen.getByLabelText('Rechercher par boutique ou partenaire'), {
      target: { value: 'zorgho' },
    })

    await waitFor(() => expect(screen.queryByText('POUYTENGA')).toBeNull())
    expect(screen.getByText('ZORGHO')).toBeTruthy()
  })

  it('dit qu’aucune opération ne correspond quand le filtre ne rend rien', async () => {
    mocks.listDealerRequests.mockResolvedValue({ requests: [], lastDoc: null, hasMore: false })
    renderDealer(<DealerHistory />)

    expect(await screen.findByText('Aucune opération')).toBeTruthy()
  })

  it('ne propose la page suivante que sur les ravitaillements', async () => {
    mocks.listDealerRequests.mockResolvedValue({
      requests: REQUESTS, lastDoc: { id: 'last' }, hasMore: true,
    })
    renderDealer(<DealerHistory />)

    const suivante = await screen.findByRole('button', { name: /Charger plus/i })
    fireEvent.click(suivante)

    await waitFor(() => expect(mocks.listDealerRequests).toHaveBeenCalledTimes(2))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-200-D — DealerProfile : le compte', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('affiche le nom, l’adresse e-mail et le rôle du dealer connecté', () => {
    renderDealer(<DealerProfile />)

    expect(screen.getByText('Ousmane Sawadogo')).toBeTruthy()
    expect(screen.getByText('ousmane@c2egf.bf')).toBeTruthy()
    expect(screen.getByText('Dealer')).toBeTruthy()
  })

  it('ne rend aucune fiche tant que le profil n’est pas chargé', () => {
    mocks.useAuth.mockReturnValue({ currentUser: { uid: 'dealer-uid' }, userProfile: null })
    const { container } = renderDealer(<DealerProfile />)

    expect(container.querySelector('dl')).toBeNull()
  })
})
