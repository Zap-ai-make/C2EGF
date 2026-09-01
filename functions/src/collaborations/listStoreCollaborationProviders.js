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
 * CRITÈRE D'ÉLIGIBILITÉ
 * ─────────────────────
 * Boutique ACTIVE, autre que la sienne, ET QUI DISPOSE DE LA RESSOURCE demandée
 * pour le montant demandé — son STOCK sur un dépôt, sa LIQUIDITÉ sur un retrait.
 * Proposer une consœur incapable de servir ne fait qu'envoyer le gérant vers un
 * refus qu'on pouvait prédire.
 *
 * ⚠ LES SOLDES NE SORTENT PAS D'ICI. Le filtrage se fait côté serveur et la
 *   réponse ne porte que `storeId` / `storeName` : une boutique n'a pas à
 *   apprendre la trésorerie de ses consœurs pour savoir à qui s'adresser.
 *   C'est le moindre privilège de SECURITY.md, appliqué à une commodité d'UI.
 *
 * ⚠ CE N'EST PAS LE GARDE-FOU FINANCIER. Les soldes lus ici sont hors
 *   transaction et peuvent bouger avant la confirmation. Le contrôle qui
 *   engage reste `nextSupplierBalance` dans confirmStoreCollaboration, sous
 *   transaction. Celui-ci ne fait qu'éviter une demande vouée à l'échec.
 *
 * Sans `amount` exploitable, aucun filtre : on rend l'annuaire entier plutôt
 * qu'une liste vide, parce qu'un menu vide se lit comme une panne.
 *
 * Lecture seule, hors transaction.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import {
  assertCollaborationsEnabled,
  resolveCollaborationNetwork,
  readStoreBalance,
  supplierResourceField,
  validateOperationType,
} from './shared.js'
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
  const payload = validateInputPayload(request.data ?? {}, ['network', 'operationType', 'amount'])
  const network = resolveCollaborationNetwork(payload.network ?? null, storeNetworks)

  // `operationType` décide du champ à contrôler ; `amount` du seuil. Les deux
  // sont facultatifs — le dialogue interroge l'annuaire avant que le gérant ait
  // fini de saisir — mais un `operationType` PRÉSENT est validé sans indulgence :
  // un type inconnu ne doit pas retomber en silence sur « stock ».
  const operationType = payload.operationType == null
    ? null
    : validateOperationType(payload.operationType)
  const resourceField = operationType ? supplierResourceField(operationType) : null
  const minimum = Number.isSafeInteger(payload.amount) && payload.amount > 0 ? payload.amount : null

  // ── 4. Profil acteur (store_admin actif) ──────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  const actorStoreId = validateProfileData(profileSnap.data())

  // ── 5. Annuaire : boutiques actives, la sienne exclue ─────────────────────
  const snap = await db.collection('stores').where('active', '==', true).get()
  const candidates = snap.docs.filter((d) => d.id !== actorStoreId)

  const filtre = resourceField !== null && minimum !== null
  const soldes = filtre
    ? await Promise.all(candidates.map(async (d) => {
      // Un solde illisible n'est pas une raison de faire tomber l'annuaire :
      // la boutique est simplement écartée, et le contrôle sous transaction
      // reste là pour trancher si elle est sollicitée par un autre chemin.
      try {
        const balSnap = await db.doc(`clients/${d.id}/networkBalances/current`).get()
        return readStoreBalance(balSnap.exists ? balSnap.data() : null, network, resourceField)
      } catch {
        return null
      }
    }))
    : []

  const providers = candidates
    .filter((d, i) => !filtre || (soldes[i] !== null && soldes[i] >= minimum))
    .map((d) => ({ storeId: d.id, storeName: d.data().name ?? null }))
    .sort((a, b) => (a.storeName ?? '').localeCompare(b.storeName ?? '', 'fr'))

  return { success: true, network, operationType, providers }
}
