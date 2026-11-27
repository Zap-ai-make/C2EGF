/**
 * tranche.js — une tranche d'« Encaisser » / « Payer par », hors de la callable.
 *
 * DEUX PORTES, UNE SEULE TRANCHE
 * ──────────────────────────────
 * La caissière encaisse par `addTransactionPayment` ; elle accepte aussi le
 * remboursement que l'agent a lancé depuis l'app Oxygen, par
 * `storeTransactionCommand` (contrat demande-operation v10 §11.3). Les deux
 * doivent faire EXACTEMENT la même chose : mêmes champs, même statut final,
 * mêmes soldes. D'où ce module, qu'elles appellent toutes deux.
 *
 * `calculerTranche` est pur. `ecrireTranche` écrit sans rien lire : dans une
 * transaction Firestore, toutes les lectures précèdent les écritures, et
 * l'appelant a déjà lu la ligne, les soldes et, quand la ligne part, la place
 * qu'elle prendra dans l'historique (`historyRefDe`).
 */

import { DealerRequestError } from '../errors.js'
import {
  normalizeNetworkBalances,
  mapPaymentMethodToNetwork,
  applySettlementImpact,
} from './financialUtils.js'
import {
  accumulerCodesAgent,
  accumulerCodesParReseau,
  libelleCodesAgent,
} from './settlementShared.js'

/**
 * Les tranches gardées sur la ligne, pour l'historique de l'agent (§11.4).
 * Au-delà, les plus anciennes tombent, comme `envoisSiege` : cinquante
 * tranches d'une seule opération relèvent de l'erreur.
 */
export const REGLEMENTS_MAX = 50

