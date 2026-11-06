/**
 * envoisEnAttente.js — ce que les opérations de la file changent à l'écran
 * (lots G3c et G4c, docs/rester-dans-le-quota-gratuit.md §G3 et §G4).
 *
 * Une opération en attente n'existe pas encore au serveur : ni dans les listes, ni
 * dans les soldes. Sans ce module, une saisie faite hors ligne disparaîtrait de
 * l'écran jusqu'au retour du réseau, et la caissière ne pourrait ni la voir, ni
 * l'encaisser, ni la corriger.
 *
 * ⚠ LA FILE SE REJOUE DANS L'ORDRE, COMME AU SERVEUR. Les opérations se suivent :
 *   saisir, modifier, encaisser, puis annuler visent la même ligne, et chacune part
 *   de ce que la précédente a laissé.
 *
 * ⚠ LES SOLDES QUI EN SORTENT SONT PROVISOIRES, ET L'ÉCRAN DOIT LE DIRE. Ils
 *   ajoutent à ceux du serveur l'effet des opérations en attente, calculé par
 *   les fonctions du navigateur qui suivent celles du serveur. Une opération
 *   que ces fonctions refusent (solde insuffisant) n'y entre pas : le serveur
 *   la refusera aussi.
 */

import { Timestamp } from 'firebase/firestore'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'
import {
  ANNULATION,
  CIBLE_NON_TERMINEE,
  CIBLE_RETOUR,
  CLIENT,
  CORRECTION,
  EN_ATTENTE,
  MODIFICATION,
  RAVITAILLEMENT,
  REGLEMENT,
  REMBOURSEMENT,
  RETOUR,
  SAISIE,
} from '../services/fileEnvoi.js'
import {
  adjustBalanceValue,
  applyInitialTransactionImpact,
  applyLiquidityDelta,
  applySettlementImpact,
  isDepositType,
  isPendingStatus,
  isWithdrawalType,
  mapPaymentMethodToNetwork,
  reverseHistoryTransactionImpact,
  reverseInitialTransactionImpact,
} from './financialImpact.js'
import { TYPE_RAVITAILLEMENT, TYPE_RETOUR } from './ravitaillement.js'

const FUSEAU = 'Africa/Ouagadougou'
const { PENDING, VALIDATED, DELETED } = FIRESTORE_CONFIG.STATUS
const jourFr = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU }).format(new Date(ms))
const etatEnvoi = (op) => ({ etat: op.etat, erreur: op.erreur ?? null })

// Ce qu'une correction peut changer : la liste blanche de `cleanTransaction`, sans
// le statut, que le serveur décide.
const CHAMPS_CORRIGEABLES = ['client', 'clientId', 'type', 'reseau', 'code', 'montant']
const champsCorriges = (updates = {}) => Object.fromEntries(
  CHAMPS_CORRIGEABLES.filter((champ) => updates[champ] !== undefined).map((champ) => [champ, updates[champ]]),
)

const statutRegle = (type, paymentMethod) => {
  if (isDepositType(type)) return `Encaissé par ${paymentMethod}`
  return isWithdrawalType(type) ? `Payé par ${paymentMethod}` : `Remboursé par ${paymentMethod}`
}

/** Ce qu'une ligne a laissé dans les soldes : de quoi le défaire, sans réseau. */
export function resumeLigne(ligne) {
  if (!ligne) return null
  const { type, montant, reseau, statut, balanceType, replenishmentId, paymentMethod, effectiveNetwork, settlementSummary, directValidation, liquiditySplit, validatedAt } = ligne
  return {
    type,
    montant,
    reseau,
    statut,
    ...(balanceType ? { balanceType } : {}),
    ...(replenishmentId ? { replenishmentId } : {}),
    paymentMethod: paymentMethod ?? null,
    effectiveNetwork: effectiveNetwork ?? null,
    ...(settlementSummary?.netByNetwork ? { settlementSummary: { netByNetwork: settlementSummary.netByNetwork } } : {}),
    directValidation: directValidation === true,
    ...(liquiditySplit ? { liquiditySplit } : {}),
    // Seule sa présence compte pour défaire une ligne, et un horodatage ne se
    // garde pas tel quel dans IndexedDB.
    validatedAt: Boolean(validatedAt),
  }
}

