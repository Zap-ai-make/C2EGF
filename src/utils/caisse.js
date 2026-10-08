/**
 * La caisse : ce que la boutique tient, et ce qui est encore en route.
 *
 * Deux écrans lisent ces mêmes chiffres — la barre des soldes, collée en haut
 * de chaque page, et les deux cases au-dessus des non terminées. Les calculer
 * séparément les ferait diverger au premier libellé mal accentué, et deux
 * totaux contradictoires sur le même écran valent moins qu'aucun des deux.
 */

/** Accents et casse retirés : l'historique porte des « Dépôt » et des « Depot ». */
const normaliser = (valeur) => String(valeur || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

/**
 * Les sommes et les comptes des transactions non terminées, par type.
 *
 * Déduplique par identifiant : une ligne que l'abonnement temps réel livre en
 * double gonflerait un total que la caissière compare à sa caisse.
 *
 * @param {Array<object>} transactions
 * @returns {{depots: number, retraits: number, nbDepots: number, nbRetraits: number}}
 */
export function sommesEnAttente(transactions = []) {
  const vues = new Set()
  const somme = { depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0 }

  for (const transaction of transactions) {
    if (!transaction || vues.has(transaction.id)) continue
    vues.add(transaction.id)

    const montant = Number(transaction.montant) || 0
    const type = normaliser(transaction.type)
    if (type === 'depot') { somme.depots += montant; somme.nbDepots += 1 }
    else if (type === 'retrait') { somme.retraits += montant; somme.nbRetraits += 1 }
  }

  return somme
}

/**
 * Le total exact de la caisse.
 *
 *   T = stock + liquidite + depots en attente - retraits en attente
 *
 * POURQUOI LES NON TERMINÉES COMPTENT
 * ───────────────────────────────────
 * Un dépôt non terminé a déjà sorti son montant du stock : le client a versé
 * l'argent, la boutique le doit encore au réseau. Il appartient donc toujours à
 * la caisse, même s'il n'apparaît plus dans les soldes. Un retrait non terminé
 * est l'inverse : son montant est rentré au stock alors que l'espèce n'a pas
 * encore été remise au client, donc il ne lui appartient pas encore.
 *
 * C'est ce qui fait de T un chiffre vérifiable à la main en fin de journée,
 * là où stock + liquidité seuls laissent toujours un écart à expliquer.
 *
 * @param {{stock: number, liquidite: number, depots: number, retraits: number}} parts
 * @returns {number}
 */
export function totalCaisse({ stock = 0, liquidite = 0, depots = 0, retraits = 0 } = {}) {
  return (Number(stock) || 0) + (Number(liquidite) || 0) + (Number(depots) || 0) - (Number(retraits) || 0)
}
