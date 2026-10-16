/**
 * adminService.js — Requêtes Firestore en lecture seule pour system_manager.
 *
 * Toutes les écritures sensibles (création boutique, suspension utilisateur,
 * changement de rôle) doivent passer par des Cloud Functions Admin SDK.
 * Ce service ne fait jamais d'écriture directe (hors lastLogin qui est géré
 * par AuthContext).
 *
 * Collections lisibles par system_manager :
 *   stores                               (toutes, actives ou non)
 *   users                                (tous)
 *   globalClients                        (tous)
 *   dealerRequests                       (tous)
 *   /{path=**}/history/{docId}           (collectionGroup)
 *   /{path=**}/networkBalances/{docId}   (collectionGroup)
 *
 * Non lisibles (pas de règle pour system_manager) :
 *   clients/{storeId}/auditLogs          → read=storeMember uniquement
 *   clients/{storeId}/drafts             → collectionGroup lisible mais peu utile pour admin
 *   clients/{storeId}/sessions           → interne boutique
 *
 * ⚠ Lot 3 (shell patron) a supprimé huit écrans de supervision (AdminDashboard,
 *   AdminStores, AdminUsers, AdminDealer, AdminDealerInventory, AdminHistory,
 *   AdminReports, AdminProfile). Les fonctions qui n'avaient pas d'autre
 *   appelant que ces écrans sont retirées avec eux : listAllStores,
 *   getAdminDashboardCounts, getDealerRequestCounts, getUserCountsByRole,
 *   listAllDealerRequests, getRecentDealerRequests, listDealerInventoryMovements,
 *   listAllUsers, listConsolidatedHistory, listStoreHistory,
 *   getStoreNetworkBalances, getRequestsForReport. Vérifié par recherche avant
 *   suppression (aucun import restant, voir le rapport de tâche 3).
 *   `listAllClients` et `listStoreOptions` restaient alors : `AdminClients.jsx`
 *   (hors périmètre de suppression de ce lot) les appelait encore.
 *
 * ⚠ Tâche 4 (tableau patron) a supprimé `AdminClients.jsx` — `PatronClients.jsx`
 *   reprend son rôle (même ligne `TableRow`, mêmes `TABLE_HEADERS`) mais lit
 *   Firestore en direct via `firestoreService.subscribeToAllClients` et
 *   cherche en mémoire (`rechercheClients.js`), pas page par page via ce
 *   service. `listAllClients` et `listStoreOptions` perdent donc leur dernier
 *   appelant et sont retirées à leur tour (même recherche de vérification,
 *   voir le rapport de tâche 4). `getStoreById` et `listAllNetworkBalances`
 *   restent : ils n'avaient déjà aucun appelant avant lot 3, et leur sort
 *   n'est pas celui de cette suppression.
 */

import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from 'firebase/firestore'
import { db } from '../config/firebase'

function mapErr(err) {
  if (err?.code === 'permission-denied') return new Error('Accès refusé. Vérifiez vos permissions.')
  if (err?.code === 'unavailable') return new Error('Service indisponible. Réessayez.')
  if (err?.code === 'failed-precondition') return new Error('Impossible de charger ces données pour le moment.')
  if (import.meta.env.DEV) console.error('[adminService]', err)
  return new Error('Une erreur inattendue s\'est produite.')
}

// ──────────────────────────────────────────────────────────────────────────────
// Boutiques
// ──────────────────────────────────────────────────────────────────────────────

export async function getStoreById(storeId) {
  try {
    const snap = await getDoc(doc(db, 'stores', storeId))
    if (!snap.exists()) throw new Error('Boutique introuvable.')
    return { id: snap.id, ...snap.data() }
  } catch (err) {
    if (err.message && !err.code) throw err
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Inventaire Dealer — normalisation d'un mouvement (lecture seule)
// ──────────────────────────────────────────────────────────────────────────────

const RESOURCE_LABELS = { stock: 'Stock', liquidite: 'Liquidité' }

// Normalise une entrée de dealerBalances/{uid}/auditLogs en ligne d'affichage.
// Pure et exportée pour test. Couvre tous les mouvements d'inventaire dealer.
export function normalizeDealerMovement(log = {}) {
  const base = { action: log.action ?? null, createdAt: log.createdAt ?? null }
  switch (log.action) {
    case 'DEALER_INVENTORY_REPLENISHED':
      return { ...base, type: 'Approvisionnement', resourceLabel: RESOURCE_LABELS[log.resource] ?? log.resource ?? '—',
        sens: '+', amount: log.amount ?? 0, soldeApres: log.newBalance ?? null, source: 'Dealer' }
    case 'DEALER_INVENTORY_DECREASED':
      return { ...base, type: 'Diminution', resourceLabel: RESOURCE_LABELS[log.resource] ?? log.resource ?? '—',
        sens: '−', amount: log.amount ?? 0, soldeApres: log.newBalance ?? null, source: 'Dealer' }
    case 'STORE_DEALER_TRANSFER_CONFIRMED': {
      const res = log.transferType === 'return_liquidity' ? 'liquidite' : 'stock'
      // Envoi de liquidité : validé/tracé mais SANS crédit de l'inventaire dealer
      // (newBalance null) → afficher neutre, pas de faux « +liquidité ».
      const noImpact = log.newBalance == null
      return { ...base, type: 'Retour boutique',
        resourceLabel: noImpact ? `${RESOURCE_LABELS[res]} (sans impact solde)` : RESOURCE_LABELS[res],
        sens: noImpact ? '·' : '+',
        amount: log.amount ?? 0,
        soldeApres: noImpact ? null : (log.newBalance ?? null),
        source: log.storeName ?? 'Boutique' }
    }
    case 'PARTNER_DEPOSIT': {
      const withdrawal = log.operation === 'withdrawal'
      return { ...base, type: withdrawal ? 'Retrait partenaire' : 'Dépôt partenaire',
        resourceLabel: withdrawal ? 'Stock + / Liquidité −' : 'Stock − / Liquidité +',
        sens: '±', amount: log.amount ?? 0, soldeApres: null,
        newStock: log.newStock ?? null, newLiquidite: log.newLiquidite ?? null,
        source: log.partnerNom ?? 'Partenaire' }
    }
    default:
      return { ...base, type: log.action ?? 'Mouvement', resourceLabel: RESOURCE_LABELS[log.resource] ?? '—',
        sens: '', amount: log.amount ?? 0, soldeApres: log.newBalance ?? null, source: '—' }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Soldes réseau par boutique (collectionGroup networkBalances)
// ──────────────────────────────────────────────────────────────────────────────

export async function listAllNetworkBalances() {
  try {
    const snap = await getDocs(
      query(collectionGroup(db, 'networkBalances'), where('__name__', '>=', ''), limit(100))
    )
    return snap.docs.map(d => {
      const parts = d.ref.path.split('/')
      const storeId = parts[1] ?? null
      return { storeId, ...d.data() }
    })
  } catch (err) {
    // Non critique — renvoie tableau vide en cas d'échec partiel
    if (import.meta.env.DEV) console.warn('[adminService] listAllNetworkBalances:', err)
    return []
  }
}
