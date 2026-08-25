/**
 * closureService.js — Requêtes Firestore en lecture seule pour les clôtures Dealer.
 *
 * Règles Firestore pour dealerClosures :
 *   - Dealer : lit ses propres clôtures (dealerUid == uid)
 *   - store_admin : lit les clôtures ciblant sa boutique (targetStoreId == storeId)
 *   - system_manager : lit toutes les clôtures
 *
 * Toutes les écritures passent par les Cloud Functions (Admin SDK).
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getCountFromServer,
  Timestamp,
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

// ── Dealer : ses propres clôtures ─────────────────────────────────────────────

export async function listDealerOwnClosures({ dealerUid, lastDoc = null, statusFilter = null } = {}) {
  try {
    const constraints = []
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    constraints.push(where('dealerUid', '==', dealerUid))
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

// ── system_manager : toutes les clôtures avec filtres optionnels ───────────────

export async function listAllClosures({
  lastDoc = null,
  statusFilter = null,
  dealerUid = null,
  storeId = null,
  dateFrom = null,
  dateTo = null,
} = {}) {
  try {
    const constraints = []
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    if (dealerUid)    constraints.push(where('dealerUid', '==', dealerUid))
    if (storeId)      constraints.push(where('targetStoreId', '==', storeId))
    if (dateFrom)     constraints.push(where('createdAt', '>=', Timestamp.fromDate(new Date(dateFrom))))
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      constraints.push(where('createdAt', '<=', Timestamp.fromDate(end)))
    }
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

export async function getClosureCount({ statusFilter = null } = {}) {
  try {
    const constraints = statusFilter ? [where('status', '==', statusFilter)] : []
    const snap = await getCountFromServer(query(collection(db, 'dealerClosures'), ...constraints))
    return snap.data().count
  } catch (err) {
    throw mapErr(err)
  }
}
