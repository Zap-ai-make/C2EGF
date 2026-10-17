import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const normalizedType = (value) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

const remainingAmount = (draft) => {
  if (finite(draft?.remainingAmount)) return draft.remainingAmount
  if (finite(draft?.montant)) return draft.montant
  return null
}

/**
 * Les deux rôles qui ont besoin de cet agrégat, et aucun autre.
 *   · `dealer`         — « mon argent dehors », son écran d'accueil ;
 *   · `system_manager` — l'écran Boutiques du patron.
 *
 * ⚠ CE GARDE EST LOCAL À CETTE CALLABLE, ET IL DOIT LE RESTER. Il existe un
 *   `validateDealerProfile` exporté par `../storeTransfers/shared.js`, partagé
 *   par les callables d'écriture (dépôt partenaire, commandes d'inventaire,
 *   décisions de transfert). Élargir CELUI-LÀ ouvrirait au patron des
 *   ÉCRITURES, alors que tout son espace est en lecture seule. Les deux gardes
 *   se ressemblent ; ils ne répondent pas à la même question.
 *
 * ⚠ UN `store_admin` OU UN `member` N'ENTRE PAS ICI, et ce n'est pas un oubli :
 *   il lit déjà les brouillons de SA boutique par les règles Firestore. Cet
 *   agrégat porte sur le réseau entier — ce n'est pas la même donnée.
 */
const ROLES_AUTORISES = Object.freeze(['dealer', 'system_manager'])

const validateCallerProfile = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (!ROLES_AUTORISES.includes(profile.role)) {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée au dealer et au gérant du réseau.')
  }
}

export function aggregateOutstandingDrafts({ stores = [], drafts = [] } = {}) {
  const byStore = new Map(stores.map((store) => [
    store.id,
    { storeId: store.id, name: store.data()?.name ?? null, depots: 0, retraits: 0, dehors: 0 },
  ]))
  let illisibles = 0
  let horsReseau = 0

  for (const draft of drafts) {
    const row = byStore.get(draft?.storeId)
    if (!row) { horsReseau += 1; continue }
    const amount = remainingAmount(draft)
    if (amount === null) { illisibles += 1; continue }
    const type = normalizedType(draft.type)
    if (type === 'depot') row.depots += amount
    else if (type === 'retrait') row.retraits += amount
    else { illisibles += 1; continue }
  }

  let depots = 0
  let retraits = 0
  const parBoutique = []
  for (const row of byStore.values()) {
    row.dehors = row.depots - row.retraits
    depots += row.depots
    retraits += row.retraits
    if (row.depots > 0 || row.retraits > 0) parBoutique.push(row)
  }
  parBoutique.sort((a, b) => b.dehors - a.dehors || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr'))
  return { parBoutique, depots, retraits, dehors: depots - retraits, illisibles, horsReseau }
}

export async function listOutstandingDraftsHandler(request, { db }) {
  const actorUid = validateAuthUid(request.auth?.uid)
  validateInputPayload(request.data ?? {}, [])

  await readValidatedProfile(db, actorUid, validateCallerProfile)

  const [storesSnap, draftsSnap] = await Promise.all([
    db.collection('stores').where('active', '==', true).get(),
    db.collectionGroup('drafts').get(),
  ])
  const drafts = draftsSnap.docs.map((draft) => {
    const data = draft.data() ?? {}
    return {
      storeId: draft.ref.parent.parent?.id ?? null,
      type: data.type,
      montant: data.montant,
      remainingAmount: data.remainingAmount,
    }
  })
  return { success: true, ...aggregateOutstandingDrafts({ stores: storesSnap.docs, drafts }) }
}
