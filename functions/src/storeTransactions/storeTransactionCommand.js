import { write } from 'firebase-functions/logger'
import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  normalizeNetworkBalances,
  applyInitialTransactionImpact,
  applyReplenishmentImpact,
  reverseInitialTransactionImpact,
  applySettlementImpact,
  mapPaymentMethodToNetwork,
  reverseHistoryTransactionImpact,
  liquidityConsumptionSplit,
  applyReplenishmentReturnImpact,
} from '../settlements/financialUtils.js'
import {
  STORE_NETWORKS,
  STORE_TRANSACTION_TYPES,
  STORE_PAYMENT_METHODS,
  CASHIER_CAN_EDIT_BALANCES,
  STORE_REPLENISHMENT_SENDERS,
} from '../config/storeProfile.js'

const SETTLEMENT_FIELDS = [
  'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
  'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
  'settlementAmount', 'settlementType',
]
const PENDING = ['Non Terminées', 'Non Terminees']
const VALIDATED = ['Validée', 'Validee']
const REPLENISHMENT_TYPE = 'Ravitaillement'
const CLOSURE_TYPE = 'Clôture'
// Ni l'un ni l'autre n'est un mouvement client : `reverseHistoryTransactionImpact`
// ne sait pas les défaire, et `cancelHistory` les refuse pour cette raison.
// Le retour de ravitaillement : la boutique rend au dealer ce qu'il lui avait
// envoye. Il vit dans `history` et non dans une collection a part, pour que la
// journee se lise comme une suite dans l'onglet Ravitaillement : recu 500 000,
// rendu 420 000. L'abonnement temps reel et la pagination resservent tels quels.
const RETURN_TYPE = 'Retour'
// Le plafond du tableau d'expediteurs memorises sur la boutique. Au-dela, on
// garde les derniers : cinquante noms distincts releve de la faute de frappe,
// pas de l'organisation.
const SENDERS_MAX = 50
// `trashHistory` et `reopenHistory` refusent ces types. Le retour s'y ajoute :
// il se defait par `trashReplenishmentReturn`, qui sait AUSSI remonter le reste
// du de sa livraison. L'inversion generique ne rendrait que le solde, et la
// livraison resterait soldee a tort.
const UNCANCELLABLE_TYPES = [REPLENISHMENT_TYPE, CLOSURE_TYPE, RETURN_TYPE]
const NOTE_MAX = 280
// La corbeille. Un statut à part, et pas « Annulée » : une annulation est une
// décision métier, une suppression est un geste de correction. Les confondre
// ferait lire « Annulée » sur une ligne que la caissière a simplement mal saisie.
const DELETED_STATUS = 'Supprimée'
const CANCELLED_STATUS = 'Annulée'
// Au-delà, on garde les dernières : cinquante corrections sur une seule
// transaction relèvent du dysfonctionnement, pas de la relecture.
const JOURNAL_MAX = 50

/**
 * Un règlement inachevé — des tranches encaissées, un reste à payer.
 *
 * ATTENTION au garde-fou qu'on ne peut PAS réutiliser ici. `validateDraft`
 * écrit `settlementAmount`, `originalAmount`, `paidAmount`, `remainingAmount`
 * et `settlementStatus` sur toute ligne qu'il valide, même sans la moindre
 * tranche. Le test `SETTLEMENT_FIELDS.some(...)` — juste pour un BROUILLON, où
 * ces champs signalent vraiment un règlement entamé — refuserait donc la quasi-
 * totalité de l'historique. Le seul signal fiable est le reste à payer.
 */
function estPartiellementRegle(data) {
  return data.settlementStatus === 'partial' || (Number(data.remainingAmount) || 0) > 0
}

/**
 * Les refus communs à la suppression et à la réouverture d'une ligne validée.
 * Les deux gestes défont un impact financier déjà appliqué ; ils butent donc
 * exactement sur les mêmes lignes.
 */
function refuserSiIntouchable(history, verbe) {
  if (history.collaborationId) fail('STORE_TRANSACTION_INVALID', `Une trace de collaboration ne peut pas être ${verbe}.`)
  if (UNCANCELLABLE_TYPES.includes(history.type)) fail('STORE_TRANSACTION_INVALID', `Une ligne « ${history.type} » ne peut pas être ${verbe}.`)
  if ([DELETED_STATUS, CANCELLED_STATUS].includes(history.statut)) fail('STORE_TRANSACTION_INVALID', 'Cette transaction a déjà été défaite.')
  if (estPartiellementRegle(history)) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction partiellement réglée se corrige par un remboursement.')
}

