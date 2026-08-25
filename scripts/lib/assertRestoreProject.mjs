/**
 * Garde projet dédiée au script de restauration de compte (restoreDeletedAccount).
 *
 * Objectif de sécurité (audit) : le dépôt ne doit contenir AUCUN chemin
 * permettant une ÉCRITURE en production. La restauration reste utile en
 * lecture seule (dry-run) pour diagnostiquer, mais toute écriture (--execute)
 * est cantonnée aux projets demo-*.
 *
 * Règles :
 *   1. project_id du service account requis (string non vide après trim).
 *   2. Cohérence GCLOUD_PROJECT / service account (aucun remplacement silencieux).
 *   3. DRY-RUN (execute=false)  → autorisé sur TOUT projet (lecture seule).
 *   4. EXECUTE (execute=true)   → autorisé UNIQUEMENT sur un projet demo-*.
 *      assertFirebaseProject() bloque taofic-ajagbe et tout projet non demo-.
 *
 * Aucune initialisation Firebase ici. Fonction pure et testable.
 * Aucun message d'erreur n'expose de secret (private_key, client_email).
 */

import { assertFirebaseProject, AssertFirebaseProjectError } from './assertFirebaseProject.mjs'

export { AssertFirebaseProjectError }

/**
 * @param {{ serviceAccount: object|null, envProjectId: string|undefined, execute: boolean }} opts
 * @returns {string} projectId validé
 * @throws {AssertFirebaseProjectError}
 */
export function resolveRestoreProject({ serviceAccount, envProjectId, execute }) {
  if (serviceAccount === null || serviceAccount === undefined) {
    throw new AssertFirebaseProjectError(
      'SERVICE_ACCOUNT_MISSING',
      'Un service account est requis pour la restauration. Opération bloquée.'
    )
  }

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

  // Écriture réelle : cantonnée à un projet demo-* (jamais la production).
  // Le dry-run (lecture seule) reste autorisé quel que soit le projet.
  if (execute) {
    assertFirebaseProject(projectId)
  }

  return projectId
}
