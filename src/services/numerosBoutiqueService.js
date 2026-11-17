import { doc, getDoc } from 'firebase/firestore'
import { db } from '../config/firebase'
import { runStoreTransactionCommand } from './storeTransactionCommandService.js'

/**
 * Les numéros de la boutique : flotte (pour l'appeler) et dealer Orange (la
 * SIM qui reçoit la monnaie des agents). L'app Oxygen les montre aux agents
 * (docs/superpowers/specs/2026-11-17-numeros-boutique-design.md).
 *
 * ⚠ JAMAIS PAR LA FILE D'ENVOI. Un numéro dealer mis en file et appliqué plus
 *   tard pourrait arriver après qu'un agent a déjà composé l'ancien. Sans
 *   réseau, l'appel échoue tout de suite, et la boutique le lit.
 */

/** Une lecture de la fiche. Un numéro absent devient une chaîne vide. */
export async function lireNumerosBoutique(storeId) {
  const fiche = (await getDoc(doc(db, 'stores', storeId))).data() ?? {}
  return {
    flotte: typeof fiche.flotte === 'string' ? fiche.flotte : '',
    dealerOrange: typeof fiche.dealer?.Orange === 'string' ? fiche.dealer.Orange : '',
  }
}

/** Le serveur retire les espaces et vérifie les 8 chiffres ; une chaîne vide efface. */
export const enregistrerNumerosBoutique = ({ flotte, dealerOrange }) =>
  runStoreTransactionCommand({ action: 'updateStoreNumbers', flotte, dealer: { Orange: dealerOrange } })
