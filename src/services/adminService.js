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
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { ADMIN_PAGE_SIZE } from '../constants/dealerConstants'
import { shapeDealerInventory } from '../utils/dealerInventory'

const PAGE = ADMIN_PAGE_SIZE

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

export async function listAllStores({ lastDoc = null, activeFilter = null, search = '' } = {}) {
  try {
    const constraints = []
    if (activeFilter !== null) constraints.push(where('active', '==', activeFilter))
    constraints.push(orderBy('name'))
    constraints.push(limit(PAGE + 1))
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'stores'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    let stores = docs.map(d => ({ id: d.id, ...d.data() }))

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      stores = stores.filter(s => s.name?.toLowerCase().includes(q))
    }

    return { stores, lastDoc: docs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
  }
}

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
// Compteurs globaux (dashboard)
// ──────────────────────────────────────────────────────────────────────────────

export async function getAdminDashboardCounts() {
  try {
    const [
      allStores,
      activeStores,
      allUsers,
      allClients,
      pendingRequests,
    ] = await Promise.all([
      getCountFromServer(query(collection(db, 'stores'))),
      getCountFromServer(query(collection(db, 'stores'), where('active', '==', true))),
      getCountFromServer(query(collection(db, 'users'))),
      getCountFromServer(query(collection(db, 'globalClients'))),
      getCountFromServer(query(collection(db, 'dealerRequests'), where('status', '==', 'pending'))),
    ])

    return {
      totalStores: allStores.data().count,
      activeStores: activeStores.data().count,
      inactiveStores: allStores.data().count - activeStores.data().count,
      totalUsers: allUsers.data().count,
      totalClients: allClients.data().count,
      pendingRequests: pendingRequests.data().count,
    }
  } catch (err) {
    throw mapErr(err)
  }
}

export async function getDealerRequestCounts() {
  try {
    const [confirmed, rejected] = await Promise.all([
      getCountFromServer(query(collection(db, 'dealerRequests'), where('status', '==', 'confirmed'))),
      getCountFromServer(query(collection(db, 'dealerRequests'), where('status', '==', 'rejected'))),
    ])
    return {
      confirmed: confirmed.data().count,
      rejected: rejected.data().count,
    }
  } catch (err) {
    throw mapErr(err)
  }
}