/**
 * La revalidation rejouera-t-elle les deux jambes ? Pour l'affichage seulement : au
 * serveur, c'est `portaitSesDeuxJambes` qui décide, sur le document qu'il a lu.
 */
const portaitSesDeuxJambes = (ligne) => !ligne.paymentMethod && (ligne.directValidation === true || !ligne.validatedAt)

/** Une saisie de la file, sous la forme que le serveur lui donnera. */
function ligneDeSaisie(op) {
  const { transaction } = op.charge
  const validee = !isPendingStatus(transaction.statut)
  return {
    ...transaction,
    // Le `commandeId` deviendra l'identifiant du document (lot G3a) : la
    // ligne garde le sien quand le serveur la renvoie.
    id: op.id,
    date: jourFr(op.creeLe),
    createdAt: Timestamp.fromMillis(op.creeLe),
    // De quoi la défaire avant son départ. Au serveur, la répartition se calcule sur
    // les réseaux qu'il voit ; C2EGF n'en opère qu'un.
    ...(validee ? { directValidation: true } : {}),
    ...(validee && isWithdrawalType(transaction.type) ? { liquiditySplit: { [transaction.reseau]: transaction.montant } } : {}),
    envoi: etatEnvoi(op),
  }
}

/** Une ligne qui attend, marquée comme telle. Celle d'une saisie l'est déjà. */
const marquee = (ligne, op) => ({ ...ligne, envoi: ligne.envoi ?? etatEnvoi(op) })

/**
 * Une non terminée, avec l'effet d'un règlement qui l'attend : le reste dû baisse
 * d'un règlement et remonte d'un remboursement, comme au serveur.
 *
 * ⚠ SANS CE RESTE, UNE TRANCHE HORS LIGNE EN AUTORISERAIT UNE SECONDE AU-DELÀ
 *   DU DÛ. Le plafond de `verifierMontantReglement` lit `remainingAmount` : la
 *   caissière pourrait encaisser deux fois le même reste, et le serveur
 *   refuserait la seconde après coup.
 *
 * Réglée en entier, la ligne passe dans l'historique, sous le même identifiant :
 * c'est ce que le serveur fera d'elle (lot G4a), et là qu'elle se corrige.
 */
function regler(op, nonTerminees, historique) {
  const { draftId, amount, paymentMethod } = op.charge ?? {}
  const ligne = nonTerminees.get(draftId)
  if (!ligne) return
  const resume = { id: op.id, type: op.type, amount, paymentMethod, etat: op.etat, erreur: op.erreur ?? null }
  const reglementsEnAttente = [...(ligne.reglementsEnAttente ?? []), resume]
  if (op.etat !== EN_ATTENTE) {
    nonTerminees.set(draftId, { ...ligne, reglementsEnAttente })
    return
  }

  const montant = Number(amount) || 0
  const paye = op.type === REGLEMENT ? montant : 0
  const rendu = op.type === REMBOURSEMENT ? montant : 0
  const reste = Math.max(0, (Number(ligne.remainingAmount ?? ligne.montant) || 0) - paye + rendu)
  const reseau = mapPaymentMethodToNetwork(paymentMethod)
  const net = ligne.settlementSummary?.netByNetwork ?? {}
  const avantSurCeReseau = net[reseau] ?? { paid: 0, refunded: 0 }
  const reglee = {
    ...ligne,
    reglementsEnAttente,
    paidAmount: (Number(ligne.paidAmount) || 0) + paye,
    refundedAmount: (Number(ligne.refundedAmount) || 0) + rendu,
    remainingAmount: reste,
    settlementStatus: reste > 0 ? 'partial' : 'settled',
    settlementSummary: {
      ...ligne.settlementSummary,
      netByNetwork: { ...net, [reseau]: { paid: avantSurCeReseau.paid + paye, refunded: avantSurCeReseau.refunded + rendu } },
    },
  }
  if (reste > 0) {
    nonTerminees.set(draftId, reglee)
    return
  }
  nonTerminees.delete(draftId)
  historique.set(draftId, marquee({
    ...reglee,
    statut: statutRegle(ligne.type, paymentMethod),
    paymentMethod,
    effectiveNetwork: reseau,
    originalAmount: ligne.montant,
    settlementAmount: ligne.montant,
    validatedAt: Timestamp.fromMillis(op.creeLe),
  }, op))
}

