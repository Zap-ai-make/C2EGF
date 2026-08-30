/**
 * Helpers purs des transferts boutique → dealer (retours de stock / liquidité).
 *
 * Sémantique métier :
 *   Une boutique renvoie UNE ressource (stock OU liquidité) au dealer.
 *   Sens unique : le solde boutique baisse à la création, le solde dealer monte
 *   à la confirmation. Un rejet restaure le solde boutique.
 *
 * Aucune dépendance externe (testables directement). Les validations échouées
 * lancent DealerRequestError (jamais HttpsError).
 */

import { DealerRequestError } from '../errors.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export const TRANSFER_TYPES = new Set(['return_stock', 'return_liquidity'])

// ── Réseau porté par l'opération : validé ∈ profil client (dealer.networks) ──
// Remplace l'ancienne constante TRANSFER_NETWORK='Orange'. Défaut préservant :
// un profil mono-réseau (TAOFIC) résout le réseau unique sans que le client ait
// à l'envoyer (comportement historique Orange). Un profil multi-réseaux exige un
// réseau explicite (aucun choix silencieux). `dealerNetworks` est injectable par
// handler pour les tests (mirror dealerRequests/closures).
export function resolveTransferNetwork(candidate, dealerNetworks = DEALER_NETWORKS) {
  const list = Array.isArray(dealerNetworks) ? dealerNetworks : [...dealerNetworks]
  if (candidate == null || candidate === '') {
    if (list.length === 1) return list[0]
    throw new DealerRequestError('INVALID_TRANSFER_NETWORK', 'Réseau requis (profil multi-réseaux).')
  }
  if (!list.includes(candidate)) {
    throw new DealerRequestError('INVALID_TRANSFER_NETWORK', 'Réseau non reconnu pour ce profil.')
  }
  return candidate
}

// ── Type de transfert → champ de solde ──────────────────────────────────────
export function validateTransferType(transferType) {
  if (typeof transferType !== 'string' || !TRANSFER_TYPES.has(transferType)) {
    throw new DealerRequestError('INVALID_TRANSFER_TYPE', 'Type de transfert invalide.')
  }
  return transferType
}

// Note orthographique : le champ Firestore est "liquidite" (sans accent).
export function transferBalanceField(transferType) {
  return transferType === 'return_stock' ? 'stock' : 'liquidite'
}

// ── Ressource d'inventaire dealer (approvisionnement) ────────────────────────
export const INVENTORY_RESOURCES = new Set(['stock', 'liquidite'])
export function validateInventoryResource(resource) {
  if (typeof resource !== 'string' || !INVENTORY_RESOURCES.has(resource)) {
    throw new DealerRequestError('INVALID_INVENTORY_RESOURCE', 'Ressource invalide (stock ou liquidite).')
  }
  return resource
}

// ── Montant (entier strictement positif, chiffres uniquement côté client) ────
export function validateTransferAmount(amount) {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError('INVALID_TRANSFER_AMOUNT', 'Montant invalide : entier strictement positif requis.')
  }
  return amount
}

export function validateTransferId(transferId) {
  if (!transferId || typeof transferId !== 'string' || transferId.trim() === '') {
    throw new DealerRequestError('INVALID_TRANSFER_ID', 'Identifiant de transfert requis.')
  }
  return transferId.trim()
}

// ── Partenaire (dénormalisé, sans impact financier) ──────────────────────────
// On valide juste des chaînes non vides et bornées : l'identité du partenaire
// n'affecte pas les soldes (seul l'inventaire du dealer bouge).
export function validatePartnerInput(data) {
  const str = (v, field, { max = 120, required = true } = {}) => {
    if (v == null || v === '') {
      if (required) throw new DealerRequestError('INVALID_PARTNER', `Champ partenaire manquant : ${field}.`)
      return null
    }
    if (typeof v !== 'string') throw new DealerRequestError('INVALID_PARTNER', `Champ partenaire invalide : ${field}.`)
    const t = v.trim()
    if (required && t === '') throw new DealerRequestError('INVALID_PARTNER', `Champ partenaire vide : ${field}.`)
    if (t.length > max) throw new DealerRequestError('INVALID_PARTNER', `Champ partenaire trop long : ${field}.`)
    return t
  }
  return {
    partnerId: str(data.partnerId, 'partnerId'),
    partnerNom: str(data.partnerNom, 'partnerNom'),
    partnerPrenom: str(data.partnerPrenom, 'partnerPrenom', { required: false }),
    partnerNumeroDA: str(data.partnerNumeroDA, 'partnerNumeroDA', { required: false }),
    partnerLocalite: str(data.partnerLocalite, 'partnerLocalite', { required: false }),
  }
}

// ── Opération partenaire : dépôt (−stock +liquidité) ou retrait (+stock −liquidité) ─
// Rétrocompatible : une valeur absente/vide vaut 'deposit' (comportement historique).
export const PARTNER_OPERATIONS = new Set(['deposit', 'withdrawal'])
export function validatePartnerOperation(operation) {
  const v = (operation == null || operation === '') ? 'deposit' : operation
  if (typeof v !== 'string' || !PARTNER_OPERATIONS.has(v)) {
    throw new DealerRequestError('INVALID_PARTNER', 'Opération partenaire invalide (dépôt ou retrait).')
  }
  return v
}

