/**
 * Annuaire des boutiques sollicitables pour une collaboration.
 *
 * POURQUOI CE CALLABLE EXISTE
 * ───────────────────────────
 * Les règles Firestore interdisent à une boutique de lire la fiche d'une autre
 * (`match /stores/{storeId}` → `isStoreMember(storeId)`). Une boutique ne peut donc
 * pas construire cette liste elle-même. Le SDK Admin, lui, contourne les règles :
 * ce callable est le SEUL chemin. Ne pas l'assouplir en ouvrant /stores en lecture.
 *
 * CRITÈRE D'ÉLIGIBILITÉ (mono-réseau)
 * ───────────────────────────────────
 * Toute boutique ACTIVE autre que la sienne. Avec un seul réseau, toutes les
 * boutiques l'opèrent : un drapeau « fournisseur » par réseau ne discriminerait
 * rien. Le véritable garde-fou n'est pas ici mais à la confirmation, où le stock
 * réel est contrôlé (INSUFFICIENT_SUPPLIER_BALANCE).
 *
 * Si un jour une boutique doit pouvoir refuser d'être sollicitée, cela se fera par
 * un booléen sur `stores/{id}` — un champ, pas une collection.
 *
 * Lecture seule, hors transaction.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled, resolveCollaborationNetwork } from './shared.js'
import { STORE_NETWORKS, COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function listStoreCollaborationProvidersHandler(
  request,
  {
    db,
    storeNetworks = STORE_NETWORKS,
    collaborationsEnabled = COLLABORATIONS_ENABLED,
  },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload ─────────────────────────────────────────────────────────────
  // `network` est accepté mais seulement pour être VALIDÉ contre le profil : en
  // mono-réseau il est redondant, en multi-réseaux il servira à filtrer. Le
  // résoudre ici garantit qu'un réseau inconnu est refusé au lieu d'être ignoré.
  const payload = validateInputPayload(request.data ?? {}, ['network'])
  const network = resolveCollaborationNetwork(payload.network ?? null, storeNetworks)

  // ── 4. Profil acteur (store_admin actif) ──────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  const actorStoreId = validateProfileData(profileSnap.data())

  // ── 5. Annuaire : boutiques actives, la sienne exclue ─────────────────────
  const snap = await db.collection('stores').where('active', '==', true).get()

  const providers = snap.docs
    .filter((d) => d.id !== actorStoreId)
    .map((d) => ({ storeId: d.id, storeName: d.data().name ?? null }))
    .sort((a, b) => (a.storeName ?? '').localeCompare(b.storeName ?? '', 'fr'))

  return { success: true, network, providers }
}
