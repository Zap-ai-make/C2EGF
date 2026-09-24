import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'

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

  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  const profile = profileSnap.data()
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (profile.role !== 'dealer') {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée au dealer.')
  }

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
