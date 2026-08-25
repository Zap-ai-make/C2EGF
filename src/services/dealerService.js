/**
 * dealerService.js — Opérations Firestore réservées au rôle Dealer.
 *
 * Collections autorisées :
 *   stores                               (lecture active == true)
 *   clients/{storeId}/networkBalances/current  (lecture soldes)
 *   dealerRequests                       (lecture propres demandes, création)
 *
 * Collections interdites :
 *   globalClients, history, drafts, users d'autres comptes,
 *   sessions, auditLogs, transactions.
 *
 * Le service ne confirme, ne rejette, ne modifie et ne supprime
 * jamais une demande existante. Aucune modification de solde.
 *
 * Requêtes utilisées :
 *   §A  where(dealerUid==uid) + where(status==s) + orderBy(createdAt,desc) + limit(20)
 *         → index composite: dealerUid ASC + status ASC + createdAt DESC (existant)
 *   §B  where(dealerUid==uid) + orderBy(createdAt,desc) + limit(20)
 *         → index composite: dealerUid ASC + createdAt DESC (ajouté dans ce lot)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { parseStrictInteger as parseDealerAmount } from '../utils/parseStrictInteger'
import { AUTH_ROLES } from '../constants/authMessages'
import {
  DEALER_NETWORK,
  DEALER_NETWORKS,
  DEALER_REQUEST_TYPES,
  DEALER_REQUESTS_PAGE_SIZE,
  DEALER_STORES_PAGE_SIZE,
} from '../constants/dealerConstants'

const STORES_COLLECTION = 'stores'
const DEALER_REQUESTS_COLLECTION = 'dealerRequests'
const NETWORK_BALANCES_DOC = 'current'

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

function mapFirestoreError(err) {
  const code = err?.code || ''
  if (code === 'permission-denied') return new Error('Accès refusé. Vérifiez vos permissions.')
  if (code === 'unavailable') return new Error('Service temporairement indisponible. Réessayez.')
  if (code === 'failed-precondition') return new Error('Opération impossible dans l\'état actuel.')
  if (code === 'invalid-argument') return new Error('Données invalides.')
  if (import.meta.env.DEV) console.error('[dealerService]', err)
  return new Error('Une erreur inattendue s\'est produite.')
}

// ---------------------------------------------------------------------------
// Validation montant strict — chiffres uniquement, pas d'espaces
// (implémentation partagée : src/utils/parseStrictInteger.js)
// Ré-exporté sous son nom historique pour les appelants (NewDealerRequest, tests).
// ---------------------------------------------------------------------------

export { parseDealerAmount }

// ---------------------------------------------------------------------------
// Validation du contexte Dealer
// ---------------------------------------------------------------------------

function validateDealerContext(currentUser, userProfile) {
  if (!currentUser) throw new Error('Utilisateur non connecté.')
  if (
    !currentUser.uid ||
    typeof currentUser.uid !== 'string' ||
    currentUser.uid.trim() === ''
  ) {
    throw new Error('UID utilisateur invalide.')
  }
  if (!userProfile) throw new Error('Profil introuvable.')
  if (userProfile.role !== AUTH_ROLES.DEALER) throw new Error('Accès réservé aux dealers.')
  if (!userProfile.active) throw new Error('Compte dealer inactif.')
  if (
    !userProfile.email ||
    typeof userProfile.email !== 'string' ||
    userProfile.email.trim() === ''
  ) {
    throw new Error('Email dealer manquant dans le profil.')
  }
  if (
    !userProfile.name ||
    typeof userProfile.name !== 'string' ||
    userProfile.name.trim() === ''
  ) {
    throw new Error('Nom dealer manquant dans le profil.')
  }
}

// ---------------------------------------------------------------------------
// listActiveStores — boutiques actives paginées (N+1 borné à PAGE_SIZE)
//
// Coût N+1 : pour chaque page de max DEALER_STORES_PAGE_SIZE boutiques,
// DEALER_STORES_PAGE_SIZE lectures supplémentaires pour les soldes.
// Ce coût est accepté car la page est bornée à 20 éléments.
// ---------------------------------------------------------------------------

export async function listActiveStores({ lastDoc: cursor = null } = {}) {
  try {
    const constraints = [
      where('active', '==', true),
      orderBy('name'),
      limit(DEALER_STORES_PAGE_SIZE + 1),
    ]
    if (cursor) constraints.push(startAfter(cursor))
    const snap = await getDocs(query(collection(db, STORES_COLLECTION), ...constraints))
    const hasMore = snap.docs.length > DEALER_STORES_PAGE_SIZE
    const visibleDocs = hasMore ? snap.docs.slice(0, DEALER_STORES_PAGE_SIZE) : snap.docs
    return {
      stores: visibleDocs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: visibleDocs.at(-1) ?? null,
      hasMore,
    }
  } catch (err) {
    throw mapFirestoreError(err)
  }
}

// ---------------------------------------------------------------------------
// getStoreBalances — soldes networkBalances/current d'une boutique
// ---------------------------------------------------------------------------

export async function getStoreBalances(storeId) {
  try {
    const ref = doc(db, 'clients', storeId, 'networkBalances', NETWORK_BALANCES_DOC)
    const snap = await getDoc(ref)
    if (!snap.exists()) return { balances: {} }
    return snap.data()
  } catch (err) {
    throw mapFirestoreError(err)
  }
}

// ---------------------------------------------------------------------------
// listDealerRequests — demandes du dealer connecté (paginées)
//
// Options :
//   currentUser    : Firebase auth user (requis)
//   userProfile    : profil Firestore (requis)
//   statusFilter   : 'pending' | 'confirmed' | 'rejected' | null
//   lastDoc        : dernier document Firestore pour cursor-based pagination
// ---------------------------------------------------------------------------

export async function listDealerRequests({
  currentUser,
  userProfile,
  statusFilter = null,
  lastDoc = null,
} = {}) {
  validateDealerContext(currentUser, userProfile)

  try {
    const constraints = []

    // Filtre dealer obligatoire — la règle Firestore l'impose de toute façon
    constraints.push(where('dealerUid', '==', currentUser.uid))

    // Filtre statut optionnel
    // Avec filtre   → index §A (dealerUid + status + createdAt)
    // Sans filtre   → index §B (dealerUid + createdAt) — ajouté dans ce lot
    if (statusFilter) {
      constraints.push(where('status', '==', statusFilter))
    }

    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(DEALER_REQUESTS_PAGE_SIZE + 1))

    if (lastDoc) {
      constraints.push(startAfter(lastDoc))
    }

    const q = query(collection(db, DEALER_REQUESTS_COLLECTION), ...constraints)
    const snap = await getDocs(q)

    const hasMore = snap.docs.length > DEALER_REQUESTS_PAGE_SIZE
    const visibleDocs = hasMore ? snap.docs.slice(0, DEALER_REQUESTS_PAGE_SIZE) : snap.docs
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
// subscribeDealerRequests — abonnement temps réel aux demandes du dealer (première page)
//
// La première page est maintenue en temps réel via onSnapshot.
// Les pages supplémentaires utilisent listDealerRequests() avec curseur (getDocs).
// Retourne la fonction unsubscribe — toujours appeler au démontage.
//
// Requêtes : identiques à listDealerRequests (§A et §B) — mêmes indexes.
// ---------------------------------------------------------------------------

export function subscribeDealerRequests({
  currentUser,
  userProfile,
  statusFilter = null,
  onUpdate,
  onError,
} = {}) {
  validateDealerContext(currentUser, userProfile)

  const constraints = [where('dealerUid', '==', currentUser.uid)]
  if (statusFilter) constraints.push(where('status', '==', statusFilter))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(DEALER_REQUESTS_PAGE_SIZE + 1))

  const q = query(collection(db, DEALER_REQUESTS_COLLECTION), ...constraints)
  return onSnapshot(
    q,
    (snap) => {
      const hasMore = snap.docs.length > DEALER_REQUESTS_PAGE_SIZE
      const visibleDocs = hasMore ? snap.docs.slice(0, DEALER_REQUESTS_PAGE_SIZE) : snap.docs
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
// subscribeDealerPendingCount — abonnement léger au nombre de demandes pending
//
// Requête : dealerUid == uid + status == 'pending' (pas d'orderBy, pas de limit)
// → utilise l'index composite dealerUid + status existant.
// Retourne la fonction unsubscribe — toujours appeler au démontage.
// ---------------------------------------------------------------------------

export function subscribeDealerPendingCount({ currentUser, userProfile, onUpdate } = {}) {
  if (
    !currentUser?.uid ||
    !userProfile?.active ||
    userProfile?.role !== AUTH_ROLES.DEALER
  ) {
    onUpdate?.(0)
    return () => {}
  }
  const q = query(
    collection(db, DEALER_REQUESTS_COLLECTION),
    where('dealerUid', '==', currentUser.uid),
    where('status', '==', 'pending'),
  )
  return onSnapshot(q, (snap) => onUpdate(snap.size), () => onUpdate(0))
}

// ---------------------------------------------------------------------------
// createDealerRequest — crée une demande Dealer
//
// Entrée publique : { currentUser, userProfile, targetStoreId, requestType, amount }
// Valeurs construites par le service (jamais prises du formulaire) :
//   dealerUid, dealerEmail, dealerName, targetStoreName,
//   network, status, createdAt, updatedAt, tous les champs null
// ---------------------------------------------------------------------------

export async function createDealerRequest({
  currentUser,
  userProfile,
  targetStoreId,
  requestType,
  amount,
  network = DEALER_NETWORK,
} = {}) {
  // Validation contexte dealer
  validateDealerContext(currentUser, userProfile)

  // Validation réseau : ∈ réseaux du profil dealer (défense en profondeur ; les
  // règles Firestore revalident via profileDealerNetworks()). Mono → 'Orange'.
  if (!DEALER_NETWORKS.includes(network)) {
    throw new Error('Réseau invalide.')
  }

  // Validation boutique cible
  if (!targetStoreId || typeof targetStoreId !== 'string' || targetStoreId.trim() === '') {
    throw new Error('Boutique cible manquante.')
  }

  // Validation type
  if (!Object.values(DEALER_REQUEST_TYPES).includes(requestType)) {
    throw new Error('Type de demande invalide.')
  }

  // Validation montant — entier strictement positif, chiffres uniquement
  const parsedAmount = parseDealerAmount(amount)
  if (parsedAmount === null) {
    throw new Error('Montant invalide : entier strictement positif requis.')
  }

  // Le type « ouverture du jour » a été retiré : liquidityAmount reste null
  // (champ conservé dans le payload pour rester conforme aux règles Firestore).
  const parsedLiquidityAmount = null

  // Charger la boutique pour valider qu'elle est active et récupérer son nom
  let storeData
  try {
    const storeSnap = await getDoc(doc(db, STORES_COLLECTION, targetStoreId))
    if (!storeSnap.exists()) throw new Error('Boutique introuvable.')
    storeData = storeSnap.data()
  } catch (err) {
    if (err.message && !err.code) throw err
    throw mapFirestoreError(err)
  }

  if (!storeData.active) throw new Error('La boutique cible est inactive.')
  if (
    !storeData.name ||
    typeof storeData.name !== 'string' ||
    storeData.name.trim() === ''
  ) {
    throw new Error('La boutique cible n\'a pas de nom valide.')
  }

  // Construction du payload — aucune valeur venant du formulaire pour les champs sensibles
  const payload = {
    dealerUid: currentUser.uid,
    dealerEmail: userProfile.email,
    dealerName: userProfile.name,
    targetStoreId,
    targetStoreName: storeData.name,
    requestType,
    network,
    amount: parsedAmount,
    liquidityAmount: parsedLiquidityAmount,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    confirmedBy: null,
    confirmedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    previousBalance: null,
    newBalance: null,
  }

  try {
    const ref = await addDoc(collection(db, DEALER_REQUESTS_COLLECTION), payload)
    return { id: ref.id, ...payload }
  } catch (err) {
    throw mapFirestoreError(err)
  }
}
