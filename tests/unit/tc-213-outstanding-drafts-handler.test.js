import { describe, expect, it, vi } from 'vitest'
import {
  aggregateOutstandingDrafts,
  listOutstandingDraftsHandler,
} from '../../functions/src/dealerMetrics/listOutstandingDrafts.js'
import { agregerArgentDehors } from '../../src/utils/argentDehors.js'

const doc = (id, data) => ({ id, data: () => data })

describe('TC-213-A — agrégat dealer côté serveur', () => {
  it('ne retourne que les totaux utiles, par boutique active', () => {
    const result = aggregateOutstandingDrafts({
      stores: [doc('store-a', { name: 'FADA' }), doc('store-b', { name: 'POUYTENGA' })],
      drafts: [
        { storeId: 'store-a', type: 'Dépôt', montant: 100000, remainingAmount: 60000 },
        { storeId: 'store-a', type: 'Retrait', montant: 10000 },
        { storeId: 'store-fermee', type: 'Dépôt', montant: 900000 },
      ],
    })

    expect(result).toEqual({
      parBoutique: [{ storeId: 'store-a', name: 'FADA', depots: 60000, retraits: 10000, dehors: 50000 }],
      depots: 60000,
      retraits: 10000,
      dehors: 50000,
      illisibles: 0,
      horsReseau: 1,
    })
    expect(JSON.stringify(result)).not.toContain('client')
  })

  it('déclare les montants et types illisibles', () => {
    const result = aggregateOutstandingDrafts({
      stores: [doc('store-a', { name: 'FADA' })],
      drafts: [
        { storeId: 'store-a', type: 'Crédit', montant: 1000 },
        { storeId: 'store-a', type: 'Dépôt', montant: 'x' },
      ],
    })
    expect(result.illisibles).toBe(2)
    expect(result.dehors).toBe(0)
  })

  it('reste en parité avec la règle métier historique du front', () => {
    const storeDocs = [doc('store-a', { name: 'FADA' }), doc('store-b', { name: 'POUYTENGA' })]
    const stores = storeDocs.map((store) => ({ storeId: store.id, name: store.data().name }))
    const drafts = [
      { storeId: 'store-a', type: 'DÉPÔT', montant: 100000, remainingAmount: 70000 },
      { storeId: 'store-a', type: 'retrait', montant: 5000 },
      { storeId: 'store-b', type: 'Depot', montant: 12000 },
      { storeId: 'store-b', type: 'Crédit', montant: 8000 },
    ]
    expect(aggregateOutstandingDrafts({ stores: storeDocs, drafts }))
      .toEqual(agregerArgentDehors(drafts, stores))
  })
})

describe('TC-213-B — autorisation du callable', () => {
  const makeDb = ({ profile = { active: true, role: 'dealer' }, profileExists = true } = {}) => {
    const storesGet = vi.fn(async () => ({ docs: [doc('store-a', { name: 'FADA' })] }))
    const draftsGet = vi.fn(async () => ({ docs: [
      { ref: { parent: { parent: { id: 'store-a' } } }, data: () => ({ type: 'Dépôt', montant: 5000 }) },
    ] }))
    return {
      doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: profileExists, data: () => profile })) })),
      collection: vi.fn(() => ({ where: vi.fn(() => ({ get: storesGet })) })),
      collectionGroup: vi.fn(() => ({ get: draftsGet })),
      storesGet,
      draftsGet,
    }
  }

  it('refuse un rôle boutique avant de lire les brouillons', async () => {
    const db = makeDb({ profile: { active: true, role: 'store_admin' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('refuse un profil absent avant de lire les brouillons', async () => {
    const db = makeDb({ profileExists: false })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('refuse un dealer inactif avant de lire les brouillons', async () => {
    const db = makeDb({ profile: { active: false, role: 'dealer' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('agrège les brouillons pour un dealer actif', async () => {
    const db = makeDb()
    const result = await listOutstandingDraftsHandler({ auth: { uid: 'dealer-1' }, data: {} }, { db })
    expect(result).toMatchObject({ success: true, dehors: 5000, depots: 5000, retraits: 0 })
    expect(db.storesGet).toHaveBeenCalledOnce()
    expect(db.draftsGet).toHaveBeenCalledOnce()
  })

  /**
   * ⚠ LE GARDE S'ÉLARGIT, IL NE S'OUVRE PAS. L'écran Boutiques du patron a
   *   besoin de cet agrégat ; les règles l'autorisent déjà à lire `drafts` en
   *   collection-group (`firestore.rules`, `{path=**}/drafts`), mais une
   *   lecture directe ferait descendre TOUS les brouillons du réseau sur son
   *   téléphone pour n'afficher que 84 sommes. D'où la callable — et d'où ces
   *   quatre tests, qui tiennent les DEUX sens : ce qui s'ouvre, et ce qui
   *   doit rester fermé.
   *
   * ⚠ CHAQUE REFUS VÉRIFIE AUSSI QUE `draftsGet` N'A PAS ÉTÉ APPELÉ. Un garde
   *   qui refuse APRÈS avoir lu les brouillons du réseau entier a déjà fait la
   *   dépense et la lecture : le refus doit tomber avant, et c'est l'assertion
   *   qui le prouve. C'est la règle que les quatre tests existants de ce bloc
   *   tiennent déjà.
   */
  it('accepte un system_manager actif', async () => {
    const db = makeDb({ profile: { active: true, role: 'system_manager' } })
    const result = await listOutstandingDraftsHandler({ auth: { uid: 'patron-1' }, data: {} }, { db })
    expect(result).toMatchObject({ success: true, dehors: 5000, depots: 5000, retraits: 0 })
    expect(db.draftsGet).toHaveBeenCalledOnce()
  })

  it('refuse toujours un member', async () => {
    const db = makeDb({ profile: { active: true, role: 'member' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('refuse un system_manager désactivé', async () => {
    const db = makeDb({ profile: { active: false, role: 'system_manager' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('refuse toujours un appel sans authentification', async () => {
    const db = makeDb()
    await expect(listOutstandingDraftsHandler({ auth: null, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })
})
