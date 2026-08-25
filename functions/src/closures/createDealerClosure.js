/**
 * Handler de création d'une clôture Dealer.
 *
 * Sémantique :
 *   Le Dealer déclare ses soldes de fin de session (stock + liquidité).
 *   Le backend lit les soldes enregistrés (Firestore) et calcule les écarts.
 *   Un motif est obligatoire si au moins un écart != 0.
 *   Aucun solde n'est modifié — la clôture est un constat, pas une correction.
 *
 * ── Idempotence et concurrence ──────────────────────────────────────────────
 *
 * L'identifiant du document est DÉTERMINISTE :
 *
 *   closureId = `${dealerUid}_${targetStoreId}_${network}_${businessDate}`
 *
 * Propriétés :
 *   - même combinaison (dealerUid, targetStoreId, network, businessDate) → même ID
 *   - pas d'espaces ni de slashes (UID Firebase : alphanumérique 28 chars ;
 *     storeId Firestore : alphanumérique ou tiret ; network : 'Orange' ;
 *     businessDate : 'YYYY-MM-DD')
 *   - longueur totale < 80 chars (bien en dessous de la limite Firestore 1500 bytes)
 *   - aucune donnée secrète dans l'ID
 *
 * Comportement idempotent (deux appels simultanés) :
 *
 *   Firestore utilise le verrouillage optimiste au niveau du document.
 *   Si deux transactions lisent `closureRef` simultanément comme inexistant
 *   et essaient toutes deux de le créer :
 *
 *   ┌──────────┬────────────────────────────────────────────────────────────┐
 *   │ Tx 1     │ Lit closureRef (absent) → écrit → COMMIT (succès)         │
 *   │ Tx 2     │ Lit closureRef (absent) → essaie d'écrire → ABORTED       │
 *   │          │ SDK Firestore retente automatiquement                      │
 *   │ Tx 2 bis │ Relit closureRef (présent, même payload) → IDEMPOTENT    │
 *   │          │ → retourne le document existant, aucune écriture          │
 *   └──────────┴────────────────────────────────────────────────────────────┘
 *
 *   Résultat garanti :
 *   - exactement 1 document dealerClosures
 *   - exactement 1 audit de création
 *   - les deux appels retournent success: true
 *
 *   Si les payloads sont différents (stock déclaré distinct), Tx 2 bis
 *   lève CLOSURE_ALREADY_EXISTS (failed-precondition).
 *
 * Le client ne peut pas fournir :
 *   recordedStockBalance, recordedLiquidityBalance, stockDifference,
 *   liquidityDifference, status, confirmedBy, rejectedBy, audit fields.
 *   Le payload allow-list est appliqué par validateInputPayload.
 *
 * db et FieldValue sont injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

const BUSINESS_DATE_RE  = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Validation d'un montant déclaré (entier >= 0)
// ---------------------------------------------------------------------------

function validateDeclaredAmount(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DealerRequestError(
      'INVALID_CLOSURE_DATA',
      `${fieldName} invalide : entier non-négatif requis.`
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function createDealerClosureHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const dealerUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation forme payload (allow-list strict) ────────────────────────
  //   recordedStockBalance, recordedLiquidityBalance, stockDifference,
  //   liquidityDifference, status, confirmedBy, rejectedBy ne sont jamais acceptés.
  const payload = validateInputPayload(request.data, [
    'targetStoreId',
    'businessDate',
    'declaredStockBalance',
    'declaredLiquidityBalance',
    'reason',
    'network',
  ])

  // ── 3. Validation des champs ──────────────────────────────────────────────
  const { targetStoreId, businessDate, reason, network } = payload
  const declaredStockBalance     = validateDeclaredAmount(payload.declaredStockBalance,     'declaredStockBalance')
  const declaredLiquidityBalance = validateDeclaredAmount(payload.declaredLiquidityBalance, 'declaredLiquidityBalance')

  if (!targetStoreId || typeof targetStoreId !== 'string' || !targetStoreId.trim()) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', 'targetStoreId requis.')
  }
  if (!BUSINESS_DATE_RE.test(businessDate)) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', 'businessDate invalide (format YYYY-MM-DD requis).')
  }
  const today = new Date().toISOString().slice(0, 10)
  if (businessDate > today) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', 'businessDate ne peut pas être dans le futur.')
  }
  if (!new Set(dealerNetworks).has(network)) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', `Réseau invalide : "${network}" hors du circuit dealer de ce client.`)
  }

  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
  if (normalizedReason.length > 0 && normalizedReason.length < 3) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', 'Motif trop court (minimum 3 caractères).')
  }
  if (normalizedReason.length > 500) {
    throw new DealerRequestError('INVALID_CLOSURE_DATA', 'Motif trop long (maximum 500 caractères).')
  }

  // ── 4. Identifiant déterministe ────────────────────────────────────────────
  //   Garantit l'unicité au niveau du document Firestore.
  //   Format : "{dealerUid}_{targetStoreId}_{network}_{businessDate}"
  //   Aucun de ces composants ne peut contenir de slash (interdit dans les IDs Firestore).
  //   Les UID Firebase sont purement alphanumériques (28 chars).
  //   Les storeIds Firestore sont alphanumériques ou avec tirets.
  //   businessDate est YYYY-MM-DD.
  const closureDocId = `${dealerUid}_${targetStoreId}_${network}_${businessDate}`
  const closureRef   = db.collection('dealerClosures').doc(closureDocId)

  // ── 5. Prévalidation rapide du profil hors transaction (fail-fast) ─────────
  const profileSnap = await db.doc(`users/${dealerUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  const profile = profileSnap.data()
  if (!profile.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Compte dealer inactif.')
  }
  if (profile.role !== 'dealer') {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée aux dealers.')
  }

  // ── 6. Transaction atomique ────────────────────────────────────────────────
  //   Toutes les lectures critiques sont répétées à l'intérieur de la transaction :
  //   profil (autoritative), boutique, solde et surtout closureRef (unicité).
  //
  //   Si deux transactions lisent closureRef simultanément comme inexistant
  //   et essaient toutes deux de t.set(), Firestore aborte la seconde (ABORTED).
  //   Le SDK retente automatiquement. Sur la deuxième tentative, closureRef existe :
  //   si le payload est équivalent → idempotent (success) ; sinon → CLOSURE_ALREADY_EXISTS.
  let closureResult
  try {
    await db.runTransaction(async (t) => {
      // 6a. Relecture autoritative du profil
      const txProfileSnap = await t.get(db.doc(`users/${dealerUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      if (!txProfile.active)          throw new DealerRequestError('PROFILE_INACTIVE', 'Compte dealer inactif.')
      if (txProfile.role !== 'dealer') throw new DealerRequestError('ROLE_FORBIDDEN',   'Action réservée aux dealers.')

      // 6b. Vérification d'unicité via l'ID déterministe (DOIT être dans la tx)
      const existingSnap = await t.get(closureRef)
      if (existingSnap.exists) {
        const existing = existingSnap.data()
        // Même payload déclaré → idempotent : retourner le résultat existant
        if (
          existing.declaredStockBalance     === declaredStockBalance     &&
          existing.declaredLiquidityBalance === declaredLiquidityBalance &&
          (existing.reason ?? null)         === (normalizedReason || null)
        ) {
          closureResult = {
            idempotent:         true,
            closureId:          closureRef.id,
            stockDifference:    existing.stockDifference,
            liquidityDifference: existing.liquidityDifference,
          }
          return // transaction sans écriture
        }
        // Payload différent pour la même clé métier → erreur stable
        throw new DealerRequestError(
          'CLOSURE_ALREADY_EXISTS',
          `Une clôture avec un payload différent existe déjà pour cette date (${businessDate}).`
        )
      }

      // 6c. Lecture boutique (nom + active)
      const storeSnap = await t.get(db.doc(`stores/${targetStoreId}`))
      if (!storeSnap.exists) {
        throw new DealerRequestError('STORE_NOT_FOUND', 'Boutique introuvable.')
      }
      const storeData = storeSnap.data()
      if (!storeData.active) {
        throw new DealerRequestError('STORE_INACTIVE', 'La boutique cible est inactive.')
      }

      // 6d. Lecture autoritative des soldes enregistrés
      const balSnap = await t.get(db.doc(`clients/${targetStoreId}/networkBalances/current`))
      if (!balSnap.exists) {
        throw new DealerRequestError('BALANCE_NOT_FOUND', 'Document de soldes introuvable pour cette boutique.')
      }
      const balData = balSnap.data()
      const networkBalance = balData?.balances?.[network]
      if (!networkBalance || typeof networkBalance !== 'object') {
        throw new DealerRequestError('INVALID_BALANCE_DATA', `Soldes ${network} introuvables.`)
      }
      const recordedStockBalance     = typeof networkBalance.stock     === 'number' && Number.isFinite(networkBalance.stock)     ? networkBalance.stock     : 0
      const recordedLiquidityBalance = typeof networkBalance.liquidite === 'number' && Number.isFinite(networkBalance.liquidite) ? networkBalance.liquidite : 0

      // 6e. Calcul des écarts (côté backend, le client ne peut pas fournir ces valeurs)
      const stockDifference     = declaredStockBalance     - recordedStockBalance
      const liquidityDifference = declaredLiquidityBalance - recordedLiquidityBalance

      // 6f. Motif obligatoire si écart
      const hasDiscrepancy = stockDifference !== 0 || liquidityDifference !== 0
      if (hasDiscrepancy && normalizedReason.length < 3) {
        throw new DealerRequestError(
          'REASON_REQUIRED',
          "Un motif (minimum 3 caractères) est obligatoire lorsqu'un écart est constaté."
        )
      }

      const now         = FieldValue.serverTimestamp()
      const closureData = {
        dealerUid,
        dealerName:              txProfile.name  ?? null,
        dealerEmail:             txProfile.email ?? null,
        targetStoreId,
        targetStoreName:         storeData.name ?? null,
        network,
        businessDate,
        declaredStockBalance,
        declaredLiquidityBalance,
        recordedStockBalance,
        recordedLiquidityBalance,
        stockDifference,
        liquidityDifference,
        reason:                  normalizedReason || null,
        status:                  'pending',
        createdAt:               now,
        updatedAt:               now,
        confirmedBy:             null,
        confirmedAt:             null,
        rejectedBy:              null,
        rejectedAt:              null,
        rejectionReason:         null,
      }

      t.set(closureRef, closureData)

      // Piste d'audit dans clients/{targetStoreId}/auditLogs
      const auditRef = db.collection(`clients/${targetStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action:                  'DEALER_CLOSURE_CREATED',
        actorUid:                dealerUid,
        actorEmail:              txProfile.email ?? null,
        actorName:               txProfile.name  ?? null,
        actorRole:               'dealer',
        targetStoreId,
        targetStoreName:         storeData.name ?? null,
        closureId:               closureRef.id,
        businessDate,
        network,
        declaredStockBalance,
        declaredLiquidityBalance,
        recordedStockBalance,
        recordedLiquidityBalance,
        stockDifference,
        liquidityDifference,
        reason:                  normalizedReason || null,
        createdAt:               now,
      })

      closureResult = {
        idempotent:          false,
        closureId:           closureRef.id,
        stockDifference,
        liquidityDifference,
      }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success:             true,
    closureId:           closureResult.closureId,
    idempotent:          closureResult.idempotent,
    stockDifference:     closureResult.stockDifference,
    liquidityDifference: closureResult.liquidityDifference,
  }
}
