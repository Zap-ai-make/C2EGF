 # État des lieux — Adaptation du CRM au nouveau client

> Document de synthèse établi le 2026-07-31, à partir d'une analyse complète du code et de
> l'historique git. **Aucune modification de code n'a été effectuée** : ce document recense ce
> qui existe, ce qui est désactivé, et ce qu'il faudra réactiver/configurer pour le nouveau
> client. Le client actuel (TAOFIC AJAGBE) utilise l'application en production et n'est pas
> impacté (le nouveau client aura son propre projet Firebase).

## Contexte

Ce dépôt a été cloné d'un projet d'origine, puis durci (sécurité, qualité, ~100+ tests).
Pour le premier client, plusieurs fonctionnalités ont été **volontairement désactivées** —
essentiellement en bridant des listes côté interface — sans supprimer la logique métier.
Le nouveau client fonctionne sur le même principe mais a besoin de ces fonctionnalités :
**tout est à réactiver, rien n'est à développer** (à l'exception du circuit dealer, voir §3).

Vérification faite dans tout l'historique git (branches `main`, `feature/v2`,
`audit/pre-v2-local`, tous les tags) : il n'existe **aucun commit « avant suppression »** vers
lequel revenir — les fonctionnalités ont été bridées dès le commit initial de ce dépôt. La
réactivation se fait donc en avant, pas par retour git.

---

## 1. Désactivations côté boutique — réactivation triviale (4 constantes UI)

Aucun déploiement Firebase requis : ce sont des listes de données front.

| Fonctionnalité désactivée | Verrou | Ce qui existe derrière |
|---|---|---|
| Cartes réseau (Moov, Telecel, Coris, Sank masquées) | `VISIBLE_NETWORK_CARDS = ['Orange', 'Liquidite']` — `src/components/network/NetworkCardsDrawer.jsx:4` (+ grille CSS pensée pour 2 cartes, ligne 26) | Styles/couleurs des 5 réseaux (`src/constants/networkConfig.js`), soldes initialisés à 0 pour les 5 (`src/context/NetworkConfigContext.jsx:9`), règles prod acceptant les 5 (`firestore.rules:138`) |
| Choix du réseau dans le formulaire de transaction | `NETWORK_OPTIONS = ['Orange']` — `src/utils/constants.js:12` (commentaire d'origine : « peuvent être réactivés ») | Codes agents des 5 réseaux conservés (`NETWORK_CODES` : Orange 000001, Moov 000626, Telecel 000002, Coris 000003, Sank 000004) |
| Méthodes de règlement (remboursements) | `PAYMENT_METHODS = ['Orange Money', 'Cash']` — `src/utils/constants.js:21` | Le backend accepte déjà les 6 : `ALLOWED_METHODS` dans `functions/src/settlements/addTransactionPayment.js:28` et `addTransactionRefund.js:26` |
| Type de transaction **Crédit** | `TRANSACTION_TYPES = [Dépôt, Retrait]` — `src/utils/constants.js:15` | Règles prod acceptent `'Crédit'` (`firestore.rules:81`) ; cycle complet : statut « Remboursé par X », paiements partiels, remboursements, annulations |

## 2. Logique de remboursement inter-réseaux — complète, rien à implémenter

Scénario type : un client prend du stock **Orange** et rembourse via **Moov** ; ou prend un
crédit et rembourse par **Coris**. Ce flux est intégralement câblé, en double (front +
Cloud Functions autoritaires) :

- Le règlement impacte **le réseau de la méthode de paiement**, pas celui d'origine :
  `applySettlementImpact` (`src/utils/financialImpact.js:483` et
  `functions/src/settlements/financialUtils.js:148`). Exemple : crédit pris sur Orange,
  remboursé « Moov Money » → stock Moov crédité.
- Annulation exacte par réseau, y compris paiements partiels multi-réseaux via
  `settlementSummary.netByNetwork` (`src/utils/financialImpact.js:430`).
- Piste d'audit et idempotence conservées (idempotencyKey, statuts
  `Encaissé/Payé/Remboursé par X`).
