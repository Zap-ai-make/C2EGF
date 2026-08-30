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
    envoyeCumul: 341200000,
    revenuCumul: 142800000,
    dehors: 198400000,
    amorce: true,
  },
})

export const subscribeIncomingTransfersCount = abonnement(variante === 'vides' ? 0 : 3)

export const subscribeIncomingTransfers = abonnement([
  { id: 't1', storeName: 'OUAGA CENTRE', transferType: 'return_liquidity', amount: 640000, createdAt: new Date() },
  { id: 't2', storeName: 'FADA', transferType: 'return_stock', amount: 1200000, createdAt: new Date() },
  { id: 't3', storeName: 'KOUPELA', transferType: 'return_liquidity', amount: 310000, createdAt: new Date() },
])

export const subscribePartnerDeposits = abonnement([])

export const replenishDealerInventory = async () => ({ success: true })
export const decreaseDealerInventory = async () => ({ success: true })
export const createStoreDealerTransfer = async () => ({ success: true })
export const confirmStoreDealerTransfer = async () => ({ success: true })
export const rejectStoreDealerTransfer = async () => ({ success: true })
export const createPartnerDeposit = async () => ({ success: true })
export const subscribeStoreTransfers = abonnement([])
export const mapTransferError = (err) => err
