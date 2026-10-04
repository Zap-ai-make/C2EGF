/**
 * TC-221 — Import de clients : la boutique tamponnée est celle qui a uploadé
 *
 * Comportement protégé :
 *   Un fichier uploadé ne décide JAMAIS de l'appartenance des clients qu'il
 *   contient. La boutique inscrite sur chaque client est celle de la session
 *   qui a fait l'upload — même quand le fichier porte une colonne « Boutique »
 *   remplie avec autre chose.
 *
 * POURQUOI CE TEST EXISTE
 * ───────────────────────
 * Le tampon est déjà posé, mais par DEUX acteurs qui ne se connaissent pas :
 *   1. parseWorksheetRows() (src/utils/excelUtils.js) mappe la colonne
 *      « Boutique » sur '_boutique_ignored' et la jette, puis supprime
 *      registeredStoreId / registeredStoreName / registeredBy du client lu ;
 *   2. addClient() (src/services/firestore.js) impose ensuite
 *      registeredStoreId / registeredStoreName depuis le store actif.
 *
 * TC-023-D couvre l'acteur 2 avec un payload écrit à la main. Rien ne couvrait
 * la jonction : qu'un fichier réellement parsé arrive bien jusque-là sans
 * emporter sa propre colonne Boutique. C'est cette couture que ce fichier
 * tient, pour qu'un futur alias d'en-tête ne la découse pas en silence.
 *
 * Fichiers source :
 *   - src/utils/excelUtils.js   (parseWorksheetRows, HEADER_ALIASES)
 *   - src/services/firestore.js (addClient)
 *   - src/pages/Clients.jsx     (handleImportClients → addClient par client)
 *
 * Interdictions : aucun import Firebase réel, aucun accès réseau.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks Firebase
// ---------------------------------------------------------------------------

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
  getApp: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  firebaseInfo: {},
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

vi.mock('../../src/utils/cacheManager', () => ({
  default: {
    setFetchFunction: vi.fn(),
    get: vi.fn(() => null),
    set: vi.fn(),
    invalidate: vi.fn(),
    generateKey: vi.fn(() => 'mock-key'),
    clear: vi.fn(),
    invalidateCollection: vi.fn(),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
    invalidateRelated: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import après mocks
// ---------------------------------------------------------------------------

import { parseWorksheetRows } from '../../src/utils/excelUtils.js'
import { FirestoreService } from '../../src/services/firestore.js'

// ---------------------------------------------------------------------------
// Le fichier tel qu'un agent commercial l'envoie : les sept colonnes du
// modèle, PLUS une colonne « Boutique » héritée d'un export d'une autre
// boutique. C'est exactement le cas qui doit être neutralisé.
// ---------------------------------------------------------------------------

const BOUTIQUE_UPLOADEUSE = { id: 'store-ouaga', name: 'C2EGF OUAGA' }

const FICHIER_AVEC_COLONNE_BOUTIQUE = [
  [
    'Boutique',
    'Nom',
    'Prénom',
    'Numéro agent / Code agent',
    'Numéro personnel',
    "Numéro d'identité",
    'Localité',
    'Agent commercial',
  ],
  ['C2EGF BOBO', 'Ouedraogo', 'Kader', '70001234', '70009876', 'B123456', 'Tanghin', 'Salif'],
  ['Boutique Usurpée', 'Diallo', 'Aïssata', '70005678', '70001122', 'B654321', 'Dapoya', 'Salif'],
]

describe('TC-221 — import : la boutique inscrite est celle qui a uploadé', () => {
  let svc
  let payloads

  beforeEach(() => {
    vi.clearAllMocks()
    payloads = []

    svc = new FirestoreService()
    svc.setActiveStore(BOUTIQUE_UPLOADEUSE)

    // Même découpe que TC-062 : on neutralise les deux collaborateurs réseau
    // d'addClient pour observer le payload qu'il CONSTRUIT. Passer par le vrai
    // addDocument ferait entrer retryWithBackoff et ses délais exponentiels.
    svc.getCollection = vi.fn(async () => []) // anti-doublon : aucun conflit
    svc.addDocument = vi.fn(async (_collection, data) => {
      payloads.push(data)
      return { id: `client-${payloads.length}` }
    })
  })

  it('[TC-221-01] le parseur ne laisse passer aucun champ d’appartenance', () => {
    const { success, clients } = parseWorksheetRows(FICHIER_AVEC_COLONNE_BOUTIQUE)

    expect(success).toBe(true)
    expect(clients).toHaveLength(2)
    clients.forEach((client) => {
      expect(client).not.toHaveProperty('registeredStoreId')
      expect(client).not.toHaveProperty('registeredStoreName')
      expect(client).not.toHaveProperty('registeredBy')
      // La valeur du fichier ne doit survivre sous AUCUN nom de champ.
      expect(Object.values(client)).not.toContain('C2EGF BOBO')
      expect(Object.values(client)).not.toContain('Boutique Usurpée')
    })
  })

  it('[TC-221-02] chaque client importé porte le nom de la boutique uploadeuse', async () => {
    const { clients } = parseWorksheetRows(FICHIER_AVEC_COLONNE_BOUTIQUE)

    // Reproduit handleImportClients (src/pages/Clients.jsx) : l'id temporaire
    // d'import est retiré, puis un addClient par ligne.
    for (const { id: _id, ...client } of clients) {
      await svc.addClient(client)
    }

    expect(payloads).toHaveLength(2)
    payloads.forEach((payload) => {
      expect(payload.registeredStoreId).toBe(BOUTIQUE_UPLOADEUSE.id)
      expect(payload.registeredStoreName).toBe(BOUTIQUE_UPLOADEUSE.name)
    })
    expect(payloads.map((payload) => payload.nom)).toEqual(['Ouedraogo', 'Diallo'])
  })

  it('[TC-221-03] un fichier sans colonne Boutique est tamponné pareil', async () => {
    const sansColonne = [
      ['Nom', 'Prénom', 'Numéro agent / Code agent'],
      ['Sawadogo', 'Fatimata', '70002468'],
    ]
    const { success, clients } = parseWorksheetRows(sansColonne)
    expect(success).toBe(true)

    const { id: _id, ...client } = clients[0]
    await svc.addClient(client)

    expect(payloads[0].registeredStoreName).toBe(BOUTIQUE_UPLOADEUSE.name)
    expect(payloads[0].registeredStoreId).toBe(BOUTIQUE_UPLOADEUSE.id)
  })

  it('[TC-221-04] sans boutique active, aucun client n’est écrit', async () => {
    const orphelin = new FirestoreService()
    orphelin.addDocument = vi.fn(async (_collection, data) => {
      payloads.push(data)
      return { id: 'orphelin' }
    })
    const { clients } = parseWorksheetRows(FICHIER_AVEC_COLONNE_BOUTIQUE)
    const { id: _id, ...client } = clients[0]

    // Un import ne doit pas pouvoir créer un client sans propriétaire : mieux
    // vaut l'échec visible qu'une ligne orpheline dans la base commune.
    await expect(orphelin.addClient(client)).rejects.toThrow()
    expect(payloads).toHaveLength(0)
  })
})
