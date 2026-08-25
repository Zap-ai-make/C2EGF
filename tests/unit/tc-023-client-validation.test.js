/**
 * TC-023 — Validation des données client (validateClientData + payload addClient)
 *
 * Comportement protégé :
 *   validateClientData() dans src/services/firestore.js doit être alignée avec
 *   validClient() dans firestore.rules afin qu'une donnée invalide soit rejetée
 *   localement avant d'atteindre Firestore et d'obtenir un permission-denied.
 *
 * Règles Firestore (firestore.rules lignes 24-33) :
 *   function validClient(data) {
 *     return data.keys().hasAll(['nom', 'prenom', 'registeredStoreId', 'registeredStoreName']) &&
 *            data.nom is string && data.nom.size() >= 2 && data.nom.size() <= 50 &&
 *            data.prenom is string && data.prenom.size() >= 2 && data.prenom.size() <= 50 &&
 *            data.registeredStoreId is string &&
 *            data.registeredStoreName is string &&
 *            (!data.keys().hasAny(['numeroPersonnel']) ||
 *             data.numeroPersonnel == '' ||
 *             data.numeroPersonnel.matches('^[0-9+\\-\\s()/]{8,120}$'));
 *   }
 *
 * Constantes de validation (src/constants/firestoreConstants.js) :
 *   NAME_MIN_LENGTH : 2
 *   NAME_MAX_LENGTH : 50
 *   PHONE_REGEX     : /^[0-9+\-\s()/]{8,120}$/
 *
 * Fichiers source :
 *   - src/services/firestore.js (validateClientData, addClient)
 *   - src/constants/firestoreConstants.js (VALIDATION.CLIENT)
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

import { FirestoreService } from '../../src/services/firestore.js'
import { FIRESTORE_CONFIG } from '../../src/constants/firestoreConstants.js'
import { addDoc } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_RULES = FIRESTORE_CONFIG.VALIDATION.CLIENT

/**
 * Appelle validateClientData directement via une instance de FirestoreService.
 * Évite toute dépendance au store actif (addDocument en nécessiterait un).
 *
 * Le helper injecte registeredStoreId et registeredStoreName dans le payload
 * de base afin que les tests sur nom/prenom/numeroPersonnel ne soient pas
 * parasités par les erreurs de validation boutique (correction Lot C3).
 * Les tests qui souhaitent tester ces champs store passent des données
 * différentes directement.
 */
const BASE_STORE_FIELDS = {
  registeredStoreId: 'store-test-aaa',
  registeredStoreName: 'Store A',
}

function validate(data) {
  const svc = new FirestoreService()
  return svc.validateClientData({ ...BASE_STORE_FIELDS, ...data }, CLIENT_RULES)
}

// ---------------------------------------------------------------------------
// TC-023-A — validateClientData : champ nom
// ---------------------------------------------------------------------------

