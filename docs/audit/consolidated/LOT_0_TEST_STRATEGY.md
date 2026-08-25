# STRATÉGIE DE TESTS — LOT 0 (FILET DE SÉCURITÉ)
## Projet : AKAYIS CRM
Date : 2026-06-17
Branche : audit/pre-v2-local
Objectif : définir le filet de sécurité à installer avant tout refactor, nettoyage de code mort ou correction métier.
Référence : MASTER_AUDIT.md (Lot 0 — Filet de sécurité et tests de caractérisation)

> ⚠️ BLOCAGE
>
> **Le Lot 0 reste interdit tant que cette stratégie corrigée n'a pas obtenu le verdict VALIDÉ POUR DÉMARRER LE LOT 0 lors d'une nouvelle revalidation indépendante.**

Convention de lecture : les sections « FAIT OBSERVÉ » citent du code vérifié directement dans cette session (fichier:ligne). Les sections « RECOMMANDATION » relèvent de propositions à valider, non encore appliquées. Aucun fichier source n'a été modifié, aucune dépendance installée, aucun test écrit par ce document.

---

## 1. État actuel des tests

### 1.1 Scripts npm existants

FAITS OBSERVÉS — `package.json:6-20` :

| Script | Commande exacte |
|---|---|
| `dev` | `vite` |
| `dev:local` | `vite --host 127.0.0.1 --port 5173` |
| `build` | `vite build && node scripts/compatCss.mjs` |
| `lint` | `eslint .` |
| `preview` | `vite preview` |
| `account:diagnose` | `node scripts/diagnoseAccount.mjs` |
| `account:reset-link` | `node scripts/generatePasswordResetLink.mjs` |
| `account:test-login` | `node --env-file=.env scripts/testClientLogin.mjs` |
| `account:update-password` | `node scripts/updateAccountPassword.mjs` |
| `account:create-temp-access` | `node scripts/createTemporaryStoreAccess.mjs` |
| `seed:stores` | `node scripts/seedStores.mjs` |
| `accounts:delete:dry-run` | `node scripts/deleteExistingAccounts.mjs` |
| `accounts:delete` | `node scripts/deleteExistingAccounts.mjs --execute` |

FAIT OBSERVÉ : aucun script `test`, `test:*`, `vitest`, `jest`, `playwright`, `emulators:exec`, ni `coverage`. Confirme MASTER-QUA-001.

### 1.2 Outils de test présents

FAIT OBSERVÉ — `package.json:33-44` (`devDependencies`) : **aucun outil de test**. Présents : `@eslint/js`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react-swc`, `eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `vite`, `workbox-window`.

FAIT OBSERVÉ — `package.json:21-32` (`dependencies`) : `firebase ^12.2.1`, `firebase-admin ^13.10.0` (MASTER-SEC-010 : en `dependencies`, pas en `devDependencies`), `react ^19.1.1`, `react-dom ^19.1.1`, `react-router-dom ^7.9.1`, `recharts`, `tailwindcss ^4.1.13`, `@tailwindcss/vite`, `vite-plugin-pwa ^1.0.3`, `xlsx ^0.18.5`.

Aucune dépendance `vitest`, `@testing-library/*`, `jsdom`, `@firebase/rules-unit-testing`, `playwright`.

### 1.3 Outils de test absents

