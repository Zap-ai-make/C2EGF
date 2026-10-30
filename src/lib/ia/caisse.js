/**
 * caisse.js — ce que la boutique tient À L'INSTANT, lu par le modèle.
 *
 * Sans cet outil, l'assistant parlait de la caisse sans la voir : il savait
 * qu'un retrait se paie en Cash, pas qu'il n'y avait pas un franc en caisse.
 *
 * ⚠ LES CHIFFRES DE LA BARRE DES SOLDES, PAS UNE SECONDE LECTURE. Le stock vient
 *   des réseaux du profil, les espèces de tous les réseaux (la carte
 *   « Liquidité »), le total caisse de `totalCaisse` — exactement comme
 *   NetworkCardsDrawer. Deux totaux différents pour la même caisse, l'un à
 *   l'écran et l'autre dans la bouche de l'assistant, valent moins qu'aucun.
 *
 * Servi par le PANNEAU, pas par Firestore : les soldes vivent dans un contexte
 * React tenu à jour en temps réel, et c'est lui qu'affiche la barre. PUR : les
 * soldes et les non terminées arrivent en paramètre.
 */

import { NETWORK_OPTIONS } from '../../utils/constants.js'
import { sommesEnAttente, totalCaisse } from '../../utils/caisse.js'
import { normalizeNetworkBalances } from '../../utils/financialImpact.js'

export const DECLARATION_CAISSE = Object.freeze({
  name: 'etat_de_la_caisse',
  description:
    "Ce que la boutique a EN CE MOMENT : le stock électronique par réseau, les espèces en caisse, " +
    'les dépôts et retraits non terminés, et le total caisse — les chiffres de la barre des soldes. ' +
    "À EMPLOYER pour « combien j'ai en espèces », « il me reste combien de stock », « le total " +
    'caisse », « est-ce que je peux payer ce retrait », et avec bilan_du_jour pour tout point de la ' +
    "situation. Les montants sont en FCFA. Ne les additionne pas toi-même : `total_caisse` est le total.",
  parameters: { type: 'OBJECT', properties: {} },
})

/** Les outils que le panneau sert lui-même, sur ce que voient les écrans. */
export const OUTILS_DU_PANNEAU = Object.freeze([DECLARATION_CAISSE.name])

/**
 * @param {{soldes?: object, enAttente?: object[]}} etat
 *   `soldes` : stock et liquidité par réseau, tels que l'écran les tient.
 */
export function lireLaCaisse({ soldes, enAttente = [] } = {}) {
  if (!soldes) return { erreur: true, message: "Je ne vois pas les soldes de la caisse à l'instant." }

  const balances = normalizeNetworkBalances(soldes)
  const stockParReseau = Object.fromEntries(NETWORK_OPTIONS.map((reseau) => [reseau, Number(balances[reseau]?.stock) || 0]))
  const stock = Object.values(stockParReseau).reduce((somme, montant) => somme + montant, 0)
  const especes = Object.values(balances).reduce((somme, b) => somme + (Number(b?.liquidite) || 0), 0)
  const attente = sommesEnAttente(Array.isArray(enAttente) ? enAttente : [])

  return {
    stock: stockParReseau,
    especes,
    depots_non_termines: { nombre: attente.nbDepots, montant: attente.depots },
    retraits_non_termines: { nombre: attente.nbRetraits, montant: attente.retraits },
    total_caisse: totalCaisse({ stock, liquidite: especes, depots: attente.depots, retraits: attente.retraits }),
  }
}
