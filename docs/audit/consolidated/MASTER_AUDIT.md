# MASTER AUDIT — AKAYIS CRM PRÉ-V2

Date : 2026-06-17
Branche : `audit/pre-v2-local`
Mode : lecture statique du code, vérification directe des findings CRITIQUE/ÉLEVÉ.
Sources consolidées : `docs/audit/claude/CLAUDE_AUDIT.md`, `docs/audit/codex/CODEX_AUDIT.md`, `docs/audit/consolidated/CLAUDE_REVIEW_OF_CODEX.md`, `docs/audit/consolidated/CODEX_REVIEW_OF_CLAUDE.md`.
Garanties : aucun fichier source modifié, aucun script administratif exécuté, aucun accès Firebase production, aucun déploiement, aucun commit, aucun push.

---

## 1. Résumé exécutif

AKAYIS CRM est une SPA React 19 / Vite 7 / PWA connectée à Firebase Auth et Firestore. Le « backend » effectif est constitué des règles Firestore (`firestore.rules`) et de scripts Firebase Admin locaux — aucune Cloud Function applicative n'existe (le dossier `functions/` ne contient que `node_modules`).

État global : **fonctionnel mais non prêt pour une V2**. Le niveau de risque actuel est **ÉLEVÉ**, dominé par des défauts de sécurité des règles Firestore (isolation inter-boutiques) et d'intégrité financière (suppression silencieuse de l'historique, soldes sans schéma). Le projet ne contient **aucun test automatisé**, ce qui rend toute correction métier risquée tant qu'un filet de caractérisation n'existe pas.

Recommandation principale : **ne pas démarrer la V2 avant d'avoir (1) écrit des tests de caractérisation, (2) corrigé l'isolation des boutiques dans `firestore.rules`, (3) rendu l'historique financier non supprimable silencieusement.** Les deux audits indépendants (Claude et Codex) convergent sur cet ordre. Plusieurs corrections sont conditionnées par des décisions métier (section 5) qui doivent être tranchées en amont.

---

## 2. État actuel de la base de code

**Architecture.** SPA React montée en `StrictMode` (`src/main.jsx`), routée par React Router v7 (`src/App.jsx`). Toutes les routes (`/`, `/clients`, `/transactions`, `/historique`, `/formulaire`, `/profil`) sont protégées par `ProtectedRoute`. Aucune route 404. Arbre de contextes : `AuthProvider → ThemeProvider → NetworkConfigProvider → ClientsProvider → TransactionsProvider → ErrorBoundary → AppContent`.

**Stack confirmée.** React 19.1.1, Vite 7 + plugin SWC, React Router DOM 7, Firebase client 12.2.1, `firebase-admin` 13.10.0 (scripts Node uniquement), Tailwind v4, Recharts, xlsx 0.18.5, vite-plugin-pwa. Intégration externe : webhook n8n (`VITE_N8N_WEBHOOK_URL`).

**Volume de code.** `src/services/firestore.js` est un singleton monolithique (~1 321 lignes : CRUD, cache TTL, pool de listeners, transactions atomiques, calcul des soldes, migration localStorage). `TransactionForm.jsx` ~628 lignes.

**Modèle Firestore.**
- Racine : `users`, `stores`, `globalClients`.
- Par boutique : `clients/{storeId}/{drafts|history|networkBalances|sessions|auditLogs}`.
- `resolveCollectionPath` (`src/services/firestore.js:88-102`) maintient `users`, `stores`, `globalClients` à la racine et préfixe les autres par `clients/{activeStore.id}/`.

**État des tests.** Aucun. `package.json:6-20` ne déclare que `lint`, `build`, `dev`, `preview` et des scripts admin. Aucun fichier `*.test.*` / `*.spec.*`, aucune dépendance `@firebase/rules-unit-testing` ni runner.

**Dettes connues confirmées.** Service monolithique (QUA-001), `getDocument` via requête `where('__name__')` au lieu de `getDoc` (QUA-007, `firestore.js:301-302`), valeurs UTF-8 corrompues dans les règles (SEC-005/006), API Firestore ancienne `enableMultiTabIndexedDbPersistence` (SEC-009), `firebase-admin` en `dependencies` (SEC-004), fichiers potentiellement non référencés (QUA-004/005, AKY-FAIBLE-011).

---

## 3. Findings consolidés

### 3.1 Sécurité (MASTER-SEC-XXX)

---
### [MASTER-SEC-001] Création de profil `users/{uid}` avec `storeId` arbitraire (escalade inter-boutiques)
**Sévérité :** CRITIQUE
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude ABSENT (mentionné en prose section 2.b) | Codex AKY-CRIT-001
**Fichiers :** `firestore.rules:87-92` (création), `firestore.rules:13-22` (`hasProfile`, `isStoreMember`)
**Symbole :** `match /users/{userId}` → `allow create`, `profile()`, `isStoreMember`
**Preuve :**
```
87  allow create: if signedIn() &&
88    request.auth.uid == userId &&
89    request.resource.data.role == 'store_admin' &&
90    request.resource.data.active == true &&
91    request.resource.data.storeId is string &&
92    request.resource.data.storeName is string;
```
Aucune vérification que `stores/{storeId}` existe ni que `stores/{storeId}.adminUid == request.auth.uid`. `isStoreMember(storeId)` (`:20-22`) fait ensuite entièrement confiance à `profile().storeId`.
**Scénario concret :** un compte Auth nouvellement créé écrit son `users/{uid}` avec le `storeId` d'une boutique cible connue, puis lit/écrit `clients/{storeId}/drafts`, `history`, `networkBalances`, `auditLogs(read)` de cette boutique.
**Impact :** vecteur racine d'escalade inter-boutiques. Accès complet aux données financières et PII d'une autre boutique.
**Test préalable obligatoire :** émulateur Rules, boutiques A/B. L'utilisateur B crée `users/{uidB}` avec `storeId=A`, puis tente `get/list/create/update` sur `clients/A/history` et `clients/A/networkBalances/current`. Le test doit d'abord capturer le comportement actuel (acceptation) en rouge.
**Correction envisagée :** exiger lors de la création de `users` que `stores/{storeId}` existe et que `get(stores/$(storeId)).data.adminUid == request.auth.uid` ; à terme onboarding par invitation/Admin SDK ou custom claim. À NE PAS appliquer sans décision métier (cf. décision D1).
**Dépendances :** couplé à MASTER-SEC-005 (auto-enrôlement). Doit être corrigé avant ou avec MASTER-SEC-002.
**Lot recommandé :** Lot 1

---
### [MASTER-SEC-002] `globalClients` : read / update / delete inter-boutiques
**Sévérité :** CRITIQUE
**Confiance :** ÉLEVÉE
**Statut :** confirmé (volet partage = décision métier requise)
**Identifiants associés :** Claude SEC-001 (read uniquement) | Codex AKY-CRIT-002
**Fichiers :** `firestore.rules:97-109` ; mapping `CLIENTS → globalClients` dans `src/constants/firestoreConstants.js`
**Symbole :** `match /globalClients/{clientId}` → `allow read`, `allow update`, `allow delete`
**Preuve :**
```
98   allow read: if hasProfile();
104  allow update: if hasProfile() &&
105    validClient(request.resource.data) &&
106    request.resource.data.registeredStoreId == resource.data.registeredStoreId;
108  allow delete: if hasProfile();
```
`read` ouvert à tout profil actif ; `delete` ouvert à tout profil actif ; `update` interdit seulement de changer `registeredStoreId` mais autorise une boutique B à modifier `nom/prenom/numeroPersonnel` d'un client de la boutique A.
**Scénario concret :** un utilisateur de la boutique B liste, modifie ou supprime un client enregistré par la boutique A via l'API Firestore.
**Impact :** fuite PII inter-boutiques, corruption et suppression de clients d'autres boutiques. Violation du secret commercial.
**Test préalable obligatoire :** émulateur, client `registeredStoreId=A`. Vérifier qu'un utilisateur B peut aujourd'hui `read/update/delete` ce document (capture du comportement actuel), puis vérifier le refus après correction.
**Correction envisagée :** limiter `read/update/delete` à `resource.data.registeredStoreId == profile().storeId`. ⚠️ Vérifier que les requêtes applicatives existantes (recherche, export) fonctionnent avec ce filtre. Si le partage réseau est volontaire, conserver `read` mais restreindre `update/delete` — cf. décision D2.
**Dépendances :** dépend de MASTER-SEC-001 (sinon le filtre par `profile().storeId` reste contournable par un profil falsifié).
**Lot recommandé :** Lot 1

