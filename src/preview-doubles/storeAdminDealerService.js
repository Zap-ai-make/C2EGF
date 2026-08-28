/**
 * Doublure du service des demandes Dealer — BANC D'ESSAI UNIQUEMENT.
 *
 * L'écran « Demandes Dealer » lit Firestore au montage. Sans doublure, le banc
 * ne peut pas l'afficher, et il resterait le seul écran de la boutique qu'on ne
 * pourrait pas REGARDER — alors que c'est la seule façon d'y voir ce que ni les
 * tests ni le lint ne montrent : la densité, l'alignement, ce qui déborde.
 *
 * Cette doublure n'est PAS un composant de remplacement : elle expose la même
 * API que `src/services/storeAdminDealerService.js` et rend des données
 * plausibles. Le banc monte donc l'écran RÉEL, avec son vrai balisage, ses vrais
 * états et son vrai tableau. C'est la différence avec une maquette recopiée, qui
 * dérive du jour où le composant change.
 *
 * Elle est substituée par un alias Vite, posé uniquement par les scripts de
 * capture (`scripts/lib/banc.mjs`). Rien dans l'application ne l'importe, et
 * `preview.html` n'est pas une entrée de build : elle ne peut pas atteindre la
 * production.
 */

const DEALERS = [
  { nom: 'C2EGF CENTRALE', email: 'centrale@c2egf.bf' },
  { nom: 'C2EGF POUYTENGA', email: 'pouytenga@c2egf.bf' },
  { nom: 'C2EGF KOUPELA', email: 'koupela@c2egf.bf' },
]

const TYPES = ['stock_add', 'liquidity_add']
const STATUTS = ['pending', 'confirmed', 'rejected', 'pending', 'confirmed']

const jour = (decalage, heure) => {
  const d = new Date()
  d.setDate(d.getDate() - decalage)
  d.setHours(heure, (decalage * 17) % 60, 0, 0)
  return d
}

const DEMANDES = Array.from({ length: 9 }, (_, i) => {
  const dealer = DEALERS[i % DEALERS.length]
  return {
    id: `req-${i + 1}`,
    dealerName: dealer.nom,
    dealerEmail: dealer.email,
    requestType: TYPES[i % TYPES.length],
    amount: 250000 + ((i * 137717) % 4750000),
    network: 'Orange',
    status: STATUTS[i % STATUTS.length],
    createdAt: jour(i, 8 + (i % 9)),
    updatedAt: jour(i, 9 + (i % 8)),
    rejectionReason: STATUTS[i % STATUTS.length] === 'rejected'
      ? 'Montant supérieur au ravitaillement convenu ce matin.'
      : null,
  }
})

/**
 * Variante demandée par l'URL du banc : `preview.html?demandes=vide` ou
 * `?demandes=erreur`. Les états vide et d'erreur sont ceux qu'on dessine le
 * plus soigneusement et qu'on regarde le moins — parce qu'il faut casser
 * quelque chose pour les voir. Ici, il suffit d'une adresse.
 */
const variante = () =>
  new URLSearchParams(globalThis.location?.search ?? '').get('demandes') ?? 'garni'

export function subscribeStoreAdminDealerRequests({ statusFilter, typeFilter, onUpdate } = {}) {
  if (variante() === 'erreur') {
    throw new Error("Votre profil n'autorise pas la lecture des demandes de cette boutique.")
  }

  const requests =
    variante() === 'vide'
      ? []
      : DEMANDES.filter(
          (r) => (!statusFilter || r.status === statusFilter) && (!typeFilter || r.requestType === typeFilter)
        )
  // Asynchrone comme le vrai service : le banc doit passer par l'état de
  // chargement, sinon on ne le regarde jamais.
  const t = setTimeout(() => onUpdate?.({ requests, lastDoc: null, hasMore: false }), 400)
  return () => clearTimeout(t)
}

export async function listStoreAdminDealerRequests() {
  return { requests: [], lastDoc: null, hasMore: false }
}

export function subscribeStorePendingCount({ onUpdate } = {}) {
  const t = setTimeout(() => onUpdate?.(DEMANDES.filter((r) => r.status === 'pending').length), 300)
  return () => clearTimeout(t)
}

export async function getStoreAdminDealerRequestById({ requestId } = {}) {
  return DEMANDES.find((r) => r.id === requestId) ?? DEMANDES[0]
}

export default {
  subscribeStoreAdminDealerRequests,
  listStoreAdminDealerRequests,
  subscribeStorePendingCount,
  getStoreAdminDealerRequestById,
}