/**
 * Empile une correction de montant dans le journal que le gérant relit.
 *
 * `FieldValue.serverTimestamp()` est interdit à l'intérieur d'un tableau
 * Firestore : l'horodatage est donc une vraie date, prise sur l'horloge de la
 * fonction — jamais celle du navigateur, qui n'est pas une source de vérité.
 */
function empilerModification(journal, { avant, apres, uid, nom }) {
  const entree = { avant, apres, at: new Date(), by: uid, byName: nom }
  return [...journal, entree].slice(-JOURNAL_MAX)
}

/**
 * La repartition de liquidite a conserver pour pouvoir defaire le geste.
 *
 * Seul le retrait valide D UN GESTE en a besoin : lui seul consomme la
 * liquidite en cascade sur plusieurs reseaux, et cette repartition est
 * irrecuperable apres coup. Un depot la remplit d un bloc sur un seul reseau,
 * un brouillon ne touche pas a la liquidite, et une validation par reglement
 * passe par `effectiveNetwork`, qui dit deja ou l argent est alle.
 */
function splitLiquiditeSiRetraitDirect(balances, transaction) {
  const type = String(transaction.type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (type !== 'retrait') return {}
  return { liquiditySplit: liquidityConsumptionSplit(balances, transaction.montant) }
}

/**
 * L'expediteur d'un ravitaillement, resolu contre le vocabulaire connu.
 *
 * POURQUOI UNE COMPARAISON NORMALISEE, ET PAS UNE EGALITE
 * ───────────────────────────────────────────────────────
 * Les retours se rattachent a leur livraison, et les livraisons se groupent par
 * expediteur : c'est ce groupement que la boutique lit le soir pour savoir ce
 * qu'elle doit a qui. Si « Mme Sawadogo », « mme sawadogo » et « Mme  Sawadogo »
 * entrent comme trois noms, ils deviennent TROIS CREANCIERS, chacun avec un
 * total partiel. Personne ne verra l'erreur : les trois totaux sont justes,
 * c'est leur separation qui est fausse.
 *
 * On renvoie donc toujours la forme DEJA CONNUE quand il y en a une, et la
 * saisie n'ajoute un nom que s'il ne ressemble a aucun autre.
 */
function cleanExpediteur(value, connus) {
  const brut = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!brut) fail('STORE_TRANSACTION_INVALID', 'Expediteur manquant.')
  if (brut.length > 60) fail('STORE_TRANSACTION_INVALID', "Nom d'expediteur trop long.")

  const pliage = (nom) => String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const deja = connus.find((nom) => pliage(nom) === pliage(brut))
  return { nom: deja ?? brut, estNouveau: !deja }
}

function fail(code, message) { throw new DealerRequestError(code, message) }
function cleanId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.trim())) fail('STORE_TRANSACTION_INVALID', `${field} invalide.`)
  return value.trim()
}
function cleanAmount(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('STORE_TRANSACTION_INVALID', 'Montant FCFA invalide.')
  return value
}
// La note du ravitaillement est libre et facultative, donc bornée : elle finit
// dans un historique qu'on relit, pas dans un champ de recherche.
function cleanNote(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > NOTE_MAX) fail('STORE_TRANSACTION_INVALID', 'Note invalide.')
  return value.trim()
}
function cleanTransaction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORE_TRANSACTION_INVALID', 'Transaction invalide.')
  if (JSON.stringify(input).length > 20_000) fail('STORE_TRANSACTION_INVALID', 'Transaction trop volumineuse.')
  const type = String(input.type || '').trim()
  const reseau = String(input.reseau || '').trim()
  const statut = String(input.statut || '').trim()
  if (!STORE_TRANSACTION_TYPES.includes(type)) fail('STORE_TRANSACTION_INVALID', 'Type de transaction non autorisé par le profil.')
  if (!STORE_NETWORKS.includes(reseau)) fail('STORE_TRANSACTION_INVALID', 'Réseau non autorisé par le profil.')
  if (![...PENDING, ...VALIDATED].includes(statut)) fail('STORE_TRANSACTION_INVALID', 'Statut initial non autorisé.')
  const clientId = cleanId(input.clientId, 'clientId')
  return {
    ...(input.client && typeof input.client === 'object' && !Array.isArray(input.client) ? { client: input.client } : {}),
    clientId,
    type,
    reseau,
    ...(typeof input.code === 'string' ? { code: input.code.slice(0, 160) } : {}),
    montant: cleanAmount(input.montant),
    statut,
  }
}
function dateFr() {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Ouagadougou' }).format(new Date())
}

