import { DealerRequestError } from '../errors.js'
import { readValidatedProfile } from '../dealerRequests/shared.js'
import { validateSettlementTransactionProfile } from './profileValidation.js'

/** Longueur maximale d'un code agent de destination. */
export const AGENT_CODE_MAX = 32

/**
 * Le code agent SUR LEQUEL l'argent a ete envoye — facultatif.
 *
 * Ce n'est PAS le code du client, deja porte par la transaction : c'est la
 * destination du mouvement, que la boutique note quand elle envoie sur le
 * compte d'un agent plutot que de remettre des especes en main propre. Sans
 * cette trace, un reglement conteste ne peut pas etre rapproche.
 *
 * Facultatif veut dire facultatif : une valeur absente ou vide rend `null`, et
 * aucun des deux chemins de reglement ne la reclame.
 */
export function cleanSettlementAgentCode(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null

  if (typeof valeur !== 'string') {
    throw new DealerRequestError('INVALID_AGENT_CODE', 'Code agent invalide.')
  }

  const propre = valeur.trim()
  if (!propre) return null

  if (propre.length > AGENT_CODE_MAX) {
    throw new DealerRequestError(
      'INVALID_AGENT_CODE',
      `Code agent trop long (${AGENT_CODE_MAX} caracteres au plus).`,
    )
  }

  // Liste blanche plutot que liste noire : ce champ part dans un document
  // d'audit et ressort a l'ecran et dans l'export.
  if (!/^[A-Za-z0-9 .-]+$/.test(propre)) {
    throw new DealerRequestError(
      'INVALID_AGENT_CODE',
      'Code agent : chiffres, lettres, espace, point et tiret seulement.',
    )
  }

  return propre
}

export async function readSettlementTransactionContext({
  db,
  transaction,
  actorUid,
  preStoreId,
  draftId,
  settlementId,
}) {
  const {
    profile: txProfile,
    validationResult: storeId,
  } = await readValidatedProfile(
    db,
    actorUid,
    (profile) => validateSettlementTransactionProfile(profile, preStoreId),
    transaction,
  )

  const storeSnap = await transaction.get(db.doc(`stores/${storeId}`))
  if (!storeSnap.exists || storeSnap.data().active !== true) {
    throw new DealerRequestError('STORE_INACTIVE', 'Boutique désactivée.')
  }

  const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
  const settlementRef = db.doc(`clients/${storeId}/drafts/${draftId}/settlements/${settlementId}`)
  const balanceRef = db.doc(`clients/${storeId}/networkBalances/current`)
  const [draftSnap, settlementSnap, balanceSnap] = await transaction.getAll(
    draftRef,
    settlementRef,
    balanceRef,
  )

  return {
    txProfile,
    storeId,
    draftRef,
    settlementRef,
    balanceRef,
    draftSnap,
    settlementSnap,
    balanceSnap,
  }
}

export function readIdempotentSettlement({
  settlementSnap,
  amount,
  paymentMethod,
  agentCode = null,
  action,
  actorUid,
  storeId,
  settlementId,
  recordConflict,
}) {
  if (!settlementSnap.exists) return null

  const existingData = settlementSnap.data()
  // ⚠ `?? null` DES DEUX COTES : les reglements enregistres avant ce champ
  //   n'ont pas de `agentCode`, et comparer `undefined` a `null` ferait echouer
  //   le moindre rejeu sur une operation ancienne.
  const memeCodeAgent = (existingData.agentCode ?? null) === (agentCode ?? null)
  if (existingData.amount !== amount || existingData.paymentMethod !== paymentMethod || !memeCodeAgent) {
    recordConflict({
      event: 'SETTLEMENT_IDEMPOTENCY_CONFLICT',
      action,
      actorUid,
      storeId,
      settlementId,
      existingAmount: existingData.amount,
      newAmount: amount,
      existingMethod: existingData.paymentMethod,
      newMethod: paymentMethod,
      existingAgentCode: existingData.agentCode ?? null,
      newAgentCode: agentCode ?? null,
    })
    throw new DealerRequestError(
      'IDEMPOTENCY_CONFLICT',
      'Cette opération a déjà été enregistrée avec des paramètres différents. Rechargez la page et réessayez.',
    )
  }

  return existingData
}

export function buildSettlementAuditBase({
  settlementId,
  draftId,
  storeId,
  draft,
  amount,
  paymentMethod,
  agentCode = null,
  affectedNetwork,
  trimmedKey,
  actorUid,
  txProfile,
  paidAmount,
  refundedAmount,
  remainingAmount,
}) {
  return {
    settlementId,
    draftId,
    storeId,
    clientId: draft.clientId ?? null,
    amount,
    paymentMethod,
    agentCode,
    effectiveNetwork: affectedNetwork,
    idempotencyKey: trimmedKey,
    actorUid,
    actorName: txProfile.name ?? null,
    actorRole: txProfile.role,
    actorStoreId: storeId,
    previousPaidAmount: paidAmount,
    previousRefundedAmount: refundedAmount,
    previousRemainingAmount: remainingAmount,
    previousSettlementStatus: draft.settlementStatus ?? null,
  }
}
