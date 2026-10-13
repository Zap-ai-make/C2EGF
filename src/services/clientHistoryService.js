/**
 * clientHistoryService.js — l'appel du callable `listClientHistory`.
 *
 * Le navigateur ne peut pas lire l'historique d'une autre boutique : les règles
 * l'interdisent. Il demande, le serveur décide. Même forme que
 * `listArgentDehors` dans `dealerService.js`.
 *
 * ⚠ `mapFirestoreError` N'EXISTE PAS DANS `src/utils/errorHandler.js` (vérifié :
 *   seuls `ERROR_TYPES`, `retryWithBackoff`, `classifyError`,
 *   `getUserFriendlyMessage`, `withErrorHandling`, `circuitBreaker` y sont
 *   exportés). On reprend donc, à l'identique, la fonction locale que
 *   `dealerService.js` définit déjà pour le même genre d'appel callable.
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

function mapFirestoreError(err) {
  const code = String(err?.code || '').replace(/^functions\//, '')
  if (code === 'permission-denied') return new Error('Accès refusé. Vérifiez vos permissions.')
  if (code === 'unavailable') return new Error('Service temporairement indisponible. Réessayez.')
  if (code === 'failed-precondition') return new Error('Opération impossible dans l\'état actuel.')
  if (code === 'invalid-argument') return new Error('Données invalides.')
  if (import.meta.env.DEV) console.error('[clientHistoryService]', err)
  return new Error('Une erreur inattendue s\'est produite.')
}

/**
 * @param {string} clientId
 * @param {{chemin: string}|null} curseur - opaque : reçu de `curseurSuivant`,
 *   renvoyé tel quel. Ne jamais l'inspecter ni le reconstruire côté navigateur
 *   (voir functions/src/clients/listClientHistory.js, `validerCurseur`).
 * @returns {Promise<{enCours: object[], lignes: object[], totaux: object|null, curseurSuivant: object|null, encore: boolean}>}
 */
export async function chargerHistoriqueClient(clientId, curseur = null) {
  try {
    const reponse = await httpsCallable(functions, 'listClientHistory')({
      clientId,
      ...(curseur ? { curseur } : {}),
    })
    const { success: _success, ...donnees } = reponse.data ?? {}
    return donnees
  } catch (err) {
    throw mapFirestoreError(err)
  }
}
