import { readFile } from 'node:fs/promises'
import {
  resolveAndAssertAdminProject,
  AssertFirebaseProjectError,
} from './resolveAndAssertAdminProject.mjs'

export { AssertFirebaseProjectError }

export const MISSING_ADMIN_CREDENTIALS_MESSAGE =
  'GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du service account Firebase Admin.'

/**
 * Initialise Firebase Admin Auth uniquement après validation du projet porté
 * par le service account. Les dépendances injectables gardent cet ordre
 * testable sans charger le SDK Firebase.
 *
 * @param {{
 *   serviceAccountPath: string,
 *   envProjectId: string|undefined,
 *   readFileImpl?: typeof readFile,
 *   loadAdminApp?: () => Promise<{ initializeApp: Function, cert: Function }>,
 *   loadAdminAuth?: () => Promise<{ getAuth: Function }>
 * }} opts
 * @returns {Promise<unknown>} instance Firebase Admin Auth
 */
export async function initializeGuardedAdminAuth({
  serviceAccountPath,
  envProjectId,
  readFileImpl = readFile,
  loadAdminApp = () => import('firebase-admin/app'),
  loadAdminAuth = () => import('firebase-admin/auth'),
}) {
  const serviceAccount = JSON.parse(await readFileImpl(serviceAccountPath, 'utf8'))

  // Cette garde doit rester avant le chargement du SDK et initializeApp().
  resolveAndAssertAdminProject({ serviceAccount, envProjectId })

  const [{ initializeApp, cert }, { getAuth }] = await Promise.all([
    loadAdminApp(),
    loadAdminAuth(),
  ])

  initializeApp({
    credential: cert(serviceAccount),
  })

  return getAuth()
}

/**
 * Adaptateur CLI commun aux scripts de gestion de comptes. Les erreurs de
 * garde produisent le message historique et terminent le processus ; les
 * erreurs de lecture ou du SDK restent remontées à l'appelant.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   reportError?: (message: string) => void,
 *   exitProcess?: (code: number) => void,
 *   readFileImpl?: typeof readFile,
 *   loadAdminApp?: () => Promise<{ initializeApp: Function, cert: Function }>,
 *   loadAdminAuth?: () => Promise<{ getAuth: Function }>
 * }} opts
 * @returns {Promise<unknown|undefined>} instance Firebase Admin Auth
 */
export async function initializeGuardedAdminAuthCli({
  env = process.env,
  reportError = console.error,
  exitProcess = (code) => process.exit(code),
  readFileImpl = readFile,
  loadAdminApp = () => import('firebase-admin/app'),
  loadAdminAuth = () => import('firebase-admin/auth'),
} = {}) {
  const serviceAccountPath = env.GOOGLE_APPLICATION_CREDENTIALS

  if (!serviceAccountPath) {
    reportError(MISSING_ADMIN_CREDENTIALS_MESSAGE)
    exitProcess(1)
    return undefined
  }

  try {
    return await initializeGuardedAdminAuth({
      serviceAccountPath,
      envProjectId: env.GCLOUD_PROJECT,
      readFileImpl,
      loadAdminApp,
      loadAdminAuth,
    })
  } catch (error) {
    if (error instanceof AssertFirebaseProjectError) {
      reportError(`Opération bloquée [${error.code}] : ${error.message}`)
      exitProcess(1)
      return undefined
    }
    throw error
  }
}
