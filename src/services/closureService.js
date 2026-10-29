/**
 * closureService.js — Requêtes Firestore en lecture seule pour les clôtures Dealer.
 *
 * Règles Firestore pour dealerClosures :
 *   - Dealer : lit ses propres clôtures (dealerUid == uid)
 *   - store_admin : lit les clôtures ciblant sa boutique (targetStoreId == storeId)
 *   - system_manager : lit toutes les clôtures
 *
 * Toutes les écritures passent par les Cloud Functions (Admin SDK).
 *
 * Seule la lecture store_admin a un appelant (`StoreAdminClosures`). Les
 * lectures dealer et system_manager (`listDealerOwnClosures`,
 * `listAllClosures`, `getClosureCount`) n'en avaient aucune et sont retirées
 * (audit du 29 octobre 2026) ; les règles qui les permettent sont inchangées.
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { ADMIN_PAGE_SIZE } from '../constants/dealerConstants'

const PAGE = ADMIN_PAGE_SIZE

function mapErr(err) {
  if (err?.code === 'permission-denied') return new Error('Accès refusé. Vérifiez vos permissions.')
  if (err?.code === 'unavailable') return new Error('Service indisponible. Réessayez.')
  if (import.meta.env.DEV) console.error('[closureService]', err)
  return new Error("Une erreur inattendue s'est produite.")
}

// ── store_admin : clôtures ciblant sa boutique ────────────────────────────────

export async function listStoreClosures({ storeId, lastDoc = null, statusFilter = null } = {}) {
  try {
    const constraints = [where('targetStoreId', '==', storeId)]
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(PAGE + 1))
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'dealerClosures'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    return { closures: docs.map(d => ({ id: d.id, ...d.data() })), lastDoc: docs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
  }
}
