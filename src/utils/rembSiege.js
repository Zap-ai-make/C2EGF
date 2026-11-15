import { activeProfile } from '../config/activeClientProfile.js'
import { adjustBalanceValue } from './financialImpact.js'
import { parseFcfaAmount } from './fcfaAmount.js'
import { formatCurrency } from './formatCurrency.js'
import { libelleVase } from './ravitaillement.js'
import { aUnCompteSur, preparerTransaction, reseauxDisponibles, toutBloque } from './preparationTransaction.js'

/**
 * Le remboursement au siège, côté navigateur.
 *
 * Le siège donne du stock à crédit aux agents la nuit ; le lendemain, l'agent
 * rembourse dans une boutique, qui envoie l'argent au siège
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md).
 *
 * Ces fonctions sont PURES. Elles disent ce que les boutons permettent et
 * préparent ce qui part au serveur ; le serveur reste le garant
 * (functions/src/storeTransactions/rembSiege.js, dont les soldes provisoires
 * ci-dessous recopient l'arithmétique — `functions/` ne peut rien importer
 * d'ici, ni l'inverse).
 */

export const TYPE_REMB_SIEGE = 'Remb. siège'

/** Le drapeau du profil : la nature n'est proposée que s'il est allumé. */
export const REMB_SIEGE_ACTIF = activeProfile.siegeRepayment?.enabled === true

export const RAISON_STOCK_INSUFFISANT = 'Stock insuffisant : utilisez Non Terminées.'
const RAISON_RESERVE = 'Choisissez Stock ou Espèce.'
const RESERVES = ['stock', 'liquidite']

export const estRembSiege = (ligne) => ligne?.type === TYPE_REMB_SIEGE

/**
 * Ce que le formulaire permet, et pourquoi il refuse le reste. Même forme
 * qu'`evaluerTransaction`, pour que le formulaire n'ait qu'une lecture.
 *
 * « Non Terminées » ne demande rien au stock : l'argent entre. « Valider »
 * envoie tout de suite au siège depuis le stock, sauf reçu en Stock, où le
 * stock reçu repart aussitôt et rien ne bouge — même à stock nul.
 *
 * @param {object} p
 * @param {number} p.stock  le stock du réseau débité
 */
export function evaluerRembSiege({ client, ambigus, montant, reseau, balanceType, stock }) {
  if (ambigus?.length) {
    const raison = `Plusieurs clients portent ce numéro (${ambigus.length}) : choisissez le bon dans la liste.`
    return toutBloque(raison, { isValid: false, message: raison })
  }
  if (!client || !montant || !reseau) return toutBloque('Veuillez remplir tous les champs requis')

  const compte = aUnCompteSur(client, reseau)
  const disponibles = reseauxDisponibles(client)
  const networkValidation = {
    isValid: compte,
    message: compte ? '' :
      disponibles.length > 0
        ? `Ce client n'a pas de code ${reseau}. Réseaux disponibles: ${disponibles.join(', ')}`
        : `Ce client n'a aucun code réseau configuré. Veuillez d'abord configurer au moins un réseau.`,
  }
  if (!compte) return toutBloque(networkValidation.message, networkValidation)
  if (!RESERVES.includes(balanceType)) return toutBloque(RAISON_RESERVE, networkValidation)

  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return toutBloque('Le montant doit être un entier strictement positif en FCFA', networkValidation)

  const canValidate = balanceType === 'stock' || valeur <= (Number(stock) || 0)
  return {
    isFormValid: true,
    stockValidation: { isValid: true, message: '' },
    networkValidation,
    actionStates: {
      canMarkAsNonTermine: true,
      canValidate,
      nonTermineeReason: '',
      validateReason: canValidate ? '' : RAISON_STOCK_INSUFFISANT,
    },
  }
}

/**
 * Le remboursement prêt à partir : l'agent, le montant, la réserve, le statut.
 * Ni type ni réseau : le serveur les pose (`addSiegeRepayment`).
 *
 * @returns {{ok: true, transaction: object, details: object} | {ok: false, raison: string}}
 */
