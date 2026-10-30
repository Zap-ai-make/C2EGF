import { getAvailableActions } from './helpers.js'
import { formatCurrency } from './formatCurrency.js'
import {
  adjustBalanceValue,
  applyLiquidityDelta,
  applySettlementImpact,
  isWithdrawalType,
  mapPaymentMethodToNetwork,
  normalizeNetworkBalances,
  reversePendingOnlyImpact,
} from './financialImpact.js'

/**
 * Le règlement d'une transaction non terminée : « Encaisser » un dépôt,
 * « Payer par » un retrait, « Rembourser » un crédit.
 *
 * Le tableau des non terminées et l'assistant appliquent les mêmes plafonds :
 * ceux-ci. Le serveur reste le garant (il refuse un trop-perçu) ; ce contrôle
 * dit la raison AVANT l'envoi, dans les mots de la caisse.
 */

export const MONTANT_MINIMUM_REGLEMENT = 500

/**
 * Les champs qu'une PREMIÈRE tranche de règlement écrit sur une non terminée.
 * Le serveur refuse d'annuler une ligne qui en porte un seul
 * (`SETTLEMENT_FIELDS`, functions/src/storeTransactions/storeTransactionCommand.js) :
 * l'argent d'une tranche a déjà bougé, et défaire la ligne ne le rendrait pas.
 * TC-314 compare les deux listes.
 */
export const CHAMPS_DE_REGLEMENT = Object.freeze([
  'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
  'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
  'settlementAmount', 'settlementType',
])

/** La ligne a-t-elle commencé à se régler ? Alors elle ne s'annule plus. */
export const aEngageUnReglement = (transaction) =>
  CHAMPS_DE_REGLEMENT.some((champ) => Object.hasOwn(transaction ?? {}, champ))

/**
 * La réserve d'où sort l'argent d'un moyen de paiement, et ce qu'elle contient.
 *
 * ⚠ LES ESPÈCES SONT LA SOMME DE TOUS LES RÉSEAUX. Le serveur consomme la
 *   liquidité en cascade (`applyLiquidityDelta`) : c'est le total qui compte,
 *   le chiffre de la carte « Liquidité ». Le stock, lui, est celui du réseau.
 */
export function reserveDuMoyen(moyen, soldes) {
  const balances = normalizeNetworkBalances(soldes)
  const reseau = mapPaymentMethodToNetwork(moyen)
  if (reseau === 'Liquidite') {
    const disponible = Object.values(balances).reduce((somme, b) => somme + (Number(b?.liquidite) || 0), 0)
    return { nom: 'espèces', de: "d'espèces", disponible }
  }
  return { nom: `stock ${reseau}`, de: `de stock ${reseau}`, disponible: Number(balances[reseau]?.stock) || 0 }
}

/**
 * La réserve couvre-t-elle ce règlement ?
 *
 * LE VERDICT EST CELUI DU SERVEUR, PAS UNE RÈGLE RÉÉCRITE
 * ─────────────────────────────────────────────────────
 * On rejoue sa fonction d'impact sur les soldes de l'écran : la copie front
 * d'`applySettlementImpact`, figée à l'identique par TC-081. Elle lève
 * exactement quand il refuserait. Payer un retrait VIDE une réserve (les
 * espèces en Cash, le stock du réseau en mobile money) ; encaisser un dépôt en
 * remplit une, et ne manque donc jamais.
 *
 * Le remboursement est l'inverse du paiement, comme `reverseSettlementImpact`
 * du serveur — fonction que le front n'a pas : son sens est écrit ici.
 *
 * Premier essai réel (30 octobre 2026) : l'assistant a préparé le paiement en
 * Cash d'un retrait sans un franc en caisse. Le serveur a refusé APRÈS
 * « Confirmer », et sous un message qui ne disait pas pourquoi.
 *
 * @returns {{ok: true} | {ok: false, raison: string, reserve: {nom: string, disponible: number}}}
 */
export function verifierReserveDuReglement({ transaction, action, moyen, montant, soldes }) {
  const type = transaction?.settlementType ?? transaction?.type
  const balances = normalizeNetworkBalances(soldes)
  try {
    if (action === 'rembourser') {
      const reseau = mapPaymentMethodToNetwork(moyen)
      const delta = isWithdrawalType(type) ? montant : -montant
      if (reseau === 'Liquidite') applyLiquidityDelta(balances, delta)
      else adjustBalanceValue(balances, reseau, 'stock', delta)
    } else {
      applySettlementImpact(balances, { type, montant }, moyen)
    }
    return { ok: true }
  } catch (cause) {
    const reserve = reserveDuMoyen(moyen, balances)
    // Une autre panne (montant illisible…) n'est pas un manque : elle remonte.
    if (reserve.disponible >= montant) throw cause
    return {
      ok: false,
      reserve,
      raison: `Pas assez ${reserve.de} : il y a ${formatCurrency(reserve.disponible)}, il en faut ${formatCurrency(montant)}.`,
    }
  }
}

/**
 * Annuler une non terminée défait ce qu'elle a fait au stock : un dépôt le
 * rend, un retrait le REPREND — et ce stock doit donc y être encore. Même
 * fonction que le serveur (`reversePendingOnlyImpact`, trashDraft).
 *
 * @returns {{ok: true} | {ok: false, raison: string}}
 */
export function verifierAnnulation({ transaction, soldes }) {
  if (aEngageUnReglement(transaction)) {
    const paye = Number(transaction.paidAmount) || 0
    const reste = transaction.remainingAmount
    return {
      ok: false,
      raison:
        `Cette opération a déjà reçu un règlement${paye ? ` de ${formatCurrency(paye)}` : ''} : ` +
        'elle ne peut plus être annulée. Elle se termine en réglant le reste dû' +
        `${reste != null ? ` (${formatCurrency(reste)})` : ''}.`,
    }
  }
  if (!soldes || !transaction?.reseau) return { ok: true }

  const balances = normalizeNetworkBalances(soldes)
  try {
    reversePendingOnlyImpact(balances, transaction.type, transaction.reseau, Number(transaction.montant))
    return { ok: true }
  } catch (cause) {
    const disponible = Number(balances[transaction.reseau]?.stock) || 0
    if (disponible >= Number(transaction.montant)) throw cause
    return {
      ok: false,
      raison:
        `L'annuler reprendrait ${formatCurrency(transaction.montant)} au stock ${transaction.reseau}, ` +
        `qui n'en a que ${formatCurrency(disponible)}.`,
    }
  }
}

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
