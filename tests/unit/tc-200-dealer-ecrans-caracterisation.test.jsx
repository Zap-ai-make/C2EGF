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
  listDealerRequests: vi.fn(),
  subscribeDealerPendingCount: vi.fn(),
  // storeTransferService
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
  listDealerRequests: mocks.listDealerRequests,
  subscribeDealerPendingCount: mocks.subscribeDealerPendingCount,
}))

vi.mock('../../src/services/storeTransferService', () => ({
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
  mocks.listDealerRequests.mockResolvedValue({ requests: REQUESTS, lastDoc: null, hasMore: false })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-200-A — DealerDashboard : ce que l’accueil affiche aujourd’hui', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('affiche les quatre indicateurs, avec le compte de boutiques de la première page', async () => {
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText('Boutiques partenaires')).toBeTruthy()
    expect(screen.getByText('Demandes en attente')).toBeTruthy()
    expect(screen.getByText('Retours en attente')).toBeTruthy()
    expect(screen.getByText('Mes demandes récentes')).toBeTruthy()

    // Deux boutiques rendues, sans « + » : la page n'est pas pleine.
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
  })

  it('DÉFAUT FIGÉ — le compte de boutiques devient « 2+ » dès qu’une page suivante existe', async () => {
    // C'est le comportement réel à 84 boutiques : la page vaut 20, `hasMore`
    // est donc toujours vrai, et l'écran affiche « 20+ » en permanence.
    // Corrigé par S2 (compte exact) ; figé ici pour pouvoir le prouver.
    mocks.listActiveStores.mockResolvedValue({ stores: STORES, lastDoc: { id: 'last' }, hasMore: true })

    renderDealer(<DealerDashboard />)

    expect(await screen.findByText('2+')).toBeTruthy()
  })

  it('DÉFAUT FIGÉ — « Mes demandes récentes » compte une liste plafonnée à 8', async () => {
    const douze = Array.from({ length: 12 }, (_, i) => ({
      ...REQUESTS[0], id: `req-${i}`, amount: 1000 * (i + 1),
    }))
    mocks.listDealerRequests.mockResolvedValue({ requests: douze, lastDoc: null, hasMore: true })

    renderDealer(<DealerDashboard />)

    // Douze demandes existent, l'indicateur en annonce huit : ce n'est pas un
    // indicateur, c'est la longueur d'une tranche. Retiré en S4.
    expect(await screen.findByText('8')).toBeTruthy()
  })

  it('mène aux demandes quand on active l’indicateur des demandes en attente', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(pushOnce(4))
    renderDealer(<DealerDashboard />)

    await screen.findByText('Demandes en attente')
    fireEvent.click(screen.getByText('Demandes en attente'))

    expect(mocks.navigate).toHaveBeenCalledWith('/dealer/requests')
  })

  it('mène aux retours quand on active l’indicateur des retours en attente', async () => {
    mocks.subscribeIncomingTransfersCount.mockImplementation(pushOnce(3))
    renderDealer(<DealerDashboard />)

    await screen.findByText('Retours en attente')
    fireEvent.click(screen.getByText('Retours en attente'))

    expect(mocks.navigate).toHaveBeenCalledWith('/dealer/transfers')
  })

  it('liste les dernières demandes avec boutique, type, montant et statut', async () => {
    renderDealer(<DealerDashboard />)

    // Deux demandes d'ajout de stock sur trois : le libellé apparaît deux fois.
    expect(await screen.findAllByText('Ajout stock')).toHaveLength(2)
    expect(screen.getByText('Ajout liquidité')).toBeTruthy()
    expect(screen.getAllByText('POUYTENGA')).toHaveLength(2)
    expect(screen.getByText('En attente')).toBeTruthy()
    expect(screen.getByText('Confirmée')).toBeTruthy()
    expect(screen.getByText('Rejetée')).toBeTruthy()
  })

  /**
   * DÉFAUT FIGÉ — deux vocabulaires pour le même objet.
   *
   * `DealerDashboard` définit sa PROPRE table `TYPE_LABELS` (« Ajout stock »),
   * alors que `constants/dealerConstants.js` en expose déjà une
   * (`DEALER_REQUEST_TYPE_LABELS` → « Ajout de stock »), employée par
   * `DealerHistory` et `DealerRequests`. Le même type de demande porte donc
   * deux noms selon l'écran. Un libellé doit se changer à un seul endroit :
   * S6 supprime la table locale.
   */
  it('DÉFAUT FIGÉ — l’accueil dit « Ajout stock » là où l’historique dit « Ajout de stock »', async () => {
    renderDealer(<DealerDashboard />)

    expect(await screen.findAllByText('Ajout stock')).toHaveLength(2)
    expect(screen.queryByText('Ajout de stock')).toBeNull()
  })

  it('invite à créer une demande quand il n’y en a aucune', async () => {
    mocks.listDealerRequests.mockResolvedValue({ requests: [], lastDoc: null, hasMore: false })
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText('Aucune demande')).toBeTruthy()
  })

  it('affiche l’erreur des indicateurs et la recharge à la demande', async () => {
    mocks.listActiveStores.mockRejectedValueOnce(new Error('Firestore indisponible'))
    renderDealer(<DealerDashboard />)

    expect(await screen.findByText(/Firestore indisponible/)).toBeTruthy()

    mocks.listActiveStores.mockResolvedValue({ stores: STORES, lastDoc: null, hasMore: false })
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }))

    await waitFor(() => expect(mocks.listActiveStores).toHaveBeenCalledTimes(2))
  })

  it('recharge les deux sources quand on actualise', async () => {
    renderDealer(<DealerDashboard />)
    await screen.findByText('Boutiques partenaires')

    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }))

    await waitFor(() => {
      expect(mocks.listActiveStores).toHaveBeenCalledTimes(2)
      expect(mocks.listDealerRequests).toHaveBeenCalledTimes(2)
    })
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
