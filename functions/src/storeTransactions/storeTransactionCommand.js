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
  STORE_TIME_ZONE,
  SIEGE_REPAYMENT_ENABLED,
  MONEY_TRANSFER_ENABLED,
} from '../config/storeProfile.js'
import { instantDeLaCaisse } from '../instantDeLaCaisse.js'
import {
  TYPE_REMB_SIEGE,
  MESSAGE_GESTE_GENERIQUE,
  ENVOIS_MAX,
  estRembSiege,
  impactSaisie,
  impactEnvoi,
  impactAnnulation,
  impactModification,
} from './rembSiege.js'
import {
  TYPE_TRANSFERT_ARGENT,
  SERVICES_TRANSFERT,
  OPERATIONS_TRANSFERT,
  TRANCHES_MAX,
  estTransfertArgent,
  impactSaisieTransfert,
  impactTrancheTransfert,
  impactModificationTransfert,
  impactAnnulationTransfert,
} from './transfertArgent.js'
import {
  COLLECTION_DEMANDES,
  ETATS_DEMANDE,
  TYPE_DU_SENS,
  clientDeFiche,
  codeReseauDeFiche,
} from '../oxygen/demande.js'
import { dealerDe, flotteDe, numerosSaisis } from '../boutiques/numeros.js'
import { signalerDemandeFermee } from '../oxygen/signal.js'

const SETTLEMENT_FIELDS = [
  'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
  'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
  'settlementAmount', 'settlementType',
]
const PENDING = ['Non Terminées', 'Non Terminees']
const VALIDATED = ['Validée', 'Validee']
const REPLENISHMENT_TYPE = 'Ravitaillement'
// Plus aucune commande n'écrit de clôture (« Vider les soldes », retiré le 31
// octobre 2026) : le type reste pour les lignes DÉJÀ écrites, qu'aucune
// commande générique ne doit défaire (UNCANCELLABLE_TYPES).
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
// Le remboursement au siège aussi : il se défait par `trashSiegeRepayment`, qui
// sait rendre ses deux jambes. L'inversion générique lèverait une erreur nue.
const UNCANCELLABLE_TYPES = [REPLENISHMENT_TYPE, CLOSURE_TYPE, RETURN_TYPE, TYPE_REMB_SIEGE]
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
function empilerModification(journal, { avant, apres, uid, nom, faitLe }) {
  const entree = { avant, apres, at: faitLe ?? new Date(), by: uid, byName: nom }
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

/**
 * Les commandes de brouillon génériques ne savent pas défaire les jambes d'un
 * remboursement au siège : `reverseInitialTransactionImpact` lève une erreur
 * NUE sur ce type, que la file d'envoi prendrait pour une panne et renverrait
 * sans fin. Un refus métier, lui, est définitif (TC-381).
 */
function refuserSiRembSiege(doc) {
  if (estRembSiege(doc)) fail('STORE_TRANSACTION_INVALID', MESSAGE_GESTE_GENERIQUE)
}
/** Ce que la caissière lit quand la demande s'est fermée sous ses yeux. */
const MESSAGES_DEMANDE_CLOSE = Object.freeze({
  [ETATS_DEMANDE.ANNULEE_AGENT]: 'L’agent a annulé cette demande.',
  [ETATS_DEMANDE.REJETEE]: 'Cette demande a déjà été rejetée.',
  [ETATS_DEMANDE.VALIDEE]: 'Cette demande a déjà été acceptée.',
})

/**
 * Seule une demande en attente reçoit une réponse. Un refus métier, en
 * majuscules : la caissière lit pourquoi, et rien n'est réessayé.
 */
function refuserSiDemandeClose(demande) {
  if (demande.etat === ETATS_DEMANDE.EN_ATTENTE) return
  fail('DEMANDE_CLOSE', MESSAGES_DEMANDE_CLOSE[demande.etat] ?? 'Cette demande est close.')
}

/** Les numéros conformes d'une fiche, clés absentes omises : l'avant et l'après du journal. */
function numerosDe(store) {
  const flotte = flotteDe(store)
  const dealer = {}
  for (const reseau of STORE_NETWORKS) {
    const numero = dealerDe(store, reseau)
    if (numero) dealer[reseau] = numero
  }
  return { ...(flotte ? { flotte } : {}), dealer }
}

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
// Les commandes du remboursement au siège, éteintes avec leur drapeau de profil.
const ACTIONS_REMB_SIEGE = ['addSiegeRepayment', 'sendToSiege', 'updateSiegeRepayment', 'trashSiegeRepayment']
// Les commandes des transferts d'argent, éteintes avec leur drapeau de profil.
const ACTIONS_TRANSFERT_ARGENT = ['updateStoreSettings', 'addMoneyTransfer', 'settleMoneyTransfer', 'updateMoneyTransfer', 'trashMoneyTransfer']
// Ce qu'une modification peut changer : jamais l'opération (annuler et ressaisir),
// ni le statut, ni le suivi des tranches.
const CHAMPS_TRANSFERT_MODIFIABLES = ['service', 'servicePrecise', 'nomClient', 'telephone', 'codeTransfert', 'montant', 'balanceType']
const PAS_UN_TRANSFERT = 'Cette ligne n’est pas un transfert d’argent.'
// Ce qu'une modification peut changer : ni le type, ni le statut, ni le suivi des envois.
const CHAMPS_REMB_SIEGE_MODIFIABLES = ['client', 'clientId', 'code', 'montant', 'balanceType']

/**
 * Un remboursement au siège tel que le navigateur l'envoie : l'agent, le
 * montant, la réserve où il l'a mis (« reçu en ») et le statut. Le type et le
 * réseau ne viennent jamais de la charge utile : le serveur les pose.
 */
function cleanRembSiege(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORE_TRANSACTION_INVALID', 'Remboursement invalide.')
  if (JSON.stringify(input).length > 20_000) fail('STORE_TRANSACTION_INVALID', 'Remboursement trop volumineux.')
  if (!['stock', 'liquidite'].includes(input.balanceType)) fail('STORE_TRANSACTION_INVALID', 'Reçu en : Stock ou Espèce.')
  const statut = String(input.statut || '').trim()
  if (![...PENDING, ...VALIDATED].includes(statut)) fail('STORE_TRANSACTION_INVALID', 'Statut initial non autorisé.')
  return {
    ...(input.client && typeof input.client === 'object' && !Array.isArray(input.client) ? { client: input.client } : {}),
    clientId: cleanId(input.clientId, 'clientId'),
    ...(typeof input.code === 'string' ? { code: input.code.slice(0, 160) } : {}),
    montant: cleanAmount(input.montant),
    balanceType: input.balanceType,
    statut: PENDING.includes(statut) ? 'Non Terminées' : 'Validée',
  }
}

/**
 * Une opération de transfert telle que le navigateur l'envoie. Le client est
 * une personne ordinaire : jamais de `client`, `clientId` ni `code`, qui
 * désignent un agent et rattacheraient la ligne à son historique. Le type, le
 * réseau et le statut ne viennent jamais de la charge utile.
 */
function cleanTransfertArgent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORE_TRANSACTION_INVALID', 'Opération invalide.')
  if (JSON.stringify(input).length > 20_000) fail('STORE_TRANSACTION_INVALID', 'Opération trop volumineuse.')
  if (!SERVICES_TRANSFERT.includes(input.service)) fail('STORE_TRANSACTION_INVALID', 'Service : Western Union, Ria, MoneyGram ou Autres.')
  if (!OPERATIONS_TRANSFERT.includes(input.operation)) fail('STORE_TRANSACTION_INVALID', 'Opération : Transfert ou Retrait.')
  if (!['stock', 'liquidite'].includes(input.balanceType)) fail('STORE_TRANSACTION_INVALID', 'Choisissez Stock ou Espèce.')
  const nomClient = typeof input.nomClient === 'string' ? input.nomClient.replace(/\s+/g, ' ').trim() : ''
  if (!nomClient || nomClient.length > 60) fail('STORE_TRANSACTION_INVALID', 'Nom du client obligatoire (60 caractères au plus).')
  const servicePrecise = input.service === 'Autres' && typeof input.servicePrecise === 'string' ? input.servicePrecise.trim() : ''
  if (servicePrecise.length > 40) fail('STORE_TRANSACTION_INVALID', 'Service précisé : 40 caractères au plus.')
  const telephone = typeof input.telephone === 'string' ? input.telephone.replace(/\s+/g, '') : ''
  if (!/^\d{0,15}$/.test(telephone)) fail('STORE_TRANSACTION_INVALID', 'Téléphone : chiffres seulement.')
  const codeTransfert = typeof input.codeTransfert === 'string' ? input.codeTransfert.trim() : ''
  if (codeTransfert.length > 30) fail('STORE_TRANSACTION_INVALID', 'Code du transfert : 30 caractères au plus.')
  return {
    service: input.service,
    ...(servicePrecise ? { servicePrecise } : {}),
    operation: input.operation,
    nomClient,
    ...(telephone ? { telephone } : {}),
    ...(codeTransfert ? { codeTransfert } : {}),
    montant: cleanAmount(input.montant),
    balanceType: input.balanceType,
  }
}