---
### [MASTER-SEC-003] Suppression de l'historique financier autorisée (perte de piste d'audit)
**Sévérité :** CRITIQUE (frontière ÉLEVÉ — voir Divergences)
**Confiance :** ÉLEVÉE
**Statut :** confirmé (modalité = décision métier requise)
**Identifiants associés :** Claude SEC-002 | Codex AKY-ELEV-003
**Fichiers :** `firestore.rules:134` (history.delete), `firestore.rules:122` (drafts.delete), `firestore.rules:149-152` (auditLogs write:false) ; `src/context/transactions.jsx:184-194` ; `src/services/firestore.js:1098-1100`
**Symbole :** `allow delete` (history/drafts), `deleteTransaction`, `deleteFromHistory`
**Preuve :**
```
firestore.rules:134   allow delete: if isStoreMember(storeId);   // history
firestore.rules:151   allow write: if false;                     // auditLogs
src/services/firestore.js:1098-1100  deleteFromHistory → deleteDocument(HISTORY, historyId)
```
`auditLogs` est en `write: if false` : aucune trace n'est écrite par l'application avant suppression.
**Scénario concret :** un membre de boutique supprime une transaction validée litigieuse via l'UI, sans aucune trace.
**Impact :** destruction de la piste d'audit financière. Violation directe de la règle CLAUDE.md « toute opération financière doit préserver une piste d'audit ». Risque comptable et légal.
**Test préalable obligatoire :** émulateur, créer une transaction validée, la supprimer avec les droits d'un membre, vérifier l'absence de trace dans `auditLogs` et `history` (capture actuelle), puis le refus après correction.
**Correction envisagée :** passer `history.delete` à `if false`. Si une correction métier est nécessaire, introduire une annulation immuable (statut `Annulée`, `cancelledAt`, `cancelledBy`, justification) écrite atomiquement avec un `auditLog`. Encadrer `drafts.delete`. UI et règles dans des sous-lots distincts (pas de mélange refactor/comportement). Cf. décision D3.
**Dépendances :** neutralise aussi MASTER-SEC-004.
**Lot recommandé :** Lot 2

---
### [MASTER-SEC-004] `deleteFromHistory` sans compensation des soldes réseau (incohérence comptable)
**Sévérité :** ÉLEVÉ
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude ABSENT | Codex AKY-ELEV-005
**Fichiers :** `src/services/firestore.js:1098-1100` ; à comparer avec `validateTransaction` / `addTransaction` / `setNetworkBalance` (qui modifient `networkBalances` via `runTransaction`)
**Symbole :** `deleteFromHistory`
**Preuve :**
```js
async deleteFromHistory(historyId) {
  return this.deleteDocument(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, historyId)
}
```
Aucune logique de compensation des soldes.
**Scénario concret :** suppression d'une transaction validée ayant impacté `networkBalances/current` → les soldes restent figés à leur valeur post-transaction.
**Impact :** divergence définitive entre l'historique financier et les soldes courants. Conséquence comptable concrète, distincte de la perte de piste d'audit.
**Test préalable obligatoire :** émulateur, créer une transaction validée, noter `networkBalances/current`, supprimer l'entrée `history`, comparer les soldes.
**Correction envisagée :** bloquer la suppression (résolu par MASTER-SEC-003). Si une annulation métier est introduite, passer par une opération inverse transactionnelle (`runTransaction`) auditée.
**Dépendances :** résolu par MASTER-SEC-003.
**Lot recommandé :** Lot 2

---
### [MASTER-SEC-005] Auto-enrôlement public de boutique en production
**Sévérité :** ÉLEVÉ
**Confiance :** ÉLEVÉE
**Statut :** décision métier requise
**Identifiants associés :** Claude ABSENT (flux décrit section 2.a) | Codex AKY-ELEV-006
**Fichiers :** `src/context/AuthContext.jsx:95-141` (signup) ; `src/components/auth/SignInForm.jsx:152-166` ; `firestore.rules:71-76` (stores.create) ; `firestore.rules:87-92` (users.create)
**Symbole :** `signup`, bouton « Créer un compte boutique », `stores.create`, `users.create`
**Preuve :**
```
src/context/AuthContext.jsx:107  createUserWithEmailAndPassword(...)
src/context/AuthContext.jsx:131-134  batch.set(stores/{storeId}) + batch.set(users/{uid})
firestore.rules:71-76  allow create (stores) if signedIn() && adminUid == auth.uid
```
**Scénario concret :** une personne externe crée une boutique active sans validation administrative.
**Impact :** abus de comptes, données parasites, surface d'attaque élargie. Combiné à MASTER-SEC-001, l'attaquant obtient un compte légitime puis pivote vers une autre boutique.
**Test préalable obligatoire :** émulateur, créer un compte depuis l'UI, vérifier la création de `stores/{id}` et `users/{uid}` sans approbation.
**Correction envisagée :** désactiver l'inscription publique en production ou la remplacer par invitation/Admin. **Décision métier D1 obligatoire** : l'auto-enrôlement est-il voulu ?
**Dépendances :** conditionne la sévérité de MASTER-SEC-001.
**Lot recommandé :** Lot 1 (décision) puis Lot 6 (mise en œuvre signup)

---
### [MASTER-SEC-006] `networkBalances` sans schéma strict ni rôle
**Sévérité :** ÉLEVÉ (sévérité réelle MOYEN-ÉLEVÉ selon contexte)
**Confiance :** ÉLEVÉE
**Statut :** confirmé (modalité = décision métier requise)
**Identifiants associés :** Claude ABSENT (SEC-008 ne couvre que le localStorage) | Codex AKY-ELEV-004
**Fichiers :** `firestore.rules:137-143` ; `src/components/network/NetworkCard.jsx:52-67` ; `src/services/firestore.js` (`setNetworkBalance`, ~825-844)
**Symbole :** `networkBalances/current`, `saveAmount`, `setNetworkBalance`
**Preuve :**
```
firestore.rules:139-141  allow create, update: if isStoreMember(storeId) &&
    balanceId == 'current' && request.resource.data.balances is map;
```
La règle ne valide que `balances is map` : aucun schéma de réseaux/champs, aucun rôle. `setNetworkBalance` clampe à `Math.max(0, ...)` côté applicatif mais sans allowlist de réseaux.
**Scénario concret :** un membre ajuste stock/liquidité hors transaction, ou injecte via l'API une map `balances` arbitraire (réseau inconnu, champ inattendu) que les règles acceptent.
**Impact :** soldes financiers non fiables, écarts non justifiés, absence d'audit.
**Test préalable obligatoire :** émulateur, écrire `networkBalances/current` avec un réseau arbitraire et un montant incohérent ; vérifier l'acceptation actuelle, puis le refus après schéma.
**Correction envisagée :** valider le schéma complet (allowlist de réseaux, champs `stock`/`liquidite` numériques), réserver l'édition manuelle à un rôle explicite, journaliser toute correction. Cf. décision D4.
**Dépendances :** aucune bloquante ; indépendant des Lots 1-2.
**Lot recommandé :** Lot 3A

---
### [MASTER-SEC-007] Valeurs UTF-8 corrompues dans les règles (types/statuts)
**Sévérité :** ÉLEVÉ (types) / MOYEN (statuts)
**Confiance :** ÉLEVÉE
**Statut :** confirmé (vérification des données existantes requise)
**Identifiants associés :** Claude SEC-005 / SEC-006 | Codex ABSENT (noté en « Limites »)
**Fichiers :** `firestore.rules:37` (types), `firestore.rules:47-67` (statuts)
**Symbole :** `validTransaction`, `validStatus`, `isPendingStatus`
**Preuve :**
```
37  data.type in ['Dépôt', 'Depot', 'Retrait', 'Crédit', 'Credit', 'DÃ©pÃ´t', 'CrÃ©dit']
49-60  'Non TerminÃ©es', 'ValidÃ©e', 'RemboursÃ©e', 'AnnulÃ©e'
```
Les règles acceptent en écriture des valeurs à encodage corrompu en plus des valeurs correctes.
**Scénario concret :** un client mal configuré écrit `type: 'DÃ©pÃ´t'` ; la règle l'accepte.
**Impact :** cohérence des données compromise — types/statuts invalides potentiellement acceptés.
**Test préalable obligatoire :** émulateur, tenter d'écrire un document avec `type: 'DÃ©pÃ´t'` / `statut: 'ValidÃ©e'` et vérifier l'acceptation. **Avant nettoyage**, vérifier qu'aucun document de production existant ne porte déjà ces valeurs (sinon leurs `update` seraient bloqués).
**Correction envisagée :** retirer les valeurs corrompues après confirmation des données existantes, et garantir un déploiement des règles en UTF-8. Lot isolé et testé.
**Dépendances :** dépend de la décision D7 (existe-t-il des données corrompues ?).
**Lot recommandé :** Lot 3B (encodage)

---
### [MASTER-SEC-008] Rollback du compte Auth orphelin limité à `permission-denied`
**Sévérité :** MOYEN
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude SEC-007 | Codex ABSENT
**Fichiers :** `src/context/AuthContext.jsx:142-150`
**Symbole :** bloc `catch` de `signup`
**Preuve :**
```js
const createdUser = auth.currentUser
if (createdUser && error?.code?.startsWith('permission-denied')) {
  try { await deleteUser(createdUser) } catch (deleteError) { ... }
}
```
Le rollback ne se déclenche que pour `permission-denied`.
**Scénario concret :** coupure réseau ou erreur quota après `createUserWithEmailAndPassword` et pendant `batch.commit()` → compte Auth créé sans profil Firestore.
**Impact :** comptes orphelins inutilisables (« Compte non rattaché à une boutique »), intervention manuelle nécessaire.
**Test préalable obligatoire :** émulateur, simuler une erreur après création Auth (autre que `permission-denied`) ; vérifier que le compte reste orphelin (comportement actuel).
**Correction envisagée :** tenter `deleteUser` pour toute erreur, pas seulement `permission-denied`. Lot applicatif isolé.
**Dépendances :** aucune.
**Lot recommandé :** Lot 6

