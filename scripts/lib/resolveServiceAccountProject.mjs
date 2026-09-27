import { AssertFirebaseProjectError } from './assertFirebaseProject.mjs'

/**
 * Extrait le project_id d'un compte de service et vérifie sa cohérence avec
 * GCLOUD_PROJECT. Cette fonction ne décide jamais si une opération est
 * autorisée sur le projet résolu.
 *
 * @param {{ serviceAccount: object, envProjectId: string|undefined }} opts
 * @returns {string} identifiant normalisé et cohérent
 * @throws {AssertFirebaseProjectError}
 */
export function resolveServiceAccountProject({ serviceAccount, envProjectId }) {
  const rawId = serviceAccount.project_id

  if (rawId === null || rawId === undefined) {
    throw new AssertFirebaseProjectError(
      'SERVICE_ACCOUNT_MISSING_PROJECT_ID',
      'Le service account ne contient pas de project_id. Opération bloquée.'
    )
  }

  if (typeof rawId !== 'string') {
    throw new AssertFirebaseProjectError(
      'SERVICE_ACCOUNT_INVALID_PROJECT_ID_TYPE',
      `Le project_id du service account doit être une chaîne, reçu : ${typeof rawId}. Opération bloquée.`
    )
  }

  const projectId = rawId.trim()
  if (projectId === '') {
    throw new AssertFirebaseProjectError(
      'SERVICE_ACCOUNT_EMPTY_PROJECT_ID',
      'Le project_id du service account est vide ou ne contient que des espaces. Opération bloquée.'
    )
  }

  if (envProjectId !== null && envProjectId !== undefined) {
    const envId = String(envProjectId).trim()
    if (envId !== '' && envId !== projectId) {
      throw new AssertFirebaseProjectError(
        'PROJECT_ID_MISMATCH',
        `Incohérence détectée : le service account porte le projet "${projectId}" ` +
        `mais GCLOUD_PROJECT vaut "${envId}". Opération bloquée.`
      )
    }
  }

  return projectId
}