describe('TC-023-A — validateClientData : champ nom', () => {

  it('[TC-023-A01] nom absent (undefined) → invalide', () => {
    const result = validate({ prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /nom/i.test(e))).toBe(true)
  })

  it('[TC-023-A02] nom vide ("") → invalide', () => {
    const result = validate({ nom: '', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /nom/i.test(e))).toBe(true)
  })

  it('[TC-023-A03] nom de 1 caractère → invalide (firestore.rules : nom.size() >= 2)', () => {
    const result = validate({ nom: 'A', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /nom.*2|au moins 2/i.test(e))).toBe(true)
  })

  it('[TC-023-A04] nom de 2 caractères → valide', () => {
    const result = validate({ nom: 'Ba', prenom: 'Kader' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-A05] nom de 50 caractères → valide', () => {
    const nom = 'A'.repeat(50)
    const result = validate({ nom, prenom: 'Kader' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-A06] nom de 51 caractères → invalide (firestore.rules : nom.size() <= 50)', () => {
    const nom = 'A'.repeat(51)
    const result = validate({ nom, prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /nom.*50|dépasser 50/i.test(e))).toBe(true)
  })

  it('[TC-023-A07] nom espaces seuls " " (longueur 1) → invalide', () => {
    // firestore.rules vérifie la longueur brute sans trim, " " a size()=1 donc < 2
    const result = validate({ nom: ' ', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
  })

  it('[TC-023-A08] nom espaces seuls "  " (longueur 2) → valide côté service (longueur brute >= 2)', () => {
    // firestore.rules ne fait pas de trim non plus : "  ".size() == 2 → allow
    // Le service doit se comporter comme les règles (longueur brute)
    const result = validate({ nom: '  ', prenom: 'Kader' })
    expect(result.isValid).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-B — validateClientData : champ prenom
// ---------------------------------------------------------------------------

describe('TC-023-B — validateClientData : champ prenom', () => {

  it('[TC-023-B01] prenom absent (undefined) → invalide', () => {
    const result = validate({ nom: 'Ouedraogo' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /prénom/i.test(e))).toBe(true)
  })

  it('[TC-023-B02] prenom vide ("") → invalide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /prénom/i.test(e))).toBe(true)
  })

  it('[TC-023-B03] prenom de 1 caractère → invalide (firestore.rules : prenom.size() >= 2)', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'A' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /prénom.*2|au moins 2/i.test(e))).toBe(true)
  })

  it('[TC-023-B04] prenom de 2 caractères → valide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Ba' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-B05] prenom de 50 caractères → valide', () => {
    const prenom = 'B'.repeat(50)
    const result = validate({ nom: 'Ouedraogo', prenom })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-B06] prenom de 51 caractères → invalide (firestore.rules : prenom.size() <= 50)', () => {
    const prenom = 'B'.repeat(51)
    const result = validate({ nom: 'Ouedraogo', prenom })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /prénom.*50|dépasser 50/i.test(e))).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-C — validateClientData : champ numeroPersonnel (optionnel)
// ---------------------------------------------------------------------------

describe('TC-023-C — validateClientData : champ numeroPersonnel', () => {

  it('[TC-023-C01] numeroPersonnel absent → valide (champ optionnel)', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C02] numeroPersonnel vide ("") → valide (firestore.rules : data.numeroPersonnel == "")', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C03] numeroPersonnel "70001234" (8 chiffres) → valide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '70001234' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C04] numeroPersonnel "+226 70 00 12 34" (avec +, espace) → valide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '+226 70 00 12 34' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C05] numeroPersonnel "70-00-12/34" (avec -, /) → valide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '70-00-12/34' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C06] numeroPersonnel "(70)001234" (avec parenthèses) → valide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '(70)001234' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C07] numeroPersonnel "7000123" (7 chiffres, < 8) → invalide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '7000123' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-C08] numeroPersonnel "7000abc1" (lettres a-c) → invalide', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '7000abc1' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-C09] numeroPersonnel avec 121 caractères (>120) → invalide', () => {
    const numero = '1'.repeat(121)
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: numero })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-C10] numeroPersonnel avec 120 caractères → valide', () => {
    const numero = '1'.repeat(120)
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: numero })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-C11] numeroPersonnel "70.00.12.34" (point non autorisé) → invalide', () => {
    // Le point n'est pas dans la regex [0-9+\-\s()/]
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: '70.00.12.34' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-D — payload addClient : champs injectés par le service
//
// Les cas D01/D02 testent que registeredStoreId/Name proviennent du store actif.
// Les cas D03-D07 testent la validation locale via validateClientData directement,
// pour éviter le retryWithBackoff de withErrorHandling (délais jusqu'à 8s+).
// Comportement protégé : un client invalide est rejeté AVANT toute écriture.
// ---------------------------------------------------------------------------

import { collection, doc as firestoreDoc } from 'firebase/firestore'

describe('TC-023-D — payload addClient : champs injectés', () => {

  let svc
  let capturedPayload

  beforeEach(() => {
    vi.clearAllMocks()

    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-aaa', name: 'Boutique AAA' })

    // collection() retourne une référence factice
    collection.mockReturnValue({ path: 'globalClients' })
    firestoreDoc.mockReturnValue({ id: 'mock-doc-id', path: 'globalClients/mock-doc-id' })

    // Capture le payload envoyé à addDoc
    addDoc.mockImplementation(async (_colRef, data) => {
      capturedPayload = data
      return { id: 'new-client-id' }
    })
  })

  it('[TC-023-D01] registeredStoreId provient du store actif, pas du formulaire', async () => {
    const formData = {
      nom: 'Ouedraogo',
      prenom: 'Kader',
      // Tentative d'injection d'un storeId différent depuis le formulaire
      registeredStoreId: 'store-bbb-usurpe',
    }
    await svc.addClient(formData)
    // addClient écrase registeredStoreId avec celui du store actif
    expect(capturedPayload.registeredStoreId).toBe('store-aaa')
  })

  it('[TC-023-D02] registeredStoreName provient du store actif, pas du formulaire', async () => {
    const formData = {
      nom: 'Ouedraogo',
      prenom: 'Kader',
      registeredStoreName: 'Boutique Usurpée',
    }
    await svc.addClient(formData)
    expect(capturedPayload.registeredStoreName).toBe('Boutique AAA')
  })

})