export async function getUserCountsByRole() {
  try {
    const snap = await getDocs(query(collection(db, 'users')))
    const counts = { store_admin: 0, dealer: 0, system_manager: 0, member: 0, other: 0 }
    snap.docs.forEach(d => {
      const role = d.data().role
      if (role in counts) counts[role]++
      else counts.other++
    })
    return counts
  } catch (err) {
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Demandes Dealer (supervision)
// ──────────────────────────────────────────────────────────────────────────────

export async function listAllDealerRequests({
  lastDoc = null,
  statusFilter = null,
  dealerSearch = '',
  storeSearch = '',
} = {}) {
  try {
    const constraints = []
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(PAGE + 1))
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'dealerRequests'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    let requests = docs.map(d => ({ id: d.id, ...d.data() }))

    if (dealerSearch.trim()) {
      const q = dealerSearch.trim().toLowerCase()
      requests = requests.filter(r =>
        r.dealerName?.toLowerCase().includes(q) ||
        r.dealerEmail?.toLowerCase().includes(q)
      )
    }
    if (storeSearch.trim()) {
      const q = storeSearch.trim().toLowerCase()
      requests = requests.filter(r => r.targetStoreName?.toLowerCase().includes(q))
    }

    return { requests, lastDoc: docs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
  }
}

export async function getRecentDealerRequests(count = 5) {
  try {
    const snap = await getDocs(
      query(collection(db, 'dealerRequests'), orderBy('createdAt', 'desc'), limit(count))
    )
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Inventaire Dealer — audit des mouvements de stock / liquidité (lecture seule)
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

// Liste paginée des mouvements d'inventaire du dealer unique actif + solde courant.
// Le gérant lit users (résolution dealer), dealerBalances/{uid} et sa sous-collection
// auditLogs (règles: isSystemManager). Aucun index composite requis.
export async function listDealerInventoryMovements({ lastDoc = null, dealerUid = null } = {}) {
  try {
    let uid = dealerUid
    let dealerName = null
    let multipleActiveDealers = false
    if (!uid) {
      // limit(2) pour détecter l'anomalie « plusieurs dealers actifs » (invariant
      // serveur : un seul dealer actif — cf. resolveSingleDealer/MULTIPLE_DEALERS_ACTIVE).
      const dealerSnap = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'dealer'), where('active', '==', true), limit(2))
      )
      if (dealerSnap.empty) {
        const empty = shapeDealerInventory(null)
        return { dealerUid: null, dealerName: null, balance: { stock: empty.stock, liquidite: empty.liquidite }, byNetwork: empty.byNetwork, totalLiquidite: empty.totalLiquidite, movements: [], lastDoc: null, hasMore: false, multipleActiveDealers: false }
      }
      multipleActiveDealers = dealerSnap.size > 1
      uid = dealerSnap.docs[0].id
      dealerName = dealerSnap.docs[0].data().name ?? null
    }

    const balSnap = await getDoc(doc(db, 'dealerBalances', uid))
    // Inventaire par réseau (profil) : `balance` = réseau primaire (vue mono
    // inchangée) ; `byNetwork`/`totalLiquidite` alimentent la vue multi-réseaux.
    const shaped = shapeDealerInventory(balSnap.exists() ? balSnap.data() : null)
    const balance = { stock: shaped.stock, liquidite: shaped.liquidite }

    const constraints = [orderBy('createdAt', 'desc'), limit(PAGE + 1)]
    if (lastDoc) constraints.push(startAfter(lastDoc))
    const snap = await getDocs(query(collection(db, 'dealerBalances', uid, 'auditLogs'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    const movements = docs.map(d => ({ id: d.id, ...normalizeDealerMovement(d.data()) }))

    return { dealerUid: uid, dealerName, balance, byNetwork: shaped.byNetwork, totalLiquidite: shaped.totalLiquidite, movements, lastDoc: docs.at(-1) ?? null, hasMore, multipleActiveDealers }
  } catch (err) {
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilisateurs
// ──────────────────────────────────────────────────────────────────────────────

export async function listAllUsers({
  lastDoc = null,
  roleFilter = null,
  activeFilter = null,
  search = '',
} = {}) {
  try {
    const constraints = []
    if (roleFilter) constraints.push(where('role', '==', roleFilter))
    if (activeFilter !== null) constraints.push(where('active', '==', activeFilter))
    constraints.push(orderBy('name'))
    constraints.push(limit(PAGE + 1))
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'users'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    let users = docs.map(d => ({ id: d.id, ...d.data() }))

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      users = users.filter(u =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q)
      )
    }

    return { users, lastDoc: docs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Clients globaux
// ──────────────────────────────────────────────────────────────────────────────

export async function listAllClients({ lastDoc = null, search = '', storeId = '' } = {}) {
  try {
    const constraints = []
    if (storeId) {
      // Filtre boutique = égalité seule (ordre implicite par __name__) → aucun
      // index composite requis. orderBy('nom') seulement en vue « toutes boutiques ».
      constraints.push(where('registeredStoreId', '==', storeId))
    } else {
      constraints.push(orderBy('nom'))
    }
    constraints.push(limit(PAGE + 1))
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'globalClients'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const docs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs
    let clients = docs.map(d => ({ id: d.id, ...d.data() }))

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      clients = clients.filter(c =>
        c.nom?.toLowerCase().includes(q) ||
        c.prenom?.toLowerCase().includes(q) ||
        c.numeroPersonnel?.toLowerCase().includes(q) ||
        c.orange?.toLowerCase().includes(q) ||             // code / numéro agent
        c.registeredStoreName?.toLowerCase().includes(q)
      )
    }

    return { clients, lastDoc: docs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Historique consolidé (collectionGroup)
// ──────────────────────────────────────────────────────────────────────────────

export async function listConsolidatedHistory({ lastDoc = null, search = '', storeNameMap = null } = {}) {
  try {
    // Pas d'orderBy sur collectionGroup : Firestore n'auto-crée pas d'index COLLECTION_GROUP
    // pour un champ simple. On trie côté client après chaque page.
    const constraints = [limit(PAGE + 1)]
    if (lastDoc) constraints.splice(0, 0, startAfter(lastDoc))

    const fetches = [getDocs(query(collectionGroup(db, 'history'), ...constraints))]
    if (!storeNameMap) fetches.push(getDocs(query(collection(db, 'stores'), limit(200))))

    const [snap, storesSnap] = await Promise.all(fetches)

    const resolvedMap = storeNameMap ?? (() => {
      const m = {}
      storesSnap.docs.forEach(d => { m[d.id] = d.data().name ?? d.id })
      return m
    })()

    const hasMore = snap.docs.length > PAGE
    const rawDocs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs

    let records = rawDocs
      .map(d => {
        const parts = d.ref.path.split('/')
        const storeId = parts[1] ?? null
        const storeName = storeId ? (resolvedMap[storeId] ?? storeId) : '—'
        return { id: d.id, storeId, storeName, ...d.data() }
      })
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0)
        const tb = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0)
        return tb - ta
      })

    const lastRawDoc = rawDocs.at(-1) ?? null

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      records = records.filter(r => {
        const cn = [r.client?.prenom, r.client?.nom].filter(Boolean).join(' ').toLowerCase()
        const code = String(r.code || r.client?.orange || '').toLowerCase()
        return (
          r.clientId?.toLowerCase().includes(q) ||
          r.clientNom?.toLowerCase().includes(q) ||
          cn.includes(q) ||
          code.includes(q) ||
          r.storeName?.toLowerCase().includes(q) ||
          r.storeId?.toLowerCase().includes(q) ||
          r.nom?.toLowerCase().includes(q)
        )
      })
    }

    return { records, lastDoc: lastRawDoc, hasMore, storeNameMap: resolvedMap }
  } catch (err) {
    throw mapErr(err)
  }
}

// Liste des boutiques (id + nom) pour alimenter un sélecteur de filtre.
// Retourne la map id→nom (compatible avec listConsolidatedHistory) et une
// liste triée par nom prête pour un <select>.
export async function listStoreOptions() {
  try {
    const snap = await getDocs(query(collection(db, 'stores'), limit(200)))
    const map = {}
    const options = []
    snap.docs.forEach(d => {
      const name = d.data().name ?? d.id
      map[d.id] = name
      options.push({ id: d.id, name })
    })
    options.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return { map, options }
  } catch (err) {
    throw mapErr(err)
  }
}

// Historique d'UNE boutique, requêté directement sur sa sous-collection
// `clients/{storeId}/history` (côté serveur) — contrairement au filtre
// client-side de listConsolidatedHistory, ceci renvoie TOUT l'historique de la
// boutique (paginé), pas seulement les lignes présentes dans la page courante.
// Pas d'orderBy Firestore (certains docs anciens peuvent ne pas avoir createdAt) :
// on trie côté client par page, comme listConsolidatedHistory.
export async function listStoreHistory({ storeId, storeName = null, lastDoc = null } = {}) {
  if (!storeId) throw new Error('storeId requis pour listStoreHistory.')
  try {
    const constraints = [limit(PAGE + 1)]
    if (lastDoc) constraints.splice(0, 0, startAfter(lastDoc))

    const snap = await getDocs(query(collection(db, 'clients', storeId, 'history'), ...constraints))
    const hasMore = snap.docs.length > PAGE
    const rawDocs = hasMore ? snap.docs.slice(0, PAGE) : snap.docs

    const records = rawDocs
      .map(d => ({ id: d.id, storeId, storeName: storeName ?? storeId, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0)
        const tb = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0)
        return tb - ta
      })

    return { records, lastDoc: rawDocs.at(-1) ?? null, hasMore }
  } catch (err) {
    throw mapErr(err)
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

export async function getStoreNetworkBalances(storeId) {
  try {
    const snap = await getDoc(doc(db, 'clients', storeId, 'networkBalances', 'current'))
    if (!snap.exists()) return null
    return snap.data()
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Rapports — agrégation des demandes Dealer sur une période
// ──────────────────────────────────────────────────────────────────────────────

export async function getRequestsForReport({ dateFrom = null, dateTo = null, statusFilter = null } = {}) {
  try {
    const constraints = []
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    if (dateFrom) constraints.push(where('createdAt', '>=', Timestamp.fromDate(new Date(dateFrom))))
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      constraints.push(where('createdAt', '<=', Timestamp.fromDate(end)))
    }
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(500))

    const snap = await getDocs(query(collection(db, 'dealerRequests'), ...constraints))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    throw mapErr(err)
  }
}
