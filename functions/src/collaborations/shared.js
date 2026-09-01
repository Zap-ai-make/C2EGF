/**
 * Helpers purs des collaborations inter-boutiques — aucune dépendance externe.
 *
 * Sémantique métier :
 *   Une boutique DEMANDEUSE a un client en face d'elle mais n'a pas le stock pour
 *   le servir. Une boutique FOURNISSEUSE, qui en a, exécute réellement l'opération
 *   Mobile Money. La contrepartie devient une dette interne entre les deux.
 *
 *   ⚠ Seuls les soldes de la FOURNISSEUSE bougent. Ceux de la demandeuse ne
 *   bougent JAMAIS : la contrepartie est portée par la dette, pas par un second
 *   mouvement de solde.
 *
 *   LA FOURNISSEUSE SE DÉPOUILLE, TOUJOURS — ET C'EST CE QUI FIXE LE SENS.
 *   Un dépôt lui prend du STOCK (elle envoie l'e-float depuis sa SIM) ; un
 *   retrait lui prend de la LIQUIDITÉ (elle avance le cash remis au client).
 *   Dans les deux cas elle cède, dans les deux cas la demandeuse encaisse la
 *   contrepartie du client : la DEMANDEUSE DOIT, toujours.
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
export function readStoreBalance(balanceData, network, field = 'stock') {
  if (balanceData === undefined || balanceData === null) return 0
  if (typeof balanceData !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Document de soldes boutique invalide.')
  }
  const networkBalance = balanceData?.balances?.[network]
  if (networkBalance === undefined || networkBalance === null) return 0
  if (typeof networkBalance !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde boutique ${network} invalide.`)
  }
  const value = networkBalance[field]
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new DealerRequestError(
      'INVALID_BALANCE_DATA',
      `Solde boutique ${network}.${field} invalide : entier sûr non négatif requis.`,
    )
  }
  return value
}

/**
 * Le stock, cas particulier de `readStoreBalance`. Conservé parce que c'est le
 * champ le plus lu et que l'appeler par son nom se lit mieux qu'un littéral.
 */
export function readStoreStock(balanceData, network) {
  return readStoreBalance(balanceData, network, 'stock')
}

// ---------------------------------------------------------------------------
// Les deux règles à ne jamais confondre
// ---------------------------------------------------------------------------

/**
 * LE champ de solde que la fournisseuse cède, selon l'opération.
 *
 *   deposit    → 'stock'     : elle envoie l'e-float depuis SA SIM.
 *   withdrawal → 'liquidite' : elle avance le CASH remis au client.
 *
 * ⚠ C'est ce choix qui rend le filtre d'annuaire possible. Tant qu'un retrait
 *   faisait MONTER le stock du fournisseur, il ne lui coûtait rien et « les
 *   boutiques qui disposent de la ressource » n'avait aucun sens à filtrer.
 */
export function supplierResourceField(operationType) {
  return validateOperationType(operationType) === 'deposit' ? 'stock' : 'liquidite'
}

/**
 * Delta appliqué au solde cédé par la FOURNISSEUSE. TOUJOURS négatif : dans les
 * deux sens, c'est elle qui se dépouille — seul le champ touché change.
 */
export function supplierBalanceDelta(operationType, amount) {
  validateOperationType(operationType)
  validateCollaborationAmount(amount)
  return -amount
}

/**
 * Sens de la dette née de la collaboration : LA DEMANDEUSE DOIT, TOUJOURS.
 *
 *   deposit    → la fournisseuse a dépensé son float, la demandeuse a encaissé
 *                le cash du client.
 *   withdrawal → la fournisseuse a avancé le cash, la demandeuse a reçu le
 *                float du client sur sa SIM.
 *
 * Dans les deux cas la fournisseuse cède et la demandeuse reçoit : le sens ne
 * dépend donc PAS du type d'opération. `operationType` reste exigé et validé —
 * une opération inconnue ne doit pas produire une dette silencieuse.
 *
 * ⚠ CE SENS A ÉTÉ INVERSÉ AU RETRAIT (chantier collaborations, 09/2026).
 *   L'ancienne règle rendait `FOURNISSEUSE doit à DEMANDEUSE` sur un retrait,
 *   parce qu'elle modélisait un float atterrissant sur la SIM de la
 *   fournisseuse. Aucune dette n'existait alors en base ; le changement n'a
 *   donc rien réécrit.
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
  return { debtorStoreId: requestingStoreId, creditorStoreId: supplierStoreId }
}

/**
 * Le contrôle de suffisance est désormais INCONDITIONNEL.
 *
 * Il ne portait que sur le dépôt, du temps où un retrait faisait monter le
 * stock du fournisseur. Maintenant que la fournisseuse cède dans les deux sens
 * — stock au dépôt, liquidité au retrait — les deux cas peuvent la mettre à
 * découvert, et les deux se vérifient.
 *
 * ⚠ Plus de garde d'overflow : `previousBalance` est un entier sûr ≥ 0 et
 *   `amount` ne le dépasse pas, donc le résultat vit dans [0, previousBalance].
 *   Un garde qui ne peut pas se déclencher n'est pas une sécurité, c'est du
 *   bruit qu'aucun test ne peut couvrir.
 */
export function nextSupplierBalance(operationType, amount, previousBalance) {
  validateOperationType(operationType)
  validateCollaborationAmount(amount)
  if (typeof previousBalance !== 'number' || !Number.isSafeInteger(previousBalance) || previousBalance < 0) {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Solde fournisseur invalide : entier sûr non négatif requis.')
  }
  if (previousBalance < amount) {
    throw new DealerRequestError(
      supplierResourceField(operationType) === 'stock'
        ? 'INSUFFICIENT_SUPPLIER_BALANCE'
        : 'INSUFFICIENT_SUPPLIER_LIQUIDITY',
      'Ressource insuffisante pour exécuter cette collaboration.',
    )
  }
  return previousBalance + supplierBalanceDelta(operationType, amount)
}