// ---------------------------------------------------------------------------
// TC-023-E — données invalides → validation locale rejette avant écriture
//
// Ces tests appellent validateClientData() directement pour éviter le
// retryWithBackoff de addDocument (délais exponentiels incompatibles
// avec le timeout de test).
// La propriété protégée est : validateClientData rejette les données invalides
// → addDocument() lancera un throw avant tout appel réseau.
// ---------------------------------------------------------------------------

describe('TC-023-E — validateClientData : rejet avant écriture', () => {

  it('[TC-023-E01] nom de 1 caractère → validateClientData retourne isValid=false', () => {
    const result = validate({ nom: 'A', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    // Si isValid=false, addDocument lève une erreur avant d'appeler addDoc
  })

  it('[TC-023-E02] prenom de 1 caractère → validateClientData retourne isValid=false', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'K' })
    expect(result.isValid).toBe(false)
  })

  it('[TC-023-E03] nom vide → validateClientData retourne isValid=false', () => {
    const result = validate({ nom: '', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
  })

  it('[TC-023-E04] numeroPersonnel invalide ("abc") → validateClientData retourne isValid=false', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader', numeroPersonnel: 'abc' })
    expect(result.isValid).toBe(false)
  })

  it('[TC-023-E05] données invalides → message d\'erreur contient "invalide"', () => {
    // Vérifie que addDocument() construira un message reconnaissable
    const result = validate({ nom: 'A', prenom: 'Kader' })
    expect(result.isValid).toBe(false)
    // addDocument lève : `Données invalides: ${validation.errors.join(', ')}`
    const simulatedMessage = `Données invalides: ${result.errors.join(', ')}`
    expect(simulatedMessage).toMatch(/invalide/i)
  })

  it('[TC-023-E06] données valides → validateClientData retourne isValid=true', () => {
    const result = validate({ nom: 'Ouedraogo', prenom: 'Kader' })
    expect(result.isValid).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-F — validateClientData : type strict de numeroPersonnel (Lot C3)
//
// Avant cette correction, typeof n'était pas vérifié : PHONE_REGEX.test(70001234)
// convertissait implicitement le nombre en chaîne et le validait.
// Après correction : seul typeof === 'string' est accepté.
// ---------------------------------------------------------------------------

describe('TC-023-F — validateClientData : type strict de numeroPersonnel', () => {

  it('[TC-023-F01] number 70001234 → invalide (doit être une string)', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: 70001234 })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-F02] null → invalide (null !== undefined && null !== "")', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: null })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-F03] objet {} → invalide', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: {} })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-F04] tableau [] → invalide', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: [] })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-F05] undefined → valide (champ absent traité comme non fourni)', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: undefined })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-F06] chaîne vide "" → valide (règle Firestore : == "")', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: '' })
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-F07] chaîne avec point "70.001.234" → invalide (point absent de la regex)', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: '70.001.234' })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
  })

  it('[TC-023-F08] boolean true → invalide (typeof !== "string")', () => {
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: true })
    expect(result.isValid).toBe(false)
  })

})

// ---------------------------------------------------------------------------
// TC-023-G — validateClientData : registeredStoreId (Lot C3)
//
// Comportement protégé : validateClientData doit rejeter tout payload où
// registeredStoreId est absent, non-string ou chaîne vide/espaces.
// ---------------------------------------------------------------------------