---
### [MASTER-SEC-009] Scripts Firebase Admin pouvant cibler la production
**Sévérité :** CRITIQUE (`deleteExistingAccounts`) / ÉLEVÉ (`createTemporaryStoreAccess`, `generatePasswordResetLink`, `updateAccountPassword`, `seedStores`) / MOYEN (`testClientLogin`) / FAIBLE (`diagnoseAccount`, lecture seule) / NUL (`compatCss`, hors périmètre Admin)
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude SEC-003 (un seul script) | Codex AKY-INFO-012 (tous) ; réserve Codex R1/R2 (cf. CODEX_VALIDATION_OF_MASTER_AUDIT.md DOC-001)
**Fichiers :** `scripts/createTemporaryStoreAccess.mjs` ; `scripts/deleteExistingAccounts.mjs:6-30` ; `scripts/diagnoseAccount.mjs` ; `scripts/generatePasswordResetLink.mjs` ; `scripts/seedStores.mjs` ; `scripts/updateAccountPassword.mjs` ; `scripts/testClientLogin.mjs` ; `package.json:12-19`
**Symbole :** garde-fous `--execute`, `--confirm-delete-all`, `AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS` ; `initializeApp` Admin dans chaque script Admin
**Preuve :**
```js
scripts/deleteExistingAccounts.mjs:22-29
  if (execute && (!confirmedDeleteAll || !allowDeleteAll)) { throw ... }
scripts/deleteExistingAccounts.mjs:11-15
  initializeApp({ credential: serviceAccountPath ? cert(...) : applicationDefault() })
```
`deleteExistingAccounts` dispose déjà de 3 garde-fous (`--execute`, `--confirm-delete-all`, `AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS=true`). **Aucun autre script** ne vérifie que le projet ciblé est un émulateur ou un projet autorisé avant `initializeApp`.

#### 3.1.1 Couverture exhaustive des scripts Firebase Admin (réserve Codex R1)

Inventaire complet des scripts du dossier `scripts/`, classés par opération, SDK utilisé et niveau de risque. La détection repose sur l'import `firebase-admin/*` (un script qui n'importe pas `firebase-admin` n'est PAS un script Admin).

| Script | npm run | SDK | Opération | Risque | Justification |
|---|---|---|---|---|---|
| `createTemporaryStoreAccess.mjs` | `account:create-temp-access` | firebase-admin | Crée/réinitialise un compte Auth (`updateUser`/`createUser`) et écrit `users/{uid}` avec le `storeId` d'une boutique source (lignes 48-77) | **ÉLEVÉ** | Contournement de l'isolation boutique : octroie un accès `store_admin` à une boutique tierce, sans aucune journalisation applicative. |
| `deleteExistingAccounts.mjs` | `accounts:delete` / `accounts:delete:dry-run` | firebase-admin | Supprime **TOUS** les comptes Auth du projet et leurs profils `users/{uid}` (lignes 40-47) | **CRITIQUE** | Destruction de masse irréversible. Atténué (non éliminé) par 3 garde-fous : `--execute` + `--confirm-delete-all` + `AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS=true` (lignes 22-29). |
| `diagnoseAccount.mjs` | `account:diagnose` | firebase-admin | Lit un profil Auth puis `users/{uid}` et `stores/{storeId}` (lignes 45-117) | **FAIBLE** | Lecture seule, aucune écriture. Expose néanmoins des informations de compte/boutique sur le terminal. |
| `generatePasswordResetLink.mjs` | `account:reset-link` | firebase-admin | Génère un lien de réinitialisation de mot de passe pour un email (ligne 24) | **ÉLEVÉ** | Prise de contrôle de compte possible si le lien fuit ou est mal protégé. |
| `seedStores.mjs` | `seed:stores` | firebase-admin | Crée 6 boutiques + comptes admin (`stores/{id}`, `users/{uid}`) et génère des liens de reset (lignes 23-66) | **ÉLEVÉ** | Modification de la structure de données de production ; crée des comptes admin et expose des liens de réinitialisation. |
| `testClientLogin.mjs` | `account:test-login` | firebase (client, **PAS** Admin) | Teste une connexion `signInWithEmailAndPassword` puis lit `users`/`stores` (lignes 35-67) | **MOYEN** | N'utilise PAS le SDK Admin ; n'a que les droits d'un client authentifié. Identifiants lus via `AKAYIS_LOGIN_EMAIL`/`AKAYIS_LOGIN_PASSWORD` (env), risque d'exposition dans l'historique shell / variables d'environnement. |
| `updateAccountPassword.mjs` | `account:update-password` | firebase-admin | Change le mot de passe d'un compte et l'active (`updateUser`, lignes 25-30) | **ÉLEVÉ** | Modification directe des identifiants d'authentification, sans audit trail applicatif. |
| `compatCss.mjs` | (build : `build`) | — (aucun) | Post-traitement CSS post-build | **NUL** | **NON un script Admin** : aucun accès Firebase, aucun credential. Exclu explicitement du périmètre SEC-009. |

Incohérence signalée : la consigne décrivait `testClientLogin.mjs` comme recevant les identifiants en argument CLI. La lecture du fichier montre qu'ils sont en réalité lus via variables d'environnement (`AKAYIS_LOGIN_EMAIL`/`AKAYIS_LOGIN_PASSWORD`) et que le script utilise le SDK **client** Firebase, non le SDK Admin. Le niveau MOYEN est conservé, justifié par l'exposition possible des identifiants via l'environnement.

#### 3.1.2 Reclassification des scripts d'accès, reset et mot de passe (réserve Codex R2)

Trois scripts sont reclassés explicitement en **ÉLEVÉ**, chacun justifié par un scénario d'abus concret :

- **`createTemporaryStoreAccess.mjs` → ÉLEVÉ.** Scénario d'abus : un opérateur (ou un attaquant disposant des credentials Admin) fournit `AKAYIS_TARGET_EMAIL` arbitraire et le `storeId` d'une boutique source ; le script octroie un accès `store_admin` complet à cette boutique au compte cible (lignes 68-77). Aucune journalisation applicative n'est écrite : contournement direct de l'isolation boutique, sans piste d'audit.
- **`generatePasswordResetLink.mjs` → ÉLEVÉ.** Scénario d'abus : génération d'un lien de réinitialisation pour l'email d'un compte légitime (ligne 24) ; si le lien est intercepté, mal protégé ou redirigé, il permet la prise de contrôle complète du compte ciblé.
- **`updateAccountPassword.mjs` → ÉLEVÉ.** Scénario d'abus : modification directe du mot de passe et réactivation d'un compte (lignes 26-30) sans aucun audit trail applicatif ; un opérateur peut s'attribuer l'accès à n'importe quel compte connu par email.

**Scénario concret (commun) :** un opérateur lance l'un de ces scripts avec `GOOGLE_APPLICATION_CREDENTIALS` pointant vers la production.
**Impact :** modification/suppression de comptes, prise de contrôle de comptes ou contournement d'isolation sur le projet réel, sans piste d'audit applicative.
**Test préalable obligatoire :** vérifier que `npm run accounts:delete:dry-run` ne supprime rien ; ajouter un test refusant tout `projectId` hors allowlist avant initialisation Admin, pour chacun des scripts Admin.
**Correction envisagée :** garde-fou centralisé `assertSafeFirebaseProject` (allowlist de projet / émulateur) importé par TOUS les scripts Admin avant `initializeApp`, README admin explicite, dry-run par défaut là où c'est applicable. Ne PAS supprimer les scripts (interdiction CLAUDE.md sans preuve complète).
**Dépendances :** aucune.
**Lot recommandé :** Lot 5

---
### [MASTER-SEC-010] `firebase-admin` en `dependencies` (hygiène)
**Sévérité :** ÉLEVÉ (faible probabilité, fort impact) — risque potentiel, pas faille active
**Confiance :** ÉLEVÉE sur le fait, MOYENNE sur l'impact
**Statut :** confirmé
**Identifiants associés :** Claude SEC-004 | Codex ABSENT
**Fichiers :** `package.json:24`
**Symbole :** `"firebase-admin": "^13.10.0"`
**Preuve :** `package.json:24` place `firebase-admin` dans `dependencies`. Vérification directe : `grep firebase-admin src/` → **aucun résultat** (imports uniquement dans `scripts/*.mjs`). Pas de fuite active.
**Scénario concret :** un développeur importe accidentellement `firebase-admin` dans un composant React → SDK Admin dans le bundle client.
**Impact :** risque d'import client accidentel ; alourdissement/erreur de bundle. Pas d'exposition active aujourd'hui.
**Test préalable obligatoire :** `grep firebase-admin src/` doit rester vide ; build local dans un lot dédié.
**Correction envisagée :** déplacer `firebase-admin` vers `devDependencies`. Un seul changement de dépendance à la fois (CLAUDE.md).
**Dépendances :** aucune.
**Lot recommandé :** Lot 5

