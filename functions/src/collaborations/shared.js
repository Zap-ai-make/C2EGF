/**
 * Helpers purs des collaborations inter-boutiques — aucune dépendance externe.
 *
 * Sémantique métier :
 *   Une boutique DEMANDEUSE a un client en face d'elle mais n'a pas le stock pour
 *   le servir. Une boutique FOURNISSEUSE, qui en a, exécute réellement l'opération
 *   Mobile Money. La contrepartie devient une dette interne entre les deux.
 *
 *   ⚠ Seul le stock de la FOURNISSEUSE bouge. Le stock de la demandeuse ne bouge
 *   JAMAIS, la liquidité (caisse cash) non plus : la contrepartie est portée par
 *   la dette, pas par un second mouvement de solde.
 *
 * Conventions maison (cf. dealerRequests/shared.js, storeTransfers/shared.js) :
 *   - les validations retournent la valeur normalisée, ou lancent DealerRequestError ;
 *   - jamais de HttpsError ici : la conversion est centralisée dans callable.js.
 */

import { DealerRequestError } from '../errors.js'
import { STORE_NETWORKS, COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export const COLLABORATION_OPERATION_TYPES = new Set(['deposit', 'withdrawal'])

export const COLLABORATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
})

// ---------------------------------------------------------------------------
// Activation du module (drapeau de profil)
// ---------------------------------------------------------------------------

// Un client qui n'a pas souscrit au module doit être refusé JUSQU'AU SERVEUR.
// Masquer l'entrée de menu ne suffit pas : un appel direct au callable resterait
// possible.
//
// ⚠ AUCUNE valeur par défaut, volontairement : un paramètre par défaut ferait
// retomber un `undefined` transmis (profil incomplet, champ renommé) sur « activé ».
// Un garde-fou de sécurité ne doit jamais avoir de repli permissif — l'appelant
// passe COLLABORATIONS_ENABLED explicitement, et on voit au point d'appel ce qui
// est vérifié. Seul `true` strict passe.
export function assertCollaborationsEnabled(enabled) {
  if (enabled !== true) {
    throw new DealerRequestError(
      'COLLABORATIONS_DISABLED',
      "Les collaborations entre boutiques ne sont pas activées pour ce client.",
    )
  }
}

// ---------------------------------------------------------------------------
// Réseau porté par la collaboration
// ---------------------------------------------------------------------------

// ⚠ Le réseau n'est JAMAIS accepté du client : il est résolu ici, depuis le profil.
// Mono-réseau (C2EGF → ['Orange']) : le réseau unique est retourné sans que le
// client ait à l'envoyer. Multi-réseaux : un réseau explicite est exigé, aucun
// choix silencieux. Même contrat que resolveTransferNetwork côté dealer.
export function resolveCollaborationNetwork(candidate, storeNetworks = STORE_NETWORKS) {
  const list = Array.isArray(storeNetworks) ? storeNetworks : [...storeNetworks]
  if (list.length === 0) {
    throw new DealerRequestError('INVALID_COLLABORATION_NETWORK', 'Aucun réseau configuré pour ce client.')
  }
  if (candidate == null || candidate === '') {
    if (list.length === 1) return list[0]
    throw new DealerRequestError('INVALID_COLLABORATION_NETWORK', 'Réseau requis (profil multi-réseaux).')
  }
  if (!list.includes(candidate)) {
    throw new DealerRequestError('INVALID_COLLABORATION_NETWORK', 'Réseau non reconnu pour ce profil.')
  }
  return candidate
}

// ---------------------------------------------------------------------------
// Validation des entrées
// ---------------------------------------------------------------------------

export function validateOperationType(operationType) {
  if (typeof operationType !== 'string' || !COLLABORATION_OPERATION_TYPES.has(operationType)) {
    throw new DealerRequestError('INVALID_OPERATION_TYPE', "Type d'opération invalide (dépôt ou retrait).")
  }
  return operationType
}

// Entier sûr strictement positif. Refuse explicitement les décimales, l'infini,
// NaN et les chaînes : le client transmet sa saisie brute, le parse est fait
// avant l'appel, mais le serveur ne fait jamais confiance au résultat.
export function validateCollaborationAmount(amount) {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError(
      'INVALID_COLLABORATION_AMOUNT',
      'Montant invalide : entier strictement positif requis.',
    )
  }
  return amount
}

export function validateCollaborationId(collaborationId) {
  if (typeof collaborationId !== 'string' || collaborationId.trim() === '') {
    throw new DealerRequestError('INVALID_COLLABORATION_ID', 'Identifiant de collaboration requis.')
  }
  return collaborationId.trim()
}

// Référence de boutique. Les identifiants Firestore ne portent pas d'espaces de
// bord : on refuse toute valeur non déjà normalisée plutôt que de la rogner en
// silence, pour qu'un identifiant approchant ne résolve jamais vers une autre
// boutique.
export function validateStoreRef(storeId) {
  if (typeof storeId !== 'string' || storeId.trim() === '' || storeId !== storeId.trim()) {
    throw new DealerRequestError('INVALID_STORE_ID', 'Boutique invalide.')
  }
  return storeId
}

