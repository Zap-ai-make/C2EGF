import { activeProfile } from '../config/activeClientProfile.js'
import { adjustBalanceValue } from './financialImpact.js'
import { parseFcfaAmount } from './fcfaAmount.js'
import { formatCurrency } from './formatCurrency.js'
import { libelleVase, montantRetourPropose } from './ravitaillement.js'

/**
 * Les transferts d'argent (Western Union, Ria, MoneyGram, autres), côté navigateur.
 *
 * Certaines boutiques font aussi un service de transfert : l'argent de ces
 * clients ordinaires passe par leur caisse
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 * Ces fonctions sont PURES. Elles disent ce que le formulaire permet et
 * préparent ce qui part au serveur ; le serveur reste le garant
 * (functions/src/storeTransactions/transfertArgent.js, dont les soldes
 * provisoires ci-dessous recopient l'arithmétique — `functions/` ne peut rien
 * importer d'ici, ni l'inverse).
 */

export const TYPE_TRANSFERT_ARGENT = 'Transfert argent'
export const SERVICES_TRANSFERT = Object.freeze(['Western Union', 'Ria', 'MoneyGram', 'Autres'])
export const OPERATIONS_TRANSFERT = Object.freeze(['transfert', 'retrait'])
const RESERVES = ['stock', 'liquidite']

/** Le drapeau du profil : la case de Configuration n'est proposée que s'il est allumé. */
export const TRANSFERT_ARGENT_ACTIF = activeProfile.moneyTransfer?.enabled === true

export const estTransfertArgent = (ligne) => ligne?.type === TYPE_TRANSFERT_ARGENT

const compacter = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '')
const sansEspaces = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, '') : '')
const libelleOperation = (operation) => (operation === 'retrait' ? 'Retrait' : 'Transfert')
const nomDuService = ({ service, servicePrecise }) =>
  (service === 'Autres' && compacter(servicePrecise)) || service || ''

/** « Western Union · Transfert », « Wari · Retrait » : le type interne n'est jamais affiché. */
export const libelleTransfert = (ligne) => `${nomDuService(ligne ?? {})} · ${libelleOperation(ligne?.operation)}`

/**
 * Ce que le formulaire permet, et la première raison de son refus.
 *
 * @param {object} p
 * @param {number} p.stock      le stock du réseau
 * @param {number} p.liquidite  l'espèce du réseau
 * @returns {{ ok: boolean, raison: string }}
 */
export function evaluerTransfertArgent({ service, operation, nomClient, telephone, montant, balanceType, stock, liquidite }) {
  const refus = (raison) => ({ ok: false, raison })
  if (!SERVICES_TRANSFERT.includes(service)) return refus('Choisissez le service.')
  if (!OPERATIONS_TRANSFERT.includes(operation)) return refus('Choisissez Transfert ou Retrait.')
  if (!compacter(nomClient)) return refus('Nom du client obligatoire.')
  if (!/^\d{0,15}$/.test(sansEspaces(telephone))) return refus('Téléphone : chiffres seulement.')
  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return refus('Montant invalide (entier supérieur à 0).')
  if (!RESERVES.includes(balanceType)) return refus('Choisissez Stock ou Espèce.')
  if (operation === 'retrait') {
    const disponible = Number(balanceType === 'stock' ? stock : liquidite) || 0
    if (valeur > disponible) return refus(balanceType === 'stock' ? 'Stock insuffisant.' : 'Espèce insuffisante.')
  }
  return { ok: true, raison: '' }
}

/**
 * L'opération prête à partir : la charge exacte de `addMoneyTransfer`. Jamais
 * de `client`, `clientId` ni `code` : ils désignent un agent.
 *
 * @returns {{ok: true, transaction: object, details: object} | {ok: false, raison: string}}
 */
export function preparerTransfertArgent(champs) {
  const evaluation = evaluerTransfertArgent(champs)
  if (!evaluation.ok) return evaluation
  const { service, servicePrecise, operation, nomClient, telephone, codeTransfert, montant, balanceType } = champs
  const precise = service === 'Autres' ? compacter(servicePrecise) : ''
  const tel = sansEspaces(telephone)
  const code = typeof codeTransfert === 'string' ? codeTransfert.trim() : ''
  const valeur = parseFcfaAmount(montant)
  const transaction = {
    service,
    ...(precise ? { servicePrecise: precise } : {}),
    operation,
    nomClient: compacter(nomClient),
    ...(tel ? { telephone: tel } : {}),
    ...(code ? { codeTransfert: code } : {}),
    montant: valeur,
    balanceType,
  }
  return {
    ok: true,
    transaction,
    details: {
      service: nomDuService(transaction),
      operation: libelleOperation(operation),
      clientName: transaction.nomClient,
      amount: valeur.toLocaleString('fr-FR'),
      reserve: `${operation === 'retrait' ? 'Payé' : 'Reçu'} en ${libelleVase(balanceType)}`,
    },
  }
}

const resteDe = (ligne) => {
  const reste = Number(ligne?.resteATraiter)
  if (ligne?.resteATraiter != null && Number.isFinite(reste)) return Math.max(0, reste)
  return Math.max(0, (Number(ligne?.montant) || 0) - (Number(ligne?.montantTraite) || 0))
}