export function preparerRembSiege({ client, reseau, montant, balanceType, statut }) {
  if (!RESERVES.includes(balanceType)) return { ok: false, raison: RAISON_RESERVE }
  const preparation = preparerTransaction({ client, reseau, montant, type: TYPE_REMB_SIEGE, statut })
  if (!preparation.ok) return preparation
  const { type: _type, reseau: _reseau, ...transaction } = preparation.transactionData
  return {
    ok: true,
    transaction: { ...transaction, balanceType },
    details: { ...preparation.details, recuEn: libelleVase(balanceType) },
  }
}

/**
 * Une tranche vers le siège, ou lequel des deux plafonds bloque. Ils se
 * corrigent autrement : l'un en envoyant moins, l'autre en attendant du stock.
 *
 * @returns {{ok: true, valeur: number} | {ok: false, motif: 'montant'|'reste'|'stock', raison: string}}
 */
export function verifierEnvoiSiege({ ligne, montant, stock }) {
  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return { ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).' }
  const reste = Number(ligne?.resteAuSiege) || 0
  if (valeur > reste) return { ok: false, motif: 'reste', raison: `Supérieur au reste à envoyer (${formatCurrency(reste)}).` }
  const disponible = Number(stock) || 0
  if (valeur > disponible) return { ok: false, motif: 'stock', raison: `Stock insuffisant. Disponible : ${formatCurrency(disponible)}.` }
  return { ok: true, valeur }
}

const fcfa = (montant) => `${(Number(montant) || 0).toLocaleString('fr-FR')} FCFA`

/**
 * Ce qu'une annulation fera à la caisse, dit avant de confirmer. La phrase
 * générique (« le stock engagé sera rendu ») dirait l'inverse : l'argent reçu
 * de l'agent ressort, et seules les tranches déjà parties reviennent au stock.
 */
export function consequenceAnnulation(ligne) {
  const reserve = ligne?.balanceType === 'stock' ? 'du stock' : 'de l’espèce'
  const envoye = Number(ligne?.envoyeAuSiege) || 0
  const retour = envoye > 0 ? ` ; les ${fcfa(envoye)} déjà envoyés au siège reviendront au stock` : ''
  return `Les ${fcfa(ligne?.montant)} reçus sortiront ${reserve}${retour}.`
}

const entre = (soldes, reseau, reserve, montant) => adjustBalanceValue(soldes, reseau, reserve, montant)
const sort = (soldes, reseau, reserve, montant) => adjustBalanceValue(soldes, reseau, reserve, -montant)

/**
 * Ce qu'une commande en attente fait aux soldes, pour les soldes provisoires.
 * Mêmes jambes, dans le même ordre que le serveur : le + d'abord.
 *
 * @param {object} commande  l'une des quatre commandes du serveur
 * @param {{ montant: number, balanceType: string, envoyeAuSiege: number } | null} avant
 *   la ligne visée, pour une modification ou une annulation
 * @returns {object|null} les soldes, ou `null` si la charge ne permet pas de le dire
 */
export function effetRembSiegeSurLesSoldes(soldes, reseau, commande, avant) {
  switch (commande?.action) {
    case 'addSiegeRepayment': {
      const { statut, balanceType, montant } = commande.transaction
      const recu = entre(soldes, reseau, balanceType, montant)
      return statut === 'Validée' ? sort(recu, reseau, 'stock', montant) : recu
    }
    case 'sendToSiege':
      return sort(soldes, reseau, 'stock', commande.amount)
    case 'updateSiegeRepayment': {
      if (!avant) return null
      const apres = { ...avant, ...commande.updates }
      return sort(entre(soldes, reseau, apres.balanceType, apres.montant), reseau, avant.balanceType, avant.montant)
    }
    case 'trashSiegeRepayment': {
      if (!avant) return null
      const envoye = Number(avant.envoyeAuSiege) || 0
      const rendu = envoye > 0 ? entre(soldes, reseau, 'stock', envoye) : soldes
      return sort(rendu, reseau, avant.balanceType, avant.montant)
    }
    default:
      return null
  }
}