- Déjà couvert par les tests : `tc-020`, `tc-060`, `tc-061` (données multi-réseaux).

## 3. Circuit dealer/ravitaillement — réseau porté par le profil (serveur + front ✅)

Contrairement à la boutique, le circuit dealer était mono-réseau **côté serveur** (pas seulement
UI). Le nouveau client ayant besoin du dealer multi-réseaux, voici les 8 verrous — **tous levés** :
la couche serveur (règles + functions `dealerRequests`, `closures`, `storeTransfers`) **et** le front
(sélecteur de réseau + inventaire multi-réseaux) dérivent désormais du profil `dealer.networks`
(réseau porté par l'opération, validé ∈ profil, `balances[network]`). Tout est **gardé par
`IS_DEALER_MULTI_NETWORK`** → mono-réseau (TAOFIC) strictement inchangé.

| # | Verrou (avant → après) | Emplacement | État |
|---|---|---|---|
| 1 | `data.network == 'Orange'` → `data.network in profileDealerNetworks()` (bloc généré) | `firestore.rules` | ✅ levé |
| 2 | `VALID_NETWORKS = ['Orange']` → `DEALER_NETWORKS` (profil, injectable) | `functions/src/dealerRequests/shared.js` | ✅ levé |
| 3 | `network` en dur → réseau porté par la demande | `functions/src/dealerRequests/confirmDealerRequest.js` | ✅ levé |
| 4 | `VALID_NETWORK = 'Orange'` → réseau validé ∈ profil | `functions/src/closures/createDealerClosure.js` | ✅ levé |
| 5 | `TRANSFER_NETWORK = 'Orange'` → `resolveTransferNetwork(candidate, profil)` | `functions/src/storeTransfers/shared.js` | ✅ levé |
| 6 | Lecteurs de soldes `balances.Orange` → `balances[network]` | `functions/src/storeTransfers/shared.js` | ✅ levé |
| 7 | `balances: { Orange: … }` → `balances: { [network]: … }` (dépôt partenaire + inventaire) | `functions/src/storeTransfers/*` | ✅ levé |
| 8 | Front figé Orange → sélecteur de réseau + inventaire multi-réseaux (gardés par `IS_DEALER_MULTI_NETWORK`) | `src/constants/dealerConstants.js`, `NewDealerRequest.jsx`, `DealerTransferForm.jsx`, `DealerInventoryBar.jsx`, `AdminDealerInventory.jsx`, `src/utils/dealerInventory.js` | ✅ levé |

Points favorables :

- **Aucune migration de données** : le schéma est déjà une map par réseau
  (`balances.<Réseau>.{stock, liquidite}`), identique au schéma boutique.
- **Filet de tests existant** : TC-034/035 (demandes dealer), TC-044/045 (clôtures),
  TC-067/069/070/072 (transferts, inventaire), plus les tests de règles en émulateur.
- Lever ces verrous nécessite un **déploiement règles + functions**, à faire uniquement sur le
  **nouveau** projet Firebase.

## 4. Rebranding — désormais piloté par le profil (`branding`)

Le nom du produit **dérive du profil client** (`config/clients/<id>.js` → `branding.appName` /
`branding.pwaName`). Un nouveau client ne modifie **aucun fichier front** : il renseigne `branding`
dans son profil. Défauts = « AKAYIS » / « AKAYIS CRM » → TAOFIC strictement inchangé (prouvé par tc-092).

- **Runtime** : `src/constants/branding.js` (`APP_NAME`, `APP_FULL_NAME`) alimente les wordmarks
  (`Layout`, `WorkspaceTopbar`, `AdminLayout`, `DealerLayout`, `AuthSidebar`, dashboards) et le titre
  d'onglet (`App.jsx`).
- **Build-time** : `vite.config.js` résout `branding` depuis `VITE_CLIENT_ID` et l'injecte dans
  `index.html` (title, meta description, apple-mobile-web-app-title) **et** le manifest PWA.

**Reste manuel par client** : remplacer les **images de logo** (`public/akayis-mark.svg`,
`public/pwa-192x192.png`, `public/pwa-512x512.png` — actifs graphiques, pas du texte) ; le nom du
package `akayis-crm` dans `package.json` est cosmétique. Les autres mentions TAOFIC/AKAYIS (tests,
scripts, commentaires) sont sans impact fonctionnel.

## 5. Nouveau projet Firebase — checklist

L'isolation multi-clients est **déjà conçue** : `src/config/clientIsolation.js` namespace
toutes les collections sous `clients/{CLIENT_ID}/…` et préfixe le localStorage, piloté par
`VITE_CLIENT_ID` (modèle prêt dans `.env.example`, qui porte déjà `VITE_CLIENT_ID=nouveau_client`).

1. Créer le projet Firebase + app web ; remplir un `.env` dédié (clés API, project id,
   `VITE_CLIENT_ID` du nouveau client).
2. Ajouter l'alias dans `.firebaserc` (actuel : `default=demo-akayis-test` pour émulateurs,
   `production=taofic-ajagbe`).
