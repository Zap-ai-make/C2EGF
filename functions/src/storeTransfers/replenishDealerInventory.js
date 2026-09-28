/**
 * Handler d'approvisionnement de l'inventaire dealer.
 *
 * Sémantique :
 *   Le dealer déclare une quantité (stock OU liquidité) qu'il a acquise
 *   (ex. achat chez Orange). Son inventaire (dealerBalances/{uid}) est CRÉDITÉ.
 *   Sert aussi d'amorçage : le premier approvisionnement initialise le solde.
 *
 * Aucun autre solde n'est touché. db et FieldValue injectés (testabilité).
 */

import { replenishDealerInventory } from './dealerInventoryCommandShared.js'

export function replenishDealerInventoryHandler(request, dependencies) {
  return replenishDealerInventory(request, dependencies)
}
