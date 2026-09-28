/**
 * Handler de diminution de l'inventaire dealer.
 *
 * Sémantique :
 *   Le dealer retire une quantité (stock OU liquidité) de son inventaire
 *   (dealerBalances/{uid}) — correction ou sortie. Symétrique de
 *   replenishDealerInventory, mais en SOUSTRACTION.
 *   Blocage sous zéro : le solde ne peut jamais devenir négatif
 *   (INSUFFICIENT_DEALER_BALANCE), aucune écriture dans ce cas.
 *
 * Aucun autre solde n'est touché. db et FieldValue injectés (testabilité).
 */

import { decreaseDealerInventory } from './dealerInventoryCommandShared.js'

export function decreaseDealerInventoryHandler(request, dependencies) {
  return decreaseDealerInventory(request, dependencies)
}
