/**
 * storeDealerRequestCommandService.js — Confirmation et rejet des demandes Dealer.
 *
 * Ce service appelle exclusivement les Cloud Functions via httpsCallable.
 * Il n'importe aucune méthode d'écriture Firestore (addDoc, setDoc, updateDoc,
 * deleteDoc, writeBatch, runTransaction, increment).
 * Le backend reste l'autorité finale sur toutes les validations.
 *
 * Région Functions : europe-west1 (initialisée dans src/config/firebase.js).
 *
 * Erreurs retournées :
 *   Les erreurs Firebase callable sont converties en Error avec :
 *     - message : message utilisateur compréhensible (voir ERROR_MESSAGES)
 *     - code    : code métier backend (ex. 'REQUEST_NOT_PENDING')
 *   Permet au UI de distinguer REQUEST_NOT_PENDING pour un rechargement ciblé.
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

// ---------------------------------------------------------------------------
// Mapping des codes métier vers messages UI
// ---------------------------------------------------------------------------

const ERROR_MESSAGES = {
  UNAUTHENTICATED:          'Votre session a expiré. Reconnectez-vous.',
  PROFILE_NOT_FOUND:        'Votre profil est introuvable.',
  PROFILE_INACTIVE:         'Votre compte est inactif.',
  ROLE_FORBIDDEN:           "Vous n'avez pas l'autorisation d'effectuer cette action.",
  STORE_ID_REQUIRED:        'Identifiant de boutique manquant dans votre profil.',
  INVALID_REQUEST_ID:       'Identifiant de demande invalide.',
  INVALID_REJECTION_REASON: 'Le motif de rejet est invalide.',
  REQUEST_NOT_FOUND:        'Cette demande est introuvable.',
  REQUEST_NOT_PENDING:      'Cette demande a déjà été traitée.',
  REQUEST_STORE_MISMATCH:   'Cette demande ne concerne pas votre boutique.',
  INVALID_REQUEST_DATA:     'Les données de cette demande sont invalides.',
  BALANCE_NOT_FOUND:        'Le solde de la boutique est introuvable.',
  INVALID_BALANCE_DATA:     'Le solde actuel est invalide. Contactez un administrateur.',
  BALANCE_OVERFLOW:         'Le nouveau solde dépasse la limite autorisée.',
  INSUFFICIENT_DEALER_BALANCE: "L'inventaire du dealer est insuffisant pour cet approvisionnement.",
  TRANSACTION_FAILED:       "L'opération n'a pas pu être finalisée.",
}

/**
 * Convertit une erreur Firebase callable en Error avec message utilisateur.
 * Préserve le code métier dans err.code pour que le UI puisse distinguer
 * les cas (ex. REQUEST_NOT_PENDING → recharger la demande).
 */
export function mapCallableError(err) {
  const detailCode = err?.details?.code
  const funcCode   = String(err?.code || '')

  let code = detailCode || ''

  if (detailCode && ERROR_MESSAGES[detailCode]) {
    const mapped    = new Error(ERROR_MESSAGES[detailCode])
    mapped.code     = detailCode
    return mapped
  }

  // Fallback sur le code Firebase si pas de code métier dans details
  let message = "Une erreur inattendue s'est produite."
  if (funcCode.includes('unauthenticated'))      { message = ERROR_MESSAGES.UNAUTHENTICATED;     code = 'UNAUTHENTICATED' }
  else if (funcCode.includes('permission-denied')){ message = ERROR_MESSAGES.ROLE_FORBIDDEN;      code = 'ROLE_FORBIDDEN' }
  else if (funcCode.includes('not-found'))        { message = ERROR_MESSAGES.REQUEST_NOT_FOUND;   code = 'REQUEST_NOT_FOUND' }
  else if (funcCode.includes('failed-precondition')){ message = ERROR_MESSAGES.REQUEST_NOT_PENDING; code = 'REQUEST_NOT_PENDING' }
  else if (funcCode.includes('invalid-argument')) { message = ERROR_MESSAGES.INVALID_REQUEST_ID;  code = 'INVALID_REQUEST_ID' }

  const mapped = new Error(message)
  mapped.code  = code
  return mapped
}

// ---------------------------------------------------------------------------
// Validation locale minimale (le backend reste autoritatif)
// ---------------------------------------------------------------------------

function validateRequestIdLocal(requestId) {
  if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
    throw new Error('Identifiant de demande invalide.')
  }
  return requestId.trim()
}

function validateRejectionReasonLocal(reason) {
  if (!reason || typeof reason !== 'string') {
    throw new Error('Le motif de rejet est requis.')
  }
  const trimmed = reason.trim()
  if (trimmed.length < 3)   throw new Error('Le motif doit comporter au moins 3 caractères.')
  if (trimmed.length > 500) throw new Error('Le motif ne peut pas dépasser 500 caractères.')
  return trimmed
}

// ---------------------------------------------------------------------------
// confirmDealerRequestCommand
// ---------------------------------------------------------------------------

export async function confirmDealerRequestCommand(requestId) {
  const validId   = validateRequestIdLocal(requestId)
  const callable  = httpsCallable(functions, 'confirmDealerRequest')

  try {
    const result = await callable({ requestId: validId })
    return result.data
  } catch (err) {
    throw mapCallableError(err)
  }
}

// ---------------------------------------------------------------------------
// rejectDealerRequestCommand
// ---------------------------------------------------------------------------

export async function rejectDealerRequestCommand(requestId, rejectionReason) {
  const validId     = validateRequestIdLocal(requestId)
  const validReason = validateRejectionReasonLocal(rejectionReason)
  const callable    = httpsCallable(functions, 'rejectDealerRequest')

  try {
    const result = await callable({ requestId: validId, rejectionReason: validReason })
    return result.data
  } catch (err) {
    throw mapCallableError(err)
  }
}
