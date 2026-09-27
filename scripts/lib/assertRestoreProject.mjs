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
 *      assertFirebaseProject() bloque c2egf-b0b5a et tout projet non demo-.
 *
 * Aucune initialisation Firebase ici. Fonction pure et testable.
 * Aucun message d'erreur n'expose de secret (private_key, client_email).
 */

import { assertFirebaseProject, AssertFirebaseProjectError } from './assertFirebaseProject.mjs'
import { resolveServiceAccountProject } from './resolveServiceAccountProject.mjs'

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

  const projectId = resolveServiceAccountProject({ serviceAccount, envProjectId })

  // Écriture réelle : cantonnée à un projet demo-* (jamais la production).
  // Le dry-run (lecture seule) reste autorisé quel que soit le projet.
  if (execute) {
    assertFirebaseProject(projectId)
  }

  return projectId
}
