/**
 * Garde projet dédiée au script de remise à zéro des données (resetDataToZero).
 *
 * Objectif de sécurité : la remise à zéro est l'opération la plus destructrice
 * du dépôt. Le dry-run (lecture seule) reste possible partout pour diagnostiquer,
 * mais toute écriture (--execute) est cantonnée aux projets demo-*, SAUF
 * déverrouillage production explicite à trois verrous côté garde :
 *
 *   1. --execute
 *   2. --allow-production (flag CLI)
 *   3. AKAYIS_ALLOW_PRODUCTION_RESET === 'true' (variable d'environnement, strict)
 *
 * Le quatrième verrou (confirmation tapée au clavier du projectId) vit dans le
 * script CLI, pas ici : cette garde reste pure, synchrone et testable.
 *
 * Règles :
 *   1. project_id du service account requis (string non vide après trim) si SA fourni,
 *      sinon envProjectId requis.
 *   2. Cohérence GCLOUD_PROJECT / service account (aucun remplacement silencieux).
 *   3. DRY-RUN (execute=false)  → autorisé sur TOUT projet cohérent (lecture seule).
 *   4. EXECUTE sur demo-*       → autorisé.
 *   5. EXECUTE sur c2egf-b0b5a  → autorisé UNIQUEMENT avec les verrous 2 et 3.
 *   6. EXECUTE sur tout autre projet non-demo → toujours bloqué (aucun opt-in).
 *
 * Aucune initialisation Firebase ici. Aucun message d'erreur n'expose de secret.
 */

import { assertFirebaseProject, AssertFirebaseProjectError } from './assertFirebaseProject.mjs'

export { AssertFirebaseProjectError }

// Projet de production de CE dépôt (= firebaseProject du profil C2EGF). En dur :
// une garde de sécurité se lit, elle ne se calcule pas. Conséquence voulue du
// changement d'ancien client : taofic-ajagbe relève désormais de la règle 6
// (tout autre projet non-demo → toujours bloqué), donc n'est plus effaçable
// depuis ce dépôt, même avec les verrous.
export const PRODUCTION_PROJECT_ID = 'c2egf-b0b5a'

/**
 * @param {{
 *   serviceAccount: object|null,
 *   envProjectId: string|undefined,
 *   execute: boolean,
 *   allowProductionFlag: boolean,
 *   envAllowProductionReset: string|undefined
 * }} opts
 * @returns {{ projectId: string, isProduction: boolean }}
 * @throws {AssertFirebaseProjectError}
 */
export function resolveResetProject({
  serviceAccount,
  envProjectId,
  execute,
  allowProductionFlag = false,
  envAllowProductionReset = undefined,
}) {
  let projectId

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
    projectId = rawId.trim()
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
  } else {
    if (envProjectId === null || envProjectId === undefined || String(envProjectId).trim() === '') {
      throw new AssertFirebaseProjectError(
        'MISSING_PROJECT_ID',
        'Aucun service account ni GCLOUD_PROJECT fourni. Opération bloquée.'
      )
    }
    projectId = String(envProjectId).trim()
  }

  const isProduction = projectId === PRODUCTION_PROJECT_ID

  if (!execute) {
    // Dry-run : lecture seule, autorisé partout (diagnostic).
    return { projectId, isProduction }
  }

  if (isProduction) {
    const missing = []
    if (!allowProductionFlag) missing.push('le flag --allow-production')
    if (envAllowProductionReset !== 'true') missing.push("la variable AKAYIS_ALLOW_PRODUCTION_RESET='true'")
    if (missing.length > 0) {
      throw new AssertFirebaseProjectError(
        'PRODUCTION_RESET_NOT_UNLOCKED',
        `Remise à zéro en PRODUCTION (${PRODUCTION_PROJECT_ID}) bloquée. ` +
        `Manque : ${missing.join(' et ')}. ` +
        'La confirmation interactive du projectId sera également exigée.'
      )
    }
    return { projectId, isProduction: true }
  }

  // Écriture réelle hors production : cantonnée à un projet demo-*.
  // L'opt-in production ne s'applique à aucun autre projet réel.
  assertFirebaseProject(projectId)

  return { projectId, isProduction: false }
}
