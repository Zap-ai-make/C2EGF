/**
 * dealerService.js — Opérations Firestore réservées au rôle Dealer.
 *
 * Collections autorisées :
 *   stores                               (lecture active == true)
 *   clients/{storeId}/networkBalances/current  (lecture soldes)
 *   dealerRequests                       (lecture propres demandes, création)
 *
 *   clients/{storeId}/drafts             (LECTURE SEULE, élargie le 31/08/2026)
 *
 * Collections interdites :
 *   globalClients, history, drafts/{id}/settlements, users d'autres comptes,
 *   sessions, auditLogs.
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
  collectionGroup,
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
import { agregerArgentDehors } from '../utils/argentDehors'
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
const NETWORK_BALANCES_COLLECTION = 'networkBalances'
const DRAFTS_COLLECTION = 'drafts'

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
// listAllActiveStores — TOUTES les boutiques actives, sans pagination
//
// POURQUOI UNE SECONDE FONCTION, ET PAS UN ARGUMENT DE LA PREMIÈRE
// ────────────────────────────────────────────────────────────────
// `listActiveStores` pagine, et c'est juste pour ce qu'elle sert : une LISTE
// que l'on parcourt. Un formulaire, lui, a besoin du CHOIX COMPLET — un menu
// déroulant amputé des deux tiers de ses options n'est pas une liste partielle,
// c'est une capacité manquante.
//
// Deux fonctions plutôt qu'un drapeau parce que le drapeau se serait oublié :
// c'est exactement ainsi que `NewDealerRequest` a fini par n'appeler qu'une
// page en croyant tout charger (spec S5, défaut figé par tc-205).
//
// ⚠ Aucune limite. C'est délibéré, et borné par la nature de la donnée : le
//   réseau compte 84 boutiques et une boutique ne se crée pas à la seconde. Le
//   jour où ce nombre change d'ordre de grandeur, c'est le menu déroulant qui
//   devient le mauvais dessin, pas cette requête — et on le remplacera par une
//   recherche serveur, pas par une page de 20 muette.
// ---------------------------------------------------------------------------

export async function listAllActiveStores() {
  try {
    const snap = await getDocs(query(
      collection(db, STORES_COLLECTION),
      where('active', '==', true),
      orderBy('name'),
    ))
    return { stores: snap.docs.map(d => ({ id: d.id, ...d.data() })) }
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
// listNetworkCaisses — l'état des caisses de TOUT le réseau (spec S2)
//
// CE QUE ÇA REMPLACE, ET CE QUE ÇA NE FAIT PAS
// ────────────────────────────────────────────
// L'écran des boutiques chargeait une page de 20 boutiques, puis lançait un
// `getStoreBalances` PAR boutique — soit 1 + N requêtes, en parallèle. Ici, deux
// requêtes, quel que soit le nombre de boutiques.
//
// ⚠ Le gain est en ALLERS-RETOURS, pas en lectures facturées. Firestore compte
//   un document lu ; à 84 boutiques on lit 84 fiches + 84 documents de soldes
//   dans les deux cas. Ce qui change, c'est qu'on passe d'environ 90 requêtes
//   réseau à 2 — et surtout que l'écran peut enfin montrer les 84 d'un coup,
//   ce que la pagination à 20 lui interdisait structurellement.
//
// Les deux requêtes partent ensemble : la seconde n'attend pas la première.
//
// Droits : `stores` est lisible par le dealer (firestore.rules §Boutiques), et
// le groupe `networkBalances` aussi (`match /{path=**}/networkBalances/{docId}`).
// Aucune règle n'a été élargie pour cette fonction.
// ---------------------------------------------------------------------------

export async function listNetworkCaisses({ network = DEALER_NETWORK } = {}) {
  try {
    const [storesSnap, balancesSnap] = await Promise.all([
      getDocs(query(
        collection(db, STORES_COLLECTION),
        where('active', '==', true),
        orderBy('name'),
      )),
      getDocs(query(collectionGroup(db, NETWORK_BALANCES_COLLECTION))),
    ])

    // Index des soldes par boutique. Le groupe rend des documents `current` ;
    // l'identifiant de la boutique se lit sur le grand-parent du document,
    // `clients/{storeId}/networkBalances/current`.
    const soldes = new Map()
    balancesSnap.docs.forEach((d) => {
      const storeId = d.ref.parent.parent?.id
      if (storeId) soldes.set(storeId, d.data()?.balances?.[network] ?? null)
    })

    // ⚠ On part des BOUTIQUES ACTIVES, pas des soldes. Le groupe rend aussi les
    //   documents des boutiques fermées : les prendre pour base gonflerait la
    //   somme des caisses d'un argent qui n'est plus en service.
    const caisses = storesSnap.docs.map((d) => {
      const solde = soldes.get(d.id)
      return {
        storeId: d.id,
        name: d.data()?.name ?? null,
        // `null` ≠ 0 : une boutique sans document de soldes n'a pas une caisse
        // vide, elle a une caisse INCONNUE. L'écran doit pouvoir le dire, et la
        // somme doit pouvoir refuser de se prononcer.
        stock: readAmount(solde?.stock),
        liquidite: readAmount(solde?.liquidite),
      }
    })

    const illisibles = caisses.filter(c => c.stock === null || c.liquidite === null).length

    return {
      caisses,
      total: caisses.length,
      // Les totaux ignorent les caisses illisibles — et `illisibles` dit
      // combien, pour que l'écran n'annonce jamais une somme complète qui ne
      // l'est pas.
      sommeStock: caisses.reduce((s, c) => s + (c.stock ?? 0), 0),
      sommeLiquidite: caisses.reduce((s, c) => s + (c.liquidite ?? 0), 0),
      illisibles,
    }
  } catch (err) {
    throw mapFirestoreError(err)
  }
}

// Un montant de caisse : entier fini, sinon `null` (inconnu, jamais 0).
function readAmount(value) {
  if (value === undefined || value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// listArgentDehors — les transactions non terminées du réseau, agrégées
//
// UNE REQUÊTE, PAS QUATRE-VINGT-QUATRE. Même mécanique que
// `listNetworkCaisses` ci-dessus : `collectionGroup` rend les brouillons de
// toutes les boutiques en un aller-retour, et l'identifiant de la boutique se
// lit sur le grand-parent du document (`clients/{storeId}/drafts/{id}`).
//
// AUCUN FILTRE `where`, ET CE N'EST PAS UN OUBLI. L'appartenance à `drafts`
// EST le statut « non terminé » : `firestore.rules` interdit d'y écrire un
// document qui ne soit pas pending. Filtrer sur `statut` ajouterait un index à
// déployer pour retirer zéro document.
//
// ⚠ DROITS. Cette fonction est la seule de ce service à dépendre de
//   l'élargissement du 31/08/2026 (`match /{path=**}/drafts/{docId}`). Tant
//   qu'il n'est pas déployé, elle rend « Accès refusé » — et l'écran doit
//   savoir le dire plutôt que compter zéro.
//
// ⚠ CE QU'ELLE RAMÈNE, ET QU'ELLE JETTE AUSSITÔT. Le document brut porte
//   `clientId`, `operatorName`, `operatorEmail`, la date. Rien de tout cela ne
//   sort d'ici : seuls `storeId`, `type`, `montant` et `remainingAmount`
//   passent à l'agrégation. Ce n'est pas une protection — le réseau a déjà
//   transporté le reste — mais c'est la garantie qu'aucun écran ne pourra
//   l'afficher par accident.
// ---------------------------------------------------------------------------

export async function listArgentDehors({ boutiques = [] } = {}) {
  try {
    const snap = await getDocs(query(collectionGroup(db, DRAFTS_COLLECTION)))
    const brouillons = snap.docs.map((d) => {
      const data = d.data() ?? {}
      return {
        storeId: d.ref.parent.parent?.id ?? null,
        type: data.type,
        montant: data.montant,
        remainingAmount: data.remainingAmount,
      }
    })
    return agregerArgentDehors(brouillons, boutiques)
  } catch (err) {
    throw mapFirestoreError(err)
  }
}

// ---------------------------------------------------------------------------
// subscribeRavitaillementsEnAttente — ce que le dealer a envoyé et qui attend
//
// Le pendant exact de `subscribeRetoursEnAttente` (storeTransferService), de
// l'autre côté du guichet : là-bas ce sont les boutiques qui attendent MA
// confirmation, ici c'est moi qui attends la LEUR.
//
// POURQUOI UNE SECONDE FONCTION SUR LA MÊME REQUÊTE
// ─────────────────────────────────────────────────
// `subscribeDealerPendingCount` alimente la pastille de navigation et ne rend
// qu'un entier. L'accueil a besoin du MONTANT. Élargir sa charge utile
// casserait ses appelants et les tests qui la tiennent, pour un gain nul : la
// requête est ici IDENTIQUE, et le SDK Firestore multiplexe les écoutes
// portant sur la même cible — un seul flux part vers le serveur, quel que soit
// le nombre d'abonnés. Aucun index ni aucune règle n'a été ajouté pour elle.
//
// ⚠ Un `amount` qui n'est pas un entier fini n'entre pas dans la somme et
//   incrémente `illisibles`. Un montant muet compté pour zéro, sur un écran qui
//   sert à décider combien envoyer, se lit comme « rien n'attend ».
// ---------------------------------------------------------------------------

export function subscribeRavitaillementsEnAttente({ currentUser, userProfile, onUpdate, onError } = {}) {
  const vide = { nombre: 0, montant: 0, illisibles: 0 }
  if (
    !currentUser?.uid ||
    !userProfile?.active ||
    userProfile?.role !== AUTH_ROLES.DEALER
  ) {
    onUpdate?.(vide)
    return () => {}
  }
  const q = query(
    collection(db, DEALER_REQUESTS_COLLECTION),
    where('dealerUid', '==', currentUser.uid),
    where('status', '==', 'pending'),
  )
  return onSnapshot(
    q,
    (snap) => {
      let montant = 0
      let illisibles = 0
      snap.docs.forEach((d) => {
        const brut = d.data()?.amount
        if (typeof brut === 'number' && Number.isFinite(brut)) montant += brut
        else illisibles += 1
      })
      onUpdate?.({ nombre: snap.size, montant, illisibles })
    },
    (err) => { onUpdate?.(vide); onError?.(mapFirestoreError(err)) },
  )
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
