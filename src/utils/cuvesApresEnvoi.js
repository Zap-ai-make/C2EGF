import { DEALER_NETWORKS, estSousSeuil, DEALER_SEUIL_BAS } from '../constants/dealerConstants'

/**
 * Les cuves du dealer après l'envoi — ce que ce ravitaillement va lui coûter.
 *
 * CE QUE CET ÉCRAN NE SAVAIT PAS DIRE
 * ───────────────────────────────────
 * Le dealer confirmait un montant sans jamais voir ce qu'il lui restait. Or
 * l'inventaire du dealer est FINI : le serveur refuse la confirmation quand la
 * cuve ne couvre pas l'envoi (`INSUFFICIENT_DEALER_BALANCE`). Le refus arrivait
 * donc après coup, du côté de la boutique, sur une demande déjà partie.
 *
 * ⚠ LE MOMENT DU DÉBIT N'EST PAS CELUI DE L'ENVOI, ET C'EST TOUT LE PIÈGE.
 *   Un ravitaillement de boutique est créé « en attente » ; le débit de la cuve
 *   du dealer n'a lieu QUE lorsque la boutique confirme
 *   (`confirmDealerRequest`). Écrire « votre stock passe à X » serait donc faux
 *   deux fois : le solde ne bouge pas maintenant, et il peut ne jamais bouger
 *   si la boutique rejette. La projection porte son moment (`MOMENTS`) et
 *   l'écran l'énonce.
 *   L'opération partenaire, elle, est IMMÉDIATE et sans confirmation.
 *
 * ⚠ ON NE PEUT PAS TOUJOURS SAVOIR, ET ALORS ON LE DIT.
 *   `subscribeDealerBalance` façonne un document absent en un inventaire à
 *   zéro : une cuve vide et un inventaire jamais amorcé sont indiscernables
 *   dans l'UI. Or les deux mènent à des issues OPPOSÉES côté serveur — cuve
 *   vide ⇒ la confirmation sera refusée ; inventaire non amorcé ⇒ la garde
 *   d'amorçage saute le débit et la confirmation passe. Annoncer l'une des deux
 *   au hasard, c'est une chance sur deux d'envoyer le dealer reconstituer une
 *   cuve qui n'a aucun besoin de l'être. D'où `ETATS_CUVE.INCONNU`.
 *
 *   Un seul indice les sépare : les compteurs de flux ne sont écrits que sur un
 *   document EXISTANT (même garde d'amorçage, cf. `confirmDealerRequest`). Donc
 *   `flux.amorce` vrai ⇒ le document existe ⇒ un zéro est une vraie cuve vide.
 *   Cet indice ne vaut QUE pour le ravitaillement de boutique : l'opération
 *   partenaire n'a, elle, aucune garde d'amorçage — document absent ou cuve
 *   vide, elle est refusée dans les deux cas, donc rien n'y est incertain.
 *
 * PUR — aucune I/O, aucun JSX. C'est la règle qui décide si l'écran alerte ou
 * non ; elle se teste seule (tc-206).
 */

export const ETATS_CUVE = Object.freeze({
  /** On ne peut pas trancher entre cuve vide et inventaire non amorcé. */
  INCONNU: 'inconnu',
  /** La cuve ne couvre pas le montant : l'opération sera refusée. */
  INSUFFISANT: 'insuffisant',
  /** L'opération passe, mais laisse la cuve sous le seuil bas du dealer. */
  SOUS_SEUIL: 'sous-seuil',
  /** L'opération passe et la cuve reste au-dessus du seuil. */
  SUFFISANT: 'suffisant',
})

export const MOMENTS = Object.freeze({
  /** Le mouvement n'aura lieu qu'à la confirmation par la boutique. */
  CONFIRMATION: 'confirmation',
  /** Le mouvement a lieu à l'envoi, sans confirmation de personne. */
  IMMEDIAT: 'immediat',
})

/** Le champ Firestore débité par un type de ravitaillement (`getBalanceField`). */
export function champDebite(requestType) {
  if (requestType === 'stock_add') return 'stock'
  if (requestType === 'liquidity_add') return 'liquidite'
  return null
}

const entierPositif = (v) => Number.isSafeInteger(v) && v > 0