async function readActor(t, db, uid) {
  const profileSnap = await t.get(db.doc(`users/${uid}`))
  if (!profileSnap.exists) fail('PROFILE_NOT_FOUND', 'Profil introuvable.')
  const profile = profileSnap.data()
  if (!profile.active) fail('PROFILE_INACTIVE', 'Compte désactivé.')
  if (!['store_admin', 'member'].includes(profile.role)) fail('ROLE_FORBIDDEN', 'Accès réservé aux boutiques.')
  const storeId = cleanId(profile.storeId, 'storeId')
  const storeSnap = await t.get(db.doc(`stores/${storeId}`))
  if (!storeSnap.exists) fail('STORE_NOT_FOUND', 'Boutique introuvable.')
  if (storeSnap.data().active !== true) fail('STORE_INACTIVE', 'Boutique désactivée.')
  return { profile, storeId, store: storeSnap.data() }
}

export async function storeTransactionCommandHandler(request, { db, FieldValue, logWriter = write }) {
  const uid = validateAuthUid(request.auth?.uid)
  const payload = validateInputPayload(request.data, ['action', 'transaction', 'draftId', 'historyId', 'updates', 'paymentMethod', 'amount', 'network', 'balanceType', 'balanceAmount', 'balances', 'note', 'direct', 'expediteur', 'replenishmentId', 'returnId'])
  const action = String(payload.action || '')
  const now = FieldValue.serverTimestamp()

  const result = await db.runTransaction(async t => {
    const { profile, storeId, store } = await readActor(t, db, uid)
    const balanceRef = db.doc(`clients/${storeId}/networkBalances/current`)

    if (action === 'ensureBalances') {
      const snap = await t.get(balanceRef)
      if (!snap.exists) t.set(balanceRef, { balances: normalizeNetworkBalances({}), updatedAt: now })
      return { balances: normalizeNetworkBalances(snap.exists ? snap.data() : {}) }
    }

    if (action === 'setBalance') {
      if (!CASHIER_CAN_EDIT_BALANCES) fail('BALANCE_EDIT_FORBIDDEN', 'La saisie directe des soldes est désactivée.')
      if (!STORE_NETWORKS.includes(payload.network) || !['stock', 'liquidite'].includes(payload.balanceType) || !Number.isSafeInteger(payload.balanceAmount) || payload.balanceAmount < 0) {
        fail('STORE_TRANSACTION_INVALID', 'Modification de solde invalide.')
      }
      const snap = await t.get(balanceRef)
      const before = normalizeNetworkBalances(snap.exists ? snap.data() : {})
      const balances = { ...before, [payload.network]: { ...before[payload.network], [payload.balanceType]: payload.balanceAmount } }
      t.set(balanceRef, { balances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, network: payload.network, balanceType: payload.balanceType, before: before[payload.network][payload.balanceType], after: payload.balanceAmount, createdAt: now })
      return { balances }
    }

    if (action === 'setBalances') {
      if (!CASHIER_CAN_EDIT_BALANCES) fail('BALANCE_EDIT_FORBIDDEN', 'La saisie directe des soldes est désactivée.')
      if (!payload.balances || typeof payload.balances !== 'object' || Array.isArray(payload.balances)) fail('STORE_TRANSACTION_INVALID', 'Soldes invalides.')
      const balances = normalizeNetworkBalances({})
      for (const network of STORE_NETWORKS) {
        const entry = payload.balances[network]
        if (!entry || !Number.isSafeInteger(entry.stock) || entry.stock < 0 || !Number.isSafeInteger(entry.liquidite) || entry.liquidite < 0) {
          fail('STORE_TRANSACTION_INVALID', `Soldes invalides pour ${network}.`)
        }
        balances[network] = { stock: entry.stock, liquidite: entry.liquidite }
      }
      const snap = await t.get(balanceRef)
      const before = normalizeNetworkBalances(snap.exists ? snap.data() : {})
      t.set(balanceRef, { balances, updatedAt: now })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, beforeBalances: before, afterBalances: balances, createdAt: now })
      return { balances }
    }

    const balanceSnap = await t.get(balanceRef)
    if (!balanceSnap.exists) fail('BALANCE_NOT_FOUND', 'Soldes de la boutique introuvables.')
    const balances = normalizeNetworkBalances(balanceSnap.data())

    if (action === 'add') {
      const transaction = cleanTransaction(payload.transaction)
      const nextBalances = applyInitialTransactionImpact(balances, transaction)
      const collection = PENDING.includes(transaction.statut) ? 'drafts' : 'history'
      const ref = db.collection(`clients/${storeId}/${collection}`).doc()
      // Une ligne validee d un geste porte les DEUX jambes. On note d ou la
      // liquidite est venue AVANT de l appliquer : apres, l information
      // n existe plus nulle part.
      const splitDirect = VALIDATED.includes(transaction.statut)
        ? splitLiquiditeSiRetraitDirect(balances, transaction)
        : {}
      const data = { ...transaction, storeId, ...(VALIDATED.includes(transaction.statut) ? { directValidation: true, ...splitDirect } : {}), storeName: store.name || profile.storeName || '', operatorId: uid, operatorName: profile.name || '', operatorEmail: profile.email || '', date: dateFr(), createdAt: now, updatedAt: now }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, ...data }
    }

    // Ravitaillement : la centrale réapprovisionne la boutique. Le client ne
    // choisit que le montant, le vase et la note ; le réseau vient du profil
    // (STORE_NETWORKS), jamais de la charge utile — un réseau soufflé par le
    // navigateur crediterait un solde que la boutique n'opère pas.
    if (action === 'replenish') {
      const amount = cleanAmount(payload.amount)
      if (!['stock', 'liquidite'].includes(payload.balanceType)) fail('STORE_TRANSACTION_INVALID', 'Vase de ravitaillement inconnu.')
      const note = cleanNote(payload.note)
      const network = STORE_NETWORKS[0]
      const nextBalances = applyReplenishmentImpact(balances, network, payload.balanceType, amount)

      // L'expediteur se resout contre le vocabulaire du profil ET les noms que
      // la boutique a deja ajoutes. Un nom inedit rejoint la liste de la
      // boutique : sans cette memoire, « Ajouter un nom » obligerait a le
      // retaper a chaque livraison, et c'est en le retapant qu'on l'orthographie
      // autrement.
      const memorises = Array.isArray(store.ravitaillementExpediteurs) ? store.ravitaillementExpediteurs : []
      const { nom: expediteur, estNouveau } = cleanExpediteur(payload.expediteur, [...STORE_REPLENISHMENT_SENDERS, ...memorises])

      const ref = db.collection(`clients/${storeId}/history`).doc()
      const data = {
        type: REPLENISHMENT_TYPE,
        montant: amount,
        reseau: network,
        balanceType: payload.balanceType,
        expediteur,
        // Le reste du, porte par la livraison elle-meme. Son ABSENCE distingue
        // les lignes d'avant ce lot : elles n'ont pas d'expediteur et leur
        // reste du est inconnaissable, donc elles comptent pour soldees.
        returnedAmount: 0,
        remainingAmount: amount,
        replenishmentStatus: 'open',
        statut: 'Validée',
        note,
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        validatedAt: now,
      }
      t.set(ref, data)
      if (estNouveau) {
        t.set(db.doc(`stores/${storeId}`), { ravitaillementExpediteurs: [...memorises, expediteur].slice(-SENDERS_MAX) }, { merge: true })
      }
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, balanceType: payload.balanceType, expediteur, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, ...data }
    }

    if (action === 'updateDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement est figée.')
      const transaction = cleanTransaction({ ...old, ...payload.updates, statut: 'Non Terminées' })
      const restored = reverseInitialTransactionImpact(balances, old)
      const nextBalances = applyInitialTransactionImpact(restored, transaction)
      // Le journal ne retient que le montant, parce que c'est le chiffre qui
      // engage la boutique — et qu'une ligne « 50 000 → 45 000 » se relit sans
      // explication, là où un diff de tous les champs demanderait un décodeur.
      const journal = Array.isArray(old.modifications) ? old.modifications : []
      const montantChange = Number(old.montant) !== Number(transaction.montant)
      t.update(ref, {
        ...transaction,
        storeId,
        updatedAt: now,
        // Écrit seulement quand il bouge : réécrire le tableau à chaque
        // correction de code ou de réseau le ferait grossir sans rien dire.
        ...(montantChange
          ? { modifications: empilerModification(journal, { avant: Number(old.montant), apres: Number(transaction.montant), uid, nom: profile.name || '' }) }
          : {}),
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, after: transaction, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: draftId, ...transaction }
    }

    if (action === 'deleteDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) return { deleted: false }
      const old = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement ne peut pas être supprimée.')
      const nextBalances = reverseInitialTransactionImpact(balances, old)
      t.delete(ref)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { deleted: true }
    }

    if (action === 'validateDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(draftRef)
      if (!snap.exists) return { validated: false }
      const draft = snap.data()
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(draft, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Utilisez le règlement par tranche pour cette transaction.')
      const amount = payload.amount == null ? draft.montant : cleanAmount(payload.amount)
      const paymentMethod = payload.paymentMethod == null ? null : String(payload.paymentMethod)
      if (paymentMethod && !STORE_PAYMENT_METHODS.includes(paymentMethod)) fail('INVALID_PAYMENT_METHOD', 'Méthode de paiement non autorisée.')
      // VALIDATION DIRECTE : le geste du bouton « Valider » du formulaire,
      // rejoué sur un brouillon. Sans mode de règlement il n'y a pas de jambe
      // de règlement à appliquer, mais il y a bien celle que la branche
      // « validée » d'`applyInitialTransactionImpact` pose — la liquidité qui
      // entre pour un dépôt, qui sort pour un retrait.
      //
      // On l'obtient en composant deux primitives éprouvées plutôt qu'en
      // écrivant une troisième arithmétique : défaire la jambe du brouillon
      // (au montant qu'elle avait), puis appliquer l'impact validé (au montant
      // corrigé). Sans `direct`, un `paymentMethod` nul laisse les soldes
      // intacts — c'est le comportement d'origine, que d'autres appels suivent.
      const direct = payload.direct === true && !paymentMethod
      const nextBalances = paymentMethod
        ? applySettlementImpact(balances, { ...draft, montant: amount }, paymentMethod)
        : direct
          ? applyInitialTransactionImpact(
            reverseInitialTransactionImpact(balances, draft),
            { ...draft, montant: amount, statut: 'Validée' },
          )
          : balances
      const historyRef = db.collection(`clients/${storeId}/history`).doc()
      // `directValidation` marque la ligne pour que son annulation future
      // défasse les DEUX jambes. Elle porte aussi `validatedAt`, dont la
      // branche d'inversion ne rendrait que celle du brouillon.
      const history = { ...draft, storeId, ...(direct ? { directValidation: true, ...splitLiquiditeSiRetraitDirect(reverseInitialTransactionImpact(balances, draft), { ...draft, montant: amount }) } : {}), statut: paymentMethod ? `${String(draft.type).normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'Depot' ? 'Encaissé' : 'Payé'} par ${paymentMethod}` : 'Validée', paymentMethod, effectiveNetwork: paymentMethod ? mapPaymentMethodToNetwork(paymentMethod) : null, settlementAmount: amount, originalAmount: draft.montant, paidAmount: amount, refundedAmount: 0, remainingAmount: 0, settlementStatus: 'settled', validatedAt: now, settlementUpdatedAt: now, updatedAt: now }
      t.set(historyRef, history)
      t.delete(draftRef)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: historyRef.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { validated: true, historyId: historyRef.id }
    }

    // Clôture : la boutique repart de zéro. On écrit d'abord ce qu'on solde,
    // on remet à zéro ensuite — l'inverse ferait disparaître les montants des
    // livres. Rien n'est lu dans la charge utile : le serveur solde ce qu'il
    // voit, et un montant soufflé par le navigateur n'a aucun effet.
    if (action === 'closeDay') {
      const soldes = STORE_NETWORKS.map(network => ({
        network,
        stock: Number(balances[network]?.stock) || 0,
        liquidite: Number(balances[network]?.liquidite) || 0,
      }))
      const total = soldes.reduce((somme, s) => somme + s.stock + s.liquidite, 0)
      if (total <= 0) fail('STORE_TRANSACTION_INVALID', 'Les soldes sont déjà à zéro.')

      const nextBalances = normalizeNetworkBalances({})
      const principal = soldes[0]
      const ref = db.collection(`clients/${storeId}/history`).doc()
      const data = {
        type: CLOSURE_TYPE,
        montant: total,
        reseau: principal.network,
        stockSolde: principal.stock,
        liquiditeSoldee: principal.liquidite,
        soldes,
        statut: 'Validée',
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        validatedAt: now,
      }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, ...data }
    }

    if (action === 'cancelHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      if (history.collaborationId) fail('STORE_TRANSACTION_INVALID', "Une trace de collaboration ne peut pas être annulée depuis l'historique.")
      // `reverseHistoryTransactionImpact` ne sait défaire qu'un dépôt ou un
      // retrait. Sur un ravitaillement ou une clôture il ne rendrait rien et la
      // ligne passerait quand même à « Annulée » : le solde resterait faux sans
      // trace du désaccord. On refuse plutôt que de mentir au gérant.
      if (UNCANCELLABLE_TYPES.includes(history.type)) fail('STORE_TRANSACTION_INVALID', `Une ligne « ${history.type} » ne s'annule pas depuis l'historique.`)
      const nextBalances = reverseHistoryTransactionImpact(balances, history)
      t.update(ref, { statut: 'Annulée', cancelledAt: now, cancelledBy: uid, updatedAt: now })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { cancelled: true }
    }

    // ─── La corbeille ───────────────────────────────────────────────────────
    //
    // Supprimer veut dire « cette transaction n'a pas eu lieu » : l'impact est
    // défait EN ENTIER. La ligne reste lisible dans la corbeille, parce qu'une
    // erreur de saisie qu'on peut relire se recorrige en dix secondes, là où une
    // ligne évaporée oblige à reconstituer de mémoire ce qu'elle contenait.
    //
    // Rien ne revient de la corbeille : restaurer réinjecterait un montant dans
    // des soldes qui ont pu être vidés depuis, et les cartes du jour mentiraient.

    if (action === 'trashHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      refuserSiIntouchable(history, 'supprimée')
      const nextBalances = reverseHistoryTransactionImpact(balances, history)
      t.update(ref, {
        statut: DELETED_STATUS,
        origin: 'history',
        deletedAt: now,
        deletedBy: uid,
        deletedByName: profile.name || '',
        updatedAt: now,
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { trashed: true, historyId }
    }

    if (action === 'trashDraft') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      // Ici le garde-fou large EST le bon : sur un brouillon, ces champs
      // n'apparaissent que si des tranches ont réellement été engagées.
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement ne peut pas être supprimée.')
      const nextBalances = reverseInitialTransactionImpact(balances, old)
      // Le brouillon DÉMÉNAGE dans `history`. C'est ce qui donne au gérant une
      // corbeille unique, triée par date, sans se demander dans quel onglet la
      // ligne a été supprimée — et côté code, l'abonnement temps réel et la
      // pagination de l'historique resservent tels quels.
      const corbeilleRef = db.collection(`clients/${storeId}/history`).doc()
      t.set(corbeilleRef, {
        ...old,
        statut: DELETED_STATUS,
        origin: 'draft',
        deletedAt: now,
        deletedBy: uid,
        deletedByName: profile.name || '',
        updatedAt: now,
      })
      t.delete(ref)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: corbeilleRef.id, uid, before: old, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { trashed: true, historyId: corbeilleRef.id }
    }

    // ─── La réouverture ─────────────────────────────────────────────────────
    //
    // L'inverse exact de `validateDraft` : celui-là fait set(history) puis
    // delete(draft), celui-ci fait set(draft) puis delete(history).
    //
    // LE PIÈGE DU SOLDE INTERMÉDIAIRE
    // `validateDraft` n'applique que la jambe du RÈGLEMENT — la liquidité qui
    // entre —, en tenant pour acquis que la jambe du BROUILLON — le stock qui
    // sort — est déjà posée par `add`. Rendre ici le montant EN ENTIER
    // produirait donc un brouillon dont la revalidation compterait le stock une
    // fois de moins qu'il ne faut, et le trou ne se verrait qu'à la clôture.
    //
    // La cible est l'état « brouillon tout juste saisi ». On l'obtient en
    // composant deux primitives déjà éprouvées plutôt qu'en écrivant une
    // troisième arithmétique à maintenir : tout défaire, puis reposer la seule
    // jambe du brouillon. TC-222-11 le vérifie par la boucle complète.
    if (action === 'reopenHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      refuserSiIntouchable(history, 'rouverte')
      // Une ligne SANS règlement — le bouton « Valider » du formulaire, un
      // import, une migration — est rouvrable comme les autres. Elle était
      // refusée tant que la revalidation ne savait pas rejouer ses deux jambes
      // faute de mode de règlement à appliquer ; `reopenedDirect` porte
      // désormais cette information jusqu'à `validateDraft`.
      //
      // « DIRECTE » VEUT DIRE « PORTAIT SES DEUX JAMBES », PAS « SANS RÈGLEMENT »
      // ────────────────────────────────────────────────────────────────────────
      // La nuance a l'air scolastique ; elle vaut de l'argent. Une ligne validée
      // par `validateDraft` sans mode de règlement NI drapeau — TC-222-31 —
      // n'a jamais posé de jambe de liquidité : elle porte `validatedAt` sans
      // `directValidation`. La rouvrir puis la revalider « en direct » lui en
      // inventerait une, et corriger un montant INCHANGÉ déplacerait les soldes.
      //
      // Les deux formes qui portent bien leurs deux jambes :
      //  — `directValidation` : le bouton « Valider », depuis ce lot ;
      //  — pas de `validatedAt` : les mêmes lignes, écrites par `add` avant lui.
      const estDirecte = !history.paymentMethod
        && (history.directValidation === true || !history.validatedAt)

      const defait = reverseHistoryTransactionImpact(balances, history)
      const nextBalances = applyInitialTransactionImpact(defait, { ...history, statut: 'Non Terminées' })

      // Brouillon construit par liste blanche, jamais par soustraction : un
      // champ de règlement qui survivrait ferait croire le brouillon réglé, et
      // `updateDraft` le refuserait — le gérant ne pourrait plus le corriger,
      // ce qui est précisément le geste qu'il vient de demander.
      const draftRef = db.collection(`clients/${storeId}/drafts`).doc()
      const draft = {
        ...(history.client && typeof history.client === 'object' ? { client: history.client } : {}),
        clientId: history.clientId,
        type: history.type,
        reseau: history.reseau,
        ...(typeof history.code === 'string' ? { code: history.code } : {}),
        montant: history.montant,
        statut: 'Non Terminées',
        storeId,
        storeName: history.storeName || store.name || profile.storeName || '',
        operatorId: history.operatorId || uid,
        operatorName: history.operatorName || '',
        operatorEmail: history.operatorEmail || '',
        // La date d'ORIGINE, pas celle du jour : une transaction de mardi
        // corrigée jeudi reste une transaction de mardi.
        date: history.date,
        createdAt: history.createdAt || now,
        ...(Array.isArray(history.modifications) ? { modifications: history.modifications } : {}),
        reopenedFromHistoryId: historyId,
        // Le mode de règlement d'origine, mis de côté sous un AUTRE nom.
        //
        // Deux raisons de ne pas le laisser s'appeler `paymentMethod` : il
        // ferait croire le brouillon déjà réglé à qui lit le document, et
        // surtout il permet à la correction de REPARTIR dans l'historique sans
        // redemander « encaisser par quoi ? » à une caissière qui n'a rien
        // changé d'autre que le montant.
        reopenedPaymentMethod: history.paymentMethod ?? null,
        // Validée d'un geste, sans règlement : la correction devra retrouver
        // ce mode-là, et non en inventer un que la caissière n'a pas choisi.
        reopenedDirect: estDirecte,
        reopenedAt: now,
        reopenedBy: uid,
        updatedAt: now,
      }
      t.set(draftRef, draft)
      t.delete(ref)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, transactionId: draftRef.id, uid, before: history, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      // On ne renvoie que l'identifiant et le drapeau : le document porte des
      // sentinelles `serverTimestamp()` qui ne traversent pas la frontière du
      // callable. `direct` voyage avec, pour que le navigateur n'ait pas à
      // redéduire une règle financière — une règle recopiée est une règle qui
      // divergera.
      return { reopened: true, draftId: draftRef.id, direct: estDirecte }
    }

    // ─── Le retour de ravitaillement ────────────────────────────────────────
    //
    // La boutique rend au dealer ce qu'il lui avait envoye. UNE SEULE RESERVE
    // bouge — c'est toute la raison d'etre de cette action : un depot valide en
    // deplace deux, et la boutique voulait juste faire sortir un montant.
    //
    // La reserve rendue peut differer de celle recue : on recoit du stock
    // electronique, on rend des especes. Les deux restent comparables parce que
    // c'est la meme dette, exprimee dans deux vases.
    if (action === 'returnReplenishment') {
      const replenishmentId = cleanId(payload.replenishmentId, 'replenishmentId')
      const amount = cleanAmount(payload.amount)
      if (!['stock', 'liquidite'].includes(payload.balanceType)) fail('STORE_TRANSACTION_INVALID', 'Vase de retour inconnu.')
      const note = cleanNote(payload.note)

      const ravitaillementRef = db.doc(`clients/${storeId}/history/${replenishmentId}`)
      const snap = await t.get(ravitaillementRef)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Ravitaillement introuvable.')
      const ravitaillement = snap.data()
      if (ravitaillement.type !== REPLENISHMENT_TYPE) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n\u2019est pas un ravitaillement.')

      // Une ligne d'avant ce lot n'a pas de reste du, et il est INCONNAISSABLE :
      // ce qui en a deja ete rendu ne fut jamais enregistre. La rouvrir au
      // retour reclamerait un montant que la boutique a peut-etre deja remis.
      if (!Number.isSafeInteger(ravitaillement.remainingAmount)) {
        fail('STORE_TRANSACTION_INVALID', 'Ce ravitaillement est anterieur au suivi des retours : son reste du est inconnu.')
      }
      if (ravitaillement.remainingAmount <= 0) fail('STORE_TRANSACTION_INVALID', 'Ce ravitaillement est deja solde.')
      if (amount > ravitaillement.remainingAmount) {
        fail('STORE_TRANSACTION_INVALID', `Montant superieur au reste du. Reste : ${ravitaillement.remainingAmount.toLocaleString('fr-FR')} FCFA`)
      }

      // Le refus \u00ab reserve insuffisante \u00bb vient d'ici, avec le disponible dans
      // son message : il est porte par `adjustBalanceValue` pour tout delta
      // negatif, et il n'y a pas lieu de le reecrire.
      const network = STORE_NETWORKS[0]
      const nextBalances = applyReplenishmentReturnImpact(balances, network, payload.balanceType, amount)

      const reste = ravitaillement.remainingAmount - amount
      const ref = db.collection(`clients/${storeId}/history`).doc()
      const data = {
        type: RETURN_TYPE,
        montant: amount,
        reseau: network,
        balanceType: payload.balanceType,
        replenishmentId,
        // Recopie, pas lue par jointure : la liste groupe par expediteur, et une
        // lecture de plus par ligne pour un nom deja connu serait du gaspillage.
        expediteur: ravitaillement.expediteur || '',
        statut: 'Validee',
        note,
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        validatedAt: now,
      }

      t.set(ref, data)
      t.update(ravitaillementRef, {
        returnedAmount: (Number(ravitaillement.returnedAmount) || 0) + amount,
        remainingAmount: reste,
        replenishmentStatus: reste === 0 ? 'settled' : 'open',
        updatedAt: now,
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, replenishmentId, uid, balanceType: payload.balanceType, expediteur: data.expediteur, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id, remainingAmount: reste }
    }

    // Defaire un retour : la reserve est recreditee ET le reste du remonte.
    //
    // C'est pour cette seconde moitie que `trashHistory` refuse le type Retour.
    // L'inversion generique rendrait le solde et laisserait la livraison soldee
    // a tort : la boutique croirait ne plus rien devoir.
    if (action === 'trashReplenishmentReturn') {
      const returnId = cleanId(payload.returnId, 'returnId')
      const ref = db.doc(`clients/${storeId}/history/${returnId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Retour introuvable.')
      const retour = snap.data()
      if (retour.type !== RETURN_TYPE) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n\u2019est pas un retour.')
      if (retour.deletedAt) fail('STORE_TRANSACTION_INVALID', 'Ce retour a deja ete supprime.')

      const ravitaillementRef = db.doc(`clients/${storeId}/history/${retour.replenishmentId}`)
      const snapRav = await t.get(ravitaillementRef)
      if (!snapRav.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Ravitaillement introuvable.')
      const ravitaillement = snapRav.data()

      // Rendre, c'est refaire entrer : l'inverse d'un retour est un
      // ravitaillement du meme montant dans le meme vase.
      const nextBalances = applyReplenishmentImpact(balances, retour.reseau || STORE_NETWORKS[0], retour.balanceType, retour.montant)
      const reste = (Number(ravitaillement.remainingAmount) || 0) + retour.montant

      t.update(ref, {
        statut: DELETED_STATUS,
        origin: 'return',
        deletedAt: now,
        deletedBy: uid,
        deletedByName: profile.name || '',
        updatedAt: now,
      })
      t.update(ravitaillementRef, {
        returnedAmount: Math.max(0, (Number(ravitaillement.returnedAmount) || 0) - retour.montant),
        remainingAmount: reste,
        replenishmentStatus: reste > 0 ? 'open' : 'settled',
        updatedAt: now,
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: returnId, replenishmentId: retour.replenishmentId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { trashed: true, returnId }
    }

    fail('STORE_TRANSACTION_INVALID', 'Commande inconnue.')
  })

  logWriter({ severity: 'INFO', event: 'STORE_TRANSACTION_COMMAND', action, actorUid: uid, result: 'success' })
  return result
}