3. Déployer `firestore.rules`, `firestore.indexes.json`, functions (runtime Node 22) ; activer
   Auth email/password. App Check recommandé (conclusion d'audit précédente).
4. **Adapter les garde-fous des scripts admin** : `scripts/lib/assertFirebaseProject.mjs:42`
   bloque en dur `taofic-ajagbe`, et `scripts/lib/assertResetProject.mjs:32` le définit comme
   seul projet de production. Le nouveau projet devra y être référencé, sinon aucun script
   admin ne fonctionnera dessus. Ces garde-fous continueront de protéger la prod du client actuel.
5. Piège connu : `firebase deploy` échoue par intermittence (résolution DNS du routeur) —
   contournement : pré-chauffer le cache DNS avant déploiement.

## 6. Provisioning boutiques / comptes / données initiales — outillage existant

Scripts éprouvés lors du lancement du client actuel (`scripts/`) :

| Besoin | Script |
|---|---|
| Créer les boutiques | `seedStores.mjs` |
| Créer les comptes (boutique / gérant / dealer) | `createTechnicalUser.mjs` (+ `verifyTechnicalUser.mjs`, `deleteTechnicalUser.mjs`) |
| Accès temporaire à une boutique | `createTemporaryStoreAccess.mjs` |
| Mots de passe / récupération | `updateAccountPassword.mjs`, `generatePasswordResetLink.mjs` |
| Remise à zéro avant démarrage | `resetDataToZero.mjs` (4 verrous de sécurité + backup vérifiable) |
| Restauration | `restoreFromBackup.mjs`, `restoreDeletedAccount.mjs` |
| Diagnostic | `diagnoseAccount.mjs`, `findClient.mjs`, `inspectPath.mjs` |

Invariants métier à respecter au provisioning :

- **Un seul dealer actif** dans tout le système (vérifié côté serveur,
  `resolveSingleDealer` dans `functions/src/storeTransfers/shared.js`).
- Les soldes réseau s'initialisent automatiquement à 0 au premier login boutique
  (`ensureNetworkBalances`).

## 7. Synthèse des chantiers

| # | Chantier | Ampleur | Déploiement |
|---|---|---|---|
| 1 | Boutique multi-réseaux + Crédit + règlements inter-réseaux | Trivial — 4 constantes UI + grille CSS | Front uniquement |
| 2 | Dealer multi-réseaux | **8/8 faits** — règles + functions + front dérivent du profil (commité, non déployé) ; mono préservé via `IS_DEALER_MULTI_NETWORK` | Règles + Functions sur le nouveau projet |
| 3 | Rebranding | Trivial — ~5 fichiers front | Front uniquement |
| 4 | Nouveau projet Firebase | Configuration + déploiement + garde-fous scripts | Nouveau projet |
| 5 | Provisioning | Scripts existants à exécuter | Nouveau projet |

**Conclusion : c'est une levée de brides, pas du développement.** Toute la logique métier
(5 réseaux, crédits, remboursements croisés, paiements partiels, annulations, audit) est
écrite, testée et durcie. Le processus projet (tests de caractérisation avant tout changement
de comportement, émulateurs uniquement, validation indépendante) s'appliquera à chaque chantier.