---
### [MASTER-SEC-011] Données sensibles persistées localement (localStorage / IndexedDB)
**Sévérité :** MOYEN
**Confiance :** ÉLEVÉE sur le fait, MOYENNE sur l'impact (dépend du contexte des postes)
**Statut :** partiellement confirmé (décision métier requise)
**Identifiants associés :** Claude SEC-008 (soldes) + SEC-009 (IndexedDB, axe dépréciation) | Codex AKY-MOY-008
**Fichiers :** `src/context/NetworkConfigContext.jsx:17-73` (`NETWORK_DATA_STORAGE_KEY`, `saveNetworkDataToStorage`) ; `src/components/ClientForm.jsx` (`CLIENT_FORM_DRAFT_KEY`) ; `src/config/firebase.js:82-89`
**Symbole :** `NETWORK_DATA_STORAGE_KEY`, `CLIENT_FORM_DRAFT_KEY`, persistance IndexedDB
**Preuve :**
```js
src/context/NetworkConfigContext.jsx:48  localStorage.setItem(NETWORK_DATA_STORAGE_KEY, JSON.stringify(data))
src/context/NetworkConfigContext.jsx:73  saveNetworkDataToStorage(balances)
```
Soldes réseau et brouillons clients persistés en clair côté navigateur ; IndexedDB Firestore optionnelle en prod.
**Scénario concret :** sur un poste partagé/perdu, brouillons clients et soldes restent consultables après déconnexion (pas de purge au logout).
**Impact :** exposition de PII et de données financières locales.
**Test préalable obligatoire :** saisir un brouillon, charger des soldes, se déconnecter, inspecter Application Storage.
**Correction envisagée :** purge au logout, TTL pour brouillons, minimisation des données persistées, décision documentée sur IndexedDB en prod. Cache de fallback légitime — décision D6 (postes personnels/partagés ?).
**Dépendances :** aucune.
**Lot recommandé :** Lot 5 / Lot 7

---
### [MASTER-SEC-012] API `enableMultiTabIndexedDbPersistence` ancienne/dépréciée
**Sévérité :** MOYEN
**Confiance :** ÉLEVÉE sur l'usage, MOYENNE sur le statut de dépréciation
**Statut :** partiellement confirmé (revalidation doc officielle requise)
**Identifiants associés :** Claude SEC-009 | Codex ABSENT
**Fichiers :** `src/config/firebase.js:82-89`
**Symbole :** `enableMultiTabIndexedDbPersistence`
**Preuve :**
```js
src/config/firebase.js:82-83
if (!isDev && import.meta.env.VITE_FIRESTORE_OFFLINE_PERSISTENCE === 'true') {
  enableMultiTabIndexedDbPersistence(db)
```
**Scénario concret :** retrait de l'API lors d'une mise à jour majeure du SDK Firebase → rupture silencieuse de la persistance hors ligne.
**Impact :** maintenabilité ; risque de rupture future.
**Test préalable obligatoire :** vérifier l'éventuel warning de dépréciation en console ; revalider sur la documentation Firebase officielle au moment du lot ; tester les navigateurs cibles.
**Correction envisagée :** migrer vers `initializeFirestore(app, { localCache: persistentMultipleTabManager() })`. Ne pas traiter comme fait définitif sans revalidation.
**Dépendances :** aucune.
**Lot recommandé :** Lot 7

---
### [MASTER-SEC-013] Chatbot n8n : envoi de données sans rédaction PII
**Sévérité :** MOYEN à FAIBLE (impact conditionnel)
**Confiance :** ÉLEVÉE sur le mécanisme, MOYENNE sur l'impact
**Statut :** partiellement confirmé (décision métier requise)
**Identifiants associés :** Claude ABSENT (« non audité ») | Codex AKY-MOY-009
**Fichiers :** `src/components/chatbot/Chatbot.jsx:11,29-59`
**Symbole :** `WEBHOOK_URL`, `sendMessage`
**Preuve :**
```js
src/components/chatbot/Chatbot.jsx:11  const WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || ''
src/components/chatbot/Chatbot.jsx:54-57  body: JSON.stringify({ message: messageContent, timestamp })
```
N'envoie que le `message` saisi + timestamp ; n'extrait pas automatiquement de PII. Si `VITE_N8N_WEBHOOK_URL` est vide, aucun envoi.
**Scénario concret :** un agent colle volontairement des données client/transactionnelles dans le chatbot ; elles partent vers le webhook n8n.
**Impact :** fuite potentielle de PII vers une intégration externe, conditionnée par la configuration du webhook et le comportement de l'agent.
**Test préalable obligatoire :** pointer le webhook vers un collecteur local, envoyer un message contenant des PII, inspecter le payload. Confirmer la valeur réelle de `VITE_N8N_WEBHOOK_URL` en prod.
**Correction envisagée :** proxy serveur contrôlé, allowlist d'URL, avertissement utilisateur, rédaction/minimisation. Cf. décision D5.
**Dépendances :** aucune.
**Lot recommandé :** Lot 7

---
### [MASTER-SEC-014] `projectId` / `authDomain` exposés dans le bundle client
**Sévérité :** FAIBLE
**Confiance :** ÉLEVÉE
**Statut :** confirmé (aucune action requise)
**Identifiants associés :** Claude SEC-010 | Codex ABSENT
**Fichiers :** `src/config/firebase.js:97-103`
**Symbole :** `export const firebaseInfo`
**Preuve :** `projectId` et `authDomain` lus depuis `import.meta.env` et exportés. Comportement inhérent à Firebase Web.
**Impact :** faible — la sécurité repose sur les règles Firestore, pas sur l'obfuscation du `projectId`.
**Test préalable obligatoire :** inspecter le bundle pour confirmer la présence.
**Correction envisagée :** aucune modification ; documenter que la sécurité repose sur les règles.
**Dépendances :** aucune.
**Lot recommandé :** aucun (information)

---

### 3.2 Performance (MASTER-PERF-XXX)

---
### [MASTER-PERF-001] Historique chargé sans borne (pagination en mémoire)
**Sévérité :** ÉLEVÉ
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude PERF-001 (+ PERF-002, PERF-003) | Codex AKY-MOY-007
**Fichiers :** `src/services/firestore.js:1102-1140` (`subscribeToHistory`), `src/services/firestore.js:428-432` (« Pas de limite par défaut ») ; `src/context/transactions.jsx:69,80` ; `src/hooks/useHistoriqueFilters.js`
**Symbole :** `subscribeToHistory`, `subscribeToCollection`, `subscribeToDrafts`
**Preuve :**
```js
src/services/firestore.js:1103-1107  let queryOptions = { /* orderByField commenté, aucun limit */ }
src/services/firestore.js:431  // Pas de limite par défaut - uniquement si explicitement demandée
```
**Scénario concret :** après plusieurs mois d'activité (p.ex. 3 600+ documents), toute la collection `history` est chargée en temps réel et maintenue en mémoire.
**Impact :** coûts Firestore croissants (chaque lecture facturée), consommation mémoire progressive, latence initiale, dégradation du dashboard (`useDashboardData` consomme `allTransactions`).
**Test préalable obligatoire :** seed émulateur (p.ex. 10 000 documents), mesurer le nombre de lectures, le temps d'affichage et la mémoire (capture de la baseline actuelle).
**Correction envisagée :** pagination Firestore (`limit(100)` + `startAfter`) ou filtre par période récente par défaut ; filtres avancés appliqués en mémoire sur la fenêtre paginée. ⚠️ Valider que `useDashboardData` reste correct.
**Dépendances :** doit s'appuyer sur les tests de caractérisation du Lot 0 couvrant `useDashboardData`.
**Lot recommandé :** Lot 4

---
### [MASTER-PERF-002] Pool de listeners simultanés + timeout silencieux
**Sévérité :** MOYEN / FAIBLE
**Confiance :** ÉLEVÉE sur le fait, MOYENNE sur l'impact du timeout
**Statut :** confirmé
**Identifiants associés :** Claude PERF-002 + PERF-005 | Codex (constat épars dans AKY-MOY-007)
**Fichiers :** `src/services/firestore.js:417-510` (pool), `src/services/firestore.js:434-438` (timeout 30 s) ; `src/context/transactions.jsx`
**Symbole :** `subscribeToCollection`, `LISTENER_TIMEOUT`
**Preuve :**
```js
src/services/firestore.js:435-438  setTimeout(() => { ... this.unsubscribeFromCollection(subscriptionKey) }, FIRESTORE_CONFIG.LIMITS.LISTENER_TIMEOUT)
```
Au moins 4 listeners `onSnapshot` simultanés dès la connexion (`globalClients`, `drafts`, `history`, `networkBalances`). Le timeout annule le listener si le premier snapshot tarde.
**Scénario concret :** sur connexion lente, le timeout annule silencieusement le listener → données qui ne se chargent plus.
**Impact :** sur connexion lente, perte de données silencieuse ; en multi-boutiques V2, multiplication des connexions WebSocket.
**Test préalable obligatoire :** simuler une connexion lente (throttling) et observer le déclenchement du timeout ; non testé à ce stade (hypothèse).
**Correction envisagée :** documenter la limite, augmenter ou retirer le timeout (le SDK gère ses propres timeouts), prévoir une stratégie de réduction des listeners pour la V2.
**Dépendances :** lié à MASTER-PERF-001.
**Lot recommandé :** Lot 4

---

### 3.3 Qualité (MASTER-QUA-XXX)

---
### [MASTER-QUA-001] Absence totale de tests automatisés
**Sévérité :** ÉLEVÉ (prérequis V2 bloquant)
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude QUA-011 | Codex AKY-INFO-013
**Fichiers :** `package.json:6-20`
**Symbole :** scripts npm
**Preuve :** seul `lint` (`package.json:10`) ; aucun `test`/`vitest`/`jest`/`playwright`/`emulators:exec` ; aucune dépendance `@firebase/rules-unit-testing` ; aucun fichier `*.test.*` / `*.spec.*`.
**Scénario concret :** une correction de règles ou de logique de soldes part en V2 sans caractérisation.
**Impact :** toute régression métier/sécurité détectée uniquement à l'exécution ou par l'utilisateur final. Incompatible avec CLAUDE.md (« ne jamais modifier une règle métier sans test de caractérisation »).
**Test préalable obligatoire :** N/A — c'est le finding qui produit les tests.
**Correction envisagée :** mettre en place l'émulateur Firestore + `@firebase/rules-unit-testing` + un runner (Vitest), puis écrire les tests de caractérisation des règles multi-boutiques et des fonctions financières AVANT toute modification.
**Dépendances :** prérequis de tous les autres lots de correction.
**Lot recommandé :** Lot 0