export function validateClientId(clientId) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new DealerRequestError('INVALID_CLIENT_ID', 'Client invalide.')
  }
  return clientId.trim()
}

// ---------------------------------------------------------------------------
// Lecture du stock d'une boutique
// ---------------------------------------------------------------------------

/**
 * Stock d'un réseau chez une boutique : tolérant à l'ABSENCE, strict sur la VALEUR.
 *
 *   document absent / réseau absent / champ absent  → 0
 *   valeur présente mais non entière, non finie,
 *   ou négative                                     → INVALID_BALANCE_DATA
 *
 * Le premier volet est indispensable : une boutique qui n'a jamais rien reçu sur
 * un réseau n'a pas d'entrée de solde, et refuser la collaboration pour ça serait
 * absurde. Le second l'est tout autant : on ne « répare » jamais silencieusement
 * un solde corrompu, on refuse l'opération.
 *
 * ⚠ Jumeau de readDealerBalanceAmount (storeTransfers/shared.js), même logique
 * mais messages orientés dealer. Dupliqué à dessein plutôt que réutilisé : un
 * « Solde dealer Orange invalide » affiché pour le stock d'une boutique
 * enverrait l'exploitant chercher au mauvais endroit. À unifier dans un lot de
 * refactorisation dédié, jamais en même temps qu'un changement de comportement.
 */
export function readStoreStock(balanceData, network) {
  if (balanceData === undefined || balanceData === null) return 0
  if (typeof balanceData !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Document de soldes boutique invalide.')
  }
  const networkBalance = balanceData?.balances?.[network]
  if (networkBalance === undefined || networkBalance === null) return 0
  if (typeof networkBalance !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde boutique ${network} invalide.`)
  }
  const value = networkBalance.stock
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new DealerRequestError(
      'INVALID_BALANCE_DATA',
      `Solde boutique ${network}.stock invalide : entier sûr non négatif requis.`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Les deux règles à ne jamais confondre
// ---------------------------------------------------------------------------

/**
 * Delta appliqué au stock de la boutique FOURNISSEUSE.
 *
 *   deposit    → −amount : le client dépose du cash chez la DEMANDEUSE, et c'est la
 *                fournisseuse qui envoie le float depuis SA SIM. Son stock baisse.
 *   withdrawal → +amount : le client envoie son float vers la SIM de la fournisseuse
 *                et reçoit du cash chez la demandeuse. Le stock fournisseur monte.
 */
export function supplierStockDelta(operationType, amount) {
  validateOperationType(operationType)
  validateCollaborationAmount(amount)
  return operationType === 'deposit' ? -amount : amount
}

/**
 * Sens de la dette née de la collaboration — c'est le miroir exact du delta.
 *
 *   deposit    → la demandeuse a encaissé le cash du client, la fournisseuse a
 *                dépensé son float : DEMANDEUSE doit à FOURNISSEUSE.
 *   withdrawal → la demandeuse a sorti le cash de sa caisse, la fournisseuse a
 *                reçu le float : FOURNISSEUSE doit à DEMANDEUSE.
 */
export function debtDirection(operationType, { requestingStoreId, supplierStoreId } = {}) {
  validateOperationType(operationType)
  validateStoreRef(requestingStoreId)
  validateStoreRef(supplierStoreId)
  if (requestingStoreId === supplierStoreId) {
    throw new DealerRequestError(
      'SAME_STORE_COLLABORATION',
      'La boutique fournisseuse doit être différente de la vôtre.',
    )
  }
  return operationType === 'deposit'
    ? { debtorStoreId: requestingStoreId, creditorStoreId: supplierStoreId }
    : { debtorStoreId: supplierStoreId, creditorStoreId: requestingStoreId }
}

/**
 * Le contrôle de suffisance ne s'applique qu'au dépôt : c'est le seul cas où le
 * stock fournisseur BAISSE. Sur un retrait il monte — rien à vérifier en amont,
 * seul le plafond d'entier sûr est contrôlé ensuite.
 */
export function requiresSupplierBalanceCheck(operationType) {
  return validateOperationType(operationType) === 'deposit'
}

/**
 * Nouveau solde de stock du fournisseur, avec les deux garde-fous du §6.2.1 :
 * suffisance (dépôt seulement) puis entier sûr ≥ 0.
 */
export function nextSupplierBalance(operationType, amount, previousBalance) {
  validateCollaborationAmount(amount)
  if (typeof previousBalance !== 'number' || !Number.isSafeInteger(previousBalance) || previousBalance < 0) {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Solde fournisseur invalide : entier sûr non négatif requis.')
  }
  if (requiresSupplierBalanceCheck(operationType) && previousBalance < amount) {
    throw new DealerRequestError(
      'INSUFFICIENT_SUPPLIER_BALANCE',
      'Stock insuffisant pour exécuter cette collaboration.',
    )
  }
  const next = previousBalance + supplierStockDelta(operationType, amount)
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant est invalide.')
  }
  return next
}
