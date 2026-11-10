/**
 * Entry point des Cloud Functions V2.
 *
 * Région : us-central1, à côté de la base nam5 ; europe-west1 le temps du passage
 * (lot C1, voir `CALLABLE`).
 *
 * Architecture :
 *   - Les handlers métier (confirm/reject) sont dans ./dealerRequests/.
 *   - Ce fichier initialise Admin SDK et enveloppe les handlers en onCall.
 *   - La conversion DealerRequestError → HttpsError est centralisée dans ./callable.js.
 *
 * Ne pas déployer sans audit de sécurité complet.
 * Utiliser exclusivement les émulateurs pendant l'audit : demo-akayis-test.
 */

import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { write } from 'firebase-functions/logger'
import { wrapCallable } from './callable.js'
import { buildSafeUnexpectedErrorLog, writeSafeErrorLog } from './logging.js'
import { confirmDealerRequestHandler } from './dealerRequests/confirmDealerRequest.js'
import { rejectDealerRequestHandler } from './dealerRequests/rejectDealerRequest.js'
import { createDealerClosureHandler } from './closures/createDealerClosure.js'
import { confirmDealerClosureHandler } from './closures/confirmDealerClosure.js'
import { rejectDealerClosureHandler } from './closures/rejectDealerClosure.js'
import { addTransactionPaymentHandler } from './settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from './settlements/addTransactionRefund.js'
import { createStoreDealerTransferHandler } from './storeTransfers/createStoreDealerTransfer.js'
import { confirmStoreDealerTransferHandler } from './storeTransfers/confirmStoreDealerTransfer.js'
import { rejectStoreDealerTransferHandler } from './storeTransfers/rejectStoreDealerTransfer.js'
import { replenishDealerInventoryHandler } from './storeTransfers/replenishDealerInventory.js'
import { decreaseDealerInventoryHandler } from './storeTransfers/decreaseDealerInventory.js'
import { createPartnerDepositHandler } from './storeTransfers/createPartnerDeposit.js'
import { createStoreCollaborationHandler } from './collaborations/createStoreCollaboration.js'
import { confirmStoreCollaborationHandler } from './collaborations/confirmStoreCollaboration.js'
import { rejectStoreCollaborationHandler } from './collaborations/rejectStoreCollaboration.js'
import { listStoreCollaborationProvidersHandler } from './collaborations/listStoreCollaborationProviders.js'
import { declareInternalDebtSettlementHandler } from './collaborations/declareInternalDebtSettlement.js'
import { confirmInternalDebtSettlementHandler } from './collaborations/confirmInternalDebtSettlement.js'
import { rejectInternalDebtSettlementHandler } from './collaborations/rejectInternalDebtSettlement.js'
import { declareInternalDebtCompensationHandler } from './collaborations/declareInternalDebtCompensation.js'
import { confirmInternalDebtCompensationHandler } from './collaborations/confirmInternalDebtCompensation.js'
import { rejectInternalDebtCompensationHandler } from './collaborations/rejectInternalDebtCompensation.js'
import { storeTransactionCommandHandler } from './storeTransactions/storeTransactionCommand.js'
import { listOutstandingDraftsHandler } from './dealerMetrics/listOutstandingDrafts.js'
import { listClientHistoryHandler } from './clients/listClientHistory.js'
import { majAnnuaireClientsHandler, reconstruireAnnuaireClientsHandler } from './clients/annuaireClients.js'
import { creerBoutiqueHandler } from './boutiques/creerBoutique.js'

// Garde idempotente : évite "App named '[DEFAULT]' already exists" lors des imports
// dans les tests d'intégration (TC-036) qui s'exécutent après TC-035 dans le même processus.
if (!getApps().length) initializeApp()
const db = getFirestore()
const deps = { db, FieldValue }