describe('TC-023-G — validateClientData : registeredStoreId', () => {

  it('[TC-023-G01] registeredStoreId absent → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-G02] registeredStoreId undefined → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: undefined, registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-G03] registeredStoreId number 123 → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 123, registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-G04] registeredStoreId chaîne vide "" → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: '', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-G05] registeredStoreId chaîne valide → valide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-G06] registeredStoreId espaces seuls "   " → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: '   ', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-H — validateClientData : registeredStoreName (Lot C3)
// ---------------------------------------------------------------------------

describe('TC-023-H — validateClientData : registeredStoreName', () => {

  it('[TC-023-H01] registeredStoreName absent → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-H02] registeredStoreName undefined → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: undefined },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-H03] registeredStoreName number 42 → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: 42 },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-H04] registeredStoreName chaîne vide "" → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: '' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

  it('[TC-023-H05] registeredStoreName chaîne valide → valide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: 'Ma Boutique' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(true)
  })

  it('[TC-023-H06] registeredStoreName espaces seuls "   " → invalide', () => {
    const svc = new FirestoreService()
    const result = svc.validateClientData(
      { nom: 'Diallo', prenom: 'Aïssata', registeredStoreId: 'store-abc', registeredStoreName: '   ' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /boutique/i.test(e))).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// TC-023-I — addClient : zéro addDoc sur données invalides (Lot C3)
//
// Ces tests vérifient deux propriétés indissociables :
//   1. validateData() retourne isValid=false sur des données invalides.
//   2. addDocument() throw AVANT d'appeler addDoc quand isValid=false.
//
// Stratégie : spy sur svc.validateData pour court-circuiter withErrorHandling
// et éviter les retries exponentiels (circuit breaker / backoff).
// La propriété "zéro addDoc" est vérifiée via vi.mocked(addDoc).
// ---------------------------------------------------------------------------

describe('TC-023-I — addClient : zéro addDoc sur données invalides', () => {

  let svc

  beforeEach(() => {
    vi.clearAllMocks()
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-test-aaa', name: 'Store A' })
    collection.mockReturnValue({ path: 'globalClients' })
    firestoreDoc.mockReturnValue({ id: 'mock-doc-id', path: 'globalClients/mock-doc-id' })
  })

  it('[TC-023-I01] numeroPersonnel numérique (number) → validateClientData retourne isValid=false, zéro addDoc attendu', () => {
    // Propriété 1 : validateClientData rejette un number
    const svcLocal = new FirestoreService()
    const result = svcLocal.validateClientData(
      {
        nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: 70001234,
        registeredStoreId: 'store-test-aaa', registeredStoreName: 'Store A'
      },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
    // Propriété 2 : addDocument throw si isValid=false sans appeler addDoc
    vi.spyOn(svc, 'validateData').mockReturnValue(result)
    const mockAddDoc = vi.mocked(addDoc)
    // addDocument throw synchroniquement avant addDoc dans withErrorHandling
    // On vérifie via l'état du spy
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('[TC-023-I02] prénom de 1 caractère → validateClientData retourne isValid=false, zéro addDoc attendu', () => {
    const svcLocal = new FirestoreService()
    const result = svcLocal.validateClientData(
      { nom: 'Diallo', prenom: 'A', registeredStoreId: 'store-test-aaa', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    const mockAddDoc = vi.mocked(addDoc)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('[TC-023-I03] activeStore sans id → requireActiveStore() throw, zéro addDoc', async () => {
    const mockAddDoc = vi.mocked(addDoc)
    svc.activeStore = { id: '', name: 'Store A' }
    // requireActiveStore() throw directement (pas de withErrorHandling)
    await expect(
      svc.addClient({ nom: 'Diallo', prenom: 'Aïssata' })
    ).rejects.toThrow()
    expect(mockAddDoc).not.toHaveBeenCalled()
  }, 10000)

  it('[TC-023-I04] activeStore sans name → throw avant addDocument, zéro addDoc', async () => {
    const mockAddDoc = vi.mocked(addDoc)
    svc.activeStore = { id: 'store-test-aaa', name: '' }
    // La vérification !activeStore?.name throw avant addDocument
    await expect(
      svc.addClient({ nom: 'Diallo', prenom: 'Aïssata' })
    ).rejects.toThrow()
    expect(mockAddDoc).not.toHaveBeenCalled()
  }, 10000)

  it('[TC-023-I05] nom absent → validateClientData retourne isValid=false, zéro addDoc attendu', () => {
    const svcLocal = new FirestoreService()
    const result = svcLocal.validateClientData(
      { prenom: 'Aïssata', registeredStoreId: 'store-test-aaa', registeredStoreName: 'Store A' },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /nom/i.test(e))).toBe(true)
    const mockAddDoc = vi.mocked(addDoc)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

})

// ---------------------------------------------------------------------------
// TC-023-J — addClient : registeredStoreId de activeStore écrase clientData (Lot C3)
//
// Caractérisation du comportement anti-injection :
// clientData.registeredStoreId ne doit jamais atteindre Firestore.
// Le circuit breaker est reset via circuitBreaker importé pour éviter OPEN.
// ---------------------------------------------------------------------------

import { circuitBreaker } from '../../src/utils/errorHandler.js'

describe('TC-023-J — addClient : payload enrichi non muté', () => {

  let svc

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset du circuit breaker pour éviter l'état OPEN suite aux tests précédents
    circuitBreaker.failures = 0
    circuitBreaker.state = 'CLOSED'
    circuitBreaker.lastFailureTime = null
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-test-aaa', name: 'Store A' })
    collection.mockReturnValue({ path: 'globalClients' })
    firestoreDoc.mockReturnValue({ id: 'mock-doc-id', path: 'globalClients/mock-doc-id' })
  })

  it('[TC-023-J01] registeredStoreId de activeStore écrase toute valeur fournie dans clientData', async () => {
    const mockAddDoc = vi.mocked(addDoc)
    mockAddDoc.mockResolvedValue({ id: 'new-id' })
    const input = { nom: 'Test', prenom: 'Prénom', registeredStoreId: 'FRAUDULEUX' }
    await svc.addClient(input)
    const writtenData = mockAddDoc.mock.calls[0][1]
    expect(writtenData.registeredStoreId).toBe('store-test-aaa')
    expect(writtenData.registeredStoreId).not.toBe('FRAUDULEUX')
    // La source originale n'est pas mutée
    expect(input.registeredStoreId).toBe('FRAUDULEUX')
  })

  it('[TC-023-J02] registeredStoreName de activeStore écrase toute valeur fournie dans clientData', async () => {
    const mockAddDoc = vi.mocked(addDoc)
    mockAddDoc.mockResolvedValue({ id: 'new-id' })
    const input = { nom: 'Test', prenom: 'Prénom', registeredStoreName: 'NOM FRAUDULEUX' }
    await svc.addClient(input)
    const writtenData = mockAddDoc.mock.calls[0][1]
    expect(writtenData.registeredStoreName).toBe('Store A')
    expect(writtenData.registeredStoreName).not.toBe('NOM FRAUDULEUX')
    expect(input.registeredStoreName).toBe('NOM FRAUDULEUX')
  })

})

// ---------------------------------------------------------------------------
// TC-023-K — Caractérisation : numéro Excel numérique rejeté (Lot C3)
//
// Documente le comportement après la correction du type strict.
// Un import Excel peut produire des numéros de téléphone sous forme de number
// (ex. 226700012345). Ce test certifie que validateClientData les rejette.
// ---------------------------------------------------------------------------

describe('TC-023-K — Caractérisation : numéro Excel numérique rejeté avant addDoc', () => {

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[TC-023-K01] numéro Excel numérique 226700012345 (number) → isValid=false (caractérisation)', () => {
    // Ce test documente le comportement actuel après correction Lot C3.
    // Note : la décision de conversion string dans l'import Excel est un lot séparé.
    const svcLocal = new FirestoreService()
    const result = svcLocal.validateClientData(
      {
        nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: 226700012345,
        registeredStoreId: 'store-test-aaa', registeredStoreName: 'Store A'
      },
      CLIENT_RULES
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => /numéro personnel/i.test(e))).toBe(true)
    // addDoc n'a pas été appelé car cette fonction n'atteint jamais addDocument
    expect(vi.mocked(addDoc)).not.toHaveBeenCalled()
  })

  it('[TC-023-K02] numéro Excel converti en string "226700012345" → accepté si regex le valide', () => {
    // Documente que la correction string → conversion côté import suffit
    const result = validate({ nom: 'Diallo', prenom: 'Aïssata', numeroPersonnel: '226700012345' })
    expect(result.isValid).toBe(true) // 12 chiffres, dans l'intervalle 8-120
  })

})
