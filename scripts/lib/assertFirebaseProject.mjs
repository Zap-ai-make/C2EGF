/**
 * Garde de projet Firebase — pure, sans connexion réseau.
 *
 * assertFirebaseProject(projectId) : vérifie qu'un projectId est sûr pour
 * les opérations émulateur. Lance une AssertFirebaseProjectError en cas d'échec.
 * Aucun SDK Firebase importé, aucune connexion réseau possible depuis ce module.
 *
 * Règles :
 *   1. projectId doit exister et être une string non vide (après trim).
 *   2. c2egf-b0b5a (production) est bloqué absolument.
 *   3. Le projectId doit commencer par "demo-" (casse sensible).
 */

export class AssertFirebaseProjectError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AssertFirebaseProjectError'
    this.code = code
  }
}

export function assertFirebaseProject(rawProjectId) {
  if (rawProjectId === null || rawProjectId === undefined) {
    throw new AssertFirebaseProjectError(
      'MISSING_PROJECT_ID',
      'Aucun projectId fourni (null ou undefined).'
    )
  }
  if (typeof rawProjectId !== 'string') {
    throw new AssertFirebaseProjectError(
      'INVALID_PROJECT_ID_TYPE',
      `projectId doit être une chaîne, reçu : ${typeof rawProjectId}.`
    )
  }
  const projectId = rawProjectId.trim()
  if (projectId === '') {
    throw new AssertFirebaseProjectError(
      'MISSING_PROJECT_ID',
      'Le projectId est vide ou ne contient que des espaces.'
    )
  }
  // Projet de production de CE dépôt (cf. config/clients/c2egf-burkina.js,
  // champ firebaseProject). Nommé en dur volontairement : une garde de sécurité
  // doit être lisible et greppable, jamais calculée.
  if (projectId === 'c2egf-b0b5a') {
    throw new AssertFirebaseProjectError(
      'PRODUCTION_PROJECT_BLOCKED',
      'Le projet de production c2egf-b0b5a est bloqué. Utiliser --project demo-akayis-test.'
    )
  }
  if (!projectId.startsWith('demo-')) {
    throw new AssertFirebaseProjectError(
      'NON_DEMO_PROJECT',
      `Le projectId "${projectId}" n'est pas un projet demo-. Aucune opération Firebase autorisée.`
    )
  }
  return projectId
}
