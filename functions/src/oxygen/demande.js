/**
 * demande.js — la demande d'opération lancée par l'agent, sans Firestore.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\demande-operation.md, version 4, §8 ;
 * précisé par docs/superpowers/specs/2026-11-17-demandes-agent-design.md.
 *
 * PUR : aucune I/O. Le point d'entrée Oxygen (qui crée, annule et lit les
 * demandes) et `storeTransactionCommand` (où la caissière y répond) lisent la
 * même demande : ses états, sa forme rendue et la fiche de l'agent ne vivent
 * qu'ici, pour que les deux côtés ne divergent pas.
 */

import { champsAgentFiche, enMs } from './liaison.js'
import { STORE_NETWORKS, STORE_PAYMENT_METHODS } from '../config/storeProfile.js'
import { mapPaymentMethodToNetwork } from '../settlements/financialUtils.js'

/** Une collection par boutique : `clients/{boutiqueId}/demandesAgent/{cle}`. */
export const COLLECTION_DEMANDES = 'demandesAgent'

/**
 * Des valeurs machine, distinctes des statuts d'opération : « Annulée » est
 * déjà le statut d'une opération que la caissière a annulée.
 */
export const ETATS_DEMANDE = Object.freeze({
  EN_ATTENTE: 'en_attente',
  VALIDEE: 'validee',
  REJETEE: 'rejetee',
  ANNULEE_AGENT: 'annulee_agent',
})

/**
 * Ce que l'agent demande (contrat v10 §11.2). Une demande d'avant ce champ est
 * une opération : `nature` absent se lit `'operation'`.
 */
export const NATURES_DEMANDE = Object.freeze({
  OPERATION: 'operation',
  REMBOURSEMENT: 'remboursement',
  REMB_SIEGE: 'remb_siege',
})

/**
 * Les modes d'un remboursement : les méthodes de règlement du profil, celles
 * que l'acceptation passe à « Encaisser ». Une liste à part finirait par
 * accepter des demandes que l'acceptation refuserait.
 */
export const MODES_REMBOURSEMENT = Object.freeze([...STORE_PAYMENT_METHODS])

/** La réserve où entre un remboursement siège : les espèces en liquidité, le reste en stock. */
export const reserveDuMode = (mode) => (mapPaymentMethodToNetwork(mode) === 'Liquidite' ? 'liquidite' : 'stock')

/**
 * Et l'inverse, pour rendre à l'agent le mode d'un « Remb. siège » (§11.4) :
 * le stock est celui du premier réseau, où la ligne est rangée.
 */
export const modeDeReserve = (balanceType) => {
  const cible = { stock: STORE_NETWORKS[0], liquidite: 'Liquidite' }[balanceType]
  return cible ? (STORE_PAYMENT_METHODS.find((mode) => mapPaymentMethodToNetwork(mode) === cible) ?? null) : null
}

/**
 * Ce que l'agent peut encore rembourser sur une ligne : le reste, moins
 * l'autre demande en attente (§11.1, règle 4). Deux demandes en attente, une
 * par mode, ne dépassent donc jamais le reste à elles deux.
 *
 * @param {{reste: number, autres: number[]}} p  `autres` : les montants des autres demandes en attente
 */
export function plafondRemboursement({ reste, autres = [] }) {
  const engage = autres.reduce((somme, montant) => somme + (Number(montant) || 0), 0)
  return Math.max(0, reste - engage)
}

/** Le sens que l'app envoie, et le type d'opération qu'il devient au CRM. */
export const TYPE_DU_SENS = Object.freeze({ depot: 'Dépôt', retrait: 'Retrait' })

/** Une demande fermée reste lisible par l'agent sept jours (contrat §4.1). */
export const RETENUE_DEMANDES_MS = 7 * 24 * 60 * 60 * 1000

/**
 * ⚠ UNE BORNE DE LECTURE, PAS UNE LIMITE MÉTIER. Un agent peut avoir autant de
 *   demandes en attente qu'il veut (décidé le 2026-11-17) ; ce plafond ne fait
 *   que garder chaque requête dans le quota.
 */
export const LIMITE_DEMANDES = 200

/**
 * Le code de la fiche sur ce réseau : c'est lui que porte le champ `code`
 * d'une opération saisie au formulaire (`preparerTransaction`).
 *
 * ⚠ LE COMPTE ORANGE SE DÉRIVE QUAND IL MANQUE. L'app l'écrit à chaque
 *   enregistrement d'une fiche : le code agent, à défaut le numéro agent
 *   (`normaliserChampsAgent`, src/services/firestore.js). Une fiche écrite hors
 *   de l'app — un script, un import — peut ne pas le porter ; l'agent n'en a
 *   pas moins un compte Orange, et sa demande ne doit pas être refusée.
 */
export function codeReseauDeFiche(fiche, reseau) {
  const cle = String(reseau).toLowerCase()
  const propre = String(fiche?.[cle] ?? '').trim()
  if (propre || cle !== 'orange') return propre
  const { codeAgent, numeroAgent } = champsAgentFiche(fiche)
  return codeAgent || numeroAgent
}

const CHAMPS_CLIENT = Object.freeze(['nom', 'prenom', 'orange', 'codeAgent', 'numeroAgent'])

/**
 * Le client d'une opération née d'une demande, tiré de la fiche. Liste
 * blanche : la fiche porte aussi des champs que l'opération n'a pas à
 * recopier (téléphone, notes).
 */
export function clientDeFiche(clientId, fiche) {
  const client = { id: clientId }
  for (const champ of CHAMPS_CLIENT) {
    if (fiche && Object.hasOwn(fiche, champ)) client[champ] = fiche[champ]
  }
  // Le compte Orange, dérivé s'il manque : le formulaire le relit quand la
  // caissière modifie l'opération, et refuserait un client sans lui.
  if (!client.orange) {
    const orange = codeReseauDeFiche(fiche, 'Orange')
    if (orange) client.orange = orange
  }
  return client
}

/**
 * La demande telle qu'Oxygen la reçoit, partout. Ni compte, ni liaison, ni
 * fiche : l'app n'a besoin que de ce qu'elle montre.
 */
export function demandeRendue(id, donnees) {
  return {
    id,
    boutiqueId: donnees.boutiqueId,
    boutiqueNom: donnees.boutiqueNom,
    sens: donnees.sens,
    reseau: donnees.reseau,
    montant: donnees.montant,
    etat: donnees.etat,
    creeLe: enMs(donnees.creeLe) || null,
    reponduLe: enMs(donnees.reponduLe) || null,
    operationId: donnees.operationId ?? null,
    nature: donnees.nature ?? NATURES_DEMANDE.OPERATION,
    ...(donnees.cibleId ? { cibleId: donnees.cibleId } : {}),
    ...(donnees.mode ? { mode: donnees.mode } : {}),
  }
}