---
### [MASTER-QUA-002] `FirestoreService` monolithique (~1 321 lignes)
**Sévérité :** MOYEN (dette)
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude QUA-001 | Codex (constat factuel, pas de finding formel)
**Fichiers :** `src/services/firestore.js`
**Symbole :** classe `FirestoreService`
**Preuve :** concentre CRUD générique, cache TTL, pool de listeners, transactions atomiques, calcul des soldes (`applyInitialTransactionImpact`, `reverseInitialTransactionImpact`, `applySettlementImpact`, `applyLiquidityDelta`) et migration localStorage.
**Scénario concret :** impossible de tester unitairement la logique de calcul sans mocker toute la classe.
**Impact :** risque élevé de régression lors des changements financiers V2.
**Test préalable obligatoire :** écrire d'abord des tests purs de calcul de soldes (Lot 0) ; l'extraction ne doit pas changer le comportement.
**Correction envisagée :** extraire la logique de calcul dans un module pur `balanceCalculator.js` (refactor pur, après tests, sans mélange avec un changement métier).
**Dépendances :** dépend de Lot 0.
**Lot recommandé :** Lot 5

---
### [MASTER-QUA-003] `getDocument` lit un document via requête `where('__name__')`
**Sévérité :** MOYEN
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude QUA-007 | Codex ABSENT
**Fichiers :** `src/services/firestore.js:301-302`
**Symbole :** `getDocument`
**Preuve :**
```js
const docRef = this.docRef(collectionName, docId)
const docSnap = await getDocs(query(this.collectionRef(collectionName), where('__name__', '==', docRef)))
```
**Impact :** lecture de document unique plus coûteuse et moins lisible qu'un `getDoc(docRef)` direct.
**Test préalable obligatoire :** test unitaire de `getDocument` (document existant / inexistant) avant simplification.
**Correction envisagée :** remplacer par `getDoc(docRef)`.
**Dépendances :** dépend de Lot 0.
**Lot recommandé :** Lot 5

---
### [MASTER-QUA-004] Modèle multi-tenant ambigu (collections racine hors namespace)
**Sévérité :** FAIBLE à MOYEN (dette de clarté, pas une faille active)
**Confiance :** ÉLEVÉE sur le fait
**Statut :** partiellement confirmé
**Identifiants associés :** Claude ABSENT (recoupe le tableau « Collections » section 1) | Codex AKY-MOY-010
**Fichiers :** `src/config/clientIsolation.js:17-23` ; `src/services/firestore.js:88-102`
**Symbole :** `getFirestoreCollectionPath`, `resolveCollectionPath`
**Preuve :**
```js
src/services/firestore.js:88-101
  if (collectionName === USERS || STORES || CLIENTS) return collectionName
  ...
  return `clients/${this.activeStore.id}/${collectionName}`
```
`users`, `stores`, `globalClients` restent à la racine ; les autres sont préfixées par `clients/{storeId}/`.
**Impact :** confusion de configuration multi-tenant, risque de migration incomplète en V2 si l'équipe suppose une isolation totale par `VITE_CLIENT_ID`. Aucune fuite directe (les règles gouvernent l'accès, pas le chemin).
**Test préalable obligatoire :** émulateur, créer compte+client avec différents `VITE_CLIENT_ID`, inspecter les chemins réels écrits.
**Correction envisagée :** documenter le modèle final, aligner code/règles/docs.
**Dépendances :** aucune.
**Lot recommandé :** Lot 7 (préparation V2)

---
### [MASTER-QUA-005] Réseaux masqués documentés ; type `Crédit` absent de l'UI mais présent en logique
**Sévérité :** MOYEN
**Confiance :** ÉLEVÉE
**Statut :** partiellement confirmé (volet réseaux déjà documenté ; volet Crédit = décision métier)
**Identifiants associés :** Claude QUA-002 | Codex ABSENT
**Fichiers :** `src/utils/constants.js:10-12` (réseaux), `src/utils/constants.js:14-18` (`TRANSACTION_TYPES`) ; logique Crédit dans `firestore.rules:37`, `helpers.js`, `firestore.js`
**Symbole :** `NETWORK_OPTIONS`, `TRANSACTION_TYPES`
**Preuve :**
```js
src/utils/constants.js:10-12  // Options réseau visibles pour ce client... (commentaire DÉJÀ présent)
export const NETWORK_OPTIONS = ['Orange']
src/utils/constants.js:15-18  TRANSACTION_TYPES = [{ 'Dépôt' }, { 'Retrait' }]   // pas de Crédit
```
Le commentaire documentant les réseaux masqués existe déjà (volet QUA-002 partiellement obsolète). Le type `Crédit` reste absent de `TRANSACTION_TYPES` alors que la logique existe dans les règles et le service.
**Impact :** ambiguïté V2 sur la réactivation de Crédit et des réseaux.
**Test préalable obligatoire :** caractériser l'UI actuelle (Crédit absent de l'interface mais accepté par certaines règles/fonctions).
**Correction envisagée :** documenter explicitement le choix sur le type `Crédit`. Cf. décision D8.
**Dépendances :** aucune.
**Lot recommandé :** Lot 7

