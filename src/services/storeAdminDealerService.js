/**
 * storeAdminDealerService.js — Lecture des demandes Dealer pour un Store Admin.
 *
 * Collections autorisées en lecture :
 *   dealerRequests   (seulement celles ciblant la boutique du profil connecté)
 *
 * Le service ne modifie, ne supprime et ne crée aucun document.
 * Aucune écriture sur networkBalances.
 * Aucune écriture sur dealerRequests.
 *
 * Le storeId provient exclusivement de userProfile — jamais d'une URL ou d'un formulaire.
 *
 * Requêtes Firestore utilisées :
 *   §A  where(targetStoreId==storeId) + orderBy(createdAt,desc) + limit(21)
 *         → index : targetStoreId ASC + createdAt DESC
 *   §B  where(targetStoreId==storeId) + where(status==s) + orderBy(createdAt,desc) + limit(21)
 *         → index : targetStoreId ASC + status ASC + createdAt DESC (existant)
 *   §C  where(targetStoreId==storeId) + where(requestType==t) + orderBy(createdAt,desc) + limit(21)
 *         → index : targetStoreId ASC + requestType ASC + createdAt DESC
 *   §D  where(targetStoreId==storeId) + where(status==s) + where(requestType==t) + orderBy(createdAt,desc) + limit(21)
 *         → index : targetStoreId ASC + status ASC + requestType ASC + createdAt DESC
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { AUTH_ROLES } from '../constants/authMessages'
import {
  DEALER_REQUEST_TYPES,
  DEALER_REQUEST_STATUSES,
  STORE_DEALER_REQUESTS_PAGE_SIZE,
} from '../constants/dealerConstants'

const DEALER_REQUESTS_COLLECTION = 'dealerRequests'

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

function mapFirestoreError(err) {
  const code = err?.code || ''
  if (code === 'permission-denied') return new Error('Vous n\'avez pas l\'autorisation d\'accéder à ces demandes.')
  if (code === 'unavailable') return new Error('Le service est temporairement indisponible.')
  if (code === 'failed-precondition') return new Error('Un index Firestore est requis pour cette recherche.')
  if (code === 'invalid-argument') return new Error('Données invalides.')
  if (code === 'not-found') return new Error('Cette demande est introuvable.')
  if (import.meta.env.DEV) console.error('[storeAdminDealerService]', err)
  return new Error('Une erreur inattendue s\'est produite.')
}

// ---------------------------------------------------------------------------
// Validation du contexte Store Admin
// ---------------------------------------------------------------------------

function validateStoreAdminContext(currentUser, userProfile) {
  if (!currentUser) throw new Error('Utilisateur non connecté.')
  if (
    !currentUser.uid ||
    typeof currentUser.uid !== 'string' ||
    currentUser.uid.trim() === ''
  ) {
    throw new Error('UID utilisateur invalide.')
  }
  if (!userProfile) throw new Error('Profil introuvable.')
  if (!userProfile.active) throw new Error('Compte inactif.')
  if (userProfile.role !== AUTH_ROLES.STORE_ADMIN) {
    throw new Error('Accès réservé aux administrateurs de boutique.')
  }
  if (
    !userProfile.storeId ||
    typeof userProfile.storeId !== 'string' ||
    userProfile.storeId.trim() === ''
  ) {
    throw new Error('Identifiant de boutique manquant dans le profil.')
  }
}

// ---------------------------------------------------------------------------
// listStoreAdminDealerRequests — demandes ciblant la boutique du profil (paginées)
//
// Options :
//   currentUser   : Firebase auth user (requis)
//   userProfile   : profil Firestore store_admin (requis)
//   statusFilter  : 'pending' | 'confirmed' | 'rejected' | null
//   typeFilter    : 'stock_add' | 'liquidity_add' | null
//   lastDoc       : curseur Firestore pour pagination
// ---------------------------------------------------------------------------

export async function listStoreAdminDealerRequests({
  currentUser,
  userProfile,
  statusFilter = null,
  typeFilter = null,
  lastDoc = null,
} = {}) {
  validateStoreAdminContext(currentUser, userProfile)

  if (statusFilter && !Object.values(DEALER_REQUEST_STATUSES).includes(statusFilter)) {
    throw new Error('Statut inconnu.')
  }
  if (typeFilter && !Object.values(DEALER_REQUEST_TYPES).includes(typeFilter)) {
    throw new Error('Type de demande inconnu.')
  }

  try {
    const constraints = [
      where('targetStoreId', '==', userProfile.storeId),
    ]

    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    if (typeFilter) constraints.push(where('requestType', '==', typeFilter))

    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(STORE_DEALER_REQUESTS_PAGE_SIZE + 1))

    if (lastDoc) constraints.push(startAfter(lastDoc))

    const q = query(collection(db, DEALER_REQUESTS_COLLECTION), ...constraints)
    const snap = await getDocs(q)

    const hasMore = snap.docs.length > STORE_DEALER_REQUESTS_PAGE_SIZE
    const visibleDocs = hasMore ? snap.docs.slice(0, STORE_DEALER_REQUESTS_PAGE_SIZE) : snap.docs

    return {
      requests: visibleDocs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: visibleDocs.at(-1) ?? null,
      hasMore,
    }
  } catch (err) {
    if (err.message && !err.code) throw err
    throw mapFirestoreError(err)
  }
}

// ---------------------------------------------------------------------------
// subscribeStoreAdminDealerRequests — abonnement temps réel (première page)
//
// Retourne la fonction unsubscribe — toujours appeler au démontage.
// Requêtes identiques à listStoreAdminDealerRequests (§A–§D) — mêmes indexes.
// ---------------------------------------------------------------------------

export function subscribeStoreAdminDealerRequests({
  currentUser,
  userProfile,
  statusFilter = null,
  typeFilter = null,
  onUpdate,
  onError,
} = {}) {
  validateStoreAdminContext(currentUser, userProfile)

  if (statusFilter && !Object.values(DEALER_REQUEST_STATUSES).includes(statusFilter)) {
    throw new Error('Statut inconnu.')
  }
  if (typeFilter && !Object.values(DEALER_REQUEST_TYPES).includes(typeFilter)) {
    throw new Error('Type de demande inconnu.')
  }

  const constraints = [where('targetStoreId', '==', userProfile.storeId)]
  if (statusFilter) constraints.push(where('status', '==', statusFilter))
  if (typeFilter) constraints.push(where('requestType', '==', typeFilter))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(STORE_DEALER_REQUESTS_PAGE_SIZE + 1))

  const q = query(collection(db, DEALER_REQUESTS_COLLECTION), ...constraints)
  return onSnapshot(
    q,
    (snap) => {
      const hasMore = snap.docs.length > STORE_DEALER_REQUESTS_PAGE_SIZE
      const visibleDocs = hasMore ? snap.docs.slice(0, STORE_DEALER_REQUESTS_PAGE_SIZE) : snap.docs
      onUpdate({
        requests: visibleDocs.map(d => ({ id: d.id, ...d.data() })),
        lastDoc: visibleDocs.at(-1) ?? null,
        hasMore,
      })
    },
    (err) => onError?.(mapFirestoreError(err))
  )
}

// ---------------------------------------------------------------------------
// subscribeStorePendingCount — abonnement léger au nombre de demandes pending boutique
//
// Requête : targetStoreId == storeId + status == 'pending'.
// → utilise l'index composite targetStoreId + status existant.
// Retourne la fonction unsubscribe — toujours appeler au démontage.
// ---------------------------------------------------------------------------

export function subscribeStorePendingCount({ currentUser, userProfile, onUpdate } = {}) {
  if (
    !currentUser?.uid ||
    !userProfile?.active ||
    userProfile?.role !== AUTH_ROLES.STORE_ADMIN ||
    !userProfile?.storeId
  ) {
    onUpdate?.(0)
    return () => {}
  }
  const q = query(
    collection(db, DEALER_REQUESTS_COLLECTION),
    where('targetStoreId', '==', userProfile.storeId),
    where('status', '==', 'pending'),
  )
  return onSnapshot(q, (snap) => onUpdate(snap.size), () => onUpdate(0))
}

// ---------------------------------------------------------------------------
// getStoreAdminDealerRequestById — détail d'une demande ciblant la boutique
//
// Vérifie côté client que request.targetStoreId == userProfile.storeId,
// en plus de la protection assurée par les règles Firestore.
// ---------------------------------------------------------------------------

export async function getStoreAdminDealerRequestById({
  currentUser,
  userProfile,
  requestId,
} = {}) {
  validateStoreAdminContext(currentUser, userProfile)

  if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
    throw new Error('Identifiant de demande manquant.')
  }

  try {
    const snap = await getDoc(doc(db, DEALER_REQUESTS_COLLECTION, requestId))
    if (!snap.exists()) throw new Error('Cette demande est introuvable.')

    const data = snap.data()

    if (data.targetStoreId !== userProfile.storeId) {
      throw new Error('Cette demande ne concerne pas votre boutique.')
    }

    return { id: snap.id, ...data }
  } catch (err) {
    if (err.message && !err.code) throw err
    throw mapFirestoreError(err)
  }
}