/** La ligne qu'une correction laissera : la forme de `correctHistory`. */
function ligneCorrigee(ligne, op) {
  const { settlementSummary: _tranchesOubliees, ...reste } = ligne
  const corrigee = { ...reste, ...champsCorriges(op.charge.updates) }
  const paymentMethod = ligne.paymentMethod ?? null
  const direct = portaitSesDeuxJambes(ligne)
  return marquee({
    ...corrigee,
    id: op.id,
    statut: paymentMethod ? statutRegle(corrigee.type, paymentMethod) : VALIDATED,
    paymentMethod,
    effectiveNetwork: paymentMethod ? mapPaymentMethodToNetwork(paymentMethod) : null,
    settlementAmount: corrigee.montant,
    originalAmount: corrigee.montant,
    paidAmount: corrigee.montant,
    refundedAmount: 0,
    remainingAmount: 0,
    settlementStatus: 'settled',
    validatedAt: Timestamp.fromMillis(op.creeLe),
    reopenedFromHistoryId: ligne.id,
    ...(direct ? { directValidation: true } : {}),
    ...(direct && isWithdrawalType(corrigee.type) ? { liquiditySplit: { [corrigee.reseau]: corrigee.montant } } : {}),
  }, op)
}

/** Une livraison dont le reste dû vient de bouger. */
function livraisonApres(livraison, rendu) {
  const remainingAmount = (Number(livraison.remainingAmount) || 0) - rendu
  return {
    ...livraison,
    returnedAmount: Math.max(0, (Number(livraison.returnedAmount) || 0) + rendu),
    remainingAmount,
    replenishmentStatus: remainingAmount > 0 ? 'open' : 'settled',
  }
}

/**
 * Ce que chaque opération fait aux deux listes. Une ligne déjà rendue par le serveur
 * sous l'identifiant de l'opération dit qu'elle a eu lieu : le serveur l'emporte, et
 * rien n'est appliqué une seconde fois.
 */
