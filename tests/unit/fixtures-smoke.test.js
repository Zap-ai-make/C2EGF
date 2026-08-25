/**
 * Test de cohérence interne des fixtures.
 * Vérifie que les données de test sont bien formées et sans contradiction.
 * Aucun import depuis src/. Aucun import Firebase.
 */

import { describe, it, expect } from 'vitest'
import { storeA, storeB } from '../fixtures/stores.js'
import { storeAAdmin, storeAMember, storeBAdmin, inactiveUser, unauthorizedUser } from '../fixtures/users.js'
import { clientStoreA, clientStoreB, globalClientStoreA, globalClientStoreB } from '../fixtures/clients.js'
import {
  FIXED_NOW,
  transactionPending,
  transactionValidated,
  transactionCancelled,
  transactionStoreB,
  transactionWithFixedDate,
} from '../fixtures/transactions.js'

function hasNoUndefined(obj) {
  return Object.values(obj).every(v => v !== undefined)
}

describe('fixtures — cohérence interne', () => {
  it('storeA.id est différent de storeB.id', () => {
    expect(storeA.id).not.toBe(storeB.id)
  })

  it('storeAAdmin.storeId correspond à storeA.id', () => {
    expect(storeAAdmin.storeId).toBe(storeA.id)
  })

  it('storeBAdmin.storeId correspond à storeB.id', () => {
    expect(storeBAdmin.storeId).toBe(storeB.id)
  })

  it('storeAAdmin et storeBAdmin appartiennent à des boutiques différentes', () => {
    expect(storeAAdmin.storeId).not.toBe(storeBAdmin.storeId)
  })

  it('FIXED_NOW est une instance de Date', () => {
    expect(FIXED_NOW instanceof Date).toBe(true)
  })

  it('transactionPending.montant est un nombre', () => {
    expect(typeof transactionPending.montant).toBe('number')
  })

  it('transactionValidated.montant est un nombre', () => {
    expect(typeof transactionValidated.montant).toBe('number')
  })

  it.each([
    ['storeA', storeA],
    ['storeB', storeB],
    ['storeAAdmin', storeAAdmin],
    ['storeAMember', storeAMember],
    ['storeBAdmin', storeBAdmin],
    ['inactiveUser', inactiveUser],
    ['unauthorizedUser', unauthorizedUser],
    ['clientStoreA', clientStoreA],
    ['clientStoreB', clientStoreB],
    ['globalClientStoreA', globalClientStoreA],
    ['globalClientStoreB', globalClientStoreB],
    ['transactionPending', transactionPending],
    ['transactionValidated', transactionValidated],
    ['transactionCancelled', transactionCancelled],
    ['transactionStoreB', transactionStoreB],
    ['transactionWithFixedDate', transactionWithFixedDate],
  ])('%s ne contient aucune propriété undefined', (_name, fixture) => {
    expect(hasNoUndefined(fixture)).toBe(true)
  })
})
