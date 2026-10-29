/**
 * TC-301 — les outils de LECTURE de l'assistant, contre le vrai `firestoreService`.
 *
 * tc-300 couvre les modules purs ; aucun test n'exécutait `executerOutil` contre
 * la base. C'est par ce trou qu'est passé BUG-06 (audit du 29 octobre 2026) :
 * `outils.js` appelait `getClients`, `getDrafts` et `getHistory` détachées du
 * singleton, donc sans `this`. Chaque lecture levait un TypeError, que
 * `traduirePanne` rendait en « Je n'ai pas pu lire… » — une panne passagère en
 * apparence, un défaut de code en réalité.
 *
 * Seul le SDK Firestore est simulé : `getDocs` répond selon le CHEMIN demandé.
 * Le singleton, sa boutique active, le cache et les services délégués sont
 * réels — c'est précisément leur assemblage qui cassait.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// La base simulée : chemin → documents
// ---------------------------------------------------------------------------

const base = vi.hoisted(() => ({ collections: {} }))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ path })),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(async (ref) => ({
    docs: (base.collections[ref.path] ?? []).map(({ id, ...donnees }) => ({ id, data: () => donnees })),
  })),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}))

vi.mock('../../src/services/storeTransactionCommandService.js', () => ({
  runStoreTransactionCommand: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  functions: {},
  firebaseInfo: {},
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

import { firestoreService } from '../../src/services/firestore.js'
import { executerOutil } from '../../src/lib/ia/outils.js'

// ---------------------------------------------------------------------------
// Jeux de données — valeurs attendues écrites à la main
// ---------------------------------------------------------------------------

const CLIENTS = [
  { id: 'c1', nom: 'OUEDRAOGO', prenom: 'Souleymane', codeAgent: '1234567', registeredStoreName: 'Gounghin' },
  { id: 'c2', nom: 'KINDA', prenom: 'Adjara', codeAgent: '7654321', registeredStoreName: 'Pissy' },
]

const BROUILLONS_A = [
  { id: 'd1', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 15000, statut: 'Non Terminées', date: '29/10/2026 08:40:00' },
  { id: 'd2', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 9000, statut: 'Annulée', date: '29/10/2026 08:50:00' },
]

const HISTORIQUE_A = [
  { id: 'h1', clientNom: 'KINDA Adjara', type: 'Retrait', montant: 20000, statut: 'Validée', date: '29/10/2026 09:15:00' },
  { id: 'h2', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '29/10/2026 09:30:00' },
]

const HISTORIQUE_B = [
  { id: 'hb1', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 3000, statut: 'Validée', date: '29/10/2026 10:00:00' },
]

const BOUTIQUE_A = { id: 'boutique-a', name: 'Gounghin' }
const BOUTIQUE_B = { id: 'boutique-b', name: 'Pissy' }

beforeEach(() => {
  base.collections = {
    globalClients: CLIENTS,
    'clients/boutique-a/drafts': BROUILLONS_A,
    'clients/boutique-a/history': HISTORIQUE_A,
    'clients/boutique-b/drafts': [],
    'clients/boutique-b/history': HISTORIQUE_B,
  }
  firestoreService.setActiveStore(BOUTIQUE_A)
  // Un outil qui échoue écrit en console : c'est voulu, et cela ne doit pas
  // salir la sortie des tests.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // Vide aussi le cache : sans cela, une lecture d'un test servirait le suivant.
  firestoreService.setActiveStore(null)
  vi.restoreAllMocks()
})

describe('[OL] outils de lecture, sur le vrai firestoreService', () => {
  it('[OL-01] chercher_client rend la fiche trouvée, sans champ d\'audit', async () => {
    const reponse = await executerOutil('chercher_client', { recherche: 'ouedraogo' })

    expect(reponse).toEqual({
      trouves: 1,
      tronque: false,
      clients: [{ nom: 'Souleymane OUEDRAOGO', codeAgent: '1234567', registeredStoreName: 'Gounghin' }],
    })
  })

  it('[OL-02] creances_en_cours additionne ce qui reste dû, annulées écartées', async () => {
    const reponse = await executerOutil('creances_en_cours')

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.nombre).toBe(1)
    expect(reponse.total_du).toBe(15000)
  })

  it('[OL-03] operations_recentes lit l\'historique de la boutique active', async () => {
    const reponse = await executerOutil('operations_recentes', { type: 'Dépôt' })

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.nombre).toBe(1)
    expect(reponse.total).toBe(50000)
    expect(reponse.operations).toEqual([
      { clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '29/10/2026 09:30:00' },
    ])
  })

  it('[OL-04] bilan_du_jour lit ses trois sources sans en déclarer une incomplète', async () => {
    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.clients_enregistres).toBe(2)
    expect(reponse.creances_en_cours).toBe(1)
    expect(reponse.total_des_creances).toBe(15000)
    expect(reponse.lectures_incompletes).toEqual([])
  })

  it('[OL-05] la boutique lue est celle du singleton, pas une autre', async () => {
    firestoreService.setActiveStore(BOUTIQUE_B)

    const reponse = await executerOutil('operations_recentes')

    expect(reponse.nombre).toBe(1)
    expect(reponse.total).toBe(3000)
    expect(reponse.operations[0].clientNom).toBe('ZIDA Kassoum')
  })
})

/**
 * « Le point de la journée », dit la déclaration lue par le modèle. Sans borne,
 * le bilan additionnait TOUT l'historique de la boutique : le cumul depuis
 * l'ouverture, présenté comme le chiffre du jour. La journée est celle du
 * tableau de bord (`useTodayTransactions`) : date saisie dans la journée
 * métier du profil, annulées et lignes sans date écartées.
 */
describe('[OJ] bilan_du_jour s\'en tient à la journée métier', () => {
  beforeEach(() => {
    // Seule l'horloge est figée : les minuteries du cache restent réelles.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-29T12:00:00Z') })
    base.collections['clients/boutique-a/history'] = [
      { id: 'j1', clientNom: 'KINDA Adjara', type: 'Retrait', montant: 20000, statut: 'Validée', date: '29/10/2026 00:05:00' },
      { id: 'j2', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '28/10/2026 23:55:00' },
      { id: 'j3', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 7000, statut: 'Annulée', date: '29/10/2026 11:00:00' },
      { id: 'j4', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 4000, statut: 'Validée', date: '29/10/2026 11:30:00' },
      { id: 'j5', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 1000, statut: 'Validée' },
    ]
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[OJ-01] la veille, une annulée et une ligne sans date ne comptent pas', async () => {
    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.operations_terminees).toBe(2)
    expect(reponse.total_encaisse).toBe(24000)
    expect(reponse.par_type).toEqual({ Retrait: 20000, Dépôt: 4000 })
  })

  it('[OJ-02] les créances en cours restent toutes comptées, quel que soit leur âge', async () => {
    base.collections['clients/boutique-a/drafts'] = [
      { id: 'v1', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 15000, statut: 'Non Terminées', date: '12/10/2026 09:00:00' },
    ]

    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.creances_en_cours).toBe(1)
    expect(reponse.total_des_creances).toBe(15000)
  })
})