function cuves(inventaire, reseau) {
  const net = reseau ?? DEALER_NETWORKS[0]
  const b = inventaire?.byNetwork?.[net]
  return {
    stock: Number.isFinite(b?.stock) ? b.stock : 0,
    liquidite: Number.isFinite(b?.liquidite) ? b.liquidite : 0,
  }
}

/**
 * Classe une projection à partir de la SEULE cuve débitée.
 *
 * L'ordre des questions est celui de la gravité, et il n'est pas commutatif :
 * une cuve insuffisante est toujours annoncée comme insuffisante, jamais comme
 * « sous le seuil ». Le seuil bas est un conseil ; l'insuffisance est un refus.
 */
function classer({ avant, montant, incertitudePossible }) {
  if (avant === 0 && incertitudePossible) return ETATS_CUVE.INCONNU
  if (montant > avant) return ETATS_CUVE.INSUFFISANT
  if (estSousSeuil(avant - montant)) return ETATS_CUVE.SOUS_SEUIL
  return ETATS_CUVE.SUFFISANT
}

function projection({ moment, mouvements, etat, manque, reseau }) {
  return Object.freeze({
    moment,
    mouvements: Object.freeze(mouvements.map(Object.freeze)),
    etat,
    manque,
    seuil: DEALER_SEUIL_BAS,
    reseau,
  })
}

/**
 * Ravitaillement d'une boutique — une seule cuve bouge, et plus tard.
 *
 * @param {object}  args
 * @param {string}  args.requestType 'stock_add' | 'liquidity_add'
 * @param {number}  args.montant     entier strictement positif (déjà validé)
 * @param {object}  args.inventaire  sortie de `shapeDealerInventory`
 * @param {string} [args.reseau]     réseau ciblé (défaut : réseau primaire)
 */
export function projeterRavitaillement({ requestType, montant, inventaire, reseau } = {}) {
  const net = reseau ?? DEALER_NETWORKS[0]
  const champ = champDebite(requestType)
  const soldes = cuves(inventaire, net)

  if (!champ || !entierPositif(montant)) {
    return projection({ moment: MOMENTS.CONFIRMATION, mouvements: [], etat: ETATS_CUVE.INCONNU, manque: null, reseau: net })
  }

  const avant = soldes[champ]
  const etat = classer({
    avant,
    montant,
    // Seul le ravitaillement connaît cette ambiguïté : sa garde d'amorçage.
    incertitudePossible: !inventaire?.flux?.amorce,
  })

  return projection({
    moment: MOMENTS.CONFIRMATION,
    mouvements: [{ champ, avant, apres: avant - montant, debitee: true }],
    etat,
    manque: etat === ETATS_CUVE.INSUFFISANT ? montant - avant : null,
    reseau: net,
  })
}

/**
 * Opération partenaire — les deux cuves bougent, en sens inverse, tout de suite.
 *
 * Dépôt : stock −M, liquidité +M (exige du stock).
 * Retrait : stock +M, liquidité −M (exige de la liquidité).
 * Aucune garde d'amorçage côté serveur : un zéro est un refus, point.
 */
export function projeterOperationPartenaire({ operation, montant, inventaire, reseau } = {}) {
  const net = reseau ?? DEALER_NETWORKS[0]
  const soldes = cuves(inventaire, net)
  const retrait = operation === 'withdrawal'
  const champDebit = retrait ? 'liquidite' : 'stock'

  if (!entierPositif(montant)) {
    return projection({ moment: MOMENTS.IMMEDIAT, mouvements: [], etat: ETATS_CUVE.INCONNU, manque: null, reseau: net })
  }

  const avantDebit = soldes[champDebit]
  const etat = classer({ avant: avantDebit, montant, incertitudePossible: false })

  return projection({
    moment: MOMENTS.IMMEDIAT,
    mouvements: [
      { champ: 'stock', avant: soldes.stock, apres: retrait ? soldes.stock + montant : soldes.stock - montant, debitee: !retrait },
      { champ: 'liquidite', avant: soldes.liquidite, apres: retrait ? soldes.liquidite - montant : soldes.liquidite + montant, debitee: retrait },
    ],
    etat,
    manque: etat === ETATS_CUVE.INSUFFISANT ? montant - avantDebit : null,
    reseau: net,
  })
}