---
### [MASTER-QUA-006] Fichiers potentiellement non référencés (code mort suspecté, non prouvé)
**Sévérité :** FAIBLE (dette)
**Confiance :** MOYENNE (absence d'import statique constatée ; imports dynamiques/barrels non exhaustivement écartés)
**Statut :** partiellement confirmé — NE PAS supprimer sans preuve complète
**Identifiants associés :** Claude QUA-004 + QUA-005 + PERF-004 | Codex AKY-FAIBLE-011
**Fichiers :** `src/data/clients.js`, `src/data/transactions.js`, `src/utils/contextFactory.jsx`, `src/utils/initializeApp.jsx`, `src/utils/performanceMonitor.jsx`, `src/components/dashboard/shared/ChartTooltip.jsx`, `src/components/dashboard/shared/ChartLegend.jsx`
**Symbole :** exports non référencés par recherche statique ; `clientsInitiaux = []`, `transactionsInitiales = []`, `startPeriodicReporting(120000)`
**Preuve :** absence d'import statique détectée (grep). PERF-004 : `initializeApp.jsx` configure un monitoring périodique mais ne semble importé nulle part → monitoring probablement inactif.
**Impact :** bruit de maintenance ; risque réel = suppression prématurée.
**Test préalable obligatoire :** analyse du graphe bundler (`vite build`), recherche d'imports dynamiques (`import(`), vérification scripts/configs, usage métier ; test avant/après ; restauration possible par commit local (protocole CLAUDE.md).
**Correction envisagée :** aucune suppression sans preuve exhaustive. Lot dédié au nettoyage uniquement.
**Dépendances :** aucune.
**Lot recommandé :** Lot 6

---
### [MASTER-QUA-007] Dette de code locale (décorateur legacy, doublons, variable inutilisée, dépendances build non déclarées)
**Sévérité :** FAIBLE à MOYEN
**Confiance :** ÉLEVÉE
**Statut :** confirmé
**Identifiants associés :** Claude QUA-003, QUA-006, QUA-008, QUA-009, QUA-010 | Codex ABSENT (sauf QUA-010 recoupé)
**Fichiers :**
- `src/pages/Historique.jsx:21-39` — handlers wrappers d'une ligne (QUA-003)
- `src/utils/cacheManager.js:200-225` — décorateur legacy `withCache` non utilisé (QUA-006)
- `src/constants/authMessages.js:39-40` — deux constantes identiques (QUA-008)
- `src/components/transactions/TransactionForm.jsx:214-224` — `confirmationMessage` + `void confirmationMessage` (QUA-009)
- `scripts/compatCss.mjs` — `browserslist`, `lightningcss` non déclarés explicitement dans `package.json` (QUA-010)
**Preuve :** voir audits Claude QUA-003/006/008/009/010 (vérifiés en lecture statique).
**Impact :** maintenabilité ; QUA-010 = build fragile si les transitives disparaissent.
**Test préalable obligatoire :** pour QUA-010, build local dans un lot dédié vérifiant la résolution de modules. Pour les autres, lint + build.
**Correction envisagée :** nettoyage local minimal, un changement de dépendance à la fois. Déclarer `browserslist` et `lightningcss` en `devDependencies`.
**Dépendances :** QUA-010 dans le même esprit que MASTER-SEC-010 (hygiène dépendances, un changement à la fois).
**Lot recommandé :** Lot 6 (code) / Lot 5 (QUA-010 dépendances)

---

## 4. Matrice des risques

Axes : Probabilité (faible → élevée) × Impact (faible → critique). Positionnement des findings MASTER.

| Impact \ Probabilité | Faible | Moyenne | Élevée |
|---|---|---|---|
| **Critique** | | MASTER-SEC-001, MASTER-SEC-002 | MASTER-SEC-003 |
| **Élevé** | MASTER-SEC-010 | MASTER-SEC-005, MASTER-SEC-006, MASTER-SEC-007, MASTER-SEC-009, MASTER-QUA-001 | MASTER-SEC-004, MASTER-PERF-001 |
| **Moyen** | MASTER-SEC-012, MASTER-PERF-002 | MASTER-SEC-008, MASTER-SEC-011, MASTER-QUA-002, MASTER-QUA-003 | MASTER-QUA-007 (QUA-010) |
| **Faible** | MASTER-SEC-014, MASTER-QUA-006 | MASTER-SEC-013, MASTER-QUA-004, MASTER-QUA-005 | MASTER-QUA-007 (autres) |

Lecture : la zone « Critique × Élevée » (MASTER-SEC-003) et « Critique × Moyenne » (SEC-001/002) constitue le cœur du risque à traiter en priorité. MASTER-SEC-004 et MASTER-PERF-001 sont « Élevé × Élevée » : forte probabilité d'occurrence avec le temps/volume.

---

## 5. Décisions métier bloquantes

Ces questions doivent être tranchées AVANT de corriger les findings correspondants. Elles conditionnent la sévérité et la nature des corrections.

| ID | Question | Findings conditionnés | Bloque le lot |
|---|---|---|---|
| **D1** | L'inscription publique d'une boutique est-elle voulue en production, ou faut-il un onboarding par invitation/Admin ? | MASTER-SEC-005, MASTER-SEC-001 | Lot 1 |
| **D2** | `globalClients` doit-il être partagé (lecture réseau volontaire) ou strictement isolé par boutique d'enregistrement ? | MASTER-SEC-002 | Lot 1 |
| **D3** | Une transaction historique peut-elle être supprimée, ou seulement annulée avec piste d'audit ? Faut-il une corbeille/archive ? | MASTER-SEC-003, MASTER-SEC-004 | Lot 2 |
| **D4** | Qui peut modifier manuellement stock/liquidité, et avec quelle justification/audit ? | MASTER-SEC-006 | Lot 3A |
| **D5** | Le chatbot n8n est-il actif en production et autorisé à recevoir des données client/transactionnelles ? | MASTER-SEC-013 | Lot 7 |
| **D6** | Les postes agents sont-ils personnels, partagés ou publics ? | MASTER-SEC-011 | Lot 5/7 |
| **D7** | Existe-t-il déjà en production des documents avec types/statuts à encodage corrompu ? | MASTER-SEC-007 | Lot 3B (encodage) |
| **D8** | Le type `Crédit` et les réseaux masqués sont-ils prévus pour la V2 ou volontairement désactivés ? | MASTER-QUA-005 | Lot 7 |

Questions complémentaires (non bloquantes) : nombre réel de boutiques en production (impacte l'urgence de SEC-001/002) ; usage de `seedStores.mjs` pour la production ; périmètre de l'export Excel de `ActionButtons.jsx` ; criticité du mode hors ligne.

---

## 6. Plan de stabilisation avant V2

Séquence directrice (conforme à CLAUDE.md : test de caractérisation avant tout changement métier ; jamais de refactor mélangé à un changement de comportement ; correction minimale et réversible).

1. **Lot 0** — Filet de sécurité : tests de caractérisation (aucun changement métier).
2. **Lot 1** — Règles Firestore : isolation profils + `globalClients` (décisions D1, D2).
3. **Lot 2** — Intégrité de l'historique et des opérations financières (décision D3).
4. **Lot 3A** — Intégrité et concurrence de `networkBalances` (D4). **Lot 3B** — Encodage UTF-8 des règles (D7). Deux sous-lots indépendants, jamais mélangés dans un même commit.
5. **Lot 4** — Performance et pagination de l'historique.
6. **Lot 5** — Dette technique, scripts admin, hygiène dépendances.
7. **Lot 6** — Code mort confirmé (preuve complète exigée) + signup orphelin + dette locale.
8. **Lot 7** — Préparation V2 (données locales, SDK, chatbot, documentation modèle).

Ordre d'exécution recommandé : **Lot 0 → 1 → 2 → 3A → 3B → 4 → 5 → 6 → 7**. Le Lot 3B (encodage) est indépendant sur le fond et peut être traité tôt une fois D7 répondue ; les Lots 1-2 ne doivent pas attendre ce nettoyage.

---

## 7. Lots de travail recommandés

### Lot 0 — Filet de sécurité et tests de caractérisation
- **Objectif :** mettre en place l'infrastructure de test (émulateur Firestore, `@firebase/rules-unit-testing`, Vitest) et capturer le comportement ACTUEL (règles multi-boutiques, dépôt/retrait/validation, suppression, soldes, `useDashboardData`). Aucun changement métier.
- **Findings concernés :** MASTER-QUA-001 (et prérequis de tous les autres).
- **Prérequis :** aucun.
- **Critères de succès mesurables :** une commande `test` exécute une suite verte qui décrit le comportement existant ; au moins deux boutiques A/B configurées ; tests des fonctions de calcul de soldes isolables.
- **Complexité :** L
- **Risque de régression :** FAIBLE (ajout de tests uniquement).
- **Décisions métier requises :** NON.

### Lot 1 — Règles Firestore et isolation des boutiques
- **Objectif :** empêcher la création d'un profil `users` à `storeId` arbitraire et restreindre `globalClients` à la boutique d'enregistrement.
- **Findings concernés :** MASTER-SEC-001, MASTER-SEC-002, (décision sur MASTER-SEC-005).
- **Prérequis :** Lot 0 terminé ; décisions D1 et D2.
- **Critères de succès mesurables :** tests A/B passant de rouge à vert ; un utilisateur B ne peut ni créer un profil `storeId=A`, ni lire/modifier/supprimer un client `registeredStoreId=A` ; aucune requête applicative légitime cassée.
- **Complexité :** M
- **Risque de régression :** ÉLEVÉ (modification de règles utilisées en production).
- **Décisions métier requises :** OUI (D1, D2).

### Lot 2 — Intégrité de l'historique et des opérations financières
- **Objectif :** rendre l'historique financier non supprimable silencieusement ; neutraliser la divergence soldes/historique.
- **Findings concernés :** MASTER-SEC-003, MASTER-SEC-004.
- **Prérequis :** Lot 0 ; Lot 1 recommandé ; décision D3.
- **Critères de succès mesurables :** `history.delete` refusé par les règles ; si annulation métier introduite, opération inverse transactionnelle + écriture `auditLog` ; soldes cohérents avec l'historique. UI (désactivation du bouton) et règles dans des sous-lots distincts.
- **Complexité :** M (L si annulation métier introduite).
- **Risque de régression :** ÉLEVÉ (comportement financier).
- **Décisions métier requises :** OUI (D3).

### Lot 3A — Intégrité et concurrence de `networkBalances` (schéma + écritures concurrentes)
- **Objectif :** garantir la cohérence des soldes réseau, à la fois par un schéma strict côté règles et en cas d'écriture concurrente.
- **Findings concernés :** MASTER-SEC-006 (schéma `networkBalances`, absence de rôle/audit).
- **Prérequis :** Lot 2 terminé ; décision D4.
- **Critères de succès mesurables :** une map `balances` hors schéma/allowlist est refusée par les règles ; test avec deux onglets/clients simultanés écrivant `networkBalances/current` vérifiant l'absence de conflit ou de perte d'écriture (cohérence transactionnelle).
- **Complexité :** M
- **Risque de régression :** MOYEN (logique financière).
- **Décisions métier requises :** NON (technique pur — la modalité d'édition manuelle relève de D4, mais l'intégrité/concurrence est purement technique).
- **Rollback :** `git revert` atomique du commit dédié.

### Lot 3B — Encodage UTF-8 et normalisation des valeurs historiques
- **Objectif :** nettoyer les valeurs corrompues dans `firestore.rules` (`DÃ©pÃ´t`, `CrÃ©dit`, `ValidÃ©e`, etc.) et standardiser les valeurs de type/statut.
- **Findings concernés :** MASTER-SEC-007 (Claude SEC-005/006, Codex AKY-MOY-007).
- **Prérequis :** Lot 3A terminé (indépendant sur le fond, mais séquentialisé pour la revue) ; décision D7.
- **Critères de succès mesurables :** aucune valeur corrompue dans `firestore.rules` ; tests émulateur validant les types/statuts propres et le refus des valeurs corrompues, sans bloquer l'`update` de documents existants.
- **Complexité :** S
- **Risque de régression :** FAIBLE (clarification de règles, pas de changement de logique).
- **Décisions métier requises :** NON (sauf si des données corrompues existent en production — incertitude à documenter avant action, cf. D7).
- **Rollback :** `git revert` atomique du commit dédié.
- **Note importante :** vérifier si des données portant ces valeurs corrompues existent en production AVANT de modifier les règles (sinon leurs `update` seraient bloqués). L'incertitude sur l'état réel de la production est documentée dans la section « Limites de l'audit ». Ne jamais mélanger Lot 3A et Lot 3B dans un même commit (rollback et risque métier distincts).

### Lot 4 — Performance et pagination
- **Objectif :** borner les lectures de l'historique (pagination Firestore) sans casser le dashboard.
- **Findings concernés :** MASTER-PERF-001, MASTER-PERF-002.
- **Prérequis :** Lot 0 (tests `useDashboardData`).
- **Critères de succès mesurables :** la souscription `history` charge une fenêtre bornée ; le nombre de lectures Firestore baisse mesurablement sur un dataset volumineux ; les agrégations dashboard restent identiques (tests verts).
- **Complexité :** L
- **Risque de régression :** MOYEN.
- **Décisions métier requises :** NON.

### Lot 5 — Dette technique et architecture
- **Objectif :** extraire la logique de calcul des soldes (refactor pur), simplifier `getDocument`, durcir les scripts admin, traiter l'hygiène des dépendances et la persistance locale.
- **Findings concernés :** MASTER-QUA-002, MASTER-QUA-003, MASTER-SEC-009, MASTER-SEC-010, MASTER-QUA-007 (QUA-010), MASTER-SEC-011 (purge locale).
- **Prérequis :** Lot 0 (tests des fonctions de calcul) ; décision D6 pour la purge locale.
- **Critères de succès mesurables :** `balanceCalculator.js` testé unitairement sans réseau, comportement inchangé ; `getDocument` utilise `getDoc` ; `assertSafeFirebaseProject` refuse tout projet hors allowlist ; `firebase-admin` en `devDependencies` avec build vert ; `browserslist`/`lightningcss` déclarés.
- **Complexité :** L
- **Risque de régression :** MOYEN (refactor couvert par tests ; un changement de dépendance à la fois).
- **Décisions métier requises :** PARTIEL (D6 pour la purge locale).

### Lot 6 — Nettoyage du code mort confirmé
- **Objectif :** supprimer le code mort UNIQUEMENT après preuve complète d'absence d'import (statique, dynamique, scripts, configs, usage métier) ; corriger le rollback du compte Auth orphelin ; nettoyer la dette locale.
- **Findings concernés :** MASTER-QUA-006, MASTER-SEC-008, MASTER-QUA-007 (QUA-003/006/008/009).
- **Prérequis :** Lot 0 ; protocole de suppression CLAUDE.md (graphe bundler, grep `import(`, restauration par commit local).
- **Critères de succès mesurables :** chaque suppression accompagnée de la preuve d'absence d'import et d'un test avant/après ; rollback Auth orphelin déclenché pour toute erreur ; build et lint verts.
- **Complexité :** M
- **Risque de régression :** MOYEN (suppression conditionnée par preuve).
- **Décisions métier requises :** NON.

### Lot 7 — Préparation de la V2
- **Objectif :** documenter le modèle multi-tenant, trancher le chatbot, migrer l'API de persistance, clarifier `Crédit`/réseaux masqués.
- **Findings concernés :** MASTER-QUA-004, MASTER-SEC-013, MASTER-SEC-012, MASTER-QUA-005, MASTER-SEC-011 (IndexedDB).
- **Prérequis :** Lots 0-6 ; décisions D5, D8 ; revalidation de la doc Firebase pour SEC-012.
- **Critères de succès mesurables :** modèle de données documenté et aligné code/règles/docs ; chatbot encadré ou désactivé selon D5 ; migration `persistentMultipleTabManager` validée sur navigateurs cibles ; choix `Crédit` documenté.
- **Complexité :** M
- **Risque de régression :** MOYEN.
- **Décisions métier requises :** OUI (D5, D8).

---

## 8. Stratégie de tests

### 8.1 Tests de caractérisation (Lot 0)
- Infrastructure : émulateur Firestore + `@firebase/rules-unit-testing` + Vitest (à ajouter en `devDependencies`, un changement de dépendance à la fois).
- Capturer le comportement ACTUEL avant toute modification (tests « golden »), conformément à CLAUDE.md.
- Fonctions financières : `applyInitialTransactionImpact`, `reverseInitialTransactionImpact`, `applySettlementImpact`, `applyLiquidityDelta`, `validateTransaction` — d'abord testées via la classe, puis isolées en `balanceCalculator.js` au Lot 5 (comportement inchangé).
- Dashboard : caractériser `useDashboardData` / `useAllTransactions` sur un dataset connu (prérequis du Lot 4).

### 8.2 Tests de sécurité Firestore (Lot 1)
- Au moins deux boutiques A/B et deux utilisateurs (exigence CLAUDE.md).
- Cas : utilisateur B crée `users/{uidB}` avec `storeId=A` → attendu refus après correction ; `read/update/delete` de `globalClients` `registeredStoreId=A` par B → refus ; accès `clients/A/{drafts,history,networkBalances,auditLogs}` par B → refus.
- Onboarding (selon D1) : création de boutique sans validation → refus ou encadrement.

### 8.3 Tests de régression financière (Lot 2)
- Création de transaction validée, suppression `history` → attendu refus (après correction) ; vérifier qu'aucune trace n'est perdue.
- Si annulation introduite : statut `Annulée` + `auditLog` + opération inverse transactionnelle ; vérifier la cohérence `networkBalances` ↔ historique.
- Schéma `networkBalances` (Lot 3A) : map hors allowlist/champ inattendu → refus.

### 8.4 Tests de performance (Lot 4)
- Seed émulateur avec un volume représentatif (p.ex. 10 000 documents `history`).
- Mesurer : nombre de lectures Firestore, temps d'affichage initial, mémoire — baseline avant / après pagination.
- Vérifier que les agrégations `useDashboardData` restent identiques aux tests de caractérisation du Lot 0.

---

## 9. Stratégie de retour arrière

**Principe général (réserve Codex R4).**
- Chaque lot doit être réalisé dans un ou plusieurs commits atomiques dédiés, sur la branche `audit/pre-v2-local` (aucun `git push`, aucun déploiement).
- En cas de régression : utiliser `git revert <commit-hash>` pour annuler proprement le commit fautif.
- **INTERDIT sans validation explicite :** `git checkout -- <fichier>`, `git restore`, `git reset --hard`. Ces commandes sont destructives et peuvent écraser du travail utilisateur non commité.
- Avant tout rollback destructif : inspecter le diff (`git diff`), confirmer qu'aucun travail en cours ne sera perdu, et obtenir une confirmation explicite.
- Les tests du Lot 0 servent de détecteur de régression. Ne jamais mélanger refactor et changement de comportement dans un même commit (facilite le `git revert` ciblé).

**Par lot (0 à 7).** Pour chaque lot :
- **Mécanisme de rollback :** `git revert <commit-hash du lot>`.
- **Risque résiduel :** si les données Firestore ont été modifiées, le rollback du code seul ne suffit pas à restaurer l'état des données.
- **Pour les règles Firestore (Lots 1, 2, 3A, 3B) :** conserver la version précédente des règles dans git ; le rollback est un redéploiement de l'ancienne version, toujours via le dépôt git (jamais manuellement). Pour le Lot 3B (encodage, SEC-007), vérifier D7 avant : si des données corrompues existent, ne pas retirer les valeurs corrompues (sinon blocage des `update`) — c'est le principal scénario de rollback à anticiper.
- **Pour les scripts Admin (Lot 5) :** aucun rollback possible si des comptes ou des données ont été supprimés — c'est pourquoi les scripts CRITIQUE/ÉLEVÉ (cf. MASTER-SEC-009) ne doivent être exécutés que sur les émulateurs.
- **Pour les changements de service (Lots 4, 5, 6) :** refactors (extraction `balanceCalculator.js`, simplification `getDocument`) couverts par tests ; en cas d'écart, `git revert` du commit. Hygiène des dépendances : un seul changement à la fois, build local après chaque changement ; en cas d'échec, `git revert` immédiat. Suppression de code mort : ne supprimer qu'après preuve complète ; restauration garantie par `git revert` du commit (le fichier reste dans l'historique git).

---

## 10. Critères de passage à la V2 (go/no-go)

Chaque critère est exprimé avec une commande ou un artefact vérifiable (réserve Codex R5).

**a) Tests Firestore Rules (Lots 0, 1). No-go sans cela.**
- Commande : `firebase emulators:exec --project <project-id> "node tests/rules/globalClients.test.js"`.
- Scénario minimal : deux boutiques A et B créées dans l'émulateur ; token Auth boutique B ; tentative de lecture d'un document `globalClients` de la boutique A → doit être refusée (`permission-denied`). Idem pour la création de profil `users/{uidB}` avec `storeId=A` et l'accès `clients/A/*`.
- Artefact attendu : rapport de test passant (exit code 0).

