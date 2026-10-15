import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * TC-265 — l'abonnement global du patron, et la précondition du gérant intacte.
 *
 * ⚠ CE QUE CE TEST NE PROUVE PAS, ET IL FAUT LE SAVOIR. Il ne vérifie aucun
 *   rôle : ce service n'en connaît aucun. Le rôle est tenu par le `RoleGuard`
 *   de la route et par `firestore.rules`.
 *
 * ⚠ ET CE QU'IL FIGE VRAIMENT : que personne n'assouplisse `subscribeToClients`
 *   pour servir le patron. `requireActiveStore()` n'y filtre rien — la
 *   collection `globalClients` est à la RACINE — mais c'est la précondition
 *   juste pour les neuf écrans du gérant, dont le reste est bien cloisonné.
 */

const onSnapshot = vi.fn(() => vi.fn())
const collection = vi.fn((_db, path) => ({ path }))

vi.mock('firebase/firestore', () => ({
  collection: (...a) => collection(...a),
  onSnapshot: (...a) => onSnapshot(...a),
  doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(),
  where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  serverTimestamp: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), deleteDoc: vi.fn(), writeBatch: vi.fn(),
  getCountFromServer: vi.fn(), collectionGroup: vi.fn(), runTransaction: vi.fn(),
}))

vi.mock('../../src/config/firebase.js', () => ({ db: {}, auth: {}, functions: {} }))

const { firestoreService } = await import('../../src/services/firestore.js')

beforeEach(() => {
  onSnapshot.mockClear()
  collection.mockClear()
  firestoreService.setActiveStore(null)
})

describe('TC-265 — le patron s’abonne sans boutique active', () => {
  it('[TC-265-01] `subscribeToAllClients` ne lève pas sans boutique active', () => {
    expect(() => firestoreService.subscribeToAllClients(vi.fn())).not.toThrow()
  })

  it('[TC-265-02] il vise la racine `globalClients`', () => {
    firestoreService.subscribeToAllClients(vi.fn())
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  it('[TC-265-03] il rend la fonction de désabonnement', () => {
    const stop = vi.fn()
    onSnapshot.mockReturnValueOnce(stop)
    expect(firestoreService.subscribeToAllClients(vi.fn())).toBe(stop)
  })

  it('[TC-265-04] les documents arrivent avec leur identifiant', () => {
    const recu = vi.fn()
    firestoreService.subscribeToAllClients(recu)
    const [, surSuivant] = onSnapshot.mock.calls[0]
    surSuivant({ docs: [{ id: 'c1', data: () => ({ nom: 'OUEDRAOGO' }) }] })
    expect(recu).toHaveBeenCalledWith([{ id: 'c1', nom: 'OUEDRAOGO' }])
  })
})

describe('TC-265 — le chemin du gérant garde sa précondition', () => {
  it('[TC-265-05] `subscribeToClients` lève toujours sans boutique active', () => {
    expect(() => firestoreService.subscribeToClients(vi.fn()))
      .toThrow(/Boutique active introuvable/)
  })

  it('[TC-265-06] et il fonctionne avec une boutique active', () => {
    firestoreService.setActiveStore({ id: 's1', name: 'FADA' })
    expect(() => firestoreService.subscribeToClients(vi.fn())).not.toThrow()
  })
})