function dateFr(instant = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: STORE_TIME_ZONE }).format(instant)
}

/**
 * La ligne d'une correction attend-elle ses DEUX jambes à la revalidation ?
 *
 * « DIRECTE » VEUT DIRE « PORTAIT SES DEUX JAMBES », PAS « SANS RÈGLEMENT »
 * ────────────────────────────────────────────────────────────────────────
 * La nuance a l'air scolastique ; elle vaut de l'argent. Une ligne validée
 * par `validateDraft` sans mode de règlement NI drapeau — TC-222-31 —
 * n'a jamais posé de jambe de liquidité : elle porte `validatedAt` sans
 * `directValidation`. La rouvrir puis la revalider « en direct » lui en
 * inventerait une, et corriger un montant INCHANGÉ déplacerait les soldes.
 *
 * Les deux formes qui portent bien leurs deux jambes :
 *  — `directValidation` : le bouton « Valider », depuis ce lot ;
 *  — pas de `validatedAt` : les mêmes lignes, écrites par `add` avant lui.
 */
function portaitSesDeuxJambes(history) {
  return !history.paymentMethod && (history.directValidation === true || !history.validatedAt)
}

/**
 * Le brouillon d'une ligne rouverte.
 *
 * Construit par liste blanche, jamais par soustraction : un champ de règlement
 * qui survivrait ferait croire le brouillon réglé, et `updateDraft` le
 * refuserait — le gérant ne pourrait plus le corriger, ce qui est précisément
 * le geste qu'il vient de demander.
 */
function brouillonDeLigneRouverte(history, { historyId, storeId, store, profile, uid, now, direct }) {
  return {
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
    // Née d'une demande d'agent, elle le reste une fois corrigée.
    ...(typeof history.demandeId === 'string' ? { demandeId: history.demandeId } : {}),
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
    reopenedDirect: direct,
    reopenedAt: now,
    reopenedBy: uid,
    updatedAt: now,
  }
}

/**
 * Ce que la validation d'un brouillon donne : les soldes et la ligne d'historique.
 *
 * VALIDATION DIRECTE : le geste du bouton « Valider » du formulaire,
 * rejoué sur un brouillon. Sans mode de règlement il n'y a pas de jambe
 * de règlement à appliquer, mais il y a bien celle que la branche
 * « validée » d'`applyInitialTransactionImpact` pose — la liquidité qui
 * entre pour un dépôt, qui sort pour un retrait.
 *
 * On l'obtient en composant deux primitives éprouvées plutôt qu'en
 * écrivant une troisième arithmétique : défaire la jambe du brouillon
 * (au montant qu'elle avait), puis appliquer l'impact validé (au montant
 * corrigé). Sans `direct`, un `paymentMethod` nul laisse les soldes
 * intacts — c'est le comportement d'origine, que d'autres appels suivent.
 */
