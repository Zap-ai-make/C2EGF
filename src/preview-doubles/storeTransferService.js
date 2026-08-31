/**
 * Doublure du service des transferts / de l'inventaire dealer — BANC D'ESSAI.
 *
 * Le poste dealer lit Firestore au montage : ses deux cuves, ses compteurs de
 * flux, et le nombre de retours en attente. Sans doublure, le banc afficherait
 * un poste à zéro — c'est-à-dire précisément l'état où l'on ne voit ni
 * l'alignement des montants, ni le seuil bas, ni la largeur que prend un
 * nombre à sept chiffres dans une barre de 224 px.
 *
 * Elle expose la même API que `src/services/storeTransferService.js` et rend
 * des données plausibles. Le banc monte donc le composant RÉEL — pas une
 * maquette qui dériverait au premier changement.
 *
 * Substituée par un alias Vite posé uniquement par `scripts/lib/banc.mjs`.
 * Rien dans l'application ne l'importe, et `preview.html` n'est pas une entrée
 * de build : elle ne peut pas atteindre la production.
 */

/** Variante demandée par l'URL : `?cuves=basses` ou `?cuves=vides`. */
const variante =
  new URLSearchParams(globalThis.location?.search ?? '').get('cuves') ?? 'garni'

/**
 * Variante du RAPPROCHEMENT — `?position=…`. Distincte de `cuves` parce
 * qu'elle porte sur d'autres champs du même document : les compteurs de flux,
 * pas les soldes.
 *
 *   antérieur (défaut) les caisses tiennent plus que les compteurs n'ont suivi
 *                      — le cas normal, celui du fonds d'avant la mise en service
 *   neufs              aucune opération comptée : on refuse de rapprocher
 *   anomalie           les compteurs ont suivi PLUS que caisses + transit
 */
const positionVariante =
  new URLSearchParams(globalThis.location?.search ?? '').get('position') ?? 'anterieur'

const FLUX = {
  anterieur: { envoyeCumul: 341200000, revenuCumul: 142800000 },
  neufs:     { envoyeCumul: 0, revenuCumul: 0 },
  anomalie:  { envoyeCumul: 400000000, revenuCumul: 100000000 },
}

const fluxChoisi = FLUX[positionVariante] ?? FLUX.anterieur

// Une cuve sous le seuil (500 000) doit pouvoir se regarder : c'est l'état que
// l'on dessine le plus soigneusement et qu'on voit le moins.
const INVENTAIRES = {
  garni:  { stock: 8420000, liquidite: 3150000 },
  basses: { stock: 8420000, liquidite: 310000 },
  vides:  { stock: 0, liquidite: 0 },
}

const inventaire = INVENTAIRES[variante] ?? INVENTAIRES.garni

const abonnement = (valeur) => ({ onUpdate }) => {
  onUpdate?.(valeur)
  return () => {}
}

export const subscribeDealerBalance = abonnement({
  byNetwork: { Orange: inventaire },
  stock: inventaire.stock,
  liquidite: inventaire.liquidite,
  totalLiquidite: inventaire.liquidite,
  flux: {
    ...fluxChoisi,
    dehors: fluxChoisi.envoyeCumul - fluxChoisi.revenuCumul,
    amorce: fluxChoisi.envoyeCumul > 0 || fluxChoisi.revenuCumul > 0,
  },
})

export const subscribeIncomingTransfersCount = abonnement(variante === 'vides' ? 0 : 3)

/**
 * Les retours en attente, en nombre ET en montant — « l'en transit » de
 * l'accueil. Les trois montants sont ceux de `subscribeIncomingTransfers`
 * ci-dessous, et ils doivent le rester : c'est la même file vue deux fois, et
 * un banc qui les laisserait diverger montrerait un rapprochement que
 * l'application ne produira jamais.
 */
export const subscribeRetoursEnAttente = abonnement({
  nombre: 3,
  montant: 640000 + 1200000 + 310000,
  illisibles: 0,
})

/** L'état de la file : `?file=garnie` (défaut) ou `?file=vide`. */
const fileVariante = new URLSearchParams(globalThis.location?.search ?? '').get('file') ?? 'garnie'

// ⚠ Dates FIXES, et non `new Date()`. Le jeu du banc est déterministe par
//   principe : une capture doit pouvoir se comparer à la précédente, et un
//   écart doit venir du code, jamais de l'heure à laquelle on l'a prise.
//   Les trois montants sont ceux de `subscribeRetoursEnAttente` ci-dessus —
//   c'est la même file vue deux fois, et elle ne doit pas diverger.
const RETOURS = [
  { id: 't1', storeName: 'OUAGA CENTRE', transferType: 'return_liquidity', amount: 640000, createdAt: new Date(2026, 7, 31, 7, 48) },
  { id: 't2', storeName: 'FADA', transferType: 'return_stock', amount: 1200000, createdAt: new Date(2026, 7, 30, 17, 20) },
  { id: 't3', storeName: 'KOUPELA', transferType: 'return_liquidity', amount: 310000, createdAt: new Date(2026, 7, 30, 11, 5) },
]

export const subscribeIncomingTransfers = ({ onUpdate }) => {
  onUpdate?.(fileVariante === 'vide' ? [] : RETOURS)
  return () => {}
}

export const subscribePartnerDeposits = abonnement([])

export const replenishDealerInventory = async () => ({ success: true })
export const decreaseDealerInventory = async () => ({ success: true })
export const createStoreDealerTransfer = async () => ({ success: true })
export const confirmStoreDealerTransfer = async () => ({ success: true })
export const rejectStoreDealerTransfer = async () => ({ success: true })
export const createPartnerDeposit = async () => ({ success: true })
export const subscribeStoreTransfers = abonnement([])
export const mapTransferError = (err) => err