/**
 * Le montant proposé pour une tranche, en texte pour le champ : tout le reste,
 * plafonné au stock pour un envoi au siège (règle de `montantRetourPropose`).
 */
export function montantTranchePropose({ ligne, stock }) {
  const reste = resteDe(ligne)
  if (ligne?.operation === 'retrait') return reste > 0 ? String(reste) : ''
  return montantRetourPropose({ reste, disponible: stock })
}

/**
 * Une tranche, ou le plafond qui bloque. Le stock ne plafonne qu'un envoi au
 * siège : un encaissement le fait monter.
 *
 * @returns {{ok: true, valeur: number} | {ok: false, motif: 'montant'|'reste'|'stock', raison: string}}
 */
export function verifierTrancheTransfert({ ligne, montant, stock }) {
  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return { ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).' }
  const reste = resteDe(ligne)
  if (valeur > reste) return { ok: false, motif: 'reste', raison: `Supérieur au reste (${formatCurrency(reste)}).` }
  const disponible = Number(stock) || 0
  if (ligne?.operation !== 'retrait' && valeur > disponible) {
    return { ok: false, motif: 'stock', raison: `Stock insuffisant. Disponible : ${formatCurrency(disponible)}.` }
  }
  return { ok: true, valeur }
}

const fcfa = (montant) => `${(Number(montant) || 0).toLocaleString('fr-FR')} FCFA`
const de = (reserve) => (reserve === 'stock' ? 'du stock' : 'de l’espèce')
const a = (reserve) => (reserve === 'stock' ? 'au stock' : 'à l’espèce')

/** Ce qu'une annulation fera à la caisse, dit avant de confirmer. */
export function consequenceAnnulationTransfert(ligne) {
  const traite = Number(ligne?.montantTraite) || 0
  if (ligne?.operation === 'retrait') {
    const suite = traite > 0 ? ` ; les ${fcfa(traite)} déjà encaissés sortiront du stock` : ''
    return `Les ${fcfa(ligne?.montant)} payés reviendront ${a(ligne?.balanceType)}${suite}.`
  }
  const suite = traite > 0 ? ` ; les ${fcfa(traite)} déjà envoyés au siège reviendront au stock` : ''
  return `Les ${fcfa(ligne?.montant)} reçus sortiront ${de(ligne?.balanceType)}${suite}.`
}

/** Ce qu'une ligne a laissé dans les soldes : de quoi la traiter ou la défaire, sans réseau. */
export const resumeTransfert = (ligne) => ({
  operation: ligne?.operation,
  montant: ligne?.montant,
  balanceType: ligne?.balanceType,
  montantTraite: Number(ligne?.montantTraite) || 0,
})

const entre = (soldes, reseau, reserve, montant) => adjustBalanceValue(soldes, reseau, reserve, montant)
const sort = (soldes, reseau, reserve, montant) => adjustBalanceValue(soldes, reseau, reserve, -montant)

const saisie = (soldes, reseau, { operation, balanceType, montant }) =>
  (operation === 'retrait' ? sort : entre)(soldes, reseau, balanceType, montant)

/**
 * Ce qu'une commande en attente fait aux soldes, pour les soldes provisoires.
 * Mêmes jambes, dans le même ordre que le serveur : le + d'abord.
 *
 * @param {object} commande  l'une des quatre commandes du serveur
 * @param {{ operation, montant, balanceType, montantTraite } | null} avant
 *   la ligne visée (`resumeTransfert`), pour une tranche, une modification ou une annulation
 * @returns {object|null} les soldes, ou `null` si la charge ne permet pas de le dire
 */
export function effetTransfertSurLesSoldes(soldes, reseau, commande, avant) {
  switch (commande?.action) {
    case 'addMoneyTransfer':
      return saisie(soldes, reseau, commande.transaction)
    case 'settleMoneyTransfer': {
      if (!avant) return null
      return (avant.operation === 'retrait' ? entre : sort)(soldes, reseau, 'stock', commande.amount)
    }
    case 'updateMoneyTransfer': {
      if (!avant) return null
      const apres = { ...avant, ...commande.updates, operation: avant.operation }
      if (avant.operation === 'retrait') return sort(entre(soldes, reseau, avant.balanceType, avant.montant), reseau, apres.balanceType, apres.montant)
      return sort(entre(soldes, reseau, apres.balanceType, apres.montant), reseau, avant.balanceType, avant.montant)
    }
    case 'trashMoneyTransfer': {
      if (!avant) return null
      const traite = Number(avant.montantTraite) || 0
      if (avant.operation === 'retrait') {
        const rendu = entre(soldes, reseau, avant.balanceType, avant.montant)
        return traite > 0 ? sort(rendu, reseau, 'stock', traite) : rendu
      }
      const revenu = traite > 0 ? entre(soldes, reseau, 'stock', traite) : soldes
      return sort(revenu, reseau, avant.balanceType, avant.montant)
    }
    default:
      return null
  }
}