// ── Profil dealer (actif, role dealer) ───────────────────────────────────────
export function validateDealerProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  if (!profile.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (profile.role !== 'dealer') {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée aux dealers.')
  }
  return true
}

// ── Lecture d'un champ de solde (stock|liquidite) : entier sûr >= 0 ──────────
export function readBalanceAmount(balanceData, field, network = 'Orange') {
  if (!balanceData || typeof balanceData !== 'object') {
    throw new DealerRequestError('BALANCE_NOT_FOUND', 'Document de soldes introuvable ou invalide.')
  }
  const balances = balanceData.balances
  if (!balances || typeof balances !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Structure balances manquante.')
  }
  const networkBalance = balances[network]
  if (!networkBalance || typeof networkBalance !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde ${network} manquant.`)
  }
  const value = networkBalance[field]
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde ${network}.${field} invalide : entier sûr non-négatif requis.`)
  }
  return value
}

// ── Solde dealer courant pour un champ : 0 si le document/solde n'existe pas ──
// À la différence des boutiques, le solde dealer peut ne pas encore exister
// (premier retour) → on part de 0. Toute valeur présente doit rester valide.
export function readDealerBalanceAmount(balanceData, field, network = 'Orange') {
  if (balanceData === undefined || balanceData === null) return 0
  if (typeof balanceData !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Solde dealer invalide.')
  }
  const networkBalance = balanceData?.balances?.[network]
  if (networkBalance === undefined || networkBalance === null) return 0
  if (typeof networkBalance !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde dealer ${network} invalide.`)
  }
  const value = networkBalance[field]
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Solde dealer ${network}.${field} invalide.`)
  }
  return value
}

// ── Compteurs de flux du dealer (spec S2) ────────────────────────────────────
//
// Deux cumuls vivent sur `dealerBalances/{uid}`, sous la clé `flux` :
//
//   flux.envoyeCumul   total envoyé aux boutiques depuis l'origine
//   flux.revenuCumul   total revenu des boutiques depuis l'origine
//
// Leur différence est « l'argent du dealer qui est dehors ». Ce sont des
// COMPTEURS, pas des soldes : ils ne décroissent jamais, n'entrent dans aucun
// calcul de solde, et ne peuvent donc pas corrompre une caisse s'ils dérivent.
//
// ⚠ POURQUOI PAS `FieldValue.increment()`. Il éviterait une lecture, mais il
//   rendrait impossible le garde-fou d'entier sûr : un compteur incrémenté à
//   l'aveugle peut franchir Number.MAX_SAFE_INTEGER sans que rien ne le dise,
//   et une valeur corrompue serait alors silencieusement propagée. On lit, on
//   vérifie, on écrit — comme pour tous les autres montants du produit.
//
// Le champ peut ne pas exister (compteur jamais initialisé) → 0. Toute valeur
// présente doit être un entier sûr non-négatif, comme un solde.
export function readFluxAmount(balanceData, field) {
  if (balanceData === undefined || balanceData === null) return 0
  if (typeof balanceData !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Inventaire dealer invalide.')
  }
  const flux = balanceData.flux
  if (flux === undefined || flux === null) return 0
  if (typeof flux !== 'object') {
    throw new DealerRequestError('INVALID_BALANCE_DATA', 'Compteurs de flux dealer invalides.')
  }
  const value = flux[field]
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new DealerRequestError('INVALID_BALANCE_DATA', `Compteur flux.${field} invalide : entier sûr non-négatif requis.`)
  }
  return value
}

// Avance un compteur de flux, en refusant tout dépassement d'entier sûr.
export function nextFluxAmount(balanceData, field, amount) {
  const previous = readFluxAmount(balanceData, field)
  const next = previous + amount
  if (!Number.isSafeInteger(next)) {
    throw new DealerRequestError(
      'BALANCE_OVERFLOW',
      `Le compteur flux.${field} dépasserait la limite des entiers sûrs.`,
    )
  }
  return next
}

// ── Résolution du dealer unique (compte role==='dealer' actif) ───────────────
// Règle métier : il ne peut exister qu'UN SEUL dealer actif dans tout le système.
// On lit jusqu'à 2 dealers pour détecter une violation d'invariant plutôt que de
// choisir arbitrairement le premier (limit(1) masquerait le problème).
//   size === 0 → DEALER_NOT_FOUND
//   size  >  1 → MULTIPLE_DEALERS_ACTIVE (invariant violé, aucune opération)
//   size === 1 → dealer résolu
// Deux égalités sans orderBy → aucune index composite requise.
export async function resolveSingleDealer(db) {
  const snap = await db
    .collection('users')
    .where('role', '==', 'dealer')
    .where('active', '==', true)
    .limit(2)
    .get()
  if (snap.empty) {
    throw new DealerRequestError('DEALER_NOT_FOUND', 'Aucun dealer actif disponible.')
  }
  if (snap.size > 1) {
    throw new DealerRequestError(
      'MULTIPLE_DEALERS_ACTIVE',
      'Plusieurs dealers actifs détectés : configuration invalide. Un seul dealer actif est autorisé.'
    )
  }
  const doc = snap.docs[0]
  const data = doc.data()
  return { uid: doc.id, name: data.name ?? null, email: data.email ?? null }
}