/**
 * Les options communes des 26 callables.
 *
 * POURQUOI UN PLAFOND D'INSTANCES
 * ──────────────────────────────
 * Sans `maxInstances`, une function de 2e génération peut monter à 100 instances.
 * Multiplié par 23 callables et un vCPU chacune, cela réserve 2 300 vCPU dans la
 * région — au-delà du quota d'un projet neuf. Trois functions ont échoué à se
 * créer pour cette raison au premier déploiement, avec un message qui ne parle
 * que de CPU et jamais d'instances.
 *
 * Mais la vraie raison n'est pas le quota, c'est LA FACTURE. Sur un plan Blaze,
 * un plafond absent signifie qu'un bug, une boucle de réessai côté client ou un
 * appel répété peuvent ouvrir cent conteneurs et les faire payer. Ce produit sert
 * une poignée de boutiques : trois instances simultanées par callable sont déjà
 * très au-dessus du besoin, et bornent le pire des cas.
 *
 * POURQUOI TROIS, ET PLUS DIX (09/2026)
 * ─────────────────────────────────────
 * À dix, les 23 callables réservaient 230 vCPU dans la région. Mettre à jour un
 * seul service fait COEXISTER l'ancienne révision et la neuve le temps du
 * basculement : le pic montait à 240, au-dessus du quota du projet. Le
 * déploiement est devenu impossible — y compris function par function, y compris
 * une seule à la fois. Le plafond n'était plus une protection, c'était un mur.
 *
 * À trois, la réserve tombe à 69 vCPU et le pic d'un basculement à 72. La marge
 * redevient large, et chaque service redéployé en libère sept au passage.
 *
 * ⚠ Ce n'est PAS la vraie réponse si le nombre de callables doit encore croître.
 *   La vraie réponse est une augmentation du quota Cloud Run
 *   (« Total CPU allocation, per project per region », europe-west1). Baisser le
 *   plafond achète de la marge ; il ne repousse pas le mur indéfiniment.
 *
 * LA RÉGION : À CÔTÉ DE LA BASE (lot C1, docs/rester-dans-le-quota-gratuit.md §C1)
 * ──────────────────────────────────────────────────────────────────────────────
 * La base est en nam5 (us-central1 + us-central2). Depuis europe-west1, chaque
 * lecture traversait l'Atlantique, en série : quatre à cinq allers-retours d'une
 * centaine de millisecondes par appel, que Cloud Run facture à 1 vCPU. À côté de la
 * base, quelques millisecondes. Depuis le lot H, la caissière n'attend plus le
 * réseau : les ~100 ms de plus entre l'Afrique de l'Ouest et l'Iowa ne se voient
 * pas, et un geste en ligne y gagne encore, puisqu'il économise les traversées.
 *
 * ⚠ LES DEUX RÉGIONS LE TEMPS DU PASSAGE. Une application pas encore rechargée
 *   appelle europe-west1, et un poste resté hors ligne peut garder l'ancienne
 *   version plusieurs jours. On retire europe-west1 une semaine après le passage
 *   du front. Le plafond vaut par région : 26 callables × 3 = 78 vCPU chacune.
 *
 * Un seul objet plutôt que la même accolade recopiée vingt-six fois : le jour
 * où la région ou le plafond change, il change à UN endroit. TC-036 [WRA-08] et
 * [WRA-09] vérifient que tous les callables les portent.
 */
const CALLABLE = Object.freeze({
  region: ['europe-west1', 'us-central1'],
  enforceAppCheck: false,
  maxInstances: 3,
})

export const confirmDealerRequest = onCall(
  CALLABLE,
  wrapCallable(confirmDealerRequestHandler, deps)
)

export const rejectDealerRequest = onCall(
  CALLABLE,
  wrapCallable(rejectDealerRequestHandler, deps)
)

export const createDealerClosure = onCall(
  CALLABLE,
  wrapCallable(createDealerClosureHandler, deps)
)

export const confirmDealerClosure = onCall(
  CALLABLE,
  wrapCallable(confirmDealerClosureHandler, deps)
)

export const rejectDealerClosure = onCall(
  CALLABLE,
  wrapCallable(rejectDealerClosureHandler, deps)
)

export const addTransactionPayment = onCall(
  CALLABLE,
  wrapCallable(addTransactionPaymentHandler, deps)
)

export const addTransactionRefund = onCall(
  CALLABLE,
  wrapCallable(addTransactionRefundHandler, deps)
)

export const storeTransactionCommand = onCall(
  CALLABLE,
  wrapCallable(storeTransactionCommandHandler, deps)
)

export const createStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(createStoreDealerTransferHandler, deps)
)

export const confirmStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(confirmStoreDealerTransferHandler, deps)
)

export const rejectStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(rejectStoreDealerTransferHandler, deps)
)

export const replenishDealerInventory = onCall(
  CALLABLE,
  wrapCallable(replenishDealerInventoryHandler, deps)
)

export const decreaseDealerInventory = onCall(
  CALLABLE,
  wrapCallable(decreaseDealerInventoryHandler, deps)
)

export const createPartnerDeposit = onCall(
  CALLABLE,
  wrapCallable(createPartnerDepositHandler, deps)
)

export const listOutstandingDrafts = onCall(
  CALLABLE,
  wrapCallable(listOutstandingDraftsHandler, deps)
)

// L'historique nominatif d'un agent, toutes boutiques confondues. Le dealer en
// est refusé : les règles ne lui donnent ailleurs qu'un agrégat sans identité.
export const listClientHistory = onCall(
  CALLABLE,
  wrapCallable(listClientHistoryHandler, deps)
)

