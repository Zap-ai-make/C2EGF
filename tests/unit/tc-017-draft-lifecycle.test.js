/**
 * TC-017 — Module draftLifecycle importable sans Firebase
 *
 * Comportement à protéger :
 *   Le module src/utils/draftLifecycle.js doit être importable sans
 *   initialiser Firebase et doit exporter les fonctions pures suivantes
 *   avec un comportement identique à celui de FirestoreService :
 *
 *   - buildDraftPayload       : fusion currentDraft + updates + statut PENDING
 *   - computeDraftUpdateImpacts : reverse + apply des impacts financiers
 *
 * Interdictions : aucun import Firebase, aucun accès réseau.
 * Les fonctions testées ici sont pures (pas d'effets de bord).
 *
 * Fichiers source :
 *   src/utils/draftLifecycle.js
 *   src/utils/financialImpact.js (délégation)
 *   src/constants/firestoreConstants.js
 *
 * TC-017-DL2 — Tests d'intégration unitaire de FirestoreService.updateDraft
 *   Exercent réellement le corps du callback passé à runTransaction.
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — obligatoires pour importer FirestoreService
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
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
// Imports après mocks
// ---------------------------------------------------------------------------

import {
  buildDraftPayload,
  computeDraftUpdateImpacts,
} from '../../src/utils/draftLifecycle.js'

import {
  applyInitialTransactionImpact,
  reverseInitialTransactionImpact,
  normalizeNetworkBalances,
} from '../../src/utils/financialImpact.js'

import { FirestoreService } from '../../src/services/firestore.js'
import { runTransaction } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Fixtures partagées
// ---------------------------------------------------------------------------

const baseBalances = {
  Orange:  { stock: 2000, liquidite: 1000 },
  Moov:    { stock: 1500, liquidite:  500 },
  Telecel: { stock:  800, liquidite:  200 },
  Coris:   { stock:  400, liquidite:  100 },
  Sank:    { stock:  200, liquidite:   50 }
}

const depositDraft = {
  type:    'Dépôt',
  reseau:  'Orange',
  montant: 500,
  statut:  'Non Terminées',
  clientId: 'client-001',
  date:    '20/06/2026'
}

const withdrawalDraft = {
  type:    'Retrait',
  reseau:  'Moov',
  montant: 300,
  statut:  'Non Terminées',
  clientId: 'client-002',
  date:    '20/06/2026'
}

const creditDraft = {
  type:    'Crédit',
  reseau:  'Telecel',
  montant: 100,
  statut:  'Non Terminées',
  clientId: 'client-003',
  date:    '20/06/2026'
}

// ---------------------------------------------------------------------------
// TC-017-E : Smoke test — import sans Firebase
// ---------------------------------------------------------------------------

describe('TC-017-E — Smoke test import sans Firebase', () => {
  it('toutes les fonctions exportées sont des fonctions', () => {
    expect(typeof buildDraftPayload).toBe('function')
    expect(typeof computeDraftUpdateImpacts).toBe('function')
  })

  it('buildDraftPayload peut être appelée sans initialiser Firebase', () => {
    const result = buildDraftPayload(depositDraft, { montant: 600 })
    expect(result).toBeDefined()
  })

  it('computeDraftUpdateImpacts peut être appelée sans initialiser Firebase', () => {
    const nextDraft = buildDraftPayload(depositDraft, { montant: 600 })
    const result = computeDraftUpdateImpacts(depositDraft, nextDraft, baseBalances)
    expect(result).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// TC-017-A : buildDraftPayload
// ---------------------------------------------------------------------------

describe('TC-017-A — buildDraftPayload', () => {
  it('fusionne currentDraft avec updates et force statut PENDING', () => {
    const result = buildDraftPayload(depositDraft, { montant: 750 })
    expect(result.montant).toBe(750)
    expect(result.statut).toBe('Non Terminées')
    expect(result.type).toBe('Dépôt')
    expect(result.reseau).toBe('Orange')
    expect(result.clientId).toBe('client-001')
  })

  it('écrase le statut même si updates contient un autre statut', () => {
    const result = buildDraftPayload(depositDraft, { statut: 'Validée', montant: 200 })
    expect(result.statut).toBe('Non Terminées')
  })

  it('updates sans montant préserve l ancien montant', () => {
    const result = buildDraftPayload(depositDraft, { reseau: 'Moov' })
    expect(result.montant).toBe(depositDraft.montant)
    expect(result.reseau).toBe('Moov')
  })

  it('updates vide retourne une copie avec statut PENDING', () => {
    const result = buildDraftPayload(depositDraft, {})
    expect(result.type).toBe(depositDraft.type)
    expect(result.montant).toBe(depositDraft.montant)
    expect(result.statut).toBe('Non Terminées')
  })

  it('n immute pas l objet currentDraft', () => {
    const original = { ...depositDraft }
    buildDraftPayload(original, { montant: 999 })
    expect(original.montant).toBe(depositDraft.montant)
  })

  it('n immute pas l objet updates', () => {
    const updates = { montant: 200 }
    buildDraftPayload(depositDraft, updates)
    expect(updates.statut).toBeUndefined()
  })

  it('ajoute des champs nouveaux présents dans updates', () => {
    const result = buildDraftPayload(depositDraft, { note: 'Urgent' })
    expect(result.note).toBe('Urgent')
  })

  it('le résultat est un objet plain (pas une référence au currentDraft)', () => {
    const result = buildDraftPayload(depositDraft, {})
    result.montant = 9999
    expect(depositDraft.montant).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// TC-017-C : computeDraftUpdateImpacts
// ---------------------------------------------------------------------------

describe('TC-017-C — computeDraftUpdateImpacts', () => {
  it('retourne restoredBalances et nextBalances', () => {
    const nextDraft = buildDraftPayload(depositDraft, { montant: 600 })
    const result = computeDraftUpdateImpacts(depositDraft, nextDraft, baseBalances)
    expect(result).toHaveProperty('restoredBalances')
    expect(result).toHaveProperty('nextBalances')
  })

  it('Dépôt Orange 500→600 : restoredBalances restaure le stock avant, nextBalances applique 600', () => {
    // Etat après création du draft initial (stock Orange diminué de 500)
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, depositDraft)
    // baseBalances.Orange.stock = 2000 → 1500
    expect(balancesAfterInitial.Orange.stock).toBe(1500)

    const nextDraft = buildDraftPayload(depositDraft, { montant: 600 })
    const { restoredBalances, nextBalances } = computeDraftUpdateImpacts(
      depositDraft,
      nextDraft,
      balancesAfterInitial
    )

    // restoredBalances = reverse(depositDraft 500) → stock remonte à 2000
    expect(restoredBalances.Orange.stock).toBe(2000)
    // nextBalances = apply(nextDraft 600) → stock descend à 1400
    expect(nextBalances.Orange.stock).toBe(1400)
    // La liquidité ne bouge pas (statut Non Terminées)
    expect(nextBalances.Orange.liquidite).toBe(baseBalances.Orange.liquidite)
  })

  it('Retrait Moov 300→200 : restoredBalances retire le stock ajouté, nextBalances applique 200', () => {
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, withdrawalDraft)
    // Retrait Non Terminées augmente le stock : 1500 + 300 = 1800
    expect(balancesAfterInitial.Moov.stock).toBe(1800)

    const nextDraft = buildDraftPayload(withdrawalDraft, { montant: 200 })
    const { restoredBalances, nextBalances } = computeDraftUpdateImpacts(
      withdrawalDraft,
      nextDraft,
      balancesAfterInitial
    )

    // reverse(Retrait 300) : 1800 - 300 = 1500
    expect(restoredBalances.Moov.stock).toBe(1500)
    // apply(Retrait 200) : 1500 + 200 = 1700
    expect(nextBalances.Moov.stock).toBe(1700)
  })

  it('Crédit Telecel 100→150 : restoredBalances restaure le stock avant, nextBalances applique 150', () => {
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, creditDraft)
    // Crédit Non Terminées : stock -= 100 → 700
    expect(balancesAfterInitial.Telecel.stock).toBe(700)

    const nextDraft = buildDraftPayload(creditDraft, { montant: 150 })
    const { restoredBalances, nextBalances } = computeDraftUpdateImpacts(
      creditDraft,
      nextDraft,
      balancesAfterInitial
    )

    // reverse(Crédit 100) : stock +100 → 800
    expect(restoredBalances.Telecel.stock).toBe(800)
    // apply(Crédit 150) : stock -150 → 650
    expect(nextBalances.Telecel.stock).toBe(650)
  })

  it('changement de réseau Orange→Moov sur un Dépôt', () => {
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, depositDraft)
    const nextDraft = buildDraftPayload(depositDraft, { reseau: 'Moov' })
    const { restoredBalances, nextBalances } = computeDraftUpdateImpacts(
      depositDraft,
      nextDraft,
      balancesAfterInitial
    )

    // reverse Orange 500 : Orange stock restauré
    expect(restoredBalances.Orange.stock).toBe(baseBalances.Orange.stock)
    // apply Moov 500 : Moov stock diminué
    expect(nextBalances.Moov.stock).toBe(baseBalances.Moov.stock - 500)
    // Orange stock inchangé après
    expect(nextBalances.Orange.stock).toBe(baseBalances.Orange.stock)
  })

  it('invariant : même montant et même réseau → nextBalances ≈ balances initiales', () => {
    // Si on applique compute avec les mêmes valeurs que le draft original,
    // nextBalances doit être identique aux balances passées en entrée (avant tout impact)
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, depositDraft)
    // nextDraft identique à currentDraft (même montant, même réseau)
    const nextDraft = buildDraftPayload(depositDraft, {})
    const { nextBalances } = computeDraftUpdateImpacts(depositDraft, nextDraft, balancesAfterInitial)

    // nextBalances doit être égal aux balancesAfterInitial (on reverse puis on reapplique la même chose)
    expect(nextBalances.Orange.stock).toBe(balancesAfterInitial.Orange.stock)
    expect(nextBalances.Orange.liquidite).toBe(balancesAfterInitial.Orange.liquidite)
  })

  it('n immute pas currentBalances', () => {
    const balances = { ...baseBalances, Orange: { ...baseBalances.Orange } }
    const originalStock = balances.Orange.stock
    const nextDraft = buildDraftPayload(depositDraft, { montant: 600 })
    computeDraftUpdateImpacts(depositDraft, nextDraft, balances)
    expect(balances.Orange.stock).toBe(originalStock)
  })

  it('n immute pas currentDraft', () => {
    const draft = { ...depositDraft }
    const nextDraft = buildDraftPayload(draft, { montant: 600 })
    computeDraftUpdateImpacts(draft, nextDraft, baseBalances)
    expect(draft.montant).toBe(500)
  })

  it('lance une erreur si le montant du currentDraft est invalide', () => {
    const invalidDraft = { ...depositDraft, montant: 0 }
    const nextDraft = buildDraftPayload(invalidDraft, { montant: 500 })
    expect(() => computeDraftUpdateImpacts(invalidDraft, nextDraft, baseBalances))
      .toThrow('Montant FCFA invalide')
  })

  it('lance une erreur si le montant du nextDraft est invalide', () => {
    const nextDraft = buildDraftPayload(depositDraft, { montant: -100 })
    expect(() => computeDraftUpdateImpacts(depositDraft, nextDraft, baseBalances))
      .toThrow('Montant FCFA invalide')
  })
})

// ---------------------------------------------------------------------------
// TC-017-D : Cohérence avec financialImpact.js
// ---------------------------------------------------------------------------

describe('TC-017-D — Cohérence avec financialImpact.js', () => {
  it('computeDraftUpdateImpacts.restoredBalances == reverseInitialTransactionImpact direct', () => {
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, depositDraft)
    const nextDraft = buildDraftPayload(depositDraft, { montant: 700 })

    const { restoredBalances } = computeDraftUpdateImpacts(depositDraft, nextDraft, balancesAfterInitial)
    const expected = reverseInitialTransactionImpact(balancesAfterInitial, depositDraft)

    expect(restoredBalances).toEqual(expected)
  })

  it('computeDraftUpdateImpacts.nextBalances == applyInitialTransactionImpact sur restoredBalances direct', () => {
    const balancesAfterInitial = applyInitialTransactionImpact(baseBalances, depositDraft)
    const nextDraft = buildDraftPayload(depositDraft, { montant: 700 })

    const { restoredBalances, nextBalances } = computeDraftUpdateImpacts(depositDraft, nextDraft, balancesAfterInitial)
    const expected = applyInitialTransactionImpact(restoredBalances, nextDraft)

    expect(nextBalances).toEqual(expected)
  })

  it('buildDraftPayload force statut Non Terminées — cohérent avec FIRESTORE_CONFIG.STATUS.PENDING', () => {
    const result = buildDraftPayload(depositDraft, {})
    expect(result.statut).toBe('Non Terminées')
  })

  it('les balances normalisées sont compatibles avec computeDraftUpdateImpacts', () => {
    // Avec balances normalisées (tous les stocks à 0) :
    // reverseInitialTransactionImpact d un Retrait fait stock -= amount → stock insuffisant
    const normalized = normalizeNetworkBalances({})
    const nextDraft = buildDraftPayload(withdrawalDraft, {})
    // reverse(Retrait Moov 300) : stock Moov -= 300 → impossible car stock = 0
    expect(() => computeDraftUpdateImpacts(withdrawalDraft, nextDraft, normalized))
      .toThrow('Stock insuffisant')
  })
})

// ---------------------------------------------------------------------------
// TC-017-DL2 — Tests d'intégration unitaire de FirestoreService.updateDraft
//
// Ces tests exercent réellement le corps du callback passé à runTransaction.
// Le mock de runTransaction exécute le callback avec un faux objet tx qui
// enregistre toutes les écritures.
//
// Architecture du mock :
//   - docRef et getNetworkBalanceDocRef sont espionnés pour retourner des
//     objets avec une propriété _type identifiable.
//   - tx.get distingue les refs par leur _type.
//   - tx.update et tx.set collectent les écritures dans capturedWrites.
// ---------------------------------------------------------------------------

describe('TC-017-DL2 — FirestoreService.updateDraft : vrai callback transactionnel', () => {
  // Données seed pour les tests DL2
  // Etat représentatif : un draft Dépôt Orange 300 a déjà été créé,
  // donc le stock Orange a été diminué de 300 lors de addTransaction.
  // Les balances stockées en Firestore reflètent cet état.
  const seedBalances = {
    Orange: { stock: 2000, liquidite: 1000 },
    Moov:   { stock: 1500, liquidite:  600 },
  }

  const seedDraft = {
    type:      'Dépôt',
    statut:    'Non Terminées',
    montant:   300,
    reseau:    'Orange',
    clientId:  'client-test',
    createdAt: 'mock-timestamp',
  }

  let svc
  let capturedWrites

  beforeEach(() => {
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-dl2', name: 'Boutique DL2' })
    capturedWrites = []

    vi.mocked(runTransaction).mockClear()

    // Espionner docRef et getNetworkBalanceDocRef pour des refs identifiables
    vi.spyOn(svc, 'docRef').mockImplementation((collectionName, id) => ({
      _type: 'draft',
      _collectionName: collectionName,
      id,
    }))
    vi.spyOn(svc, 'getNetworkBalanceDocRef').mockReturnValue({ _type: 'balance' })

    // Mock runTransaction qui exécute réellement le callback
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          if (ref._type === 'draft') {
            return {
              exists: () => true,
              data: () => ({ ...seedDraft }),
            }
          }
          if (ref._type === 'balance') {
            return {
              exists: () => true,
              data: () => ({ balances: { ...seedBalances } }),
            }
          }
          return { exists: () => false, data: () => null }
        }),
        update: vi.fn((ref, patch) => {
          capturedWrites.push({ op: 'update', ref, patch })
        }),
        set: vi.fn((ref, data, options) => {
          capturedWrites.push({ op: 'set', ref, data, options })
        }),
      }

      return callback(mockTx)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // DL2-N1 : Scénario nominal — changement de montant 300 → 500
  //
  // Calcul à la main :
  //   Impact initial (pending Dépôt Orange 300) : stock[Orange] -= 300 → 1700
  //   seedBalances.Orange.stock = 2000 (état APRÈS l'impact initial du draft)
  //
  //   Reverse (pending Dépôt Orange 300) :
  //     stock[Orange] += 300 → 2300... MAIS seedBalances = 2000
  //     → reverseInitialTransactionImpact({Orange:{stock:2000}}, {type:'Dépôt',statut:'Non Terminées',montant:300,reseau:'Orange'})
  //     → stock[Orange] += 300 → 2300
  //     Attends : seedBalances.Orange.stock + 300 = 2300
  //
  //   Apply nouveau (pending Dépôt Orange 500) :
  //     stock[Orange] -= 500 → 2300 - 500 = 1800
  //
  //   Résultat attendu :
  //     Orange.stock = 1800
  //     Moov.stock = 1500 (inchangé)
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-N1] updateDraft : changement de montant 300→500 applique reverse+apply correct', async () => {
    // Copies profondes prises avant l'appel pour vérifier l'immutabilité des seeds
    const seedBalancesBefore = JSON.parse(JSON.stringify(seedBalances))
    const seedDraftBefore = JSON.parse(JSON.stringify(seedDraft))

    const result = await svc.updateDraft('draft-001', { montant: 500 })

    // runTransaction a été appelé une fois
    expect(runTransaction).toHaveBeenCalledOnce()

    // L'update du draft contient le nouveau montant et le statut préservé
    const draftWrite = capturedWrites.find(w => w.op === 'update' && w.ref._type === 'draft')
    expect(draftWrite).toBeDefined()
    expect(draftWrite.patch.montant).toBe(500)
    expect(draftWrite.patch.statut).toBe('Non Terminées')
    expect(draftWrite.patch).toHaveProperty('updatedAt')
    // reseau n'est pas dans le patch car updates = { montant: 500 } ne le contient pas

    // L'écriture des balances reflète reverse(300) + apply(500)
    // reverse: Orange.stock 2000 + 300 = 2300
    // apply:   Orange.stock 2300 - 500 = 1800
    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    expect(balanceWrite.data.balances.Orange.stock).toBe(1800)
    expect(balanceWrite.data.balances.Moov.stock).toBe(1500)
    expect(balanceWrite.options).toEqual({ merge: true })

    // La valeur de retour contient l'id et les données du nextDraft
    expect(result.id).toBe('draft-001')
    expect(result.montant).toBe(500)
    expect(result.statut).toBe('Non Terminées')
    expect(result.reseau).toBe('Orange')

    // Les seeds ne doivent pas avoir été mutés
    expect(seedBalances).toEqual(seedBalancesBefore)
    expect(seedDraft).toEqual(seedDraftBefore)
  })

  // -------------------------------------------------------------------------
  // DL2-N2 : Scénario nominal — même montant, même réseau (idempotent)
  //
  // Calcul :
  //   reverse(Dépôt Orange 300) : 2000 + 300 = 2300
  //   apply(Dépôt Orange 300)   : 2300 - 300 = 2000
  //   → balances identiques aux seedBalances
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-N2] updateDraft : même montant et même réseau → balances inchangées', async () => {
    // Copies profondes prises avant l'appel pour vérifier l'immutabilité des seeds
    const seedBalancesBefore = JSON.parse(JSON.stringify(seedBalances))
    const seedDraftBefore = JSON.parse(JSON.stringify(seedDraft))

    const result = await svc.updateDraft('draft-001', { montant: 300 })

    expect(runTransaction).toHaveBeenCalledOnce()

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    // reverse puis apply annulent l'effet : Orange.stock reste à 2000
    // reverse(Dépôt Orange 300) : 2000 + 300 = 2300
    // apply(Dépôt Orange 300)   : 2300 - 300 = 2000
    expect(balanceWrite.data.balances.Orange.stock).toBe(2000)
    expect(balanceWrite.data.balances.Moov.stock).toBe(1500)
    expect(balanceWrite.options).toEqual({ merge: true })

    expect(result.montant).toBe(300)
    expect(result.statut).toBe('Non Terminées')

    // Les seeds ne doivent pas avoir été mutés
    expect(seedBalances).toEqual(seedBalancesBefore)
    expect(seedDraft).toEqual(seedDraftBefore)
  })

  // -------------------------------------------------------------------------
  // DL2-F1 : Montant décimal dans le patch — erreur avant runTransaction
  //
  // updateDraft valide updates.montant AVANT d'appeler runTransaction.
  // Aucune écriture ne doit être produite.
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-F1] updateDraft : montant décimal dans patch → erreur avant toute écriture', async () => {
    await expect(svc.updateDraft('draft-001', { montant: 300.5 }))
      .rejects.toThrow('Montant FCFA invalide')

    // runTransaction jamais appelé : la garde s'exécute avant
    expect(runTransaction).not.toHaveBeenCalled()
    expect(capturedWrites).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // DL2-F2 : Reverse de l'ancien impact impossible — stock insuffisant
  //
  // Un draft Retrait Moov 300 existe : reverse = stock -= 300.
  // Si le stock Moov est à 0, adjustBalanceValue lance "Stock insuffisant".
  // Aucune écriture ne doit passer.
  //
  // Calcul :
  //   seedDraft = {type:'Retrait', statut:'Non Terminées', montant:300, reseau:'Moov'}
  //   reverse(Retrait Moov 300) : stock[Moov] -= 300 → 0 - 300 = -300 → ERREUR
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-F2] updateDraft : reverse impossible (stock insuffisant) → aucune écriture', async () => {
    const withdrawalSeedDraft = {
      type:      'Retrait',
      statut:    'Non Terminées',
      montant:   300,
      reseau:    'Moov',
      clientId:  'client-test',
      createdAt: 'mock-timestamp',
    }

    // Balances avec Moov.stock = 0 : le reverse d'un Retrait va tenter stock -= 300 → impossible
    const insufficientBalances = {
      Orange: { stock: 2000, liquidite: 1000 },
      Moov:   { stock: 0, liquidite: 600 },
    }

    // Copies profondes prises avant l'appel pour vérifier l'immutabilité
    const withdrawalSeedDraftBefore = JSON.parse(JSON.stringify(withdrawalSeedDraft))
    const insufficientBalancesBefore = JSON.parse(JSON.stringify(insufficientBalances))

    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          if (ref._type === 'draft') {
            return {
              exists: () => true,
              data: () => ({ ...withdrawalSeedDraft }),
            }
          }
          if (ref._type === 'balance') {
            return {
              exists: () => true,
              data: () => ({ balances: { ...insufficientBalances } }),
            }
          }
          return { exists: () => false, data: () => null }
        }),
        update: vi.fn((ref, patch) => {
          capturedWrites.push({ op: 'update', ref, patch })
        }),
        set: vi.fn((ref, data, options) => {
          capturedWrites.push({ op: 'set', ref, data, options })
        }),
      }

      return callback(mockTx)
    })

    await expect(svc.updateDraft('draft-001', { montant: 500 }))
      .rejects.toThrow('Stock insuffisant')

    // 0 appels à tx.update et tx.set : aucune écriture ne doit avoir été collectée avant l'erreur
    expect(capturedWrites).toHaveLength(0)

    // Les seeds locaux ne doivent pas avoir été mutés
    expect(withdrawalSeedDraft).toEqual(withdrawalSeedDraftBefore)
    expect(insufficientBalances).toEqual(insufficientBalancesBefore)
  })

  // -------------------------------------------------------------------------
  // DL2-F3 : Draft inexistant
  //
  // tx.get retourne exists: false → updateDraft throw 'Transaction introuvable'
  // Aucune écriture.
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-F3] updateDraft : draft inexistant → erreur attendue', async () => {
    // Copie profonde avant l'appel pour vérifier l'immutabilité
    const seedBalancesBefore = JSON.parse(JSON.stringify(seedBalances))

    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          // Le draft n'existe pas
          if (ref._type === 'draft') {
            return { exists: () => false, data: () => null }
          }
          if (ref._type === 'balance') {
            return {
              exists: () => true,
              data: () => ({ balances: { ...seedBalances } }),
            }
          }
          return { exists: () => false, data: () => null }
        }),
        update: vi.fn((ref, patch) => {
          capturedWrites.push({ op: 'update', ref, patch })
        }),
        set: vi.fn((ref, data, options) => {
          capturedWrites.push({ op: 'set', ref, data, options })
        }),
      }

      return callback(mockTx)
    })

    await expect(svc.updateDraft('inexistant-id', { montant: 500 }))
      .rejects.toThrow('Transaction introuvable')

    // 0 appels à tx.update et tx.set
    expect(capturedWrites).toHaveLength(0)

    // Les seeds ne doivent pas avoir été mutés
    expect(seedBalances).toEqual(seedBalancesBefore)
  })

  // -------------------------------------------------------------------------
  // DL2-F4 : networkBalances absent
  //
  // Lecture du code updateDraft (ligne 892-893) :
  //   const balanceSnap = await tx.get(balanceRef)
  //   const currentBalances = this.normalizeNetworkBalances(
  //     balanceSnap.exists() ? balanceSnap.data() : {}
  //   )
  //
  // → Si exists() === false, normalizeNetworkBalances({}) est appelé,
  //   ce qui retourne les balances par défaut (tous les stocks à 0).
  //   updateDraft NE THROW PAS dans ce cas.
  //
  // Calcul avec balances à 0 :
  //   reverse(Dépôt Orange 300) : stock[Orange] += 300 → 0 + 300 = 300
  //   apply(Dépôt Orange 300)   : stock[Orange] -= 300 → 300 - 300 = 0
  //   → Orange.stock = 0 (annulation du seul impact pending)
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-F4] updateDraft : networkBalances absent → normalise à zéro, pas de throw', async () => {
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          if (ref._type === 'draft') {
            return {
              exists: () => true,
              data: () => ({ ...seedDraft }),
            }
          }
          // Balance absente
          if (ref._type === 'balance') {
            return { exists: () => false, data: () => null }
          }
          return { exists: () => false, data: () => null }
        }),
        update: vi.fn((ref, patch) => {
          capturedWrites.push({ op: 'update', ref, patch })
        }),
        set: vi.fn((ref, data, options) => {
          capturedWrites.push({ op: 'set', ref, data, options })
        }),
      }

      return callback(mockTx)
    })

    // updateDraft ne throw pas si balance absente : normalizeNetworkBalances({}) retourne les defaults (tous à 0)
    const result = await svc.updateDraft('draft-001', { montant: 300 })

    expect(runTransaction).toHaveBeenCalledOnce()

    // Le draft est bien mis à jour
    const draftWrite = capturedWrites.find(w => w.op === 'update' && w.ref._type === 'draft')
    expect(draftWrite).toBeDefined()
    expect(draftWrite.patch.montant).toBe(300)

    // Les balances normalisées à zéro donnent :
    // reverse(Dépôt Orange 300) : stock[Orange] 0 + 300 = 300
    // apply(Dépôt Orange 300)   : stock[Orange] 300 - 300 = 0
    // → Orange.stock = 0 (annulation du seul impact pending sur des balances vierges)
    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    expect(balanceWrite.data.balances.Orange.stock).toBe(0)
    expect(balanceWrite.options).toEqual({ merge: true })

    // La valeur de retour est définie
    expect(result).toBeDefined()
    expect(result.id).toBe('draft-001')
  })

  // -------------------------------------------------------------------------
  // DL2-N3 : Vérification de la structure complète de tx.set (balanceRef)
  //
  // updateDraft appelle tx.set(balanceRef, {balances: nextBalances, updatedAt: now}, {merge: true})
  // → options doit contenir merge: true
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-N3] updateDraft : tx.set des balances utilise merge:true', async () => {
    await svc.updateDraft('draft-001', { montant: 500 })

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    expect(balanceWrite.options).toEqual({ merge: true })
    expect(balanceWrite.data).toHaveProperty('balances')
    expect(balanceWrite.data).toHaveProperty('updatedAt')
  })

  // -------------------------------------------------------------------------
  // DL2-N4 : tx.update du draft contient updatedAt
  // -------------------------------------------------------------------------
  it('[TC-017-DL2-N4] updateDraft : tx.update du draft contient updatedAt', async () => {
    await svc.updateDraft('draft-001', { montant: 500 })

    const draftWrite = capturedWrites.find(w => w.op === 'update' && w.ref._type === 'draft')
    expect(draftWrite).toBeDefined()
    expect(draftWrite.patch).toHaveProperty('updatedAt')
  })
})
