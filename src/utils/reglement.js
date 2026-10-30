import { getAvailableActions } from './helpers.js'

/**
 * Le règlement d'une transaction non terminée : « Encaisser » un dépôt,
 * « Payer par » un retrait, « Rembourser » un crédit.
 *
 * Le tableau des non terminées et l'assistant appliquent les mêmes plafonds :
 * ceux-ci. Le serveur reste le garant (il refuse un trop-perçu) ; ce contrôle
 * dit la raison AVANT l'envoi, dans les mots de la caisse.
 */

export const MONTANT_MINIMUM_REGLEMENT = 500

const GESTES_DE_REGLEMENT = Object.freeze(['encaisser', 'payerPar', 'rembourser'])

/** Le geste de règlement d'une nature, ou null si elle ne se règle pas. */
export function actionDeReglement(type) {
  const actions = getAvailableActions(type)
  return GESTES_DE_REGLEMENT.find((geste) => actions[geste]) ?? null
}

/** Le montant proposé d'office : le reste dû, sinon le montant entier (ancien brouillon). */
export const montantProposeDuReglement = (transaction) => transaction.remainingAmount ?? transaction.montant

/**
 * Le montant accepté, ou la raison du refus.
 *
 * ⚠ `parseInt`, et pas `parseFcfaAmount` : c'est la lecture que le tableau a
 *   toujours faite de son champ, et TC-306 la fige. L'harmoniser serait une
 *   décision métier, pas une extraction.
 *
 * @param {object} p
 * @param {object|null} p.transaction  la ligne non terminée ; absente, aucun plafond
 * @param {string} p.action            encaisser, payerPar, rembourser
 * @param {string|number} p.montant
 * @returns {{ok: true, valeur: number} | {ok: false, raison: string}}
 */
export function verifierMontantReglement({ transaction, action, montant }) {
  const valeur = parseInt(montant, 10)
  if (!valeur || valeur < MONTANT_MINIMUM_REGLEMENT) {
    return { ok: false, raison: `Montant invalide (minimum ${MONTANT_MINIMUM_REGLEMENT} FCFA, entier)` }
  }

  if (action !== 'rembourser') {
    const reste = transaction ? montantProposeDuReglement(transaction) : Infinity
    if (valeur > reste) {
      return { ok: false, raison: `Maximum : ${reste.toLocaleString('fr-FR')} FCFA (reste dû)` }
    }
  } else if (transaction && transaction.paidAmount != null) {
    // Un remboursement rend au plus ce qui a été payé, net de ce qui a déjà
    // été rendu. Le montant est d'au moins 500 : un net nul ou négatif est
    // donc refusé ici, avec son chiffre.
    const netPaye = (transaction.paidAmount ?? 0) - (transaction.refundedAmount ?? 0)
    if (valeur > netPaye) {
      return { ok: false, raison: `Maximum remboursable : ${netPaye.toLocaleString('fr-FR')} FCFA` }
    }
  }

  return { ok: true, valeur }
}
