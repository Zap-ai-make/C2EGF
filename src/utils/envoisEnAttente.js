/**
 * envoisEnAttente.js — ce que les opérations de la file changent à l'écran
 * (lot G3c, docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Une opération en attente n'existe pas encore au serveur : ni dans les non
 * terminées, ni dans les soldes. Sans ce module, une saisie faite hors ligne
 * disparaîtrait de l'écran jusqu'au retour du réseau, et la caissière ne
 * pourrait ni la voir, ni l'encaisser.
 *
 * ⚠ LES SOLDES QUI EN SORTENT SONT PROVISOIRES, ET L'ÉCRAN DOIT LE DIRE. Ils
 *   ajoutent à ceux du serveur l'effet des opérations en attente, calculé par
 *   les fonctions du navigateur qui suivent celles du serveur. Une opération
 *   que ces fonctions refusent (solde insuffisant) n'y entre pas : le serveur
 *   la refusera aussi.
 */

import { Timestamp } from 'firebase/firestore'
import { CLIENT, EN_ATTENTE, REGLEMENT, REMBOURSEMENT, SAISIE } from '../services/fileEnvoi.js'
import {
  adjustBalanceValue,
  applyInitialTransactionImpact,
  applyLiquidityDelta,
  applySettlementImpact,
  isPendingStatus,
  isWithdrawalType,
  mapPaymentMethodToNetwork,
} from './financialImpact.js'

const FUSEAU = 'Africa/Ouagadougou'
const jourFr = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU }).format(new Date(ms))

/** Une saisie de la file, sous la forme que le serveur lui donnera. */
function ligneDeSaisie(op) {
  return {
    ...op.charge.transaction,
    // Le `commandeId` deviendra l'identifiant du document (lot G3a) : la
    // ligne garde le sien quand le serveur la renvoie.
    id: op.id,
    date: jourFr(op.creeLe),
    createdAt: Timestamp.fromMillis(op.creeLe),
    envoi: { etat: op.etat, erreur: op.erreur ?? null },
  }
}

/**
 * @param {object[]} operations la file, dans l'ordre de saisie
 * @returns {{
 *   nonTerminees: object[], validees: object[], clients: object[],
 *   reglements: Map<string, object[]>,
 * }}
 */
export function lignesEnAttente(operations = []) {
  const saisies = operations.filter((op) => op.type === SAISIE && op.charge?.transaction)
  const reglements = new Map()
  for (const op of operations) {
    if (op.type !== REGLEMENT && op.type !== REMBOURSEMENT) continue
    const { draftId, amount, paymentMethod } = op.charge ?? {}
    const liste = reglements.get(draftId) ?? []
    liste.push({ id: op.id, type: op.type, amount, paymentMethod, etat: op.etat, erreur: op.erreur ?? null })
    reglements.set(draftId, liste)
  }
  return {
    nonTerminees: saisies.filter((op) => isPendingStatus(op.charge.transaction.statut)).map(ligneDeSaisie),
    validees: saisies.filter((op) => !isPendingStatus(op.charge.transaction.statut)).map(ligneDeSaisie),
    clients: operations
      .filter((op) => op.type === CLIENT && op.etat === EN_ATTENTE)
      .map((op) => ({ id: op.id, ...op.charge.donnees, enAttente: true })),
    reglements,
  }
}

/** Le remboursement défait ce qu'un règlement a fait : le signe inverse. */
function rembourser(soldes, type, montant, paymentMethod) {
  const reseau = mapPaymentMethodToNetwork(paymentMethod)
  const delta = isWithdrawalType(type) ? montant : -montant
  return reseau === 'Liquidite' ? applyLiquidityDelta(soldes, delta) : adjustBalanceValue(soldes, reseau, 'stock', delta)
}

