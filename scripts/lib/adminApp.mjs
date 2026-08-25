/**
 * Module Admin SDK — émulateur uniquement, aucun fallback.
 *
 * Lance une AdminEnvError (code typé) si l'environnement n'est pas conforme.
 * Les scripts CLI importent ce module dynamiquement et interceptent l'erreur.
 *
 * Gardes (dans l'ordre, toutes actives sans exception) :
 *   1. c2egf-b0b5a (production) bloqué absolument
 *   2. FIREBASE_AUTH_EMULATOR_HOST requis et non vide
 *   3. FIRESTORE_EMULATOR_HOST requis et non vide
 *   4. GCLOUD_PROJECT requis et non vide
 *   5. GCLOUD_PROJECT doit commencer par "demo-"
 *
 * initializeApp() n'est appelé qu'après validation complète.
 * Aucun ALLOW_REAL_FIREBASE. Aucun fallback FIREBASE_PROJECT_ID.
 * Aucun projectId par défaut.
 */

import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { AdminEnvError, validateEmulatorEnv } from './technicalUserProvisioning.mjs'

const envResult = validateEmulatorEnv(process.env)

if (!envResult.ok) {
  throw new AdminEnvError(envResult.code, envResult.message)
}

const { projectId } = envResult

const _app = initializeApp({ projectId })

export const auth = getAuth()
export const db = getFirestore()
export const isEmulator = true
export { projectId }
export { AdminEnvError }

export async function closeAdminApp() {
  await deleteApp(_app)
}