function validationDuBrouillon(balances, draft, { amount, paymentMethod, directDemande, storeId, now, validatedAt = now }) {
  const direct = directDemande === true && !paymentMethod
  const nextBalances = paymentMethod
    ? applySettlementImpact(balances, { ...draft, montant: amount }, paymentMethod)
    : direct
      ? applyInitialTransactionImpact(
        reverseInitialTransactionImpact(balances, draft),
        { ...draft, montant: amount, statut: 'Validée' },
      )
      : balances
  // `directValidation` marque la ligne pour que son annulation future
  // défasse les DEUX jambes. Elle porte aussi `validatedAt`, dont la
  // branche d'inversion ne rendrait que celle du brouillon.
  const history = { ...draft, storeId, ...(direct ? { directValidation: true, ...splitLiquiditeSiRetraitDirect(reverseInitialTransactionImpact(balances, draft), { ...draft, montant: amount }) } : {}), statut: paymentMethod ? `${String(draft.type).normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'Depot' ? 'Encaissé' : 'Payé'} par ${paymentMethod}` : 'Validée', paymentMethod, effectiveNetwork: paymentMethod ? mapPaymentMethodToNetwork(paymentMethod) : null, settlementAmount: amount, originalAmount: draft.montant, paidAmount: amount, refundedAmount: 0, remainingAmount: 0, settlementStatus: 'settled', validatedAt, settlementUpdatedAt: now, updatedAt: now }
  return { nextBalances, history }
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

export async function storeTransactionCommandHandler(request, { db, FieldValue, logWriter = write, signalerOxygen = signalerDemandeFermee }) {
  const uid = validateAuthUid(request.auth?.uid)
  const payload = validateInputPayload(request.data, ['action', 'transaction', 'draftId', 'historyId', 'updates', 'paymentMethod', 'amount', 'network', 'balanceType', 'balanceAmount', 'balances', 'note', 'direct', 'expediteur', 'replenishmentId', 'returnId', 'commandeId', 'ageMs', 'demandeId', 'statut', 'flotte', 'dealer', 'transfertsArgent'])
  const action = String(payload.action || '')
  const now = FieldValue.serverTimestamp()
  // L'identifiant qu'une file d'envoi hors ligne donne à une saisie ou à une
  // validation (lot G3a). Rejouée après une réponse perdue, l'opération est
  // reconnue à lui et ne s'applique pas deux fois. Il devient l'identifiant
  // du document créé : la garde ne coûte qu'une lecture, et aucune trace à
  // part qu'il faudrait un jour effacer. Facultatif : sans lui, rien ne change.
  const commandeId = payload.commandeId == null ? null : cleanId(payload.commandeId, 'commandeId')
  // Partie en retard, l'opération garde le jour où elle a eu lieu (lot G4a) et
  // son heure de réception. Voir `instantDeLaCaisse`.
  const faitLe = instantDeLaCaisse(payload.ageMs)
  const recu = faitLe ? { recuLe: now } : {}
  const datation = faitLe ? { date: dateFr(faitLe), createdAt: faitLe, ...recu } : { date: dateFr(), createdAt: now }
  if (ACTIONS_REMB_SIEGE.includes(action) && !SIEGE_REPAYMENT_ENABLED) {
    fail('STORE_TRANSACTION_INVALID', 'Le remboursement au siège est désactivé.')
  }
  if (ACTIONS_TRANSFERT_ARGENT.includes(action) && !MONEY_TRANSFER_ENABLED) {
    fail('STORE_TRANSACTION_INVALID', 'Les transferts d’argent sont désactivés.')
  }

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

    // ─── Les numéros de la boutique (contrat Oxygen, §9) ──────────────────────
    //
    // Décidé par l'utilisateur le 2026-11-17 : la boutique saisit elle-même son
    // numéro flotte et son numéro dealer, depuis son Profil. Le risque est connu
    // et accepté : le compte boutique pourrait mettre une autre SIM là où les
    // agents envoient leur argent. D'où le journal, avec l'avant et l'après.
    // Avant la lecture des soldes : une boutique toute neuve, qui n'en a pas
    // encore, doit pouvoir donner ses numéros.
    if (action === 'updateStoreNumbers') {
      if (profile.role !== 'store_admin') fail('ROLE_FORBIDDEN', 'Seul le compte boutique modifie ses numéros.')
      const saisis = numerosSaisis({ flotte: payload.flotte, dealer: payload.dealer }, STORE_NETWORKS)
      if (!saisis.ok) fail('STORE_TRANSACTION_INVALID', saisis.message)
      const avant = numerosDe(store)
      const apres = numerosDe(saisis)
      if (JSON.stringify(avant) === JSON.stringify(apres)) return { numeros: apres, inchange: true }
      // Un numéro vidé efface son champ : la clé disparaît, jamais `null` ni ''.
      // `numerosModifiesLe` : le patron voit quand (constat SEC-14 de l'audit du
      // 18 novembre), sur la fiche qu'il lit déjà ; le journal, lui, ne lui est
      // pas ouvert.
      const champs = { flotte: saisis.flotte ?? FieldValue.delete(), numerosModifiesLe: now }
      for (const reseau of STORE_NETWORKS) champs[`dealer.${reseau}`] = saisis.dealer[reseau] ?? FieldValue.delete()
      t.update(db.doc(`stores/${storeId}`), champs)
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, avant, apres, createdAt: now })
      return { numeros: apres }
    }

    // ─── Les réglages de la boutique (Profil → Configuration) ────────────────
    //
    // Demandé par l'utilisateur le 2026-11-23 : chaque boutique coche elle-même
    // l'option des transferts d'argent. Comme les numéros : jamais par la file
    // d'envoi, avant la lecture des soldes, journal avec l'avant et l'après.
    if (action === 'updateStoreSettings') {
      if (profile.role !== 'store_admin') fail('ROLE_FORBIDDEN', 'Seul le compte boutique modifie ses réglages.')
      if (typeof payload.transfertsArgent !== 'boolean') fail('STORE_TRANSACTION_INVALID', 'Réglage invalide.')
      const avant = { transfertsArgent: store.transfertsArgent === true }
      const apres = { transfertsArgent: payload.transfertsArgent }
      if (avant.transfertsArgent === apres.transfertsArgent) return { ...apres, inchange: true }
      t.update(db.doc(`stores/${storeId}`), { ...apres, reglagesModifiesLe: now })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, uid, avant, apres, createdAt: now })
      return apres
    }

    const balanceSnap = await t.get(balanceRef)
    if (!balanceSnap.exists) fail('BALANCE_NOT_FOUND', 'Soldes de la boutique introuvables.')
    const balances = normalizeNetworkBalances(balanceSnap.data())

    if (action === 'add') {
      const transaction = cleanTransaction(payload.transaction)
      const collection = PENDING.includes(transaction.statut) ? 'drafts' : 'history'
      const ref = commandeId
        ? db.doc(`clients/${storeId}/${collection}/${commandeId}`)
        : db.collection(`clients/${storeId}/${collection}`).doc()
      // ⚠ AVANT L'IMPACT, PAS APRÈS. Une saisie déjà appliquée peut avoir vidé
      //   le stock qu'elle demandait : recalculée, elle serait refusée pour
      //   « solde insuffisant », et la file d'envoi la croirait perdue.
      if (commandeId && (await t.get(ref)).exists) return { id: ref.id, idempotent: true }
      const nextBalances = applyInitialTransactionImpact(balances, transaction)
      // Une ligne validee d un geste porte les DEUX jambes. On note d ou la
      // liquidite est venue AVANT de l appliquer : apres, l information
      // n existe plus nulle part.
      const splitDirect = VALIDATED.includes(transaction.statut)
        ? splitLiquiditeSiRetraitDirect(balances, transaction)
        : {}
      const data = { ...transaction, storeId, ...(VALIDATED.includes(transaction.statut) ? { directValidation: true, ...splitDirect } : {}), storeName: store.name || profile.storeName || '', operatorId: uid, operatorName: profile.name || '', operatorEmail: profile.email || '', ...datation, updatedAt: now }
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
      const ref = commandeId
        ? db.doc(`clients/${storeId}/history/${commandeId}`)
        : db.collection(`clients/${storeId}/history`).doc()
      if (commandeId && (await t.get(ref)).exists) return { id: ref.id, idempotent: true }
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
        ...datation,
        updatedAt: now,
        validatedAt: faitLe ?? now,
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
      refuserSiRembSiege(old)
      // Une marque sur le brouillon, pas une trace à part : la file n'envoie une
      // modification qu'après la précédente, donc seule la dernière peut revenir.
      if (commandeId && old.derniereCommande === commandeId) return { id: draftId, idempotent: true }
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
          ? { modifications: empilerModification(journal, { avant: Number(old.montant), apres: Number(transaction.montant), uid, nom: profile.name || '', faitLe }) }
          : {}),
        ...(commandeId ? { derniereCommande: commandeId } : {}),
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
      refuserSiRembSiege(old)
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
      const historyRef = commandeId
        ? db.doc(`clients/${storeId}/history/${commandeId}`)
        : db.collection(`clients/${storeId}/history`).doc()
      // Rejouée, la validation trouve sa ligne d'historique déjà écrite et le
      // brouillon déjà parti, dans la même transaction. Si le brouillon est
      // encore là, l'identifiant appartient à une autre ligne : l'écrire
      // l'écraserait.
      if (commandeId && (await t.get(historyRef)).exists) {
        if (snap.exists) fail('IDEMPOTENCY_CONFLICT', 'Cet identifiant de commande est déjà pris par une autre ligne.')
        return { validated: true, historyId: historyRef.id, idempotent: true }
      }
      if (!snap.exists) return { validated: false }
      const draft = snap.data()
      refuserSiRembSiege(draft)
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(draft, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Utilisez le règlement par tranche pour cette transaction.')
      const amount = payload.amount == null ? draft.montant : cleanAmount(payload.amount)
      const paymentMethod = payload.paymentMethod == null ? null : String(payload.paymentMethod)
      if (paymentMethod && !STORE_PAYMENT_METHODS.includes(paymentMethod)) fail('INVALID_PAYMENT_METHOD', 'Méthode de paiement non autorisée.')
      const { nextBalances, history } = validationDuBrouillon(balances, draft, { amount, paymentMethod, directDemande: payload.direct, storeId, now })
      t.set(historyRef, history)
      t.delete(draftRef)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: historyRef.id, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { validated: true, historyId: historyRef.id }
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
      // Renvoyée, ou annulée entre-temps depuis un autre poste : le but est atteint,
      // et le montant n'a été rendu qu'une fois.
      if (commandeId && [DELETED_STATUS, CANCELLED_STATUS].includes(history.statut)) return { trashed: true, historyId, idempotent: true }
      // « annulée », le mot du bouton. Ce refus remonte tel quel dans un toast :
      // le lire « ne peut pas être supprimée » sous un bouton « Annuler »
      // laisserait croire à deux gestes distincts, dont un seul aurait échoué.
      refuserSiIntouchable(history, 'annulée')
      const nextBalances = reverseHistoryTransactionImpact(balances, history)
      t.update(ref, {
        statut: DELETED_STATUS,
        origin: 'history',
        deletedAt: faitLe ?? now,
        ...recu,
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
      const corbeilleRef = commandeId
        ? db.doc(`clients/${storeId}/history/${commandeId}`)
        : db.collection(`clients/${storeId}/history`).doc()
      if (commandeId && (await t.get(corbeilleRef)).exists) return { trashed: true, historyId: corbeilleRef.id, idempotent: true }
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      refuserSiRembSiege(old)
      // Ici le garde-fou large EST le bon : sur un brouillon, ces champs
      // n'apparaissent que si des tranches ont réellement été engagées.
      if (SETTLEMENT_FIELDS.some(field => Object.hasOwn(old, field))) fail('SETTLED_DRAFT_IMMUTABLE', 'Une transaction ayant engagé un règlement ne peut pas être supprimée.')
      const nextBalances = reverseInitialTransactionImpact(balances, old)
      // Le brouillon DÉMÉNAGE dans `history`. C'est ce qui donne au gérant une
      // corbeille unique, triée par date, sans se demander dans quel onglet la
      // ligne a été supprimée — et côté code, l'abonnement temps réel et la
      // pagination de l'historique resservent tels quels.
      t.set(corbeilleRef, {
        ...old,
        statut: DELETED_STATUS,
        origin: 'draft',
        deletedAt: faitLe ?? now,
        ...recu,
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
      const estDirecte = portaitSesDeuxJambes(history)

      const defait = reverseHistoryTransactionImpact(balances, history)
      const nextBalances = applyInitialTransactionImpact(defait, { ...history, statut: 'Non Terminées' })

      const draftRef = db.collection(`clients/${storeId}/drafts`).doc()
      const draft = brouillonDeLigneRouverte(history, { historyId, storeId, store, profile, uid, now, direct: estDirecte })
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

    // ─── La correction d'une ligne validée, d'un seul geste (lot G4a) ───────
    //
    // Ce que `reopenHistory`, `updateDraft` et `validateDraft` font en trois appels,
    // dans une seule transaction. TC-358 compare les deux routes sur chaque sorte
    // de ligne : mêmes soldes, même ligne d'arrivée.
    //
    // POURQUOI UNE COMMANDE DE PLUS
    // Sans réseau, la réouverture ne peut pas précéder le formulaire. Et en trois
    // envois, un refus au deuxième laisserait la ligne dans les non terminées, sans
    // personne devant l'écran pour comprendre pourquoi. Ici, un refus laisse tout
    // en l'état. `reopenHistory` reste pour les applications pas encore rechargées.
    if (action === 'correctHistory') {
      const historyId = cleanId(payload.historyId, 'historyId')
      const nouvelleRef = commandeId
        ? db.doc(`clients/${storeId}/history/${commandeId}`)
        : db.collection(`clients/${storeId}/history`).doc()
      // ⚠ AVANT L'IMPACT, comme pour la saisie : déjà corrigée, la ligne d'origine
      //   n'existe plus, et le stock qu'elle demandait peut être reparti.
      if (commandeId && (await t.get(nouvelleRef)).exists) return { corrected: true, historyId: nouvelleRef.id, idempotent: true }

      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const history = snap.data()
      refuserSiIntouchable(history, 'corrigée')
      const paymentMethod = history.paymentMethod ?? null
      if (paymentMethod && !STORE_PAYMENT_METHODS.includes(paymentMethod)) fail('INVALID_PAYMENT_METHOD', 'Méthode de paiement non autorisée.')

      // Rouvrir : tout défaire, puis reposer la seule jambe du brouillon.
      const direct = portaitSesDeuxJambes(history)
      const brouillon = brouillonDeLigneRouverte(history, { historyId, storeId, store, profile, uid, now, direct })
      const rouverts = applyInitialTransactionImpact(reverseHistoryTransactionImpact(balances, history), { ...history, statut: 'Non Terminées' })

      // Corriger : la jambe du brouillon, au nouveau montant.
      const transaction = cleanTransaction({ ...brouillon, ...payload.updates, statut: 'Non Terminées' })
      const corriges = applyInitialTransactionImpact(reverseInitialTransactionImpact(rouverts, brouillon), transaction)
      const journal = Array.isArray(brouillon.modifications) ? brouillon.modifications : []
      const corrige = {
        ...brouillon,
        ...transaction,
        ...(Number(brouillon.montant) !== Number(transaction.montant)
          ? { modifications: empilerModification(journal, { avant: Number(brouillon.montant), apres: Number(transaction.montant), uid, nom: profile.name || '', faitLe }) }
          : {}),
      }

      // Revalider : le mode d'origine, sans le redemander.
      const { nextBalances, history: ligne } = validationDuBrouillon(corriges, corrige, {
        amount: corrige.montant,
        paymentMethod,
        directDemande: direct,
        storeId,
        now,
        validatedAt: faitLe ?? now,
      })
      t.set(nouvelleRef, { ...ligne, ...recu })
      t.delete(ref)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, newHistoryId: nouvelleRef.id, uid, before: history, after: transaction, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { corrected: true, historyId: nouvelleRef.id, direct }
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
      const ref = commandeId
        ? db.doc(`clients/${storeId}/history/${commandeId}`)
        : db.collection(`clients/${storeId}/history`).doc()
      // ⚠ AVANT LES PLAFONDS : renvoyé après avoir soldé la livraison, le retour se
      //   croirait refusé (« deja solde »), alors qu'il a eu lieu.
      if (commandeId && (await t.get(ref)).exists) return { id: ref.id, idempotent: true }
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
        ...datation,
        updatedAt: now,
        validatedAt: faitLe ?? now,
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
      if (retour.deletedAt) {
        if (commandeId) return { trashed: true, returnId, idempotent: true }
        fail('STORE_TRANSACTION_INVALID', 'Ce retour a deja ete supprime.')
      }

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
        deletedAt: faitLe ?? now,
        ...recu,
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

    // ─── Le remboursement au siège ──────────────────────────────────────────
    //
    // Le siège donne du stock à crédit aux agents la nuit ; l'agent rembourse
    // le lendemain à la boutique, qui envoie l'argent au siège. Une seule
    // réserve bouge par jambe, comme le ravitaillement (rembSiege.js). La ligne
    // attend dans `drafts` tant que tout n'est pas envoyé, puis passe dans
    // `history` sous le même identifiant, comme une non terminée réglée.
    //
    // Les commandes génériques (updateDraft, trashDraft, règlements…) refusent
    // ces lignes : elles ne savent pas en défaire les jambes.

    if (action === 'addSiegeRepayment') {
      const remb = cleanRembSiege(payload.transaction)
      const enAttente = remb.statut === 'Non Terminées'
      const collection = enAttente ? 'drafts' : 'history'
      const ref = commandeId
        ? db.doc(`clients/${storeId}/${collection}/${commandeId}`)
        : db.collection(`clients/${storeId}/${collection}`).doc()
      // ⚠ AVANT L'IMPACT, comme `add` : déjà appliquée, la saisie a peut-être
      //   vidé le stock qu'elle demandait.
      if (commandeId && (await t.get(ref)).exists) return { id: ref.id, idempotent: true }
      const network = STORE_NETWORKS[0]
      const nextBalances = impactSaisie(balances, network, remb)
      const data = {
        ...remb,
        type: TYPE_REMB_SIEGE,
        reseau: network,
        // Validée d'un geste : la caissière a envoyé tout de suite.
        envoyeAuSiege: enAttente ? 0 : remb.montant,
        resteAuSiege: enAttente ? remb.montant : 0,
        envoisSiege: [],
        ...(enAttente ? {} : { directValidation: true, validatedAt: faitLe ?? now }),
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        ...datation,
        updatedAt: now,
      }
      t.set(ref, data)
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, balanceType: remb.balanceType, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id }
    }

    if (action === 'sendToSiege') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const amount = cleanAmount(payload.amount)
      const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const historyRef = db.doc(`clients/${storeId}/history/${draftId}`)
      const snap = await t.get(draftRef)
      if (!snap.exists) {
        // Renvoyée après la tranche qui a soldé la ligne : elle est dans
        // l'historique, et sa tranche avec elle.
        const partie = commandeId ? await t.get(historyRef) : null
        if (partie?.exists && (partie.data().envoisSiege ?? []).some(e => e.id === commandeId)) {
          return { sent: true, resteAuSiege: 0, historyId: draftId, idempotent: true }
        }
        fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      }
      const draft = snap.data()
      if (!estRembSiege(draft)) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n’est pas un remboursement au siège.')
      const envois = Array.isArray(draft.envoisSiege) ? draft.envoisSiege : []
      if (commandeId && envois.some(e => e.id === commandeId)) return { sent: true, resteAuSiege: draft.resteAuSiege, idempotent: true }
      const resteAvant = Number(draft.resteAuSiege) || 0
      if (amount > resteAvant) {
        fail('STORE_TRANSACTION_INVALID', `Montant supérieur au reste à envoyer. Reste : ${resteAvant.toLocaleString('fr-FR')} FCFA`)
      }
      const reste = resteAvant - amount
      // ⚠ LU AVANT TOUTE ÉCRITURE, et seulement quand la ligne part : comme
      //   `addTransactionPayment`, on n'écrase pas une autre ligne d'historique.
      if (reste === 0 && (await t.get(historyRef)).exists) {
        fail('IDEMPOTENCY_CONFLICT', 'Ce numéro de transaction est déjà pris par une autre ligne.')
      }
      const nextBalances = impactEnvoi(balances, draft.reseau || STORE_NETWORKS[0], amount)
      const tranche = { id: commandeId ?? db.collection(`clients/${storeId}/drafts`).doc().id, montant: amount, at: faitLe ?? new Date(), by: uid, byName: profile.name || '' }
      const suivi = {
        envoyeAuSiege: (Number(draft.envoyeAuSiege) || 0) + amount,
        resteAuSiege: reste,
        envoisSiege: [...envois, tranche].slice(-ENVOIS_MAX),
        updatedAt: now,
      }
      if (reste > 0) {
        t.update(draftRef, suivi)
      } else {
        t.set(historyRef, { ...draft, ...suivi, statut: 'Validée', validatedAt: faitLe ?? now, ...recu })
        t.delete(draftRef)
      }
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, amount, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { sent: true, resteAuSiege: reste, ...(reste === 0 ? { historyId: draftId } : {}) }
    }

    if (action === 'updateSiegeRepayment') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      if (!estRembSiege(old)) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n’est pas un remboursement au siège.')
      if (commandeId && old.derniereCommande === commandeId) return { id: draftId, idempotent: true }
      // Comme un dépôt entamé : une tranche est partie, la ligne est figée.
      if ((Number(old.envoyeAuSiege) || 0) > 0) fail('SETTLED_DRAFT_IMMUTABLE', 'Un remboursement déjà envoyé en partie ne se modifie plus.')
      const updates = payload.updates
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) fail('STORE_TRANSACTION_INVALID', 'Modification invalide.')
      const retenus = Object.fromEntries(CHAMPS_REMB_SIEGE_MODIFIABLES.filter(champ => updates[champ] !== undefined).map(champ => [champ, updates[champ]]))
      const apres = cleanRembSiege({
        client: old.client, clientId: old.clientId, code: old.code, montant: old.montant, balanceType: old.balanceType,
        ...retenus,
        statut: 'Non Terminées',
      })
      const nextBalances = impactModification(balances, old.reseau || STORE_NETWORKS[0], old, apres)
      const journal = Array.isArray(old.modifications) ? old.modifications : []
      const montantChange = Number(old.montant) !== apres.montant
      t.update(ref, {
        ...apres,
        resteAuSiege: apres.montant,
        updatedAt: now,
        ...(montantChange ? { modifications: empilerModification(journal, { avant: Number(old.montant), apres: apres.montant, uid, nom: profile.name || '', faitLe }) } : {}),
        ...(commandeId ? { derniereCommande: commandeId } : {}),
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, after: apres, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: draftId }
    }

    // « Ce remboursement n'a pas eu lieu » : TOUTES les jambes sont défaites, à
    // tout moment, y compris les tranches déjà envoyées. C'est aussi le seul
    // chemin pour corriger une tranche mal tapée : annuler, ressaisir, renvoyer.
    if (action === 'trashSiegeRepayment') {
      const surBrouillon = payload.draftId != null
      if (surBrouillon === (payload.historyId != null)) fail('STORE_TRANSACTION_INVALID', 'Indiquez la ligne à annuler.')
      const corbeille = { statut: DELETED_STATUS, deletedAt: faitLe ?? now, ...recu, deletedBy: uid, deletedByName: profile.name || '', updatedAt: now }

      if (surBrouillon) {
        const draftId = cleanId(payload.draftId, 'draftId')
        const corbeilleRef = commandeId
          ? db.doc(`clients/${storeId}/history/${commandeId}`)
          : db.collection(`clients/${storeId}/history`).doc()
        if (commandeId && (await t.get(corbeilleRef)).exists) return { trashed: true, historyId: corbeilleRef.id, idempotent: true }
        const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
        const snap = await t.get(ref)
        if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
        const old = snap.data()
        if (!estRembSiege(old)) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n’est pas un remboursement au siège.')
        const nextBalances = impactAnnulation(balances, old.reseau || STORE_NETWORKS[0], old)
        t.set(corbeilleRef, { ...old, ...corbeille, origin: 'draft' })
        t.delete(ref)
        t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
        t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: corbeilleRef.id, uid, before: old, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
        return { trashed: true, historyId: corbeilleRef.id }
      }

      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const ligne = snap.data()
      if (!estRembSiege(ligne)) fail('STORE_TRANSACTION_INVALID', 'Cette ligne n’est pas un remboursement au siège.')
      if (ligne.statut === DELETED_STATUS) {
        if (commandeId) return { trashed: true, historyId, idempotent: true }
        fail('STORE_TRANSACTION_INVALID', 'Ce remboursement a déjà été annulé.')
      }
      const nextBalances = impactAnnulation(balances, ligne.reseau || STORE_NETWORKS[0], ligne)
      t.update(ref, { ...corbeille, origin: 'history' })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { trashed: true, historyId }
    }

    // ─── Les transferts d'argent (Western Union, Ria, MoneyGram, autres) ─────
    //
    // docs/superpowers/specs/2026-11-23-transferts-argent-design.md. Calqués
    // sur le remboursement au siège : une réserve à la fois, le + d'abord,
    // `commandeId` vérifié avant tout impact. Toujours en non terminée (pas de
    // « Valider », décision de l'utilisateur) ; les tranches passent toujours
    // par le stock. Seule la saisie exige l'option de la boutique : décochée,
    // une boutique doit encore pouvoir fermer ses lignes.

    if (action === 'addMoneyTransfer') {
      if (store.transfertsArgent !== true) fail('STORE_TRANSACTION_INVALID', 'Transferts d’argent non activés pour cette boutique.')
      const operation = cleanTransfertArgent(payload.transaction)
      const ref = commandeId
        ? db.doc(`clients/${storeId}/drafts/${commandeId}`)
        : db.collection(`clients/${storeId}/drafts`).doc()
      // ⚠ AVANT L'IMPACT, comme `add` : déjà appliqué, un retrait a peut-être
      //   vidé la réserve qu'il demandait.
      if (commandeId && (await t.get(ref)).exists) return { id: ref.id, idempotent: true }
      const network = STORE_NETWORKS[0]
      const nextBalances = impactSaisieTransfert(balances, network, operation)
      t.set(ref, {
        ...operation,
        type: TYPE_TRANSFERT_ARGENT,
        reseau: network,
        statut: 'Non Terminées',
        montantTraite: 0,
        resteATraiter: operation.montant,
        tranches: [],
        storeId,
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        ...datation,
        updatedAt: now,
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: ref.id, uid, operation: operation.operation, balanceType: operation.balanceType, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: ref.id }
    }

    if (action === 'settleMoneyTransfer') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const amount = cleanAmount(payload.amount)
      const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const historyRef = db.doc(`clients/${storeId}/history/${draftId}`)
      const snap = await t.get(draftRef)
      if (!snap.exists) {
        // Renvoyée après la tranche qui a soldé la ligne : elle est dans
        // l'historique, et sa tranche avec elle.
        const partie = commandeId ? await t.get(historyRef) : null
        if (partie?.exists && (partie.data().tranches ?? []).some(e => e.id === commandeId)) {
          return { settled: true, resteATraiter: 0, historyId: draftId, idempotent: true }
        }
        fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      }
      const draft = snap.data()
      if (!estTransfertArgent(draft)) fail('STORE_TRANSACTION_INVALID', PAS_UN_TRANSFERT)
      const tranches = Array.isArray(draft.tranches) ? draft.tranches : []
      if (commandeId && tranches.some(e => e.id === commandeId)) return { settled: true, resteATraiter: draft.resteATraiter, idempotent: true }
      const resteAvant = Number(draft.resteATraiter) || 0
      if (amount > resteAvant) {
        fail('STORE_TRANSACTION_INVALID', `Montant supérieur au reste. Reste : ${resteAvant.toLocaleString('fr-FR')} FCFA`)
      }
      const reste = resteAvant - amount
      // ⚠ LU AVANT TOUTE ÉCRITURE, comme `sendToSiege` : on n'écrase pas une
      //   autre ligne d'historique.
      if (reste === 0 && (await t.get(historyRef)).exists) {
        fail('IDEMPOTENCY_CONFLICT', 'Ce numéro de transaction est déjà pris par une autre ligne.')
      }
      const nextBalances = impactTrancheTransfert(balances, draft.reseau || STORE_NETWORKS[0], draft, amount)
      const tranche = { id: commandeId ?? db.collection(`clients/${storeId}/drafts`).doc().id, montant: amount, at: faitLe ?? new Date(), by: uid, byName: profile.name || '' }
      const suivi = {
        montantTraite: (Number(draft.montantTraite) || 0) + amount,
        resteATraiter: reste,
        tranches: [...tranches, tranche].slice(-TRANCHES_MAX),
        updatedAt: now,
      }
      if (reste > 0) {
        t.update(draftRef, suivi)
      } else {
        t.set(historyRef, { ...draft, ...suivi, statut: 'Validée', validatedAt: faitLe ?? now, ...recu })
        t.delete(draftRef)
      }
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, amount, operation: draft.operation, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { settled: true, resteATraiter: reste, ...(reste === 0 ? { historyId: draftId } : {}) }
    }

    if (action === 'updateMoneyTransfer') {
      const draftId = cleanId(payload.draftId, 'draftId')
      const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      const old = snap.data()
      if (!estTransfertArgent(old)) fail('STORE_TRANSACTION_INVALID', PAS_UN_TRANSFERT)
      if (commandeId && old.derniereCommande === commandeId) return { id: draftId, idempotent: true }
      // Comme un dépôt entamé : une tranche est faite, la ligne est figée.
      if ((Number(old.montantTraite) || 0) > 0) fail('SETTLED_DRAFT_IMMUTABLE', 'Une opération déjà traitée en partie ne se modifie plus.')
      const updates = payload.updates
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) fail('STORE_TRANSACTION_INVALID', 'Modification invalide.')
      const retenus = Object.fromEntries(CHAMPS_TRANSFERT_MODIFIABLES.filter(champ => updates[champ] !== undefined).map(champ => [champ, updates[champ]]))
      const apres = cleanTransfertArgent({
        service: old.service, servicePrecise: old.servicePrecise, nomClient: old.nomClient, telephone: old.telephone,
        codeTransfert: old.codeTransfert, montant: old.montant, balanceType: old.balanceType,
        ...retenus,
        operation: old.operation,
      })
      const nextBalances = impactModificationTransfert(balances, old.reseau || STORE_NETWORKS[0], old, apres)
      const journal = Array.isArray(old.modifications) ? old.modifications : []
      const montantChange = Number(old.montant) !== apres.montant
      // Un champ facultatif vidé disparaît de la ligne, jamais une chaîne vide.
      const effaces = Object.fromEntries(['servicePrecise', 'telephone', 'codeTransfert']
        .filter(champ => old[champ] !== undefined && apres[champ] === undefined)
        .map(champ => [champ, FieldValue.delete()]))
      t.update(ref, {
        ...apres,
        ...effaces,
        resteATraiter: apres.montant,
        updatedAt: now,
        ...(montantChange ? { modifications: empilerModification(journal, { avant: Number(old.montant), apres: apres.montant, uid, nom: profile.name || '', faitLe }) } : {}),
        ...(commandeId ? { derniereCommande: commandeId } : {}),
      })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, uid, before: old, after: apres, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { id: draftId }
    }

    // « Cette opération n'a pas eu lieu » : TOUTES les jambes sont défaites, à
    // tout moment, tranches comprises. C'est aussi le seul chemin pour corriger
    // une tranche mal tapée : annuler, ressaisir, retraiter.
    if (action === 'trashMoneyTransfer') {
      const surBrouillon = payload.draftId != null
      if (surBrouillon === (payload.historyId != null)) fail('STORE_TRANSACTION_INVALID', 'Indiquez la ligne à annuler.')
      const corbeille = { statut: DELETED_STATUS, deletedAt: faitLe ?? now, ...recu, deletedBy: uid, deletedByName: profile.name || '', updatedAt: now }

      if (surBrouillon) {
        const draftId = cleanId(payload.draftId, 'draftId')
        const corbeilleRef = commandeId
          ? db.doc(`clients/${storeId}/history/${commandeId}`)
          : db.collection(`clients/${storeId}/history`).doc()
        if (commandeId && (await t.get(corbeilleRef)).exists) return { trashed: true, historyId: corbeilleRef.id, idempotent: true }
        const ref = db.doc(`clients/${storeId}/drafts/${draftId}`)
        const snap = await t.get(ref)
        if (!snap.exists) fail('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
        const old = snap.data()
        if (!estTransfertArgent(old)) fail('STORE_TRANSACTION_INVALID', PAS_UN_TRANSFERT)
        const nextBalances = impactAnnulationTransfert(balances, old.reseau || STORE_NETWORKS[0], old)
        t.set(corbeilleRef, { ...old, ...corbeille, origin: 'draft' })
        t.delete(ref)
        t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
        t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: draftId, historyId: corbeilleRef.id, uid, before: old, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
        return { trashed: true, historyId: corbeilleRef.id }
      }

      const historyId = cleanId(payload.historyId, 'historyId')
      const ref = db.doc(`clients/${storeId}/history/${historyId}`)
      const snap = await t.get(ref)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Transaction introuvable.')
      const ligne = snap.data()
      if (!estTransfertArgent(ligne)) fail('STORE_TRANSACTION_INVALID', PAS_UN_TRANSFERT)
      if (ligne.statut === DELETED_STATUS) {
        if (commandeId) return { trashed: true, historyId, idempotent: true }
        fail('STORE_TRANSACTION_INVALID', 'Cette opération a déjà été annulée.')
      }
      const nextBalances = impactAnnulationTransfert(balances, ligne.reseau || STORE_NETWORKS[0], ligne)
      t.update(ref, { ...corbeille, origin: 'history' })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, historyId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { trashed: true, historyId }
    }

    // ─── Les demandes des agents (contrat Oxygen v4) ─────────────────────────
    //
    // L'agent demande depuis l'app Oxygen ; la caissière répond ici, avec SA
    // session, et jamais par la file d'envoi : une acceptation mise en file
    // pendant que l'agent annule serait refusée après coup, une fois l'argent
    // remis. Accepter crée l'opération SOUS L'IDENTIFIANT DE LA DEMANDE, dans la
    // transaction qui ferme la demande : la trace et l'idempotence d'un coup.
    if (action === 'acceptAgentRequest' || action === 'rejectAgentRequest') {
      const demandeId = cleanId(payload.demandeId, 'demandeId')
      const demandeRef = db.doc(`clients/${storeId}/${COLLECTION_DEMANDES}/${demandeId}`)
      const snap = await t.get(demandeRef)
      if (!snap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Demande introuvable.')
      const demande = snap.data()
      const fermeture = { reponduLe: now, reponduPar: uid }

      if (action === 'rejectAgentRequest') {
        if (demande.etat === ETATS_DEMANDE.REJETEE) return { rejected: true, idempotent: true }
        refuserSiDemandeClose(demande)
        t.update(demandeRef, { etat: ETATS_DEMANDE.REJETEE, ...fermeture })
        t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, demandeId, uid, createdAt: now })
        return { rejected: true }
      }

      const statut = String(payload.statut || '').trim()
      if (![...PENDING, ...VALIDATED].includes(statut)) fail('STORE_TRANSACTION_INVALID', 'Statut initial non autorisé.')
      // Rejouer, c'est redemander le MÊME geste : une réponse perdue en route.
      // Un autre statut vient d'une autre caisse, qui apprend que la demande
      // est prise. Une demande acceptée sans `statutInitial` (avant ce champ)
      // se rejoue comme avant.
      const memeGeste = (demande.statutInitial ?? statut) === statut
      if (demande.etat === ETATS_DEMANDE.VALIDEE && memeGeste) {
        return { accepted: true, operationId: demande.operationId ?? demandeId, idempotent: true }
      }
      refuserSiDemandeClose(demande)

      // La fiche fait foi, pas la copie gardée sur la demande : la caissière
      // valide ce que le CRM sait de l'agent au moment où l'argent bouge.
      const ficheSnap = await t.get(db.doc(`globalClients/${demande.clientId}`))
      if (!ficheSnap.exists) fail('STORE_TRANSACTION_NOT_FOUND', 'Fiche de l’agent introuvable.')
      const fiche = ficheSnap.data()
      const code = codeReseauDeFiche(fiche, demande.reseau)
      if (!code) fail('STORE_TRANSACTION_INVALID', `La fiche de cet agent n’a pas de code ${demande.reseau}.`)

      const transaction = cleanTransaction({
        client: clientDeFiche(demande.clientId, fiche),
        clientId: demande.clientId,
        type: TYPE_DU_SENS[demande.sens],
        reseau: demande.reseau,
        code,
        montant: demande.montant,
        statut,
      })
      const ref = db.doc(`clients/${storeId}/${PENDING.includes(statut) ? 'drafts' : 'history'}/${demandeId}`)
      if ((await t.get(ref)).exists) fail('IDEMPOTENCY_CONFLICT', 'Ce numéro de transaction est déjà pris par une autre ligne.')

      // Un solde insuffisant lève ici : la transaction entière est annulée, et
      // la demande reste en attente (contrat §8, point 2).
      const nextBalances = applyInitialTransactionImpact(balances, transaction)
      const valideeDunGeste = VALIDATED.includes(statut)
      // Datée de sa validation, côté serveur : jamais l'heure du téléphone, ni
      // l'`ageMs` d'une file d'envoi par laquelle ce geste ne passe pas.
      const data = {
        ...transaction,
        storeId,
        ...(valideeDunGeste ? { directValidation: true, ...splitLiquiditeSiRetraitDirect(balances, transaction) } : {}),
        storeName: store.name || profile.storeName || '',
        operatorId: uid,
        operatorName: profile.name || '',
        operatorEmail: profile.email || '',
        date: dateFr(),
        createdAt: now,
        updatedAt: now,
        // La trace de la demande (contrat §4.2). L'identifiant ne suffit pas :
        // une Non terminée, une fois validée ou réglée, part dans l'historique
        // sous un autre identifiant. Ce champ, lui, suit la ligne partout.
        demandeId,
      }
      t.set(ref, data)
      t.update(demandeRef, { etat: ETATS_DEMANDE.VALIDEE, operationId: demandeId, statutInitial: statut, ...fermeture })
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })
      t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), { action, transactionId: demandeId, demandeId, uid, beforeBalances: balances, afterBalances: nextBalances, createdAt: now })
      return { accepted: true, operationId: demandeId, statut }
    }

    fail('STORE_TRANSACTION_INVALID', 'Commande inconnue.')
  })

  logWriter({ severity: 'INFO', event: 'STORE_TRANSACTION_COMMAND', action, actorUid: uid, result: 'success' })

  // La demande vient de se fermer : Oxygen réveille le téléphone de l'agent
  // (contrat v9 §10). Attendu, car Cloud Run gèle l'instance une fois la
  // réponse rendue ; la caissière n'attend pas pour autant, sa carte part dès
  // l'écriture. Un rejeu n'en renvoie pas, et un échec ne coûte à l'agent
  // qu'un tour de relecture : jamais une erreur pour la caissière.
  if ((action === 'acceptAgentRequest' || action === 'rejectAgentRequest') && !result.idempotent) {
    const demandeId = cleanId(payload.demandeId, 'demandeId')
    try {
      await signalerOxygen(demandeId)
    } catch (error) {
      logWriter({ severity: 'WARNING', event: 'OXYGEN_SIGNAL_ECHEC', demandeId, ...(error?.statut ? { statut: error.statut } : { erreur: error?.name || 'Error' }) })
    }
  }
  return result
}
