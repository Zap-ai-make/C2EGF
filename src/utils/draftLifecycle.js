/**
 * draftLifecycle.js — Logique pure du cycle de vie des brouillons (drafts)
 *
 * Ce module contient exclusivement des fonctions sans effet de bord :
 * - aucun accès Firestore (db, runTransaction, etc.)
 * - aucun accès réseau
 * - aucune dépendance à l'état de la boutique (activeStore)
 * - aucun appel à serverTimestamp
 *
 * Les signatures, formules et messages d'erreur sont identiques à ceux
 * qui existent dans FirestoreService. Ce module ne crée aucun comportement
 * nouveau — il extrait uniquement la logique pure déjà présente.
 *
 * Fonctions exportées :
 *   buildDraftPayload        — construit le nextDraft fusionné lors d'un updateDraft
 *   computeDraftUpdateImpacts — orchestre reverse + apply financialImpact
 */

import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'
import {
  reverseInitialTransactionImpact,
  applyInitialTransactionImpact
} from './financialImpact.js'

// ---------------------------------------------------------------------------
// buildDraftPayload
// ---------------------------------------------------------------------------

/**
 * Fusionne un brouillon existant avec les mises à jour demandées et force
 * le statut à PENDING. Reproduit exactement la construction de `nextDraft`
 * dans FirestoreService.updateDraft.
 *
 * Ne fait aucune écriture Firestore.
 *
 * @param {object} currentDraft - Données actuelles du document draft
 * @param {object} updates      - Champs à mettre à jour
 * @returns {object} nextDraft fusionné avec statut PENDING
 */
export function buildDraftPayload(currentDraft, updates) {
  return {
    ...currentDraft,
    ...updates,
    statut: FIRESTORE_CONFIG.STATUS.PENDING
  }
}

// ---------------------------------------------------------------------------
// computeDraftUpdateImpacts
// ---------------------------------------------------------------------------

/**
 * Calcule les nouveaux soldes lors d'une mise à jour de brouillon.
 *
 * Reproduit exactement les deux appels financiers inline dans
 * FirestoreService.updateDraft :
 *   1. reverseInitialTransactionImpact(currentBalances, currentDraft)
 *   2. applyInitialTransactionImpact(restoredBalances, nextDraft)
 *
 * Ne fait aucune écriture Firestore.
 *
 * @param {object} currentDraft    - Données actuelles du brouillon (avec montant, type, reseau, statut)
 * @param {object} nextDraft       - Brouillon fusionné après updates (résultat de buildDraftPayload)
 * @param {object} currentBalances - Balances réseau courantes (normalisées)
 * @returns {{ restoredBalances: object, nextBalances: object }}
 */
export function computeDraftUpdateImpacts(currentDraft, nextDraft, currentBalances) {
  const restoredBalances = reverseInitialTransactionImpact(currentBalances, currentDraft)
  const nextBalances = applyInitialTransactionImpact(restoredBalances, nextDraft)
  return { restoredBalances, nextBalances }
}

