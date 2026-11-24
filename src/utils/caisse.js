import { REFUSEE } from '../services/fileEnvoi.js'
import { montantRestant } from './argentDehors.js'
import { estRembSiege } from './rembSiege.js'
import { estTransfertArgent } from './transfertArgent.js'

/**
 * La caisse : ce que la boutique tient, et ce qui est encore en route.
 *
 * Deux écrans lisent ces mêmes chiffres — la barre des soldes, collée en haut
 * de chaque page, et les cases au-dessus des non terminées. Les calculer
 * séparément les ferait diverger au premier libellé mal accentué, et deux
 * totaux contradictoires sur le même écran valent moins qu'aucun des deux.
 */

/** Accents et casse retirés : l'historique porte des « Dépôt » et des « Depot ». */
const normaliser = (valeur) => String(valeur || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

/**
 * La nature d'une non terminée : ce que comptent les cases au-dessus de la
 * liste, et ce que trie leur filtre. Une seule lecture pour les deux.
 *
 * @returns {'depot'|'retrait'|'siege'|'transfert'|'retraitTransfert'|null}
 */
export function natureEnAttente(transaction) {
  if (!transaction) return null
  if (estRembSiege(transaction)) return 'siege'
  // Deux natures : une case et un filtre pour chaque sens (relecture du 23 novembre).
  if (estTransfertArgent(transaction)) return transaction.operation === 'retrait' ? 'retraitTransfert' : 'transfert'
  const type = normaliser(transaction.type)
  return type === 'depot' || type === 'retrait' ? type : null
}

/**
 * Ce qui reste à envoyer au siège. Une ligne sans reste lisible vaut son
 * montant moins ce qui est déjà parti : un zéro ferait passer l'argent du
 * siège pour celui de la boutique.
 */
const resteAuSiege = (ligne) => {
  const reste = Number(ligne.resteAuSiege)
  if (ligne.resteAuSiege != null && Number.isFinite(reste)) return Math.max(0, reste)
  return Math.max(0, (Number(ligne.montant) || 0) - (Number(ligne.envoyeAuSiege) || 0))
}

/** Ce qui reste à traiter sur un transfert d'argent, lu comme `resteAuSiege`. */
const resteATraiter = (ligne) => {
  const reste = Number(ligne.resteATraiter)
  if (ligne.resteATraiter != null && Number.isFinite(reste)) return Math.max(0, reste)
  return Math.max(0, (Number(ligne.montant) || 0) - (Number(ligne.montantTraite) || 0))
}

/**
 * Les sommes et les comptes des transactions non terminées, par type.
 *
 * Déduplique par identifiant : une ligne que l'abonnement temps réel livre en
 * double gonflerait un total que la caissière compare à sa caisse.
 *
 * Un remboursement au siège se compte à part (`siege`) : ni dépôt ni retrait
 * d'agent, c'est l'argent que la boutique tient pour le siège.
 *
 * @param {Array<object>} transactions
 * Un transfert d'argent (spec 2026-11-23) aussi, en deux sommes de sens
 * opposé : ce qu'il reste à envoyer au siège (transferts), ce que le siège
 * doit encore rendre (retraits), chacune avec son compte.
 *
 * @returns {{depots: number, retraits: number, nbDepots: number, nbRetraits: number, siege: number, nbSiege: number, transfertsDus: number, nbTransfertsDus: number, retraitsARecevoir: number, nbRetraitsARecevoir: number}}
 */
export function sommesEnAttente(transactions = []) {
  const vues = new Set()
  const somme = { depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0, siege: 0, nbSiege: 0, transfertsDus: 0, nbTransfertsDus: 0, retraitsARecevoir: 0, nbRetraitsARecevoir: 0 }

  for (const transaction of transactions) {
    if (!transaction || vues.has(transaction.id)) continue
    vues.add(transaction.id)
    // Une saisie refusée par le serveur (lot G3c) reste affichée le temps qu'on
    // la retire, mais elle n'a jamais existé : aucune somme n'est en route.
    if (transaction.envoi?.etat === REFUSEE) continue

    const nature = natureEnAttente(transaction)
    if (nature === 'siege') {
      somme.siege += resteAuSiege(transaction)
      somme.nbSiege += 1
      continue
    }
    if (nature === 'transfert') {
      somme.transfertsDus += resteATraiter(transaction)
      somme.nbTransfertsDus += 1
      continue
    }
    if (nature === 'retraitTransfert') {
      somme.retraitsARecevoir += resteATraiter(transaction)
      somme.nbRetraitsARecevoir += 1
      continue
    }

    // ⚠ LE RESTE DÛ, PAS LE MONTANT D'ORIGINE.
    //   Une transaction partiellement réglée a déjà vu ses tranches encaissées
    //   passer dans les soldes : les recompter en entier ferait annoncer au
    //   bandeau un total supérieur à ce qu'il y a dans la caisse, et la
    //   caissière chercherait l'écart chez elle. `montantRestant` fait déjà
    //   cette lecture pour « l'argent dehors » du dealer ; deux lectures
    //   différentes du même argent finiraient par donner deux chiffres.
    const montant = Number(montantRestant(transaction)) || 0
    if (nature === 'depot') { somme.depots += montant; somme.nbDepots += 1 }
    else if (nature === 'retrait') { somme.retraits += montant; somme.nbRetraits += 1 }
  }

  return somme
}

/**
 * Le total exact de la caisse.
 *
 *   T = stock + liquidite + depots en attente - retraits en attente
 *       - reste a envoyer au siege
 *
 * POURQUOI LES NON TERMINÉES COMPTENT
 * ───────────────────────────────────
 * Un dépôt non terminé a déjà sorti son montant du stock : le client a versé
 * l'argent, la boutique le doit encore au réseau. Il appartient donc toujours à
 * la caisse, même s'il n'apparaît plus dans les soldes. Un retrait non terminé
 * est l'inverse : son montant est rentré au stock alors que l'espèce n'a pas
 * encore été remise au client, donc il ne lui appartient pas encore.
 *
 * Un remboursement au siège non terminé se lit comme un retrait : l'argent de
 * l'agent est entré dans une réserve, mais il part au siège. On retranche ce
 * qui reste à envoyer, si bien que T ne bouge ni à la réception (la réserve et
 * le reste montent ensemble) ni à chaque tranche (ils baissent ensemble).
 *
 * Un transfert d'argent non terminé suit la même logique (spec 2026-11-23) :
 * l'argent reçu pour le siège se retranche comme un remboursement, celui que
 * le siège doit rendre s'ajoute comme un dépôt non terminé.
 *
 * C'est ce qui fait de T un chiffre vérifiable à la main en fin de journée,
 * là où stock + liquidité seuls laissent toujours un écart à expliquer.
 *
 * @param {{stock: number, liquidite: number, depots: number, retraits: number, siege?: number, transfertsDus?: number, retraitsARecevoir?: number}} parts
 * @returns {number}
 */
export function totalCaisse({ stock = 0, liquidite = 0, depots = 0, retraits = 0, siege = 0, transfertsDus = 0, retraitsARecevoir = 0 } = {}) {
  return (Number(stock) || 0) + (Number(liquidite) || 0) + (Number(depots) || 0)
    - (Number(retraits) || 0) - (Number(siege) || 0)
    - (Number(transfertsDus) || 0) + (Number(retraitsARecevoir) || 0)
}
