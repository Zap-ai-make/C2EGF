export const DEALER_REQUEST_TYPES = Object.freeze({
  STOCK_ADD: 'stock_add',
  LIQUIDITY_ADD: 'liquidity_add',
})

export const DEALER_REQUEST_TYPE_LABELS = Object.freeze({
  stock_add: 'Ajout de stock',
  liquidity_add: 'Ajout de liquidité',
})

export const DEALER_REQUEST_STATUSES = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
})

export const DEALER_REQUEST_STATUS_LABELS = Object.freeze({
  pending: 'En attente',
  confirmed: 'Confirmée',
  rejected: 'Rejetée',
})

// Réseau dealer par défaut = 1er réseau du circuit dealer du profil actif.
// Le dealer MULTI-réseaux (plusieurs SIM) est un chantier serveur (Phase 3) ; ici on
// conserve le comportement mono-réseau (ex. TAOFIC → 'Orange').
import { activeProfile } from '../config/activeClientProfile.js'

export const DEALER_NETWORK = activeProfile.dealer.networks[0]

// Tous les réseaux du circuit dealer du profil (dealer multi-SIM). Mono-réseau
// (ex. TAOFIC → ['Orange']) : un seul élément → l'UI dealer garde sa vue simple
// (Stock/Liquidité). Multi-réseaux : une carte Stock par réseau + liquidité globale.
export const DEALER_NETWORKS = activeProfile.dealer.networks
export const IS_DEALER_MULTI_NETWORK = DEALER_NETWORKS.length > 1

// Seuil bas d'une caisse, en FCFA — axe de variation client (spec S2).
// Un seul seuil pour tout le réseau, décision de cadrage. Il vient du profil et
// de nulle part ailleurs : une valeur en dur dans un composant serait
// exactement la constante magique qu'il remplace (cf. NetworkCard.jsx).
export const DEALER_SEUIL_BAS = activeProfile.dealer.seuilBas

/** Une caisse est-elle sous le seuil ? `null` (montant inconnu) n'est pas bas. */
export function estSousSeuil(montant) {
  return typeof montant === 'number' && Number.isFinite(montant) && montant < DEALER_SEUIL_BAS
}

export const DEALER_REQUESTS_PAGE_SIZE = 20
export const DEALER_STORES_PAGE_SIZE = 20
export const STORE_DEALER_REQUESTS_PAGE_SIZE = 20

// Espaces gérant/admin (supervision) : pages plus denses (tableaux larges) →
// 25 lignes, contre 20 côté dealer/boutique. Valeur volontairement distincte.
export const ADMIN_PAGE_SIZE = 25

// ── Transferts boutique → dealer (retours de stock / liquidité) ──────────────
export const STORE_TRANSFER_TYPES = Object.freeze({
  RETURN_STOCK: 'return_stock',
  RETURN_LIQUIDITY: 'return_liquidity',
})

export const STORE_TRANSFER_TYPE_LABELS = Object.freeze({
  return_stock: 'Retour de stock',
  return_liquidity: 'Envoi de liquidité',
})

export const STORE_TRANSFERS_PAGE_SIZE = 20
