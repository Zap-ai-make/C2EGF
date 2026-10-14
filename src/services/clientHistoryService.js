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

/**
 * ⚠ LE CODE MÉTIER SURVIT À LA TRADUCTION. `wrapCallable` le transmet dans
 *   `details.code` (functions/src/callable.js) ; l'écraser en même temps que le
 *   message privait l'appelant du seul moyen de distinguer un curseur périmé
 *   — rattrapable en repartant de la première page — d'une vraie donnée
 *   invalide, qui ne l'est pas.
 */
export const CODE_CURSEUR_PERIME = 'INVALID_HISTORY_CURSOR'

function mapFirestoreError(err) {
  const code = String(err?.code || '').replace(/^functions\//, '')
  const codeMetier = err?.details?.code ?? null

  const traduite = (message) => Object.assign(new Error(message), { code: codeMetier })

  if (code === 'permission-denied') return traduite('Accès refusé. Vérifiez vos permissions.')
  if (code === 'unavailable') return traduite('Service temporairement indisponible. Réessayez.')
  if (code === 'failed-precondition') return traduite('Opération impossible dans l\'état actuel.')
  if (code === 'invalid-argument') {
    // ⚠ LE SERVEUR A DÉJÀ RÉDIGÉ CE MESSAGE POUR L'UTILISATEUR : « Le repère de
    //   pagination n'existe plus. Rouvrir l'historique. » Le remplacer par
    //   « Données invalides. » jetait la seule phrase actionnable de l'échange.
    if (codeMetier === CODE_CURSEUR_PERIME) return traduite(err.message)
    return traduite('Données invalides.')
  }
  if (import.meta.env.DEV) console.error('[clientHistoryService]', err)
  return traduite('Une erreur inattendue s\'est produite.')
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