/**
 * Les soldes du serveur, plus l'effet des opérations en attente.
 *
 * @param {object} soldes ceux du serveur
 * @param {object[]} operations la file
 * @param {Map<string, object>} brouillons les non terminées connues, par identifiant :
 *   un règlement prend son sens (dépôt ou retrait) de la ligne qu'il règle,
 *   quand sa charge ne le porte pas déjà (`type`, posé à la mise en file)
 * @returns {{ soldes: object, appliquees: number }}
 */
export function soldesProvisoires(soldes, operations = [], brouillons = new Map()) {
  let resultat = soldes
  let appliquees = 0
  for (const op of operations) {
    if (op.etat !== EN_ATTENTE) continue
    try {
      if (op.type === SAISIE) {
        resultat = applyInitialTransactionImpact(resultat, op.charge.transaction)
      } else if (op.type === REGLEMENT || op.type === REMBOURSEMENT) {
        const type = op.charge.type ?? brouillons.get(op.charge.draftId)?.type
        if (!type) continue
        resultat = op.type === REGLEMENT
          ? applySettlementImpact(resultat, { type, montant: op.charge.amount }, op.charge.paymentMethod)
          : rembourser(resultat, type, op.charge.amount, op.charge.paymentMethod)
      } else {
        continue
      }
      appliquees += 1
    } catch {
      // Refusée par le calcul local, elle le sera par le serveur : elle
      // n'entre pas dans le provisoire.
    }
  }
  return { soldes: resultat, appliquees }
}

/**
 * Une non terminée, avec l'effet des règlements qui l'attendent : le reste dû
 * baisse d'un règlement et remonte d'un remboursement, comme au serveur.
 *
 * ⚠ SANS CE RESTE, UNE TRANCHE HORS LIGNE EN AUTORISERAIT UNE SECONDE AU-DELÀ
 *   DU DÛ. Le plafond de `verifierMontantReglement` lit `remainingAmount` : la
 *   caissière pourrait encaisser deux fois le même reste, et le serveur
 *   refuserait la seconde après coup.
 */
function avecReglements(ligne, reglements) {
  const attendus = reglements.filter((r) => r.etat === EN_ATTENTE)
  const somme = (type) => attendus.filter((r) => r.type === type).reduce((total, r) => total + (Number(r.amount) || 0), 0)
  const paye = somme(REGLEMENT)
  const rendu = somme(REMBOURSEMENT)
  if (paye === 0 && rendu === 0) return { ...ligne, reglementsEnAttente: reglements }
  const resteAvant = Number(ligne.remainingAmount ?? ligne.montant) || 0
  const reste = Math.max(0, resteAvant - paye + rendu)
  return {
    ...ligne,
    reglementsEnAttente: reglements,
    paidAmount: (Number(ligne.paidAmount) || 0) + paye,
    refundedAmount: (Number(ligne.refundedAmount) || 0) + rendu,
    remainingAmount: reste,
    settlementStatus: reste > 0 ? 'partial' : 'settled',
  }
}

/**
 * Les lignes du serveur, plus celles qui attendent le réseau.
 *
 * Une ligne que le serveur rend déjà (même identifiant : le `commandeId`) est
 * la sienne, pas la copie locale. Sans opération en attente, la liste du
 * serveur revient telle quelle, sans copie ni nouveau tri.
 *
 * @param {object[]} serveur les lignes reçues
 * @param {object[]} locales celles de la file (`lignesEnAttente`)
 * @param {Map<string, object[]>} reglements par identifiant de ligne
 * @param {(lignes: object[]) => object[]} trier
 */
export function fusionnerEnAttente(serveur, locales = [], reglements = new Map(), trier = (l) => l) {
  if (locales.length === 0 && reglements.size === 0) return serveur
  const connues = new Set(serveur.map((t) => t.id))
  const lignes = [...serveur, ...locales.filter((l) => !connues.has(l.id))]
  return trier(lignes.map((t) => (reglements.has(t.id) ? avecReglements(t, reglements.get(t.id)) : t)))
}