// ── Collaborations inter-boutiques ──────────────────────────────────────────
// Une boutique à court de stock fait exécuter l'opération par une consœur ; la
// contrepartie devient une dette interne. Toute la mécanique financière est dans
// confirmStoreCollaboration : la création n'engage aucun solde.

export const createStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(createStoreCollaborationHandler, deps)
)

export const confirmStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(confirmStoreCollaborationHandler, deps)
)

export const rejectStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(rejectStoreCollaborationHandler, deps)
)

export const listStoreCollaborationProviders = onCall(
  CALLABLE,
  wrapCallable(listStoreCollaborationProvidersHandler, deps)
)

// ── Dettes internes : remboursement par tranches ────────────────────────────
// La DÉBITRICE déclare (n'impute rien, réserve du montant) ; la CRÉANCIÈRE
// confirme (impute, et déplace du float si la méthode est du Mobile Money) ou
// rejette (libère la réservation, dette intacte).

export const declareInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(declareInternalDebtSettlementHandler, deps)
)

export const confirmInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(confirmInternalDebtSettlementHandler, deps)
)

export const rejectInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(rejectInternalDebtSettlementHandler, deps)
)

// ── Dettes internes : compensation ──────────────────────────────────────────
// Solder une dette D1 (A→B) contre la dette opposée D2 (B→A). Aucun float ne
// bouge : deux créances s'annulent. La confirmation impute les DEUX dettes et
// écrit une tranche miroir sous D2.

export const declareInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(declareInternalDebtCompensationHandler, deps)
)

export const confirmInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(confirmInternalDebtCompensationHandler, deps)
)

export const rejectInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(rejectInternalDebtCompensationHandler, deps)
)

// ── Création d'une boutique par le patron ───────────────────────────────────
// Le compte de connexion, la fiche et le profil en un geste, au lieu de la
// console Firebase.
//
// ⚠ us-central1 SEULEMENT. Elle naît après le passage du lot C1 : aucune
//   application ne l'a jamais appelée en europe-west1, et une création de plus
//   dans cette région serait une chance de plus de buter sur le quota.
// ⚠ UNE INSTANCE, ET 1/6 DE vCPU (`gcf_gen1`, 256 Mio). Le quota régional compte
//   les instances existantes ; celle-ci sert quelques fois par mois et ne doit
//   presque rien y peser (docs/deployer-les-functions.md §5).

export const creerBoutique = onCall(
  { ...CALLABLE, region: 'us-central1', maxInstances: 1, cpu: 'gcf_gen1' },
  wrapCallable(creerBoutiqueHandler, { db, FieldValue, auth: getAuth() })
)

// ── Annuaire des clients ────────────────────────────────────────────────────
// La base clients en 64 tranches : un chargement complet coûte 64 lectures au
// lieu de ~15 700 (docs/rester-dans-le-quota-gratuit.md §A1). Ce ne sont pas
// des callables : le navigateur ne les appelle jamais.
//
// ⚠ us-central1, ET PAS europe-west1. La base est en nam5, et Eventarc n'accepte
//   pas de multi-région pour un déclencheur Firestore : nam5 se déclenche
//   depuis us-central1. Ailleurs, la function ne recevrait aucun événement.
//   Le quota vCPU de cette région est distinct de celui d'europe-west1.

const ANNUAIRE = Object.freeze({ region: 'us-central1', maxInstances: 3 })
const depsAnnuaire = { db, FieldValue, FieldPath }

export const majAnnuaireClients = onDocumentWritten(
  { ...ANNUAIRE, document: 'globalClients/{clientId}' },
  (event) => majAnnuaireClientsHandler(event, depsAnnuaire)
)

// Le premier remplissage, puis toute réparation. Une décision humaine :
//   gcloud functions call reconstruireAnnuaireClients --gen2 --region=us-central1
// ⚠ `invoker: 'private'` : seuls les comptes IAM du projet peuvent l'appeler.
//   Publique, n'importe qui la déclencherait en boucle — ~15 700 lectures
//   facturées par appel (TC-036 [WRA-11]).
export const reconstruireAnnuaireClients = onRequest(
  { ...ANNUAIRE, maxInstances: 1, invoker: 'private', timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ erreur: 'POST attendu.' })
      return
    }
    try {
      res.json(await reconstruireAnnuaireClientsHandler(depsAnnuaire))
    } catch (err) {
      try {
        writeSafeErrorLog(write, buildSafeUnexpectedErrorLog({ action: 'reconstruireAnnuaireClients', error: err }))
      } catch {
        // Le journal ne doit jamais remplacer la réponse.
      }
      res.status(500).json({ erreur: 'La reconstruction a échoué.' })
    }
  }
)