const EFFETS_SUR_LES_LIGNES = {
  [SAISIE](op, nonTerminees, historique) {
    if (!op.charge?.transaction || nonTerminees.has(op.id) || historique.has(op.id)) return
    const liste = isPendingStatus(op.charge.transaction.statut) ? nonTerminees : historique
    liste.set(op.id, ligneDeSaisie(op))
  },
  [REGLEMENT]: regler,
  [REMBOURSEMENT]: regler,
  [MODIFICATION](op, nonTerminees) {
    const ligne = nonTerminees.get(op.charge.draftId)
    if (!ligne || ligne.derniereCommande === op.id) return
    nonTerminees.set(ligne.id, marquee({ ...ligne, ...champsCorriges(op.charge.updates) }, op))
  },
  [CORRECTION](op, _nonTerminees, historique) {
    const ligne = historique.get(op.charge.historyId)
    if (!ligne || historique.has(op.id)) return
    historique.delete(ligne.id)
    historique.set(op.id, ligneCorrigee(ligne, op))
  },
  [ANNULATION](op, nonTerminees, historique) {
    const { cible, cibleId } = op.charge
    const deletedAt = new Date(op.creeLe)
    if (cible === CIBLE_NON_TERMINEE) {
      const ligne = nonTerminees.get(cibleId)
      if (!ligne || historique.has(op.id)) return
      nonTerminees.delete(cibleId)
      historique.set(op.id, marquee({ ...ligne, id: op.id, statut: DELETED, origin: 'draft', deletedAt }, op))
      return
    }
    const ligne = historique.get(cibleId)
    if (!ligne || ligne.deletedAt) return
    historique.set(cibleId, marquee({ ...ligne, statut: DELETED, origin: cible === CIBLE_RETOUR ? 'return' : 'history', deletedAt }, op))
    const livraison = cible === CIBLE_RETOUR && historique.get(ligne.replenishmentId)
    if (livraison) historique.set(livraison.id, livraisonApres(livraison, -(Number(ligne.montant) || 0)))
  },
  [RAVITAILLEMENT](op, _nonTerminees, historique) {
    if (historique.has(op.id)) return
    const { amount, balanceType, expediteur, note } = op.charge.commande
    historique.set(op.id, marquee({
      id: op.id,
      type: TYPE_RAVITAILLEMENT,
      montant: amount,
      reseau: op.charge.reseau,
      balanceType,
      expediteur,
      returnedAmount: 0,
      remainingAmount: amount,
      replenishmentStatus: 'open',
      statut: VALIDATED,
      note: note ?? '',
      date: jourFr(op.creeLe),
      createdAt: Timestamp.fromMillis(op.creeLe),
      validatedAt: Timestamp.fromMillis(op.creeLe),
    }, op))
  },
  [RETOUR](op, _nonTerminees, historique) {
    if (historique.has(op.id)) return
    const { replenishmentId, amount, balanceType, note } = op.charge.commande
    const livraison = historique.get(replenishmentId)
    if (livraison) historique.set(replenishmentId, livraisonApres(livraison, amount))
    historique.set(op.id, marquee({
      id: op.id,
      type: TYPE_RETOUR,
      montant: amount,
      reseau: op.charge.reseau,
      balanceType,
      replenishmentId,
      expediteur: livraison?.expediteur ?? '',
      statut: 'Validee',
      note: note ?? '',
      date: jourFr(op.creeLe),
      createdAt: Timestamp.fromMillis(op.creeLe),
      validatedAt: Timestamp.fromMillis(op.creeLe),
    }, op))
  },
}

/** Refusées, elles se lisent encore sur leur ligne, avec leur raison. */
const VISIBLES_REFUSEES = [SAISIE, REGLEMENT, REMBOURSEMENT]

/**
 * Les lignes du serveur, après tout ce qui attend le réseau.
 *
 * Sans opération sur une ligne, les listes du serveur reviennent telles quelles, sans
 * copie ni nouveau tri. Une opération refusée, à part la saisie et le règlement, ne
 * change aucune ligne : la liste des envois la montre avec sa raison.
 *
 * @param {object[]} nonTerminees celles du serveur
 * @param {object[]} historique celui du serveur
 * @param {object[]} operations la file, dans l'ordre de saisie
 * @param {{ trierNonTerminees?: Function, trierHistorique?: Function }} [tris]
 * @returns {{ nonTerminees: object[], historique: object[] }}
 */
export function appliquerFile(nonTerminees, historique, operations = [], { trierNonTerminees = (l) => l, trierHistorique = (l) => l } = {}) {
  const utiles = operations.filter((op) => op.type !== CLIENT && (op.etat === EN_ATTENTE || VISIBLES_REFUSEES.includes(op.type)))
  if (utiles.length === 0) return { nonTerminees, historique }
  const nt = new Map(nonTerminees.map((l) => [l.id, l]))
  const hist = new Map(historique.map((l) => [l.id, l]))
  for (const op of utiles) EFFETS_SUR_LES_LIGNES[op.type]?.(op, nt, hist)
  return { nonTerminees: trierNonTerminees([...nt.values()]), historique: trierHistorique([...hist.values()]) }
}