**b) Scripts sensibles protégés (Lot 5).**
Liste exhaustive à vérifier, cohérente avec MASTER-SEC-009 :

| Script | SDK | Sévérité | Critère de vérification |
|---|---|---|---|
| `createTemporaryStoreAccess.mjs` | firebase-admin | ÉLEVÉ | Documentation de risque à jour + garde-fou `assertSafeFirebaseProject` |
| `deleteExistingAccounts.mjs` | firebase-admin | CRITIQUE | 3 garde-fous actifs (`--execute`, `--confirm-delete-all`, variable d'env) + dry-run obligatoire |
| `diagnoseAccount.mjs` | firebase-admin | FAIBLE | Documentation à jour (lecture seule, pas d'écriture) |
| `generatePasswordResetLink.mjs` | firebase-admin | ÉLEVÉ | Documentation de risque à jour + garde-fou `assertSafeFirebaseProject` |
| `seedStores.mjs` | firebase-admin | ÉLEVÉ | Documentation de risque à jour + garde-fou `assertSafeFirebaseProject` |
| `updateAccountPassword.mjs` | firebase-admin | ÉLEVÉ | Documentation de risque à jour + garde-fou `assertSafeFirebaseProject` |
| `testClientLogin.mjs` | firebase (SDK **client**, PAS Admin) | MOYEN | Distingué des scripts Admin : utilise `signInWithEmailAndPassword`, droits limités à un compte authentifié ; identifiants via variables d'env `AKAYIS_LOGIN_EMAIL`/`AKAYIS_LOGIN_PASSWORD` |

Note : `compatCss.mjs` est exclu de cet inventaire — script de post-build CSS, aucun accès Firebase, risque NUL.

- Critère global : chaque script firebase-admin doit avoir une documentation de risque à jour et ne jamais être accessible via `npm run` en production sans flag de sécurité supplémentaire.
- Artefact attendu : vérification manuelle du tableau ci-dessus + revue de `package.json` (section `scripts`).

**c) Absence de `firebase-admin` dans `src/` (Lot 5).**
- Commande exacte : `grep -r "firebase-admin" src/`.
- Critère : sortie vide (exit code 1 de grep, aucune ligne trouvée).
- Artefact attendu : capture de la commande avec sortie vide.

**d) Tests de pagination / performance (Lot 4).**
- Seuil minimal : tester avec un dataset de 500 documents `history` dans l'émulateur.
- Commande : mesurer le temps de chargement initial de la page Historique avec 500 documents, avec `limit` vs sans `limit`.
- Artefact attendu : comparaison avant/après documentée.

