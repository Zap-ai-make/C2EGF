/**
 * Helpers réutilisables pour les tests de règles Firestore (TC-007 à TC-010).
 * Utilise exclusivement l'émulateur Firestore via @firebase/rules-unit-testing.
 * Aucun SDK Admin. Aucun accès Firebase production.
 */

import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

export { assertSucceeds, assertFails }

/**
 * Retourne un contexte Firestore authentifié pour l'uid donné.
 * Le contexte est lié à l'émulateur local (jamais au projet production).
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} testEnv
 * @param {string} uid
 */
export function getAuthenticatedContext(testEnv, uid) {
  return testEnv.authenticatedContext(uid)
}

/**
 * Retourne un contexte Firestore non authentifié.
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} testEnv
 */
export function getUnauthenticatedContext(testEnv) {
  return testEnv.unauthenticatedContext()
}

/**
 * Seed un document dans Firestore via withSecurityRulesDisabled (contourne les règles).
 * Utilisé exclusivement pour la mise en place des fixtures de test.
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} testEnv
 * @param {string} path - Chemin de la collection ou sous-collection,
 *   ex: 'users', 'globalClients', 'clients/store-test-aaa/history'
 * @param {string} docId - Identifiant du document
 * @param {object} data - Données du document
 */
export async function seedDocument(testEnv, path, docId, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore()
    const parts = path.split('/')
    // Construit le chemin complet : [...parts, docId]
    // Ex: 'clients/store-test-aaa/history' + 'hist-001'
    //   → doc(fs, 'clients', 'store-test-aaa', 'history', 'hist-001')
    await setDoc(doc(fs, ...parts, docId), data)
  })
}
