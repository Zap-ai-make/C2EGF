import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TC-356 — sans réseau, un geste hors de la file d'envoi dit pourquoi (lot G3c).
 *
 * Modifier, annuler, ravitailler passent par le serveur sans file. La requête
 * n'aboutit pas, et le SDK le dit « internal [0] » : c'est ce que la caissière
 * lisait. Le code, lui, ne change pas : la file s'en sert pour retenter.
 */

const appel = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: () => appel }))
vi.mock('../../src/config/firebase', () => ({ functions: {} }))

const { runStoreTransactionCommand } = await import('../../src/services/storeTransactionCommandService.js')

beforeEach(() => appel.mockReset())

describe('TC-356 — le message sans réseau', () => {
  it('[MR-01] la requête n’a pas abouti : le message le dit, le code reste une panne', async () => {
    appel.mockRejectedValueOnce(Object.assign(new Error('internal [0]'), { code: 'functions/internal' }))
    await expect(runStoreTransactionCommand({ action: 'updateDraft' })).rejects.toMatchObject({
      message: 'Cette opération demande une connexion internet.',
      code: 'functions/internal',
    })
  })

  it('[MR-02] une vraie erreur du serveur garde son message et son code', async () => {
    appel.mockRejectedValueOnce(Object.assign(new Error('Stock insuffisant. [400]'), { code: 'functions/failed-precondition', details: { code: 'INSUFFICIENT_STORE_BALANCE' } }))
    await expect(runStoreTransactionCommand({ action: 'add' })).rejects.toMatchObject({
      message: 'Stock insuffisant. [400]',
      code: 'INSUFFICIENT_STORE_BALANCE',
    })
  })
})