**e) Intégrité financière / suppression journalisée (Lot 2).**
- Critère : toute tentative de suppression d'un document `history` doit soit échouer (règle Firestore `deny`), soit écrire dans `auditLogs` avant suppression.
- Test : tenter `deleteDoc` sur `history` dans l'émulateur → doit retourner `permission-denied`.
- Artefact attendu : règle déployée (sur émulateur) + test passant.

**f) Décisions métier D1-D8 (Lot 7).**
- Critère : document daté et signé (ou validé par email/message) pour chacune des 8 décisions.
- Format minimal : tableau `Décision | Réponse | Date | Validé par`.
- Artefact attendu : fichier `docs/decisions/DECISIONS_METIER.md` complété.

**g) Artefacts par lot.**
- Lot 0 : fichier de tests de caractérisation exécutable (ex. `tests/characterization/`).
- Lot 1 : règles Firestore déployées sur émulateur + rapport de test A/B.
- Lot 2 : règle `history.delete` bloquée + test passant.
- Lot 3A : test de concurrence `networkBalances` passant.
- Lot 3B : aucune valeur corrompue dans `firestore.rules` (grep manuel).
- Lot 4 : temps de chargement Historique mesuré avec 500 docs.
- Lot 5 : aucune méthode métier dans `FirestoreService` (revue manuelle).
- Lot 6 : imports vérifiés exhaustivement pour les fichiers supprimés.
- Lot 7 : toutes les décisions D1-D8 tranchées, branche V2 créée.

---

## 11. Limites de l'audit

- Audit statique uniquement. Aucun test, lint, build ou script admin exécuté ; aucun accès réseau distant ni Firebase production.
- Les valeurs réelles de `VITE_FIRESTORE_OFFLINE_PERSISTENCE`, `VITE_USE_FIREBASE_EMULATORS`, `VITE_N8N_WEBHOOK_URL` (fichiers `.env`) sont inconnues — l'impact de MASTER-SEC-013 (chatbot) et de la persistance IndexedDB dépend de ces valeurs.
- Le dossier `functions/` ne contient que `node_modules` — aucune Cloud Function auditée.
- Le statut exact de dépréciation de `enableMultiTabIndexedDbPersistence` (MASTER-SEC-012) n'a pas été revalidé contre la documentation Firebase officielle au moment de l'audit (confiance MOYENNE sur ce point).
- Le code mort suspecté (MASTER-QUA-006) n'est PAS prouvé : l'absence d'import statique est confirmée, mais les imports dynamiques, barrels et usages via scripts/configs n'ont pas été exhaustivement écartés.
- Le nombre réel de boutiques en production est inconnu : il conditionne l'urgence opérationnelle de MASTER-SEC-001/002.
- Composants non audités en détail : `ActionButtons.jsx`, divers charts, `ClientsTable.jsx`, `NavBar.jsx`. Le périmètre exact de l'export Excel n'est pas confirmé.
- Biais potentiel : la consolidation s'appuie sur quatre rapports antérieurs ; chaque finding CRITIQUE/ÉLEVÉ a néanmoins été revérifié par lecture directe du code (firestore.rules complet, AuthContext, firestore.js extraits cités, firebase.js, package.json, constants.js, NetworkConfigContext, deleteExistingAccounts.mjs).

---

## 12. Conditions levées après validation Codex

Cette section documente les cinq réserves exprimées par Codex dans `docs/audit/consolidated/CODEX_VALIDATION_OF_MASTER_AUDIT.md` (verdict « ACCEPTABLE SOUS CONDITIONS ») et indique où elles ont été traitées dans ce document.

| Réserve Codex | Description | Traitée dans |
|---|---|---|
| R1 — Couverture des scripts Admin | MASTER-SEC-009 ne couvrait pas tous les scripts Admin | Section 3.1 MASTER-SEC-009 / 3.1.1 (Correction 1 + 2) |
| R2 — Reclassification sévérité scripts | `createTemporaryStoreAccess`, `generatePasswordResetLink`, `updateAccountPassword` non classifiés en ÉLEVÉ | Section 3.1 MASTER-SEC-009 / 3.1.2 (Correction 2) |
| R3 — Lot 3 trop large | Intégrité `networkBalances` et encodage UTF-8 mélangés dans un même lot | Section 7 Lot 3A / Lot 3B (Correction 3) |
| R4 — Stratégie de rollback insuffisante | `git checkout` cité comme mécanisme normal, rollback destructif non balisé | Section 9 (Correction 4) |
| R5 — Critères V2 non mesurables | Critères de passage à la V2 sans commandes ni artefacts vérifiables | Section 10 (Correction 5) |

Note : ces cinq réserves ont été levées par modifications documentaires dans ce même fichier. Aucune correction de code n'a été appliquée — les corrections techniques restent à réaliser dans les lots correspondants.

---

## 13. Fichiers consultés

Rapports d'audit :
```
CLAUDE.md
docs/audit/claude/CLAUDE_AUDIT.md
docs/audit/codex/CODEX_AUDIT.md
docs/audit/consolidated/CLAUDE_REVIEW_OF_CODEX.md
docs/audit/consolidated/CODEX_REVIEW_OF_CLAUDE.md
```

Code vérifié directement :
```
firestore.rules                                  (lecture complète, lignes 1-159)
src/context/AuthContext.jsx                      (lignes 90-169 — signup + rollback)
src/config/firebase.js                           (lignes 75-107 — persistance + firebaseInfo)
src/services/firestore.js                        (88-102 resolveCollectionPath, 295-317 getDocument,
                                                  425-464 subscribeToCollection, 1090-1150 deleteFromHistory/subscribeToHistory)
package.json                                     (scripts + dependencies + devDependencies)
src/utils/constants.js                           (lignes 1-103 — NETWORK_OPTIONS, TRANSACTION_TYPES)
src/context/NetworkConfigContext.jsx             (lignes 1-80 — localStorage soldes)
scripts/createTemporaryStoreAccess.mjs           (lecture complète — accès temporaire boutique)
scripts/deleteExistingAccounts.mjs               (lecture complète — garde-fous suppression de masse)
scripts/diagnoseAccount.mjs                      (lecture complète — diagnostic lecture seule)
scripts/generatePasswordResetLink.mjs            (lecture complète — lien de reset)
scripts/seedStores.mjs                           (lecture complète — création boutiques + admins)
scripts/updateAccountPassword.mjs                (lecture complète — changement de mot de passe)
scripts/testClientLogin.mjs                      (lecture complète — SDK client, non Admin)
```

Recherches transverses :
```
grep "firebase-admin" src/  → aucun résultat (confirme MASTER-SEC-010 : pas d'import client actif)
```

---

## 14. Bilan de modification

| Opération | Résultat |
|---|---|
| Fichiers sources modifiés | **Aucun** |
| Fichiers sources créés | **Aucun** |
| Fichier créé | `docs/audit/consolidated/MASTER_AUDIT.md` (ce fichier) |
| Scripts administratifs exécutés | **Non** |
| Dépendances installées / mises à jour | **Non** |
| Firebase production accédé | **Non** |
| git commit / push / déploiement | **Non** |
| Révision documentaire post-Codex (2026-06-17) | Corrections 1 à 6 appliquées à **ce seul fichier** pour lever les réserves R1-R5 (cf. section 12). Aucune conclusion technique modifiée, aucun finding supprimé, aucun identifiant MASTER-XXX altéré. Lecture des 7 scripts `scripts/*.mjs` Admin/client effectuée pour étayer MASTER-SEC-009. |

Sortie de `git diff --stat` :

> Note : l'outillage de cette session ne dispose pas d'un canal d'exécution shell (seuls Read/Glob/Grep/Write/Edit sont disponibles). `git diff --stat` n'a donc pas pu être exécuté par l'agent. À exécuter manuellement pour vérification :
>
> ```
> git diff --stat
> ```
>
> État attendu : un seul fichier **nouveau (non suivi)** `docs/audit/consolidated/MASTER_AUDIT.md`. Le seul fichier déjà modifié au démarrage de la session était `CLAUDE.md` (modification préexistante, **non touchée par cet audit**). Comme `MASTER_AUDIT.md` est un nouveau fichier non suivi, il apparaît sous `git status` (untracked) plutôt que sous `git diff --stat`. Aucun fichier source applicatif n'a été modifié, créé ou supprimé par cet audit.
