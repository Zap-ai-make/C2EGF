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

/**
 * ⚠ LES BOUTIQUES, L'APPLICATION LES CONNAÎT DÉJÀ (lot A4b,
 *   docs/rester-dans-le-quota-gratuit.md §A4). Depuis le lot A4a, elle garde les
 *   boutiques actives pour la session ; les relire ici coûtait 84 lectures à
 *   chaque ouverture de l'accueil du dealer ou de l'écran Boutiques du patron.
 *   Elle les envoie donc, `[{ id, name }]`, et `stores` n'est relu que si elles
 *   manquent : c'est le cas des versions de l'application antérieures à A4b, qui
 *   doivent continuer de marcher.
 *
 *   Rien ne repose sur cette liste que l'appelant puisse détourner : elle ne fait
 *   que nommer et regrouper des sommes que son rôle a le droit de voir pour tout
 *   le réseau. Le garde de rôle passe avant, comme avant.
 */
const MAX_BOUTIQUES = 500
const MAX_TEXTE = 200

const texteBorne = (valeur) => typeof valeur === 'string' && valeur.length > 0 && valeur.length <= MAX_TEXTE

function lireBoutiquesFournies(boutiques) {
  if (boutiques === undefined) return null
  const valide = Array.isArray(boutiques)
    && boutiques.length <= MAX_BOUTIQUES
    && boutiques.every((b) => b !== null && typeof b === 'object'
      && texteBorne(b.id)
      && (b.name === null || b.name === undefined || (typeof b.name === 'string' && b.name.length <= MAX_TEXTE)))
  if (!valide) throw new DealerRequestError('INVALID_REQUEST_ID', 'Liste de boutiques invalide.')
  // La forme d'un document : `aggregateOutstandingDrafts` lit `id` et `data().name`.
  return boutiques.map((b) => ({ id: b.id, data: () => ({ name: b.name ?? null }) }))
}

export async function listOutstandingDraftsHandler(request, { db }) {
  const actorUid = validateAuthUid(request.auth?.uid)
  const data = request.data ?? {}
  validateInputPayload(data, ['boutiques'])
  const boutiquesFournies = lireBoutiquesFournies(data.boutiques)

  await readValidatedProfile(db, actorUid, validateCallerProfile)

  const [stores, draftsSnap] = await Promise.all([
    boutiquesFournies ?? db.collection('stores').where('active', '==', true).get().then((snap) => snap.docs),
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
  return { success: true, ...aggregateOutstandingDrafts({ stores, drafts }) }
}
