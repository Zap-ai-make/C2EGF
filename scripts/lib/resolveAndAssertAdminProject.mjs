/**
 * Résolution et validation stricte du projet Firebase pour les scripts Admin.
 *
 * Règles :
 *   Cas A — service account fourni :
 *     - project_id doit être présent, string, non vide après trim
 *     - project_id est validé par assertFirebaseProject()
 *     - GCLOUD_PROJECT ne peut jamais remplacer project_id
 *     - Si GCLOUD_PROJECT est présent et diffère de project_id → erreur de cohérence
 *
 *   Cas B — pas de service account :
 *     - GCLOUD_PROJECT est utilisé
 *     - Il doit passer assertFirebaseProject()
 *
 * Aucun fallback silencieux (|| ou ??).
 * Aucune initialisation Firebase dans ce module.
 */

import { assertFirebaseProject, AssertFirebaseProjectError } from './assertFirebaseProject.mjs'

export { AssertFirebaseProjectError }

/**
 * Résout et valide le projectId depuis les credentials ou l'environnement.
 *
 * @param {{ serviceAccount: object|null, envProjectId: string|undefined }} opts
 * @returns {string} projectId validé
 * @throws {AssertFirebaseProjectError}
 */
export function resolveAndAssertAdminProject({ serviceAccount, envProjectId }) {
  if (serviceAccount !== null && serviceAccount !== undefined) {
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

    if (rawId.trim() === '') {
      throw new AssertFirebaseProjectError(
        'SERVICE_ACCOUNT_EMPTY_PROJECT_ID',
        'Le project_id du service account est vide ou ne contient que des espaces. Opération bloquée.'
      )
    }

    const projectId = assertFirebaseProject(rawId)

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

  return assertFirebaseProject(envProjectId)
}
