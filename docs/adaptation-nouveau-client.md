# Adaptation du CRM à un nouveau client

> Document initial établi le 2026-07-31, actualisé le 2026-09-24 après la mise en place des profils clients.
> La variation passe désormais par `config/clients/` et ses artefacts générés ; elle ne se fait
> plus en modifiant des constantes dispersées.

## Contexte

Ce dépôt a été cloné d'un projet d'origine, puis durci (sécurité, qualité, ~100+ tests).
Pour le premier client, plusieurs fonctionnalités ont été **volontairement désactivées** —
essentiellement en bridant des listes côté interface — sans supprimer la logique métier.
Chaque nouvelle instance choisit ses fonctionnalités dans son profil. Une capacité déjà présente
peut être activée par configuration ; un besoin absent du pilote reste un chantier à spécifier.

Vérification faite dans tout l'historique git (branches `main`, `feature/v2`,
`audit/pre-v2-local`, tous les tags) : il n'existe **aucun commit « avant suppression »** vers
lequel revenir — les fonctionnalités ont été bridées dès le commit initial de ce dépôt. La
réactivation se fait donc en avant, pas par retour git.

---

## 1. Axes boutique — profil central et enforcement serveur

Modifier `networks.enabled`, `transactions.types` ou `transactions.paymentMethods` exige de
régénérer les règles et la configuration Functions, puis de redéployer les couches concernées.

| Fonctionnalité désactivée | Verrou | Ce qui existe derrière |
|---|---|---|
| Cartes et choix du réseau | `networks.enabled` | Front, règles `profileStoreNetworks()`, Functions `STORE_NETWORKS` |
| Méthodes de règlement | `transactions.paymentMethods` | Front et Functions `STORE_PAYMENT_METHODS` ; une méthode retirée reste utilisable uniquement pour rembourser une tranche historique existante |
| Type de transaction **Crédit** | `transactions.types` | Front et règles `profileTransactionTypes()` |

La visibilité progressive de l'espace boutique se règle avec `storeWorkspace`. Cet axe peut
masquer les demandes dealer, les dettes internes et certains onglets de Transactions ou
d'Historique pendant l'accompagnement des caissières. Il ne coupe aucune capacité métier et ne
demande qu'un nouveau build front : les routes, les données et les contrôles serveur restent en
place pour permettre une réactivation par profil.

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
`IS_DEALER_MULTI_NETWORK`** → les profils mono-réseau, dont C2EGF, conservent leur comportement.

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
dans son profil. Les valeurs par défaut du pilote sont « AKAYIS » / « AKAYIS CRM » (couvert par tc-092).

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

L'isolation entre clients repose d'abord sur **un projet Firebase distinct par instance**.
`VITE_CLIENT_ID` choisit le profil et préfixe le stockage local du navigateur. Dans Firestore,
les données métier d'une boutique vivent notamment sous `clients/{storeId}/…`, tandis que
`users`, `stores` et `globalClients` restent des collections racine : ce chemin n'est pas une
frontière d'isolation entre sociétés.

1. Créer le projet Firebase + app web ; remplir un `.env` dédié (clés API, project id,
   `VITE_CLIENT_ID` du nouveau client).
2. Ajouter l'alias dans `.firebaserc` après vérification humaine (état actuel :
   `default=demo-akayis-test`, `production=c2egf-b0b5a`).
3. Générer puis vérifier les artefacts avant toute décision de déploiement :
   `npm run check:generated`. Le déploiement de `firestore.rules`, des index et des Functions
   reste une opération humaine selon `AGENTS.md`.
4. **Adapter les garde-fous des scripts admin** : `assertFirebaseProject.mjs` bloque C2EGF et
   tout identifiant non `demo-*`. `assertResetProject.mjs` ne reconnaît que `c2egf-b0b5a`
   comme production de cette instance. Un autre projet reste bloqué tant que ces gardes n'ont
   pas été revues explicitement.
5. Avant toute opération sur des données réelles, désigner le responsable de la sauvegarde,
   vérifier la restauration sur une copie et conserver la preuve de cette vérification.

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
| 6 | Visibilité progressive de l'espace boutique | Profil `storeWorkspace` | Front uniquement |

**Conclusion : c'est une levée de brides, pas du développement.** Toute la logique métier
(5 réseaux, crédits, remboursements croisés, paiements partiels, annulations, audit) est
écrite, testée et durcie. Le processus projet (tests de caractérisation avant tout changement
de comportement, émulateurs uniquement, validation indépendante) s'appliquera à chaque chantier.