Pour réaliser la stratégie complète, il manque :
- Runner de tests : `vitest` (installé à l'Étape 1).
- Mesure de couverture : `@vitest/coverage-v8` (installé séparément à l'Étape 7, PAS à l'Étape 1).
- Environnement DOM : `jsdom`.
- Tests de composants React : `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
- Tests de règles Firestore : `@firebase/rules-unit-testing`.
- Outil émulateur : `firebase-tools` (CLI Firebase) — non listé dans `package.json`, doit être disponible globalement ou en `devDependencies`.
- (Optionnel) E2E : `@playwright/test`.

### 1.4 Contraintes spécifiques

FAITS OBSERVÉS et contraintes induites :

- **React 19.1.1** (`package.json:25`). `@testing-library/react` doit être ≥ 16 pour supporter React 19 (les versions 14.x ciblent React 18). À VÉRIFIER au moment de l'installation.
- **Vite 7.1.x** (`package.json:42`). Vitest doit être en ligne 3.x (Vitest 3 supporte Vite 7). À VÉRIFIER : la compatibilité exacte Vitest/Vite 7 doit être confirmée par la matrice officielle au moment de l'installation.
- **Firebase client 12.2.1** (`package.json:23`). `@firebase/rules-unit-testing` doit être aligné sur les dépendances réelles du projet. La version exacte n'est PAS présupposée ici : elle est déterminée par la commande unique exacte `npm view @firebase/rules-unit-testing version peerDependencies` avant installation (cf. Étape 5). Le résultat de cette commande doit être lu avant l'installation ; la version compatible sera choisie à partir de ce résultat (compatibilité avec `firebase`, `firebase-admin` et Node.js installés) ; aucune version ne doit être inventée ou figée à l'avance.
- **ESM pur** : `package.json:5` déclare `"type": "module"`. Toute config de test (`vitest.config`, fixtures, setup) doit être en ESM (`import`/`export`), pas en CommonJS (`require`).
- **PWA** (`vite.config.js:16-142`) : `VitePWA` est activé y compris en dev (`devOptions.enabled: true`, `vite.config.js:22-25`). Le Service Worker peut interférer avec l'environnement de test jsdom. RECOMMANDATION : configurer une variable d'environnement de test pour neutraliser le plugin PWA dans la config de test (cf. section 9.4).
- **Compilation SWC** (`@vitejs/plugin-react-swc`, `vite.config.js:2,14`). Vitest s'appuie sur la transformation Vite ; le plugin SWC reste compatible mais devra être présent dans la config de test pour transformer le JSX.
- **firebase.json minimal** : FAIT OBSERVÉ — `firebase.json:1-6` ne contient QUE `{ "firestore": { "rules": "firestore.rules" } }`. **Il n'y a AUCUNE section `emulators`.** C'est un prérequis manquant : l'émulateur Firestore (port, host) n'est pas configuré. RECOMMANDATION (section 8 Étape 5) : ajouter une section `emulators` à `firebase.json` AVANT d'exécuter les tests de règles. Cette modification de `firebase.json` est un changement de configuration, pas de comportement métier — à isoler.

---

## 2. Outils recommandés

### 2.1 Vitest
**Rôle :** runner de tests natif Vite ; réutilise `vite.config.js` (plugins React SWC, Tailwind), évite une double configuration de transformation. Exécute les tests unitaires (fonctions pures), composants (avec jsdom) et sert d'orchestrateur pour les tests de règles Firestore.
**Version recommandée :** `^3` (Vitest 3.x), justification : c'est la ligne compatible avec Vite 7. La version mineure exacte est à figer au moment de l'installation.
**Compatibilité confirmée :** Vite 7 — À VÉRIFIER contre la matrice officielle Vitest au moment de l'installation. React 19 / Firebase 12 — Vitest est agnostique du framework, OUI sur le principe.
**Dépendances nécessaires :** `vitest`.
**Risques d'intégration :** interaction avec `VitePWA` dans `vite.config.js` (cf. 9.4) ; la section `test` doit désactiver le SW en mode test. ESM pur requis.
**Décision :** INCLURE dans Lot 0.
**Justification de la décision :** prérequis fondamental de MASTER-QUA-001 ; sans runner, aucun test n'existe.

### 2.2 @vitest/coverage-v8
**Rôle :** mesure de couverture via le moteur V8 intégré (pas d'instrumentation babel/istanbul, plus rapide et compatible SWC).
**Version recommandée :** alignée sur la version exacte de `vitest` (les deux packages doivent partager la même version mineure).
**Compatibilité confirmée :** OUI si version identique à Vitest.
**Dépendances nécessaires :** `@vitest/coverage-v8`.
**Risques d'intégration :** désynchronisation de version avec `vitest` (Vitest refuse de démarrer si les versions divergent). `@vitest/coverage-istanbul` est une alternative mais inutile ici (V8 suffit et évite l'instrumentation babel incompatible avec SWC).
**Décision :** INCLURE dans Lot 0 (Étape 7, après les premiers tests verts).
**Justification de la décision :** critère d'acceptation du Lot 0 (couverture mesurable) ; v8 préféré à istanbul pour la cohérence avec SWC.

### 2.3 @testing-library/react
**Rôle :** rendu et requêtage de composants React isolés (ex. `SignInForm.jsx`, `ClientForm.jsx`).
**Version recommandée :** `^16` (16.x est la première ligne supportant React 19).
**Compatibilité confirmée :** React 19 — OUI pour 16.x (À VÉRIFIER pour le numéro de patch exact). Vite 7 — indépendant. Firebase 12 — indépendant.
**Dépendances nécessaires :** `@testing-library/react`.
**Risques d'intégration :** une version < 16 échouerait avec React 19 (API `act`/`createRoot`). Nécessite jsdom et un cleanup automatique (cf. 9.3).
**Décision :** INCLURE dans Lot 0 (Étape 2).
**Justification de la décision :** nécessaire pour caractériser le comportement UI du signup (MASTER-SEC-008) et des formulaires ; sans cela, seules les fonctions pures et les règles seraient couvertes.

### 2.4 @testing-library/jest-dom
**Rôle :** matchers DOM (`toBeInTheDocument`, `toHaveValue`, etc.) pour les assertions de composants.
**Version recommandée :** `^6`.
**Compatibilité confirmée :** OUI (agnostique du runner, fonctionne avec Vitest via import dans le setup).
**Dépendances nécessaires :** `@testing-library/jest-dom`.
**Risques d'intégration :** doit être importé dans le fichier de setup Vitest (`import '@testing-library/jest-dom'`), sinon les matchers ne sont pas reconnus.
**Décision :** INCLURE dans Lot 0 (Étape 2).
**Justification de la décision :** confort et lisibilité des assertions de composants ; faible coût.

### 2.5 @testing-library/user-event
**Rôle :** simulation d'interactions utilisateur réalistes (saisie, clic, focus) pour les tests de formulaires.
**Version recommandée :** `^14`.
**Compatibilité confirmée :** OUI avec @testing-library/react 16.
**Dépendances nécessaires :** `@testing-library/user-event`.
**Risques d'intégration :** API asynchrone (`await user.click(...)`) ; oublier `await` produit des tests instables.
**Décision :** INCLURE dans Lot 0 (Étape 2).
**Justification de la décision :** nécessaire pour caractériser le parcours de saisie du formulaire de transaction et du signup.

### 2.6 jsdom
**Rôle :** DOM virtuel pour exécuter les tests de composants React sous Vitest (environnement `jsdom`).
**Version recommandée :** dernière ligne stable compatible Node utilisé localement (`^25` ou ultérieure ; figer au moment de l'installation).
**Compatibilité confirmée :** OUI (jsdom est l'environnement standard de Vitest pour le DOM).
**Dépendances nécessaires :** `jsdom`.
**Risques d'intégration :** jsdom n'implémente pas les Service Workers ni IndexedDB complets — les tests touchant la persistance Firestore offline (`src/config/firebase.js:82-89`) ne doivent PAS s'exécuter en jsdom mais via l'émulateur.
**Décision :** INCLURE dans Lot 0 (Étape 1).
**Justification de la décision :** requis dès qu'un composant React est rendu ; les tests purs (helpers, calcul de soldes) peuvent rester en environnement `node`.

### 2.7 @firebase/rules-unit-testing
**Rôle :** initialiser un environnement de test connecté à l'émulateur Firestore, créer des contextes authentifiés (boutique A, boutique B, non connecté), tester `allow/deny` des règles `firestore.rules`.
**Version recommandée :** AUCUNE version figée présupposée (ni `9.x`, ni `^4`, ni autre). La version est déterminée par la procédure de vérification de l'Étape 5, via la commande unique exacte :
```
npm view @firebase/rules-unit-testing version peerDependencies
```
Le résultat de cette commande doit être lu avant l'installation ; la version compatible sera choisie à partir de ce résultat ; aucune version ne doit être inventée ou figée à l'avance. La version retenue doit être compatible avec les versions de `firebase`, `firebase-admin` et Node.js effectivement installées (cf. `package.json` / `package-lock.json`). Ne pas installer une version arbitraire sans cette vérification.
**Compatibilité confirmée :** À VÉRIFIER au moment de l'installation via `npm view` (alignement avec les dépendances réelles). ESM — À VÉRIFIER que le package expose un point d'entrée ESM.
**Dépendances nécessaires :** `@firebase/rules-unit-testing` + CLI Firebase (`firebase-tools`) pour démarrer l'émulateur.
**Risques d'intégration :** version désalignée avec `firebase` ; ESM/CJS ; émulateur non configuré dans `firebase.json` (cf. 1.4). Nécessite que `firebase.json` ait une section `emulators`.
**Décision :** INCLURE dans Lot 0 (Étape 5).
**Justification de la décision :** le « backend » d'AKAYIS est constitué des règles Firestore (MASTER_AUDIT section 1) ; les findings CRITIQUES (SEC-001/002/003) sont des règles. Sans ces tests, aucune caractérisation de l'isolation inter-boutiques n'est possible.

### 2.8 firebase-admin (déjà en dependencies)
**Rôle dans les tests :** seeder l'émulateur (créer des documents de départ avec des droits élevés contournant les règles) si nécessaire. `@firebase/rules-unit-testing` fournit déjà `withSecurityRulesDisabled` pour seeder sans Admin ; firebase-admin n'est donc PAS requis pour les tests de règles.
**Version recommandée :** déjà présent `^13.10.0` (`package.json:24`).
**Compatibilité confirmée :** OUI (utilisé uniquement côté Node dans `scripts/`).
**Dépendances nécessaires :** aucune nouvelle.
**Risques d'intégration :** MASTER-SEC-010 — `firebase-admin` est en `dependencies`, pas en `devDependencies`. NE PAS le déplacer dans le Lot 0 (changement de dépendance hors périmètre ; relève du Lot 5). Tout import de `firebase-admin` dans un test doit être documenté explicitement (cf. 9.6).
**Décision :** EXCLURE comme dépendance de seeding au Lot 0 (préférer `withSecurityRulesDisabled` de `@firebase/rules-unit-testing`).
**Justification de la décision :** éviter d'introduire le SDK Admin dans le chemin de test alors qu'une primitive native existe ; réduit le risque d'accès production accidentel.

### 2.9 Playwright (E2E)
**Rôle :** parcours utilisateur complets (login → navigation → transaction) dans un vrai navigateur.
**Version recommandée :** `@playwright/test` ligne courante (si retenu ultérieurement).
**Compatibilité confirmée :** indépendant du framework, OUI.
**Dépendances nécessaires :** `@playwright/test` + téléchargement des navigateurs.
**Risques d'intégration :** lourd (binaires navigateurs, CI), nécessite l'application servie + émulateurs Auth/Firestore ; risque d'utiliser Firebase production si la config d'env n'est pas verrouillée.
**Décision :** REPORTER (Étape 8 optionnelle, conditionnelle).
**Justification de la décision :** les findings CRITIQUES du MASTER_AUDIT sont couvrables par tests de règles (Firestore) + tests unitaires de calcul, sans E2E. Playwright ajoute de la valeur sur les parcours d'auth mais n'est pas un prérequis du filet de sécurité minimal. À évaluer après l'Étape 6.

---

## 3. Architecture de tests proposée

RECOMMANDATION — arborescence à créer (aucun de ces fichiers n'existe aujourd'hui) :

```
tests/
├── unit/           # fonctions pures, utilitaires, helpers, calcul de soldes
├── components/     # composants React isolés
├── integration/    # interactions entre contextes et services
├── firestore/      # règles Firestore via émulateur
├── e2e/            # parcours utilisateur complets (si Playwright retenu — différé)
├── fixtures/       # données de test réutilisables (boutiques A/B, users, transactions)
└── setup/          # configuration globale (setup files, mocks)
```

| Dossier | Contenu type | Runner / environnement | Exemple de fichier |
|---|---|---|---|
| `tests/unit/` | tests de `src/utils/helpers.js` et des méthodes pures de calcul de soldes de `FirestoreService` (`applyInitialTransactionImpact`, etc.) | Vitest, environnement `node` (pas de DOM) | `tests/unit/balanceImpact.test.js`, `tests/unit/helpers.test.js` |
| `tests/components/` | rendu isolé de `SignInForm.jsx`, `ClientForm.jsx`, `TransactionForm.jsx` | Vitest, environnement `jsdom` + Testing Library | `tests/components/SignInForm.test.jsx` |
| `tests/integration/` | enchaînements contexte ↔ service (ex. signup → rollback) avec dépendances mockées ou émulateur Auth | Vitest, `jsdom` ; Auth émulé si possible | `tests/integration/signupRollback.test.jsx` |
| `tests/firestore/` | règles `firestore.rules` via `@firebase/rules-unit-testing` | Vitest exécuté DANS `firebase emulators:exec` | `tests/firestore/globalClients.rules.test.js` |
| `tests/e2e/` | parcours complets (différé) | Playwright | `tests/e2e/login.spec.js` |
| `tests/fixtures/` | constantes de test : `stores.js` (A/B), `users.js`, `transactions.js` | importé par tous | `tests/fixtures/stores.js` |
| `tests/setup/` | `vitest.setup.js` (import jest-dom, cleanup) ; helpers d'init émulateur | chargé via `setupFiles` de la config Vitest | `tests/setup/vitest.setup.js` |

Fichiers de configuration associés (RECOMMANDATION) :
- Section `test` ajoutée à `vite.config.js` OU fichier dédié `vitest.config.js` (préférer un fichier dédié pour isoler la désactivation PWA en mode test — cf. 9.4).
- `firebase.json` : ajout d'une section `emulators` (cf. 1.4 et 8 Étape 5).
- `.firebaserc` : vérifier la présence d'un alias projet de test (ou utiliser `--project` factice avec l'émulateur).

---

## 4. Premier périmètre minimal obligatoire

RECOMMANDATION — priorisation alignée sur les findings CRITIQUES/ÉLEVÉS du MASTER_AUDIT.

| Fonctionnalité | Fichier source | Fonction/symbole | Type de test | Priorité |
|---|---|---|---|---|
| Authentification (login/logout) | `src/context/AuthContext.jsx:160-168` (signin), `fetchUserProfile` `:40-53` | `signin`, `fetchUserProfile` | composant/intégration (Auth émulé) | ÉLEVÉ |
| Séparation boutique A / boutique B | `firestore.rules:20-22`, `:111-153` | `isStoreMember`, `match /clients/{storeId}/**` | Firestore (émulateur) | CRITIQUE |
| Création profil users avec storeId | `firestore.rules:87-92` | `match /users/{userId}` → `allow create` | Firestore | CRITIQUE |
| Lecture globalClients inter-boutiques | `firestore.rules:97-109` | `match /globalClients/{clientId}` → `allow read/update/delete` | Firestore | CRITIQUE |
| Suppression history | `firestore.rules:134` ; `src/services/firestore.js:1098-1100` | `allow delete` (history), `deleteFromHistory` | Firestore | CRITIQUE |
| Modification history | `firestore.rules:131-133` | `allow update` (champs `statut`/`updatedAt`/`notes`) | Firestore | ÉLEVÉ |
| Validation des montants | `firestore.rules:35-40` ; `src/utils/helpers.js:203-205` | `validTransaction` (règle), `validateTransactionForm` (UI) | Firestore + unitaire | ÉLEVÉ |
| Calcul des impacts de soldes réseau | `src/services/firestore.js:711-744`, `:746-761`, `:763-773`, `:652-681` | `applyInitialTransactionImpact`, `reverseInitialTransactionImpact`, `applySettlementImpact`, `applyLiquidityDelta` | unitaire | CRITIQUE |
| Rollback Auth signup incomplet | `src/context/AuthContext.jsx:142-150` | bloc `catch` de `signup` (`deleteUser` limité à `permission-denied`) | intégration (mock Auth, cf. TC-005) | ÉLEVÉ |
| Agrégations dashboard | `src/hooks/useDashboardData.js:12-58`, `src/hooks/useAllTransactions.js:8-33` | `useDashboardData`, `useAllTransactions` | unitaire (hooks, horloge figée) | ÉLEVÉ |

Note FAIT OBSERVÉ : il n'existe PAS de fonction nommée `validateTransaction` purement validatrice. `src/services/firestore.js:1156` définit `validateTransaction(draftId, customStatus, selectedPaymentMethod)` qui est une opération Firestore async (Drafts → History), pas un validateur de payload. La validation de payload côté règles est `validTransaction` (`firestore.rules:35-40`) et côté UI `validateTransactionForm` (`helpers.js:203-205`). Cette nuance est reprise en section 5 (TC-003/TC-004).

---

## 5. Tests de caractérisation à écrire avant tout refactor

Ces tests capturent le comportement ACTUEL (golden tests), sans jugement de correction. Ils ne doivent PAS être écrits dans cette session — ils sont décrits ici.

### TC-001 — Impact d'un dépôt validé sur les soldes
**Comportement actuel à capturer :** un dépôt au statut « Validée » retire `montant` du `stock` du réseau puis ajoute `montant` à la liquidité (via `applyLiquidityDelta`).
**Fichier source concerné :** `src/services/firestore.js:711-744` (`applyInitialTransactionImpact`), s'appuie sur `applyLiquidityDelta` `:652-681` et `adjustBalanceValue`.
**Fonction ou symbole :** `FirestoreService.applyInitialTransactionImpact`
**Entrée de test :** `balances = { Orange: { stock: 1000, liquidite: 500 }, ... }`, `transactionData = { type: 'Dépôt', statut: 'Validée', montant: 200, reseau: 'Orange' }`.
**Résultat attendu (actuel) :** figer la map retournée (stock Orange = 800, liquidité augmentée de 200 sur le premier réseau selon la logique `applyLiquidityDelta`). Capturer la valeur EXACTE produite par le code actuel.
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-QUA-002 (extraction `balanceCalculator.js` au Lot 5 sans changement), MASTER-SEC-004.
**Type :** unitaire

### TC-002 — Impact d'un retrait validé sur les soldes
**Comportement actuel à capturer :** un retrait « Validée » retire `montant` de la liquidité (`applyLiquidityDelta(balances, -amount)`) puis ajoute `montant` au `stock` du réseau (`src/services/firestore.js:737-740`).
**Fichier source concerné :** `src/services/firestore.js:737-740`
**Fonction ou symbole :** `applyInitialTransactionImpact` (branche retrait validé)
**Entrée de test :** `balances` avec liquidité suffisante, `transactionData = { type: 'Retrait', statut: 'Validée', montant: 300, reseau: 'Moov' }`.
**Résultat attendu (actuel) :** figer la map ; vérifier aussi le cas liquidité insuffisante → `applyLiquidityDelta` lève `Error('Liquidite insuffisante...')` (`:677`).
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-QUA-002, MASTER-SEC-004.
**Type :** unitaire

### TC-003 — Validation d'une transaction valide (payload)
**Comportement actuel à capturer :** un payload de transaction conforme est accepté ; le validateur UI `validateTransactionForm` renvoie une valeur truthy quand client/montant/type sont présents et montant > 0.
**Fichier source concerné :** `src/utils/helpers.js:203-205` (`validateTransactionForm`) ; règle `firestore.rules:35-40` (`validTransaction`).
**Fonction ou symbole :** `validateTransactionForm` (unitaire) ; `validTransaction` (Firestore).
**Entrée de test :** unitaire : `validateTransactionForm({nom,prenom}, '500', 'Dépôt')`. Firestore : `create` history avec `{ type: 'Dépôt', montant: 500, clientId: 'c1', statut: 'Validée', storeId: A }`.
**Résultat attendu (actuel) :** unitaire → truthy ; Firestore → ALLOW pour un membre de la boutique A.
**Priorité :** ÉLEVÉ
**Risque couvert :** MASTER-QUA-005 (clarification types), base pour Lot 2.
**Type :** unitaire + Firestore

### TC-004 — Validation d'une transaction invalide (montant nul, type inconnu)
**Comportement actuel à capturer :** `validateTransactionForm` renvoie falsy si montant <= 0 ou type absent. Côté règle, `validTransaction` (`firestore.rules:38`) exige `montant > 0` et `montant <= 100000000` et un `type` dans la liste (qui inclut des valeurs UTF-8 corrompues — MASTER-SEC-007).
**Fichier source concerné :** `src/utils/helpers.js:203-205` ; `firestore.rules:35-40`.
**Fonction ou symbole :** `validateTransactionForm`, `validTransaction`
**Entrée de test :** unitaire : `validateTransactionForm(client, '0', 'Dépôt')` et `validateTransactionForm(client, '500', '')`. Firestore : `create` avec `montant: 0` (DENY attendu) ; `create` avec `type: 'DÃ©pÃ´t'` (capture du comportement ACTUEL : ALLOW, car le type corrompu est listé `firestore.rules:37`).
**Résultat attendu (actuel) :** unitaire → falsy ; Firestore montant 0 → DENY ; Firestore type corrompu → **ALLOW** (comportement actuel à figer, à ne pas corriger en Lot 0 — relève de Lot 3B/D7).
**Priorité :** ÉLEVÉ
**Risque couvert :** MASTER-SEC-007.
**Type :** unitaire + Firestore

### TC-005 — Rollback Auth en cas d'échec après création du compte
**Comportement actuel à capturer :** dans `signup`, après `createUserWithEmailAndPassword`, si `batch.commit()` échoue, le rollback `deleteUser` ne se déclenche QUE si `error.code` commence par `permission-denied` (`src/context/AuthContext.jsx:144`). Pour toute autre erreur (réseau, quota), le compte Auth reste orphelin.
**Fichier source concerné :** `src/context/AuthContext.jsx:142-150`
**Fonction ou symbole :** bloc `catch` de `signup`
**Décision Lot 0 (explicite) :** utiliser un **mock Auth** via `vi.mock('firebase/auth')` (et mock du module Firestore au besoin) — **PAS l'émulateur Auth**.
- Ordre obligatoire : la configuration du mock Auth (`vi.mock('firebase/auth', ...)`) **doit apparaître et être validée AVANT** l'exécution de TC-005. TC-005 dépend de la fixture mock Auth, **pas** de l'émulateur Auth. Aucune exécution de TC-005 ne peut précéder la mise en place et la validation du mock.
- L'émulateur Auth reste **hors périmètre du Lot 0**. Aucun test du Lot 0 ne peut appeler Firebase Auth en production.
- Justification : réduire le périmètre et le risque du Lot 0. L'émulateur Firestore (Étape 5) ne configure que Firestore ; ajouter l'émulateur Auth élargirait l'infrastructure sans nécessité prouvée pour ce seul TC.
- L'émulateur Auth est **reporté à un lot ultérieur**, sauf démonstration explicite de sa nécessité (par exemple si un mock ne permet pas de reproduire fidèlement le comportement de `deleteUser`).
- Contrainte absolue : **aucun appel à l'authentification de production** ne doit jamais être effectué dans ce test. Le mock interdit tout accès réseau réel.
**Entrée de test :** mocker `createUserWithEmailAndPassword` (succès) puis simuler une erreur NON `permission-denied` (réseau, quota) au `batch.commit()` ; observer si `deleteUser` est appelé.
**Résultat attendu (actuel) :** le compte Auth N'EST PAS supprimé (orphelin) — `deleteUser` n'est pas appelé pour une erreur non `permission-denied`. Figer ce comportement.
**Priorité :** ÉLEVÉ
**Risque couvert :** MASTER-SEC-008.
**Type :** intégration (composant + **mock Auth**, pas d'émulateur Auth en Lot 0)
**Commande de couverture :** TC-005 est exécuté par `npm run test:components` (cf. section 7, qui cible `tests/components tests/integration`). La porte qualité directe et `npm run validate` doivent donc obligatoirement inclure `npm run test:components`, faute de quoi TC-005 ne serait pas exécuté.

### TC-006 — Solde réseau après une série de transactions
**Comportement actuel à capturer :** l'application successive de `applyInitialTransactionImpact` puis `reverseInitialTransactionImpact` sur des transactions en attente ramène les soldes à l'état initial (invariant d'inversion pour le statut « Non Terminées »).
**Fichier source concerné :** `src/services/firestore.js:711-744` et `:746-761`
**Fonction ou symbole :** `applyInitialTransactionImpact` + `reverseInitialTransactionImpact`
**Entrée de test :** appliquer un dépôt « Non Terminées » (montant 200, Orange) puis le reverser ; comparer la map finale à la map initiale.
**Résultat attendu (actuel) :** map finale == map initiale pour le statut pending. Pour le statut « Validée », `reverseInitialTransactionImpact` ne fait RIEN (`:750` ne traite que `isPendingStatus`) — capturer cette asymétrie (lien avec MASTER-SEC-004 : pas de compensation à la suppression d'une transaction validée).
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-SEC-004, MASTER-QUA-002.
**Type :** unitaire

### TC-007 — Lecture globalClients inter-boutiques (règle actuelle permissive)
**Comportement actuel à capturer :** `firestore.rules:98` autorise `read` à tout profil actif (`hasProfile()`), sans filtre `registeredStoreId`. Un membre de la boutique B peut lire un client `registeredStoreId=A`.
**Fichier source concerné :** `firestore.rules:97-109`
**Fonction ou symbole :** `match /globalClients/{clientId}` → `allow read`
**Entrée de test :** émulateur, document `globalClients/x` avec `registeredStoreId=A` ; contexte authentifié utilisateur boutique B.
**Résultat attendu (actuel) :** **ALLOW** (read réussit). Figer ce comportement (sera resserré au Lot 1, décision D2).
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-SEC-002.
**Type :** Firestore

### TC-008 — Suppression d'un document history (règle actuelle permissive)
**Comportement actuel à capturer :** `firestore.rules:134` autorise `delete` à tout membre de la boutique. Aucun `auditLog` n'est écrit (`firestore.rules:151` : `auditLogs.write: if false`).
**Fichier source concerné :** `firestore.rules:134`, `:149-152`
**Fonction ou symbole :** `match /clients/{storeId}/history/{historyId}` → `allow delete`
**Entrée de test :** émulateur, créer un document history dans la boutique A, contexte membre A, tenter `deleteDoc`.
**Résultat attendu (actuel) :** **ALLOW** (suppression réussit, aucune trace). Figer (sera bloqué au Lot 2, décision D3).
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-SEC-003.
**Type :** Firestore

### TC-009 — Création d'un profil users avec storeId arbitraire
**Comportement actuel à capturer :** `firestore.rules:87-92` autorise un utilisateur authentifié à créer `users/{sonUid}` avec un `storeId` quelconque (string), sans vérifier l'existence de `stores/{storeId}` ni `adminUid`.
**Fichier source concerné :** `firestore.rules:87-92`
**Fonction ou symbole :** `match /users/{userId}` → `allow create`
**Entrée de test :** émulateur, nouvel utilisateur Auth (uidB), tenter `create users/{uidB}` avec `{ role:'store_admin', active:true, storeId:'<boutique A>', storeName:'A' }`.
**Résultat attendu (actuel) :** **ALLOW**. Puis vérifier que cet utilisateur peut ensuite lire/écrire `clients/A/history` (escalade). Figer le comportement actuel (corrigé au Lot 1, décision D1).
**Priorité :** CRITIQUE
**Risque couvert :** MASTER-SEC-001.
**Type :** Firestore

### TC-010 — subscribeToHistory sans borne (comportement non paginé)
**Comportement actuel à capturer :** `subscribeToHistory` construit `queryOptions` sans `orderByField` ni `limit` (`src/services/firestore.js:1102-1107`, commentaires lignes 1104-1106). La souscription charge toute la collection `history`.
**Fichier source concerné :** `src/services/firestore.js:1102-1140`
**Fonction ou symbole :** `subscribeToHistory`, déléguant à `subscribeToCollection`
**Entrée de test :** émulateur seedé avec N documents history ; instrumenter le callback pour compter les documents reçus.
**Résultat attendu (actuel) :** le callback reçoit les N documents (aucune borne). Figer (sera paginé au Lot 4).
**Priorité :** MOYEN
**Risque couvert :** MASTER-PERF-001.
**Type :** Firestore (ou intégration service + émulateur)

### TC-011 — Agrégations du dashboard (useDashboardData / useAllTransactions)
**Comportement actuel à capturer :**
- `useAllTransactions` (`src/hooks/useAllTransactions.js:8-33`) fusionne `pendingTransactions` et `completedTransactions` via une `Map` indexée par `transaction.id` ; les transactions complétées **écrasent** les transactions en attente de même `id` ; les transactions sans `id` sont ignorées. Figer l'ordre et la déduplication produits.
- `useDashboardData` (`src/hooks/useDashboardData.js:12-58`) calcule `totalClients`, `monthlyClients` (clients du mois courant via `parsefrenchDate(client.dateAjout)`), `dailyClients` (clients du jour), et `topClient` (libellé de la transaction du jour au montant le plus élevé via `getTopTransaction` + `formatCurrency`, ou `"Aucune transaction aujourd'hui"`).
**Fichiers source concernés :** `src/hooks/useDashboardData.js:12-58`, `src/hooks/useAllTransactions.js:8-33` (dépend aussi de `useTodayTransactions`, `parsefrenchDate`, `chartHelpers`).
**Fonction ou symbole :** `useDashboardData`, `useAllTransactions`
**Déterminisme obligatoire :**
- **Dataset figé** : fixtures de clients et de transactions à valeurs constantes (cf. Étape 3, `tests/fixtures/`), aucune donnée aléatoire ni `Math.random`.
- **Date et heure contrôlées** : `useDashboardData` lit `new Date()` (`useDashboardData.js:16`) pour `today`, le mois et l'année courants. Le test DOIT figer l'horloge via `vi.setSystemTime(new Date('2026-06-17T10:00:00Z'))` (et `vi.useRealTimers()` en `afterEach`), faute de quoi `monthlyClients`/`dailyClients`/`topClient` deviennent non reproductibles.
- **Aucune refactorisation métier** : les hooks sont testés tels quels ; on capture les valeurs EXACTES produites par le code actuel (golden), sans modifier les hooks ni extraire de logique.
**Entrée de test :** clients fixes (certains avec `dateAjout` dans le mois figé, d'autres hors mois) ; `pendingTransactions`/`completedTransactions` fixes avec un doublon d'`id` (pour vérifier l'écrasement) et une transaction du jour au montant le plus élevé.
**Résultat attendu (actuel) :** figer `totalClients`, `monthlyClients`, `dailyClients`, `topClient` et la liste dédupliquée de `useAllTransactions` aux valeurs exactes produites par le code actuel sous l'horloge figée.
**Priorité :** ÉLEVÉ
**Risque couvert :** prérequis du Lot 4 (MASTER-PERF-001 ; MASTER_AUDIT section 8.4 — vérifier que les agrégations restent identiques après pagination), exigence MASTER_AUDIT section 8.1.
**Type :** unitaire (hooks React testés via `renderHook`, environnement `jsdom`)

---

## 6. Tests Firestore obligatoires

Cibles : `firestore.rules` via `@firebase/rules-unit-testing` + émulateur Firestore. Au moins DEUX boutiques A/B (exigence CLAUDE.md « tester les règles avec au moins deux boutiques différentes »). Tous ces tests CAPTURENT le comportement actuel ; aucune règle n'est modifiée en Lot 0.

### 6.1 Collection users

| Acteur | Opération | Résultat attendu (état actuel à capturer) |
|---|---|---|
| Non connecté | `create users/{uid}` | DENY (`firestore.rules:87` exige `signedIn()`) |
| Connecté (uid=userId) | `create users/{uid}` avec `storeId` valide, role `store_admin`, active true | ALLOW |
| Connecté (uid=userId) | `create users/{uid}` avec `storeId` d'une AUTRE boutique | **ALLOW** (MASTER-SEC-001 — `firestore.rules:87-92` ne vérifie pas l'appartenance) |
| Connecté | `update` du rôle d'un AUTRE utilisateur | DENY (`firestore.rules:83-85` limite l'update à `request.auth.uid == userId` et au seul champ `lastLogin`) |
| Membre actif boutique A | `read` de son propre profil | ALLOW (`firestore.rules:80`) |
| Membre actif boutique A | `read` du profil d'un utilisateur boutique B | DENY attendu (`firestore.rules:81` n'autorise que `profile().storeId == resource.data.storeId`) — capturer le résultat réel |

### 6.2 Collection globalClients

| Acteur | Opération (client `registeredStoreId=A`) | Résultat attendu (état actuel) |
|---|---|---|
| Non connecté | `read` | DENY (`hasProfile()` faux) |
| Membre boutique A | `read` client A | ALLOW |
| Membre boutique A | `read` client B | **ALLOW** (`firestore.rules:98` — MASTER-SEC-002) |
| Membre boutique A | `update` client B (ex. `nom`) | **ALLOW** si `registeredStoreId` inchangé (`firestore.rules:104-106`) |
| Membre boutique A | `delete` client B | **ALLOW** (`firestore.rules:108`) |
| Utilisateur désactivé (`active:false`) | `read` | DENY (`hasProfile()` exige `active == true`, `firestore.rules:16`) |

### 6.3 Collection clients/{storeId}/history

| Acteur | Opération | Résultat attendu (état actuel) |
|---|---|---|
| Membre boutique A | `read` history A | ALLOW (`firestore.rules:126`) |
| Membre boutique A | `delete` document history A | **ALLOW** (`firestore.rules:134` — MASTER-SEC-003) |
| Utilisateur boutique B | `read` history A | DENY (`isStoreMember(A)` faux pour B) |
| Non connecté | `read` history A | DENY |

### 6.4 Collection clients/{storeId}/networkBalances

| Acteur | Opération | Résultat attendu (état actuel) |
|---|---|---|
| Membre boutique A | `read` | ALLOW (`firestore.rules:138`) |
| Membre boutique A | `create/update` `balanceId='current'` avec `balances` map quelconque | **ALLOW** (`firestore.rules:139-141` ne valide que `balances is map` — MASTER-SEC-006) |
| Membre boutique A | `update` `balanceId != 'current'` | DENY (`firestore.rules:140` exige `balanceId == 'current'`) |
| Membre boutique A | `delete` | DENY (`firestore.rules:142` : `allow delete: if false`) |

---

## 7. Commandes npm proposées

RECOMMANDATION — scripts à ajouter à `package.json` (à l'Étape correspondante de la section 8, PAS en bloc, PAS dans cette session) :

```json
{
  "scripts": {
    "test": "vitest run --project unit --project components",
    "test:unit": "vitest run tests/unit",
    "test:components": "vitest run tests/components tests/integration",
    "test:firestore": "firebase emulators:exec --only firestore --project demo-akayis-test \"npx vitest run --config vitest.firestore.config.js\"",
    "test:coverage": "vitest run --coverage",
    "validate": "npm run lint && npm run build && npm run test:unit && npm run test:components && npm run test:firestore && npm run test:coverage"
  }
}
```

**IMPORTANT (Correction Codex) :** le script `test` général ne doit JAMAIS inclure `tests/firestore`. Les tests de règles Firestore ne peuvent s'exécuter QUE dans l'enveloppe `emulators:exec` (sinon ils tournent hors émulateur). Deux mécanismes possibles : (a) une configuration Vitest dédiée `vitest.firestore.config.js` ciblant uniquement `tests/firestore`, et une configuration générale excluant ce dossier ; (b) des « projects » Vitest distincts. L'exemple ci-dessus suppose des projets/configs séparés. La forme exacte (`--project` Vitest vs `--config`) est à figer au moment de l'implémentation, l'invariant étant : `npm test` n'exécute pas `tests/firestore`.

**Note PowerShell (Windows) :** le bloc JSON ci-dessus définit des scripts `package.json` ; l'opérateur `&&` du script `validate` est interprété par le shell interne de npm (portable), pas par l'invite. Lorsqu'on tape les commandes **directement dans l'invite PowerShell**, ne jamais utiliser `&&` (syntaxe bash) : chaîner avec `;` et `if ($?)`. Équivalent PowerShell direct de `validate` (les tests Firestore restant dans l'enveloppe `emulators:exec --project demo-akayis-test` via `npm run test:firestore`). La séquence directe doit obligatoirement inclure `npm run test:components` (qui couvre TC-005, mock Auth) — cette étape n'est PAS optionnelle :
```powershell
npm run lint; if ($?) { npm run build }; if ($?) { npm run test:unit }; if ($?) { npm run test:components }; if ($?) { npm run test:firestore }; if ($?) { npm run test:coverage }
```
Utiliser des guillemets doubles pour tout argument contenant des espaces dans PowerShell (ex. l'argument de `firebase emulators:exec`). Toute commande `firebase` impose `--project demo-akayis-test`, sans dépendance implicite sur `.firebaserc`. Le garde-fou `beforeAll` (le `projectId` doit commencer par `demo-`, cf. Étape 5) reste maintenu pour les tests Firestore.

| Commande | Rôle | Quand l'utiliser |
|---|---|---|
| `test` | exécute les suites unit + components/integration (CI / pré-commit), **hors `tests/firestore`** | après chaque changement |
| `test:unit` | tests purs (helpers, calcul de soldes, hooks dashboard), rapides, sans émulateur | boucle de dev sur la logique financière et le dashboard |
| `test:components` | rendu de composants + intégration (signup mock Auth) sous jsdom | dev sur l'UI (signup, formulaires) |
| `test:firestore` | démarre l'émulateur Firestore (projet `demo-akayis-test`) puis exécute les tests de règles via `emulators:exec` | validation de l'isolation inter-boutiques |
| `test:coverage` | rapport de couverture v8 | revue de complétude du filet |
| `validate` | porte de qualité complète : lint + build + unit + components (TC-005, obligatoire) + firestore + coverage | avant de clore un lot |

Note : `test:firestore` suppose la section `emulators` ajoutée à `firebase.json` (Étape 5) et force explicitement `--project demo-akayis-test` (jamais le projet par défaut de `.firebaserc`, qui est un projet de production réel). `build` (`vite build && node scripts/compatCss.mjs`) reste inchangé.

---

## 8. Ordre exact d'installation et de configuration

Chaque étape est atomique, vérifiable, réversible (`git revert` du commit dédié). Un seul changement de dépendance significatif par commit (CLAUDE.md). Aucune de ces étapes n'est exécutée dans cette session.

**Séquence des étapes (ordre logique imposé) :**

| Étape | Objet | Dépendance installée |
|---|---|---|
| 1 | Vitest + jsdom + **smoke test réel** (1 passed) | `vitest`, `jsdom` |
| 2 | React Testing Library, rendu trivial validé | `@testing-library/*` |
| 3 | Fixtures A/B, users, transactions, **dataset dashboard** | aucune |
| 4 | Tests unitaires TC-001..TC-004, TC-006, **TC-011 (dashboard)** | aucune |
| 5 | `@firebase/rules-unit-testing` (**version vérifiée via `npm view`**) + émulateur Firestore + garde-fou `demo-` | `@firebase/rules-unit-testing` |
| 6 | Tests Firestore TC-007..TC-010 + section 6, **dans `emulators:exec --project demo-akayis-test`** ; **TC-005 (mock Auth, hors émulateur)** : la config `vi.mock('firebase/auth')` doit être écrite ET validée AVANT d'exécuter TC-005 | aucune |
| 7 | **Coverage (étape séparée)** + `validate` | `@vitest/coverage-v8` |
| 8 | Playwright (E2E) — **reporté hors Lot 0**, décision post-Lot 0 | (différé) |

Invariants : `@vitest/coverage-v8` n'est PAS installé à l'Étape 1 ; les tests Firestore ne sont JAMAIS lancés hors `emulators:exec` ; toute commande émulateur force `--project demo-akayis-test`.

### Étape 1 — Installer Vitest et jsdom, valider par un smoke test réel
**Commandes (Windows PowerShell) :**
```powershell
npm install --save-dev vitest jsdom
```
Note : la commande d'installation complète couvrant aussi React Testing Library (Étape 2) est, en une seule invocation PowerShell :
```powershell
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
À l'Étape 1 stricte, n'installer que `vitest jsdom` ; les paquets `@testing-library/*` sont installés à l'Étape 2 (un changement de dépendance significatif par commit, CLAUDE.md).
Note : `@vitest/coverage-v8` n'est **PAS** installé à cette étape. Il est installé séparément à l'Étape 7 (Coverage), après que les premiers tests soient verts (cf. Correction Codex « coverage trop tôt »).
**Fichiers à créer ou modifier :**
- `vitest.config.js` (RECOMMANDÉ, fichier dédié) OU section `test` dans `vite.config.js`. Contenu minimal à décrire : `environment: 'node'` par défaut (les tests DOM surchargeront via commentaire `// @vitest-environment jsdom`), `setupFiles: ['tests/setup/vitest.setup.js']`, et neutralisation du plugin PWA en mode test (cf. 9.4).
- `tests/setup/vitest.setup.js` : initialement vide (placeholder).
- `tests/unit/smoke.test.js` : smoke test minimal RÉEL avec au moins une assertion passante, par exemple :
  ```js
  import { describe, it, expect } from 'vitest'

  describe('smoke', () => {
    it('le runner Vitest démarre et exécute un test', () => {
      expect(1 + 1).toBe(2)
    })
  })
  ```
  Ce smoke test prouve que le runner démarre et exécute un test réel et reproductible. Il peut rester en place ou être retiré une fois les vrais tests de caractérisation écrits.
**Commande de validation (Windows PowerShell) :**
```powershell
npx vitest run tests/unit/smoke.test.js
```
Variante avec reporter détaillé :
```powershell
npx vitest run --reporter=verbose tests/unit/smoke.test.js
```
La sortie attendue doit afficher **« 1 passed »** (et exit 0), et **non** « no test files found ». On ne valide jamais l'étape sur une suite vide.
**Critère d'arrêt :** si Vitest plante au démarrage (conflit Vite 7 / plugin PWA / SWC) ou si la sortie indique « no test files found » alors que le smoke test existe, investiguer avant de continuer. Ne pas masquer l'erreur.

### Étape 2 — Installer React Testing Library
**Commandes (Windows PowerShell) :**
```powershell
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
**Fichiers à créer ou modifier :**
- `tests/setup/vitest.setup.js` : ajouter `import '@testing-library/jest-dom'` et un `afterEach(cleanup)` (cf. 9.3).
**Commande de validation (Windows PowerShell) :** écrire UN test trivial (render d'un `<div>`) dans `tests/components/` puis exécuter :
```powershell
npx vitest run --config vitest.config.js tests/components
```
**Critère d'arrêt :** si les matchers jest-dom ne sont pas reconnus → vérifier l'import dans le setup et le chargement de `setupFiles`. Si React 19 échoue → confirmer `@testing-library/react` ≥ 16.

### Étape 3 — Configurer les fixtures
**Fichiers à créer :**
- `tests/fixtures/stores.js` : boutique A (`{ id: 'store-a', name: 'Boutique A', active: true }`) et boutique B (`store-b`), IDs FIXES.
- `tests/fixtures/users.js` : admin boutique A (`store_admin`, `active:true`, `storeId:'store-a'`), membre boutique B, user désactivé (`active:false`).
- `tests/fixtures/transactions.js` : dépôt valide, retrait valide, montant nul, type invalide, type UTF-8 corrompu (`'DÃ©pÃ´t'`).
- `tests/fixtures/dashboard.js` (pour TC-011) : dataset figé pour `useDashboardData`/`useAllTransactions` — liste de clients à `dateAjout` FIXES (certains dans le mois de référence `2026-06`, certains hors mois, un le jour de référence `2026-06-17`), et `pendingTransactions`/`completedTransactions` FIXES dont un doublon d'`id` (pour figer l'écrasement pending→completed) et une transaction du jour au montant maximal. Aucune valeur aléatoire, aucune date relative.
**Commande de validation (Windows PowerShell) :** importer les fixtures dans un test unitaire vide puis exécuter :
```powershell
npx vitest run --config vitest.config.js tests/unit
```
**Critère d'arrêt :** si l'import ESM échoue → vérifier que les fixtures utilisent `export` (pas `module.exports`) et que la config respecte `"type": "module"`.

### Étape 4 — Écrire les tests unitaires des fonctions pures et des hooks dashboard (TC-001 à TC-004, TC-006, TC-011)
**Fichiers à créer :**
- `tests/unit/balanceImpact.test.js` (TC-001, TC-002, TC-006) : instancie `FirestoreService` et appelle directement `applyInitialTransactionImpact` / `reverseInitialTransactionImpact` / `applyLiquidityDelta` (méthodes pures, sans I/O).
- `tests/unit/helpers.test.js` (TC-003, TC-004 volet UI) : teste `validateTransactionForm`, `getAvailableActions`, `validateTransactionAction` de `src/utils/helpers.js`.
- `tests/unit/dashboardData.test.js` (TC-011) : teste `useDashboardData` et `useAllTransactions` via `renderHook` (environnement `jsdom`), avec dataset figé (fixtures, cf. Étape 3) et horloge figée via `vi.setSystemTime`/`vi.useRealTimers`. Aucune refactorisation des hooks.
- TC-005 (rollback signup) ne fait PAS partie de cette Étape 4 : il relève de `tests/integration/` (Étape 6) et utilise un **mock Auth** (`vi.mock('firebase/auth')`), pas l'émulateur Auth (cf. décision TC-005). Sa configuration de mock Auth doit être écrite et validée AVANT l'exécution de TC-005.
**Commande de validation (Windows PowerShell) :**
```powershell
npx vitest run --config vitest.config.js tests/unit
```
Équivalent via script npm : `npm run test:unit`.
**Critère d'arrêt :** si les fonctions de calcul ne peuvent pas être appelées sans déclencher d'I/O Firebase (constructeur de `FirestoreService`), documenter le couplage observé (sans corriger) ; au besoin n'instancier que la classe et appeler les méthodes pures. L'extraction en `balanceCalculator.js` reste un travail de Lot 5, PAS de Lot 0. Pour TC-011, si l'horloge n'est pas figée, `monthlyClients`/`dailyClients`/`topClient` varient : figer `vi.setSystemTime` avant tout calcul.

### Étape 5 — Installer @firebase/rules-unit-testing et configurer l'émulateur
**Procédure de vérification de version AVANT installation (obligatoire) — commande unique exacte, Windows PowerShell :**
```powershell
npm view @firebase/rules-unit-testing version peerDependencies
```
Le résultat de cette commande doit être lu avant l'installation ; la version compatible sera choisie à partir de ce résultat ; aucune version ne doit être inventée ou figée à l'avance. Vérifier la compatibilité de la version retournée avec les versions de `firebase`, `firebase-admin` et Node.js **effectivement installées** (listées dans `package.json` / `package-lock.json`). La version retenue doit être compatible avec ces dépendances réelles. Ne PAS installer une version arbitraire ni présupposer une ligne majeure (ni `9.x`, ni `^4`, ni autre) sans cette vérification.
**Commande d'installation (la version exacte est figée d'après la vérification ci-dessus), Windows PowerShell :**
```powershell
npm install --save-dev @firebase/rules-unit-testing
```
**Prérequis :** CLI Firebase disponible (`firebase-tools`) ; émulateur Firestore installé.
**Fichiers à créer ou modifier :**
- `firebase.json` : AJOUTER une section `emulators` (host/port Firestore). FAIT OBSERVÉ : `firebase.json:1-6` ne contient aucune section `emulators` actuellement — cet ajout est obligatoire. Changement de configuration isolé (un commit dédié).
- `tests/firestore/setup.js` : `initializeTestEnvironment({ projectId: 'demo-akayis-test', firestore: { rules: readFileSync('firestore.rules') } })` ; helpers `authedContext(uid, claims)` et seeding via `withSecurityRulesDisabled`.
- **Garde-fou anti-production obligatoire** dans CHAQUE fichier de test Firestore (`beforeAll`), qui échoue immédiatement si le projet n'est pas un projet de démo :
  ```js
  // Guard obligatoire dans chaque fichier de test Firestore
  beforeAll(() => {
    const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID
    if (!projectId || !projectId.startsWith('demo-')) {
      throw new Error(`SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`)
    }
  })
  ```
- **`.firebaserc` : AVERTISSEMENT.** FAIT OBSERVÉ (Codex, `.firebaserc:1-4`) : le projet par défaut pointe vers un **projet de production réel** (`taofic-ajagbe`). Il ne doit **JAMAIS** être utilisé implicitement pour ces tests. Toute commande émulateur DOIT forcer explicitement `--project demo-akayis-test`. Ne JAMAIS se reposer sur le projet par défaut de `.firebaserc`.
**Commande de validation (enveloppe `emulators:exec` obligatoire, Windows PowerShell) :**
```powershell
firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.firestore.config.js"
```
**Pourquoi l'enveloppe `emulators:exec` est obligatoire :** elle démarre l'émulateur Firestore AVANT d'exécuter les tests, exporte les variables d'environnement d'émulateur (`FIRESTORE_EMULATOR_HOST`, `GCLOUD_PROJECT`) attendues par `@firebase/rules-unit-testing`, puis arrête proprement l'émulateur APRÈS. Lancer `npx vitest run` directement ne démarre aucun émulateur : les tests de règles échoueraient ou, pire, tenteraient d'atteindre un backend réel.
**AVERTISSEMENT :** ne JAMAIS lancer `npx vitest run` directement sur `tests/firestore` sans l'enveloppe `emulators:exec --project demo-...`. Le script npm correspondant est `test:firestore` (cf. section 7), qui encapsule cette commande.
**Critère d'arrêt :** si l'émulateur ne démarre pas → vérifier la section `emulators` de `firebase.json` et la version de la CLI. Si le garde-fou `beforeAll` lève l'erreur SÉCURITÉ → vérifier que `--project demo-akayis-test` est bien passé et que `GCLOUD_PROJECT` est exporté par `emulators:exec`. Si l'import ESM de `@firebase/rules-unit-testing` échoue → vérifier l'alignement de version avec Firebase (cf. `npm view` ci-dessus).

### Étape 6 — Écrire les tests Firestore (TC-007 à TC-010 + section 6)
**Fichiers à créer :**
- `tests/firestore/users.rules.test.js` (section 6.1 + TC-009)
- `tests/firestore/globalClients.rules.test.js` (section 6.2 + TC-007)
- `tests/firestore/history.rules.test.js` (section 6.3 + TC-008 + TC-010)
- `tests/firestore/networkBalances.rules.test.js` (section 6.4)
- `tests/integration/signupRollback.test.jsx` (TC-005) — utilise un **mock Auth** (`vi.mock('firebase/auth')`) et un mock du module Firestore au niveau du module ; **PAS l'émulateur Auth** en Lot 0 (cf. décision TC-005). La configuration `vi.mock('firebase/auth', ...)` doit apparaître et être validée AVANT l'exécution de TC-005 ; TC-005 dépend de cette fixture mock, pas de l'émulateur Auth (hors périmètre Lot 0). Aucun appel d'authentification réel ni en production.
**Commande de validation (Windows PowerShell) :**
```powershell
firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.firestore.config.js"
```
Équivalent via script npm : `npm run test:firestore` (encapsule l'enveloppe `emulators:exec --project demo-akayis-test`). Le test TC-005, étant un mock pur, s'exécute hors émulateur :
```powershell
npx vitest run --config vitest.config.js tests/components tests/integration
```
Équivalent via script npm : `npm run test:components`.
**Critère d'arrêt :** si un test de caractérisation révèle un comportement inattendu (différent du MASTER_AUDIT), DOCUMENTER dans `FINDINGS_LOT_0.md` — NE PAS corriger (section 11).

### Étape 7 — Installer et configurer le coverage, puis la commande validate
**Commandes (installation isolée du coverage, séparée de l'Étape 1), Windows PowerShell :**
```powershell
npm install --save-dev @vitest/coverage-v8
```
Le package `@vitest/coverage-v8` doit partager la même version mineure que `vitest` (Vitest refuse de démarrer si les versions divergent). Il n'est installé qu'ici, une fois les premiers tests verts — JAMAIS dans l'installation initiale de l'Étape 1.
**Fichiers à modifier :**
- `package.json` : ajouter les scripts de la section 7 (dont `test:coverage`).
- `vitest.config.js` (ou section `test`) : `coverage: { provider: 'v8', reportsDirectory: 'coverage', reporter: ['text', 'html'] }`.
**Commande de coverage (Windows PowerShell) :**
```powershell
npx vitest run --config vitest.config.js --coverage
```
Équivalent via script npm : `npm run test:coverage`.
**Commande de validation combinée (Windows PowerShell) :** la porte de qualité complète s'enchaîne avec `;` et `if ($?)` (jamais `&&`, qui est de la syntaxe bash). Elle doit obligatoirement exécuter `npm run test:components` (porte couvrant TC-005, mock Auth) — l'omettre permettrait de valider le Lot 0 sans TC-005. Les tests Firestore restent obligatoirement dans l'enveloppe `emulators:exec --project demo-akayis-test` (via `npm run test:firestore`) :
```powershell
npm run lint; if ($?) { npm run build }; if ($?) { npm run test:unit }; if ($?) { npm run test:components }; if ($?) { npm run test:firestore }; if ($?) { npm run test:coverage }
```
Équivalent via script npm : `npm run validate`.
**Commandes individuelles de la porte (Windows PowerShell) :**
```powershell
npm run lint
npm run build
```
**Critère d'arrêt :** si le coverage révèle des zones critiques non couvertes (calcul de soldes, règles inter-boutiques, hooks dashboard), planifier des tests supplémentaires AVANT de clore le lot. Le seuil chiffré est à décider (cf. section 13 / décision humaine).

### Étape 8 (optionnelle) — Playwright pour les tests E2E
**Condition d'activation :** UNIQUEMENT si les tests de règles + unitaires ne couvrent pas suffisamment les parcours d'authentification (login/logout réels, navigation protégée).
**Commandes (décrites, non exécutées), Windows PowerShell :**
```powershell
npm install --save-dev @playwright/test
npx playwright install
```
**Critère de décision :** à évaluer après l'Étape 6. Probablement REPORTÉ hors Lot 0 (cf. décision 2.9).

---

## 9. Risques

### 9.1 Incompatibilités de versions
- React 19 + `@testing-library/react` : exige ≥ 16. Une version 14.x échoue à `render`. À VÉRIFIER au moment de l'installation.
- Vitest + plugins Vite : `VitePWA` (`vite.config.js:16`) et `@tailwindcss/vite` (`vite.config.js:3,15`) sont chargés par Vitest s'il réutilise `vite.config.js`. Risque de surcoût/d'effets de bord du SW. Préférer un `vitest.config.js` dédié qui n'inclut PAS le plugin PWA.
- ESM pur (`package.json:5` `"type": "module"`) : `@firebase/rules-unit-testing` et toutes les fixtures doivent fonctionner en ESM. À VÉRIFIER le point d'entrée ESM du package rules-unit-testing.

### 9.2 Utilisation accidentelle de Firebase production
- Risque : un test lit `.env` de production et écrit dans Firestore production (interdit CLAUDE.md). FAIT OBSERVÉ (Codex, `.firebaserc:1-4`) : le projet par défaut de `.firebaserc` est un projet de production réel (`taofic-ajagbe`) — il ne doit JAMAIS être utilisé implicitement.
- Garde-fou OBLIGATOIRE (commande) : toute commande émulateur force `--project demo-akayis-test` ; `VITE_USE_FIREBASE_EMULATORS=true` ; pas de credentials de production dans l'environnement de test.
- Garde-fou OBLIGATOIRE (code, exécutable dès l'Étape 5) : `beforeAll` dans chaque fichier de test Firestore qui jette une erreur si `process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID` est absent ou ne commence pas par `demo-` (cf. Étape 5 pour le snippet exact). Ce garde-fou échoue AVANT toute opération, même si la commande oubliait `--project`.
- TC-005 (signup) utilise un **mock Auth** (`vi.mock('firebase/auth')`) : aucun appel d'authentification de production possible.
- Aucun appel réseau réel dans les tests unitaires ni de règles : les tests de règles passent EXCLUSIVEMENT par l'émulateur via `@firebase/rules-unit-testing`.
- FAIT OBSERVÉ : `src/config/firebase.js:82-89` active la persistance IndexedDB en prod selon `VITE_FIRESTORE_OFFLINE_PERSISTENCE` ; les tests ne doivent pas charger cette config (rester en `node`/jsdom contrôlé).

### 9.3 Tests non déterministes
- Timestamps : `serverTimestamp()` (utilisé dans `AuthContext.jsx:110` et le service) est non déterministe. Utiliser des valeurs fixes dans les fixtures et, dans l'émulateur, comparer la présence du champ plutôt que sa valeur exacte.
- Horloge du dashboard (TC-011) : `useDashboardData` lit `new Date()` (`src/hooks/useDashboardData.js:16`) pour `today`/mois/année. Le test DOIT figer l'horloge via `vi.setSystemTime` (et `vi.useRealTimers()` en `afterEach`) avec une date fixe alignée sur le dataset de fixtures, sinon `monthlyClients`/`dailyClients`/`topClient` ne sont pas reproductibles.
- Listeners `onSnapshot` (`src/services/firestore.js`, `subscribeToHistory:1139`) : ne jamais les brancher sur le vrai Firestore ; utiliser l'émulateur et `unsubscribe` en `afterEach`.
- State global : Testing Library nécessite `afterEach(cleanup)` dans `tests/setup/vitest.setup.js`. L'environnement de test de règles doit appeler `clearFirestore()` entre les tests.

### 9.4 PWA et service worker
- FAIT OBSERVÉ : `vite.config.js:22-25` active le PWA en dev (`devOptions.enabled: true`). En test, le SW peut intercepter des requêtes et fausser les rendus.
- RECOMMANDATION : utiliser un `vitest.config.js` dédié qui n'enregistre PAS `VitePWA`, ou conditionner le plugin par `process.env.VITEST` / mode test dans `vite.config.js`. Décision de structure à valider (humaine).

### 9.5 Variables d'environnement
- Tests unitaires : aucune dépendance à des variables Firebase (fonctions pures).
- Tests Firestore : un fichier `.env.test` dédié pointant vers l'émulateur ; `projectId` `demo-*`.
- Ne JAMAIS committer de valeurs de production dans les fixtures ou dans `.env.test`.

### 9.6 Dépendances Admin
- MASTER-SEC-010 : `firebase-admin` est en `dependencies` (`package.json:24`). NE PAS le déplacer en Lot 0.
- Pour seeder l'émulateur, préférer `withSecurityRulesDisabled` de `@firebase/rules-unit-testing` plutôt que `firebase-admin`.
- Si un test importe `firebase-admin`, le documenter explicitement et vérifier qu'il ne s'exécute que contre l'émulateur (`FIRESTORE_EMULATOR_HOST` défini).

---

## 9 bis. Baseline qualité et code mort (fin Lot 0)

Cette baseline est produite **à la toute fin du Lot 0**, une fois le filet de tests en place et vert, **sans aucune suppression ni refactorisation**. Elle sert UNIQUEMENT de point de comparaison reproductible pour l'audit qualité/code mort approfondi des lots suivants (lien avec la réserve Codex C9 et `MASTER_AUDIT.md:786-792` — le code mort suspect n'est pas prouvé).

Contenu minimal de la baseline (relevés bruts, sans interprétation destructive) :

- résultat de `npm run lint` ;
- résultat de `npm run build` ;
- résultat de `npm run test:unit` ;
- résultat de `npm run test:firestore` ;
- résultat de `npm run test:coverage` ;
- inventaire initial des fichiers de `src/`, `scripts/` et des fichiers de configuration ;
- liste des routes de l'application ;
- liste des scripts npm (cf. section 1.1) ;
- liste des dépendances directes (cf. sections 1.2) ;
- liste des imports/exports ou candidats potentiellement inutilisés, **clairement marqués comme « non confirmés »** (aucune suppression sans audit approfondi des imports statiques, imports dynamiques, scripts, configurations et usages métier) ;
- taille ou nombre de lignes des fichiers principaux ;
- état git propre (`git status --short` vide hors fichiers de test ajoutés) ;
- date, branche et hash du commit local utilisé comme référence.

Précisions explicites — cette baseline :

- **ne prouve PAS** qu'un fichier est mort ;
- **ne permet AUCUNE suppression immédiate** (interdiction CLAUDE.md : ne jamais supprimer un fichier au seul signalement d'un outil) ;
- sert uniquement de point de comparaison pour l'audit qualité/code mort approfondi des lots suivants ;
- devra être enregistrée dans un futur document dédié — **sans le créer maintenant** (aucun fichier n'est créé par cette stratégie ; ce livrable est planifié, non produit ici).

---

## 10. Critères d'acceptation du Lot 0

| Critère | Commande de vérification | Artefact attendu |
|---|---|---|
| Vitest configuré et opérationnel (smoke test réel) | `npx vitest run tests/unit/smoke.test.js` | Exit 0, **« 1 passed »** (jamais « no test files found ») |
| Tests unitaires TC-001 à TC-004, TC-006 et TC-011 (dashboard) passants | `npm run test:unit` | Exit 0, tests verts figeant le comportement actuel (horloge figée pour TC-011) |
| TC-005 (rollback signup, mock Auth) passant | `npm run test:components` (mock Auth, pas d'émulateur Auth) | Exit 0 |
| Émulateur Firestore démarrable | `firebase emulators:start --only firestore --project demo-akayis-test` | Port configuré ouvert (après ajout section `emulators` à `firebase.json`) |
| Tests Firestore TC-007 à TC-010 + section 6 passants | `npm run test:firestore` (enveloppe `emulators:exec --project demo-akayis-test`) | Exit 0, tous les scénarios A/B couverts ; garde-fou `demo-` actif |
| Comportements actuels figés | chaque TC passe contre le code ACTUEL non modifié | baseline documentée (golden) |
| Lint propre | `npm run lint` | Exit 0 |
| Build propre | `npm run build` | Exit 0, `dist/` généré |
| Coverage mesuré | `npm run test:coverage` | rapport HTML ; seuil chiffré à décider (décision humaine) |
| Aucun accès Firebase production | revue manuelle des env de test | `projectId` `demo-*`, `VITE_USE_FIREBASE_EMULATORS=true` partout |
| Dépôt propre | `git status` | seuls les fichiers de test + config de test ajoutés |

---

## 11. Ce qui est explicitement hors périmètre du Lot 0

Liste ferme et non négociable :

- Correction des règles Firestore, même si un test révèle une faille (MASTER-SEC-001/002/003/006/007). Noter, ne pas corriger.
- Suppression de fichiers, même identifiés morts (MASTER-QUA-006). Interdiction CLAUDE.md.
- Refactorisation de `FirestoreService` (MASTER-QUA-002) ou extraction de `balanceCalculator.js` (relève du Lot 5).
- Simplification de `getDocument` (MASTER-QUA-003, Lot 5).
- Pagination de `subscribeToHistory` (MASTER-PERF-001, Lot 4).
- Ajout de fonctionnalités ou de pages.
- Déplacement de `firebase-admin` en `devDependencies` (MASTER-SEC-010, Lot 5).
- Mise à jour groupée des dépendances (sauf installation des outils de test, un changement à la fois).
- Déploiement (Firebase/Netlify/Vercel), `git push`, modification des règles production.
- Exécution des scripts Admin (`scripts/*.mjs`) hors émulateur.
- Modification du comportement métier des fonctions testées.

Si un test révèle un comportement inattendu : **documenter dans `docs/audit/consolidated/FINDINGS_LOT_0.md`, ne pas corriger.**

Note de nuance : l'ajout d'une section `emulators` à `firebase.json` (Étape 5) et l'ajout d'une config de test (`vitest.config.js`, `tests/`) sont des ajouts de configuration de test, PAS des changements de comportement métier — ils restent dans le périmètre du Lot 0, mais doivent être commités séparément des tests eux-mêmes pour faciliter le `git revert`.

---

## 11 bis. Conditions levées après validation Codex

Cette section relie les réserves du rapport `docs/audit/consolidated/CODEX_VALIDATION_OF_LOT_0_STRATEGY.md` aux sections de CE document qui les corrigent : les 7 réserves de la validation initiale (C1-C7), les 4 réserves de la revalidation (C8-C11), et la réserve bloquante de la revalidation finale (C12 — `npm run test:components` absent de la séquence de validation directe, BLOC-01). Toutes ont été traitées par révision documentaire (aucune correction de code, aucune dépendance installée).

| Réserve Codex | Identifiant | Section corrigée | Statut |
|---|---|---|---|
| Absence de test dashboard (`useDashboardData` / `useAllTransactions`) | C1 | Section 5 TC-011 ; Section 4 (ligne dashboard) ; Étape 3 (fixtures `dashboard.js`) ; Étape 4 ; Section 9.3 | Levée |
| Validation avec suite vide à l'Étape 1 | C2 | Étape 1 (smoke test réel, « 1 passed ») ; Section 10 (critère Vitest) | Levée |
| Coverage mélangé à l'installation initiale | C3 | Étape 1 (retrait de `@vitest/coverage-v8`) ; Étape 7 (installation isolée) ; Section 2.2 | Levée |
| Tests Firestore lancés sans `emulators:exec` | C4 | Étape 5 (enveloppe obligatoire + pourquoi + avertissement) ; Section 7 (`test:firestore`, `test` exclut `tests/firestore`) ; Section 10 | Levée |
| Absence du flag `--project demo-` | C5 | Étape 5 (`--project demo-akayis-test` + garde-fou `beforeAll`) ; Section 7 ; Section 9.2 ; Section 10 | Levée |
| Version de `@firebase/rules-unit-testing` non vérifiée | C6 | Section 1.4 ; Section 2.7 ; Étape 5 (procédure `npm view`) | Levée |
| TC-005 sans décision explicite sur le mock Auth | C7 | Section 5 TC-005 (décision : mock Auth) ; Section 4 ; Étape 4 ; Étape 6 ; Section 9.2 | Levée |
| Commande npm view exacte manquante | C8 | Section 1.4 ; Section 2.7 ; Étape 5 (`@firebase/rules-unit-testing`, commande unique `npm view ... version peerDependencies`) | Levée |
| Baseline qualité/code mort absente | C9 | Section 9 bis (Baseline qualité et code mort, fin Lot 0) | Levée |
| Ordre TC-005 incohérent | C10 | Section 4 ; Section 5 TC-005 (mock validé avant exécution) ; Étape 4 ; Étape 6 (séquence) | Levée |
| Commandes PowerShell incomplètes | C11 | Section 7 (note PowerShell) ; Étapes 1, 2, 3, 4, 5, 6, 7, 8 (commandes PowerShell complètes) | Levée |
| `npm run test:components` absent de la séquence validate | C12 | Section validate / porte qualité finale (Section 7 note PowerShell ; Étape 7 ; bloc package.json `validate`) ; Section 5 TC-005 | Levée |

Note : ces réserves sont levées au niveau documentaire (stratégie, ordre, garde-fous). Leur mise en œuvre effective reste à réaliser lors de l'exécution du Lot 0, dans le respect des interdictions de CLAUDE.md.

---

## 12. Fichiers consultés

```
CLAUDE.md
docs/audit/consolidated/MASTER_AUDIT.md
docs/audit/consolidated/CODEX_VALIDATION_OF_MASTER_AUDIT.md
package.json
vite.config.js
firebase.json
eslint.config.js
firestore.rules
src/utils/ (liste : chartHelpers.js, errorHandler.js, logger.js, cacheManager.js,
            initializeApp.jsx, performanceMonitor.jsx, contextFactory.jsx, constants.js,
            authHelpers.js, excelUtils.js, helpers.js)
src/utils/helpers.js                (lecture complète 1-391)
src/services/firestore.js           (1-50 structure ; 652-781 fonctions de calcul ;
                                     1098-1158 deleteFromHistory/subscribeToHistory/validateTransaction)
src/context/AuthContext.jsx         (1-60 structure ; 95-158 signup + rollback)
src/hooks/useDashboardData.js       (lecture complète 1-59 — agrégations dashboard, new Date())
src/hooks/useAllTransactions.js     (lecture complète 1-33 — déduplication par id)
```

Recherche transverse : `grep applyInitialTransactionImpact|deleteFromHistory|subscribeToHistory ... src/services/firestore.js` (confirmation des numéros de ligne des symboles cités).

---

## 13. Bilan de modification

Fichiers source modifiés : aucun.
Fichier documentaire modifié : `docs/audit/consolidated/LOT_0_TEST_STRATEGY.md` (ce fichier), corrections documentaires C1-C7 (validation Codex initiale), C8-C11 (revalidation Codex : commande `npm view` exacte, baseline qualité/code mort, ordre TC-005, commandes PowerShell complètes) et C12 (revalidation finale : ajout de `npm run test:components` dans la séquence de validation directe et alignement de `npm run validate`, BLOC-01), cf. section 11 bis.
Dépendances installées : aucune.
Tests écrits / exécutés : aucun (ce document les DÉCRIT).
Émulateur lancé : aucun. Accès Firebase : aucun. Commit / push / déploiement : aucun.

Décisions humaines requises avant de lancer le Lot 0 :
- Seuil de couverture chiffré (critère d'acceptation section 10).
- Structure de la config de test : `vitest.config.js` dédié vs section `test` dans `vite.config.js` (impacte la neutralisation PWA, section 9.4) ; et structure de séparation `tests/firestore` (config dédiée vs projects Vitest, section 7).
- Report confirmé de Playwright hors Lot 0 (section 2.9 / Étape 8) — décision à acter post-Lot 0.
- Confirmation des numéros de version exacts (« À VÉRIFIER » des sections 1.4 et 2 ; `npm view` pour `@firebase/rules-unit-testing`, Étape 5) au moment de l'installation, contre les matrices officielles.

Décisions désormais tranchées dans ce document (plus en attente) :
- TC-005 : mock Auth en Lot 0, émulateur Auth reporté (section 5 TC-005).
- Projet de test forcé : `demo-akayis-test` avec garde-fou `beforeAll` (Étape 5, section 9.2).

Vérification finale à exécuter MANUELLEMENT (non exécutée par ce document), Windows PowerShell :
```powershell
git diff --stat
git status --short
```
État attendu : un seul fichier nouveau (non tracké) `docs/audit/consolidated/LOT_0_TEST_STRATEGY.md`. Le fichier `CLAUDE.md` apparaissait déjà modifié au démarrage de la session (modification préexistante, non touchée ici). Aucun commit ne doit être effectué.
```
```
