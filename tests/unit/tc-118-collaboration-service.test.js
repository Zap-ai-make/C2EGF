/**
 * TC-118 — collaborationService : traduction des erreurs, parse du montant,
 *          et surtout le FILTRE DE STATUT CÔTÉ SERVEUR.
 *
 * Le contrat le plus coûteux à casser est celui-ci : `limit()` s'applique côté
 * serveur AVANT tout filtrage client. Filtrer après coup ferait disparaître des
 * lignes qui n'ont jamais été chargées — une file d'attente qui se vide toute
 * seule alors que le travail reste à faire. Les tests ci-dessous vérifient donc
 * que la contrainte de statut est bien DANS la requête, et dans le bon ordre.
 *
 * On vérifie aussi que le message brut du serveur n'est jamais exposé : il peut
 * porter des détails d'implémentation, et l'utilisateur doit lire du français.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock est hoisté au-dessus des imports : les doubles doivent donc être créés
// dans vi.hoisted, sinon la factory référencerait une variable non initialisée.
const { firestore, callableImpl } = vi.hoisted(() => ({
  firestore: {
    collection: vi.fn((_db, ...segments) => ({ _col: segments.join('/') })),
    collectionGroup: vi.fn((_db, name) => ({ _group: name })),
    doc: vi.fn(),
    query: vi.fn((...parts) => ({ _query: parts })),
    where: vi.fn((field, op, value) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field, dir) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n) => ({ _type: 'limit', n })),
    onSnapshot: vi.fn(() => vi.fn()),
  },
  callableImpl: vi.fn(),
}))

vi.mock('firebase/firestore', () => firestore)
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callableImpl) }))

vi.mock('../../src/config/firebase.js', () => ({ db: {}, functions: {}, auth: {}, default: {} }))

import {
  ERROR_MESSAGES,
  mapCollaborationError,
  parseAmount,
  generateIdempotencyKey,
  createStoreCollaboration,
  listStoreCollaborationProviders,
  declareInternalDebtSettlement,
  subscribeIncomingCollaborations,
  subscribeOutgoingCollaborations,
  subscribeIncomingCollaborationsCount,
  subscribeMyDebts,
  subscribeMyCredits,
  subscribeDebtSettlements,
  subscribePendingSettlementsCount,
} from '../../src/services/collaborationService.js'

// Les contraintes passées au dernier `query(...)` construit.
const lastConstraints = () => firestore.query.mock.calls.at(-1).slice(1)
const whereOn = (field) => lastConstraints().find((c) => c._type === 'where' && c.field === field)

beforeEach(() => {
  vi.clearAllMocks()
  firestore.onSnapshot.mockReturnValue(vi.fn())
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-118-A — le filtre de statut est DANS la requête, jamais après', () => {
  it('« Reçues » demande status == pending au serveur', () => {
    subscribeIncomingCollaborations({ storeId: 'store-B', statusFilter: 'pending', onUpdate: vi.fn() })
    expect(whereOn('supplierStoreId')).toMatchObject({ op: '==', value: 'store-B' })
    expect(whereOn('status')).toMatchObject({ op: '==', value: 'pending' })
  })

  it('« Mes demandes » filtre sur requestingStoreId', () => {
    subscribeOutgoingCollaborations({ storeId: 'store-A', statusFilter: 'pending', onUpdate: vi.fn() })
    expect(whereOn('requestingStoreId')).toMatchObject({ op: '==', value: 'store-A' })
    expect(whereOn('status')).toMatchObject({ op: '==', value: 'pending' })
  })

  it('le chemin historique demande plusieurs statuts avec « in »', () => {
    subscribeIncomingCollaborations({
      storeId: 'store-B', statuses: ['confirmed', 'rejected'], onUpdate: vi.fn(),
    })
    expect(whereOn('status')).toMatchObject({ op: 'in', value: ['confirmed', 'rejected'] })
  })

  it('la contrainte de statut précède orderBy et limit', () => {
    // Ordre imposé par Firestore : égalités, puis tri, puis fenêtre.
    subscribeIncomingCollaborations({ storeId: 'store-B', statusFilter: 'pending', onUpdate: vi.fn() })
    const kinds = lastConstraints().map((c) => c._type)
    expect(kinds.lastIndexOf('where')).toBeLessThan(kinds.indexOf('orderBy'))
    expect(kinds.indexOf('orderBy')).toBeLessThan(kinds.indexOf('limit'))
  })

  it('sans statut demandé, aucune contrainte de statut n’est inventée', () => {
    subscribeIncomingCollaborations({ storeId: 'store-B', onUpdate: vi.fn() })
    expect(whereOn('status')).toBeUndefined()
  })

  it('statusFilter l’emporte sur statuses (un seul chemin à la fois)', () => {
    subscribeIncomingCollaborations({
      storeId: 'store-B', statusFilter: 'pending', statuses: ['confirmed'], onUpdate: vi.fn(),
    })
    expect(whereOn('status')).toMatchObject({ op: '==', value: 'pending' })
  })

  it('la fenêtre par défaut est de 20 lignes, et reste pilotable', () => {
    subscribeIncomingCollaborations({ storeId: 'store-B', statusFilter: 'pending', onUpdate: vi.fn() })
    expect(lastConstraints().find((c) => c._type === 'limit')).toMatchObject({ n: 20 })

    subscribeIncomingCollaborations({ storeId: 'store-B', statuses: ['confirmed'], limitCount: 50, onUpdate: vi.fn() })
    expect(lastConstraints().find((c) => c._type === 'limit')).toMatchObject({ n: 50 })
  })

  it('les lignes remontées portent leur id', () => {
    const onUpdate = vi.fn()
    subscribeIncomingCollaborations({ storeId: 'store-B', statusFilter: 'pending', onUpdate })
    const onNext = firestore.onSnapshot.mock.calls.at(-1)[1]
    onNext({ docs: [{ id: 'c1', data: () => ({ amount: 20000 }) }] })
    expect(onUpdate).toHaveBeenCalledWith([{ id: 'c1', amount: 20000 }])
  })
})

describe('TC-118-B — dettes et tranches', () => {
  it('« Ce que je dois » filtre sur debtorStoreId', () => {
    subscribeMyDebts({ storeId: 'store-A', onUpdate: vi.fn() })
    expect(whereOn('debtorStoreId')).toMatchObject({ op: '==', value: 'store-A' })
  })

  it('« Ce qu’on me doit » filtre sur creditorStoreId', () => {
    subscribeMyCredits({ storeId: 'store-B', onUpdate: vi.fn() })
    expect(whereOn('creditorStoreId')).toMatchObject({ op: '==', value: 'store-B' })
  })

  it('les tranches d’une dette se lisent SANS clause where', () => {
    // La règle Firestore est écrite pour cette requête-là : une contrainte ici
    // n'est pas nécessaire, et la règle interroge le document parent.
    subscribeDebtSettlements({ debtId: 'debt-1', onUpdate: vi.fn() })
    expect(lastConstraints().some((c) => c._type === 'where')).toBe(false)
    expect(lastConstraints().find((c) => c._type === 'orderBy')).toMatchObject({ field: 'declaredAt', dir: 'desc' })
  })
})

describe('TC-118-C — compteurs de badge', () => {
  it('le badge « reçues » ne lit que la taille, sans tri ni fenêtre', () => {
    const onUpdate = vi.fn()
    subscribeIncomingCollaborationsCount({ storeId: 'store-B', onUpdate })
    const kinds = lastConstraints().map((c) => c._type)
    expect(kinds).not.toContain('orderBy')
    expect(kinds).not.toContain('limit')

    const onNext = firestore.onSnapshot.mock.calls.at(-1)[1]
    onNext({ size: 3 })
    expect(onUpdate).toHaveBeenCalledWith(3)
  })

  it('le badge « règlements à confirmer » filtre sur creditorStoreId — c’est ce qui évite la fuite', () => {
    // Le nom `settlements` est partagé avec le moteur de transactions client.
    // Ce filtre est ce qui exclut ces documents, exactement comme la règle.
    subscribePendingSettlementsCount({ storeId: 'store-B', onUpdate: vi.fn() })
    expect(firestore.collectionGroup).toHaveBeenCalledWith(expect.anything(), 'settlements')
    expect(whereOn('creditorStoreId')).toMatchObject({ op: '==', value: 'store-B' })
    expect(whereOn('settlementStatus')).toMatchObject({ op: '==', value: 'declared' })
  })

  it('sans boutique, le compteur vaut 0 et aucun abonnement n’est ouvert', () => {
    const onUpdate = vi.fn()
    const unsub = subscribePendingSettlementsCount({ storeId: null, onUpdate })
    expect(onUpdate).toHaveBeenCalledWith(0)
    expect(firestore.onSnapshot).not.toHaveBeenCalled()
    expect(typeof unsub).toBe('function')
    expect(() => unsub()).not.toThrow()
  })

  it('sans boutique, les listes rendent un tableau vide sans s’abonner', () => {
    const onUpdate = vi.fn()
    subscribeMyDebts({ storeId: undefined, onUpdate })
    expect(onUpdate).toHaveBeenCalledWith([])
    expect(firestore.onSnapshot).not.toHaveBeenCalled()
  })
})

describe('TC-118-D — traduction des erreurs serveur', () => {
  it('le code métier donne le message français', () => {
    const mapped = mapCollaborationError({ details: { code: 'INSUFFICIENT_SUPPLIER_BALANCE' } })
    expect(mapped.message).toBe(ERROR_MESSAGES.INSUFFICIENT_SUPPLIER_BALANCE)
    expect(mapped.code).toBe('INSUFFICIENT_SUPPLIER_BALANCE')
  })

  it('le message BRUT du serveur n’est jamais exposé', () => {
    const mapped = mapCollaborationError({
      message: 'Firestore transaction failed at internalDebts/abc line 42',
      details: { code: 'TRANSACTION_FAILED' },
    })
    expect(mapped.message).toBe(ERROR_MESSAGES.TRANSACTION_FAILED)
    expect(mapped.message).not.toContain('internalDebts')
  })

  it('un code inconnu reste NEUTRE plutôt que trompeur', () => {
    const mapped = mapCollaborationError({ details: { code: 'CODE_QUI_NEXISTE_PAS' } })
    expect(mapped.message).toBe("Une erreur inattendue s'est produite.")
    expect(mapped.code).toBe('CODE_QUI_NEXISTE_PAS')
  })

  it('une session expirée est reconnue même sans code métier', () => {
    const mapped = mapCollaborationError({ code: 'functions/unauthenticated' })
    expect(mapped.message).toBe(ERROR_MESSAGES.UNAUTHENTICATED)
    expect(mapped.code).toBe('UNAUTHENTICATED')
  })

  it('une erreur sans forme connue reste générique', () => {
    expect(mapCollaborationError(undefined).message).toBe("Une erreur inattendue s'est produite.")
    expect(mapCollaborationError({}).message).toBe("Une erreur inattendue s'est produite.")
  })

  it('chaque code serveur du module a son message', () => {
    for (const code of [
      'COLLABORATION_NOT_PENDING', 'COLLABORATION_STORE_MISMATCH', 'SAME_STORE_COLLABORATION',
      'DEBT_ALREADY_SETTLED', 'DEBT_STORE_MISMATCH', 'SETTLEMENT_EXCEEDS_REMAINING',
      'SETTLEMENT_INSUFFICIENT_BALANCE', 'NOT_OPPOSITE_PAIR', 'COMPENSATION_EXCEEDS_REMAINING',
      'IDEMPOTENCY_CONFLICT', 'INVALID_REJECTION_REASON', 'COLLABORATIONS_DISABLED',
    ]) {
      expect(ERROR_MESSAGES[code], `message manquant pour ${code}`).toBeTruthy()
    }
  })
})

describe('TC-118-E — le service est la source UNIQUE du parse de montant', () => {
  it('accepte une saisie de chiffres', () => {
    expect(parseAmount('20000')).toBe(20000)
    expect(parseAmount('  20000  ')).toBe(20000)
    expect(parseAmount(20000)).toBe(20000)
  })

  it('refuse tout le reste', () => {
    for (const bad of ['', '  ', '0', '-5', '12.5', '20 000', '20000a', 'abc', null, undefined, 0, -1, 12.5]) {
      expect(parseAmount(bad), `${bad} devrait être refusé`).toBeNull()
    }
  })

  it('la commande transmet un entier, jamais la saisie brute', async () => {
    callableImpl.mockResolvedValue({ data: { success: true, collaborationId: 'c1' } })
    await createStoreCollaboration({
      clientId: 'cl-1', operationType: 'deposit', amount: '  20000 ', supplierStoreId: 'store-B',
    })
    expect(callableImpl).toHaveBeenCalledWith(expect.objectContaining({ amount: 20000 }))
  })

  it('une saisie invalide échoue AVANT l’appel réseau', async () => {
    callableImpl.mockResolvedValue({ data: {} })
    await expect(createStoreCollaboration({
      clientId: 'cl-1', operationType: 'deposit', amount: '12.5', supplierStoreId: 'store-B',
    })).rejects.toMatchObject({ code: 'INVALID_COLLABORATION_AMOUNT' })
    expect(callableImpl).not.toHaveBeenCalled()
  })

  it('le réseau n’est jamais envoyé au serveur', () => {
    callableImpl.mockResolvedValue({ data: {} })
    createStoreCollaboration({ clientId: 'c', operationType: 'deposit', amount: '1', supplierStoreId: 's' })
    expect(callableImpl.mock.calls[0][0]).not.toHaveProperty('network')
  })
})

describe('TC-118-F — clé d’idempotence', () => {
  it('respecte le jeu de caractères accepté par le serveur', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{1,100}$/)
    }
  })

  it('deux appels successifs donnent deux clés différentes', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()))
    expect(keys.size).toBeGreaterThan(45)
  })

  it('une clé est générée d’office si l’appelant n’en fournit pas', async () => {
    callableImpl.mockResolvedValue({ data: { success: true } })
    await declareInternalDebtSettlement({ debtId: 'd1', amount: '5000', method: 'Cash' })
    expect(callableImpl.mock.calls[0][0].idempotencyKey).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('la clé fournie est respectée — c’est elle qui rend le rejeu idempotent', async () => {
    callableImpl.mockResolvedValue({ data: { success: true } })
    await declareInternalDebtSettlement({ debtId: 'd1', amount: '5000', method: 'Cash', idempotencyKey: 'k1' })
    expect(callableImpl.mock.calls[0][0].idempotencyKey).toBe('k1')
  })
})

describe('TC-118-G — annuaire des fournisseurs', () => {
  it('rend la liste des boutiques', async () => {
    callableImpl.mockResolvedValue({ data: { success: true, providers: [{ storeId: 'store-B', storeName: 'B' }] } })
    await expect(listStoreCollaborationProviders()).resolves.toEqual([{ storeId: 'store-B', storeName: 'B' }])
  })

  it('une réponse sans annuaire rend un tableau vide, pas undefined', async () => {
    callableImpl.mockResolvedValue({ data: { success: true } })
    await expect(listStoreCollaborationProviders()).resolves.toEqual([])
  })

  it('l’erreur serveur est traduite', async () => {
    callableImpl.mockRejectedValue({ details: { code: 'ROLE_FORBIDDEN' } })
    await expect(listStoreCollaborationProviders()).rejects.toMatchObject({
      code: 'ROLE_FORBIDDEN',
      message: ERROR_MESSAGES.ROLE_FORBIDDEN,
    })
  })
})
