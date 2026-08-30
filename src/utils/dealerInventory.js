/**
 * dealerInventory.js — façonnage (pur) de l'inventaire dealer pour l'affichage.
 *
 * Le document `dealerBalances/{uid}` stocke l'inventaire par réseau :
 *   { balances: { <Réseau>: { stock, liquidite }, … } }
 *
 * Ce helper transforme ces données brutes en une forme prête pour l'UI :
 *   - `byNetwork` : { <Réseau>: { stock, liquidite } } pour CHAQUE réseau du profil
 *     (0 si absent) → alimente les cartes Stock par réseau (multi-réseaux) ;
 *   - `stock` / `liquidite` : réseau PRIMAIRE (networks[0]) → rétro-compatibilité
 *     de la vue mono-réseau (aucun changement pour TAOFIC → Orange) ;
 *   - `totalLiquidite` : somme des liquidités de tous les réseaux → carte
 *     « Liquidité » globale de la vue multi-réseaux (calquée sur la boutique).
 *
 * PUR (aucune I/O) → testable directement (tc-086).
 */

import { DEALER_NETWORKS } from '../constants/dealerConstants'

// Reproduit le comportement d'affichage historique (`Number(x) || 0`) : tout
// nombre FINI est conservé tel quel — y compris un négatif, qui signale une
// anomalie d'inventaire à NE PAS masquer côté admin (piste d'audit visuelle) ;
// NaN / ±Infinity / non-numérique → 0.
function safeAmount(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {object|null|undefined} balancesData - données brutes du doc dealerBalances
 * @param {string[]} networks - réseaux du profil (défaut : profil actif)
 * @returns {{ byNetwork: Record<string,{stock:number,liquidite:number}>,
 *            stock:number, liquidite:number, totalLiquidite:number }}
 */
export function shapeDealerInventory(balancesData, networks = DEALER_NETWORKS) {
  const balances = (balancesData && typeof balancesData === 'object' && balancesData.balances) || {}
  const byNetwork = {}
  for (const net of networks) {
    const b = (balances[net] && typeof balances[net] === 'object') ? balances[net] : {}
    byNetwork[net] = { stock: safeAmount(b.stock), liquidite: safeAmount(b.liquidite) }
  }
  const primary = networks[0]
  const totalLiquidite = networks.reduce((sum, net) => sum + byNetwork[net].liquidite, 0)
  return {
    byNetwork,
    // Réseau primaire : préserve la vue mono à l'identique.
    stock: byNetwork[primary].stock,
    liquidite: byNetwork[primary].liquidite,
    totalLiquidite,
    flux: shapeFlux(balancesData),
  }
}

/**
 * Les compteurs de flux — « l'argent du dealer qui est dehors » (spec S2).
 *
 * Ils arrivent par le MÊME document que les soldes, donc par l'abonnement qui
 * existe déjà : les lire ne coûte pas une lecture de plus.
 *
 * `dehors` = envoyé − revenu. Ce n'est volontairement PAS découpé par ressource :
 * au comptoir de la boutique, un dépôt fait stock ↓ et liquidité ↑, si bien que
 * le stock envoyé devient de la liquidité chez elle. Deux nombres séparés
 * dériveraient l'un vers l'autre sans qu'un franc ne sorte du réseau.
 *
 * ⚠ `dehors` peut être NÉGATIF, et on ne le masque pas. Les compteurs partent de
 *   zéro le jour de leur mise en service : tant qu'ils n'ont pas rattaché
 *   l'historique, des retours peuvent être comptés sans que l'envoi
 *   correspondant l'ait été. Un négatif est donc le signal honnête d'un cumul
 *   incomplet — le forcer à 0 fabriquerait une donnée fausse et masquerait
 *   précisément ce que l'écran doit annoncer.
 */
function shapeFlux(balancesData) {
  const flux = (balancesData && typeof balancesData === 'object' && balancesData.flux) || {}
  const envoyeCumul = safeAmount(flux.envoyeCumul)
  const revenuCumul = safeAmount(flux.revenuCumul)
  return {
    envoyeCumul,
    revenuCumul,
    dehors: envoyeCumul - revenuCumul,
    // Aucune opération comptée ⇒ le rapprochement avec la somme des caisses
    // n'a pas de sens. C'est l'écran qui le dira ; ici on se contente de le
    // rendre lisible.
    amorce: envoyeCumul > 0 || revenuCumul > 0,
  }
}

/** Inventaire vide (tous réseaux à 0) — état initial avant la 1re lecture. */
export function emptyDealerInventory(networks = DEALER_NETWORKS) {
  return shapeDealerInventory(null, networks)
}