/** Les fiches pas encore envoyées, pour la liste des clients. */
export function clientsEnAttente(operations = []) {
  return operations
    .filter((op) => op.type === CLIENT && op.etat === EN_ATTENTE)
    .map((op) => ({ id: op.id, ...op.charge.donnees, enAttente: true }))
}

/** Le remboursement défait ce qu'un règlement a fait : le signe inverse. */
function rembourser(soldes, type, montant, paymentMethod) {
  const reseau = mapPaymentMethodToNetwork(paymentMethod)
  const delta = isWithdrawalType(type) ? montant : -montant
  return reseau === 'Liquidite' ? applyLiquidityDelta(soldes, delta) : adjustBalanceValue(soldes, reseau, 'stock', delta)
}

/** Rouvrir, corriger, revalider : les trois temps de `correctHistory`. */
function corriger(soldes, avant, updates) {
  const brouillon = { ...avant, statut: PENDING }
  const rouverts = applyInitialTransactionImpact(reverseHistoryTransactionImpact(soldes, avant), brouillon)
  const nouveau = { ...brouillon, ...champsCorriges(updates) }
  const corriges = applyInitialTransactionImpact(reverseInitialTransactionImpact(rouverts, brouillon), nouveau)
  if (avant.paymentMethod) return applySettlementImpact(corriges, nouveau, avant.paymentMethod)
  if (!portaitSesDeuxJambes(avant)) return corriges
  return applyInitialTransactionImpact(reverseInitialTransactionImpact(corriges, nouveau), { ...nouveau, statut: VALIDATED })
}

/** Ce qu'une opération fait aux soldes, ou `null` si la charge ne permet pas de le dire. */
function effetSurLesSoldes(soldes, op, brouillons) {
  const { charge } = op
  switch (op.type) {
    case SAISIE:
      return applyInitialTransactionImpact(soldes, charge.transaction)
    case REGLEMENT:
    case REMBOURSEMENT: {
      const type = charge.type ?? brouillons.get(charge.draftId)?.type
      if (!type) return null
      return op.type === REGLEMENT
        ? applySettlementImpact(soldes, { type, montant: charge.amount }, charge.paymentMethod)
        : rembourser(soldes, type, charge.amount, charge.paymentMethod)
    }
    case RAVITAILLEMENT:
      return adjustBalanceValue(soldes, charge.reseau, charge.commande.balanceType, charge.commande.amount)
    case RETOUR:
      return adjustBalanceValue(soldes, charge.reseau, charge.commande.balanceType, -charge.commande.amount)
    case MODIFICATION: {
      if (!charge.avant) return null
      const brouillon = { ...charge.avant, statut: PENDING }
      return applyInitialTransactionImpact(reverseInitialTransactionImpact(soldes, brouillon), { ...brouillon, ...champsCorriges(charge.updates) })
    }
    case CORRECTION:
      return charge.avant ? corriger(soldes, charge.avant, charge.updates) : null
    case ANNULATION: {
      const { avant, cible } = charge
      if (!avant) return null
      if (cible === CIBLE_NON_TERMINEE) return reverseInitialTransactionImpact(soldes, { ...avant, statut: PENDING })
      if (cible === CIBLE_RETOUR) return adjustBalanceValue(soldes, avant.reseau, avant.balanceType, avant.montant)
      return reverseHistoryTransactionImpact(soldes, avant)
    }
    default:
      return null
  }
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
      const suivant = effetSurLesSoldes(resultat, op, brouillons)
      if (suivant === null) continue
      resultat = suivant
      appliquees += 1
    } catch {
      // Refusée par le calcul local, elle le sera par le serveur : elle
      // n'entre pas dans le provisoire.
    }
  }
  return { soldes: resultat, appliquees }
}