function buildFinalStatus(type, paymentMethod) {
  const t = String(type || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (t === 'depot')   return `Encaissé par ${paymentMethod}`
  if (t === 'retrait') return `Payé par ${paymentMethod}`
  if (t === 'credit')  return `Remboursé par ${paymentMethod}`
  return `Validée par ${paymentMethod}`
}

/**
 * Met à jour le settlementSummary du draft pour ce réseau.
 * Le summary est maintenu incrémentalement pour permettre l'annulation exacte.
 */
function updateSummaryForPayment(prevSummary, network, amount, agentCodes, codesParReseau) {
  const prev = (prevSummary?.netByNetwork || {})[network] || { paid: 0, refunded: 0 }
  return {
    netByNetwork: {
      ...(prevSummary?.netByNetwork || {}),
      [network]: { paid: prev.paid + amount, refunded: prev.refunded },
    },
    // Absente quand aucune tranche n'a note de destination : un reglement sans
    // code agent garde la forme de document qu'il avait avant ce champ.
    ...(agentCodes.length ? { agentCodes } : {}),
    ...(Object.keys(codesParReseau).length ? { agentCodesByNetwork: codesParReseau } : {}),
  }
}

/** La place de la ligne dans l'historique : le même identifiant que la non terminée (lot G4a). */
export const historyRefDe = (db, storeId, draftId) => db.doc(`clients/${storeId}/history/${draftId}`)

/**
 * Ce que fait une tranche, sans rien écrire.
 *
 * @param {object} p
 * @param {object} p.draft          la ligne non terminée
 * @param {number} p.amount         entier > 0, déjà validé
 * @param {string} p.paymentMethod  'Orange Money' | 'Cash' (liste blanche du profil)
 * @param {string|null} [p.agentCode]
 * @param {object} p.balances       les soldes lus (forme Firestore ou normalisée)
 * @param {Date} p.le               l'instant de la caisse, à défaut l'heure du serveur
 * @param {string|null} [p.demandeId] la demande d'agent acceptée qui fait cette
 *   tranche. Notée sur l'entrée de `reglements` : sans elle, l'autre demande
 *   en attente sur la ligne lirait cette tranche comme un encaissement au
 *   comptoir (« Encaissé à … ? », `encaisseApres`). Oxygen ne la lit pas
 *   (`lireActivite` ne rend que montant, mode et instant).
 */
export function calculerTranche({ draft, amount, paymentMethod, agentCode = null, balances, le, demandeId = null }) {
  // ── Type métier ÉPINGLÉ (défense en profondeur, cf. C1) ────────────────
  // Le signe de l'impact réseau dépend du type (Retrait ⇒ débit). Les règles
  // Firestore figent déjà draft.type dès qu'un règlement est engagé, mais on
  // ne s'y fie pas seul : dès la 1re tranche on épingle le type dans un champ
  // serveur immuable (settlementType, verrouillé côté règles) et on le relit
  // ensuite — même si le gel des règles était contourné, le signe reste stable.
  const effectiveType = draft.settlementType ?? draft.type

  // ── Initialisation lazy (backward compat) ─────────────────────────────
  const originalAmount  = draft.originalAmount  ?? draft.montant
  const paidAmount      = draft.paidAmount      ?? 0
  const refundedAmount  = draft.refundedAmount  ?? 0
  const remainingAmount = draft.remainingAmount ?? (originalAmount - paidAmount + refundedAmount)

  if (remainingAmount <= 0) {
    throw new DealerRequestError('SETTLEMENT_ALREADY_SETTLED', 'Cette transaction est déjà entièrement réglée.')
  }
  if (amount > remainingAmount) {
    throw new DealerRequestError(
      'SETTLEMENT_EXCEEDS_REMAINING',
      `Montant (${amount} FCFA) supérieur au reste dû (${remainingAmount} FCFA).`
    )
  }

  // ── Impact financier ──────────────────────────────────────────────────
  const currentBalances = normalizeNetworkBalances(balances)
  const affectedNetwork = mapPaymentMethodToNetwork(paymentMethod)
  const nextBalances    = applySettlementImpact(currentBalances, { type: effectiveType, montant: amount }, paymentMethod)

  const newPaid      = paidAmount + amount
  const newRemaining = remainingAmount - amount

  // ── settlementSummary incrémental ─────────────────────────────────────
  const prevSummary    = draft.settlementSummary ?? null
  const codesAgent     = accumulerCodesAgent(prevSummary, agentCode)
  const codesParReseau = accumulerCodesParReseau(prevSummary, affectedNetwork, agentCode)

  const deja = Array.isArray(draft.reglements) ? draft.reglements : []

  return {
    effectiveType,
    originalAmount,
    paidAmount,
    refundedAmount,
    remainingAmount,
    newPaid,
    newRemaining,
    fullySettled: newRemaining === 0,
    affectedNetwork,
    previousBalanceEntry: currentBalances[affectedNetwork] ?? { stock: 0, liquidite: 0 },
    newBalanceEntry:      nextBalances[affectedNetwork]    ?? { stock: 0, liquidite: 0 },
    nextBalances,
    newSummary: updateSummaryForPayment(prevSummary, affectedNetwork, amount, codesAgent, codesParReseau),
    codesAgent,
    reglements: [...deja, { montant: amount, mode: paymentMethod, le, ...(demandeId ? { demandeId } : {}) }].slice(-REGLEMENTS_MAX),
  }
}

/**
 * Écrit la tranche : soldes, document de règlement, ligne (mise à jour, ou
 * déplacée dans l'historique quand le reste tombe à zéro).
 *
 * @param {object} t  la transaction Firestore
 * @param {object} p
 * @param {object} p.auditBase  `buildSettlementAuditBase(...)` : qui, quoi, l'état d'avant
 * @param {Date|null} p.faitLe  l'instant de la caisse quand le geste est parti en retard
 * @param {unknown} p.now       `FieldValue.serverTimestamp()`
 * @returns {{fullySettled: boolean, historyId?: string}}
 */
export function ecrireTranche(t, { db, storeId, draftId, draft, calcul, paymentMethod, settlementId, auditBase, faitLe, now }) {
  const draftRef      = db.doc(`clients/${storeId}/drafts/${draftId}`)
  const settlementRef = db.doc(`clients/${storeId}/drafts/${draftId}/settlements/${settlementId}`)
  const balanceRef    = db.doc(`clients/${storeId}/networkBalances/current`)
  const { affectedNetwork, fullySettled, newPaid, newRemaining, refundedAmount } = calcul

  // ── Document settlement ───────────────────────────────────────────────
  const settlementData = {
    // Identité
    type:              'payment',
    operationType:     'payment',
    ...auditBase,
    // Après
    newPaidAmount:       newPaid,
    newRefundedAmount:   refundedAmount,
    newRemainingAmount:  newRemaining,
    newSettlementStatus: fullySettled ? 'settled' : 'partial',
    // Impact financier
    affectedNetwork,
    affectedBalanceField: affectedNetwork === 'Liquidite' ? 'liquidite' : 'stock',
    previousFinancialBalance: calcul.previousBalanceEntry,
    newFinancialBalance:      calcul.newBalanceEntry,
    financialDelta:           auditBase.amount,
    // Finalisation
    fullySettled,
    historyId:   null,  // mis à jour ci-dessous si fullySettled
    createdAt:   now,
  }

  // ── Mise à jour des soldes ────────────────────────────────────────────
  t.set(balanceRef, { balances: calcul.nextBalances, updatedAt: now }, { merge: true })

  if (fullySettled) {
    const historyRef = historyRefDe(db, storeId, draftId)
    const historyId  = historyRef.id

    const finalSummary = {
      ...calcul.newSummary,
      totalPaid:      newPaid,
      totalRefunded:  refundedAmount,
      draftSettlementsPath: `clients/${storeId}/drafts/${draftId}`,
    }

    t.set(historyRef, {
      ...draft,
      originalAmount:      calcul.originalAmount,
      paidAmount:          newPaid,
      refundedAmount,
      remainingAmount:     0,
      settlementStatus:    'settled',
      settlementType:      calcul.effectiveType,
      settlementSummary:   finalSummary,
      settlementUpdatedAt: now,
      statut:              buildFinalStatus(calcul.effectiveType, paymentMethod),
      paymentMethod,
      // ⚠ `settlementAgentCode` ET NON `agentCode` : la ligne d'historique
      //   porte deja `code`, celui du CLIENT. Les deux repondent a des
      //   questions differentes — « qui est ce client » et « ou est parti
      //   l'argent » — et un nom court les aurait confondus a la relecture.
      //
      //   TOUTES les tranches, et non la derniere : `agentCode` seul aurait
      //   attribue le montant entier au dernier compte credite.
      settlementAgentCode: libelleCodesAgent(calcul.codesAgent),
      effectiveNetwork:    affectedNetwork,
      settlementAmount:    calcul.originalAmount,
      reglements:          calcul.reglements,
      validatedAt:         faitLe ?? now,
      ...(faitLe ? { recuLe: now } : {}),
      updatedAt:           now,
    })
    t.delete(draftRef)

    // Copie du settlement sous history pour audit durable
    const historySettlementRef = db.doc(`clients/${storeId}/history/${historyId}/settlements/${settlementId}`)
    t.set(settlementRef,        { ...settlementData, historyId })
    t.set(historySettlementRef, { ...settlementData, historyId })

    return { fullySettled: true, historyId }
  }

  // Paiement partiel
  t.set(settlementRef, settlementData)

  t.update(draftRef, {
    originalAmount:      calcul.originalAmount,
    paidAmount:          newPaid,
    refundedAmount,
    remainingAmount:     newRemaining,
    settlementStatus:    'partial',
    settlementType:      calcul.effectiveType,
    settlementSummary:   calcul.newSummary,
    settlementUpdatedAt: now,
    reglements:          calcul.reglements,
  })

  return { fullySettled: false }
}
