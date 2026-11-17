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

import { enMs } from './liaison.js'

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
 */
export const codeReseauDeFiche = (fiche, reseau) =>
  String(fiche?.[String(reseau).toLowerCase()] ?? '').trim()

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
  }
}
