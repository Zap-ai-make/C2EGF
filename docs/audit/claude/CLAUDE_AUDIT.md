# AUDIT PRÉ-V2 — AKAYIS CRM

**Date :** 2026-06-17
**Branche :** `audit/pre-v2-local`
**Auditeurs :** Sous-agent `codebase-explorer` (lecture seule) + vérification manuelle des findings critiques
**Périmètre :** Lecture statique du code — aucun accès à Firebase production — aucune exécution de script

---

## Table des matières

1. [Architecture](#1-architecture)
2. [Flux métier](#2-flux-métier)
3. [Sécurité](#3-sécurité)
4. [Qualité](#4-qualité)
5. [Performance](#5-performance)
6. [Priorités avant V2](#6-priorités-avant-v2)
7. [Questions métier à poser au client](#7-questions-métier-à-poser-au-client)
8. [Éléments nécessitant validation Codex](#8-éléments-nécessitant-validation-codex)
9. [Limites de l'audit](#9-limites-de-laudit)
10. [Fichiers consultés](#10-fichiers-consultés)
11. [Bilan de modification](#11-bilan-de-modification)

---

## 1. Architecture

### Point d'entrée et montage React

`src/main.jsx` monte l'arbre React en `StrictMode`. Le Service Worker est enregistré automatiquement par `vite-plugin-pwa` via un script injecté dans `index.html`.

### Routes (`src/App.jsx`)

Toutes les routes sont protégées par `ProtectedRoute`. Aucune route 404 n'est déclarée — une URL inconnue rend un contenu vide sans fallback visible.

| Route | Page |
|---|---|
| `/` | Dashboard |
| `/clients` | Clients |
| `/transactions` | Transactions |
| `/historique` | Historique |
| `/formulaire` | Formulaire (ajout client) |
| `/profil` | Profil |

### Arbre des contextes

```
Router
  AuthProvider
    ThemeProvider
      NetworkConfigProvider
        ClientsProvider
          TransactionsProvider
            ErrorBoundary
              AppContent (routes)
```

### Collections Firestore et chemins

| Collection logique | Chemin Firestore | Isolation boutique |
|---|---|---|
| USERS | `users` | Non (racine) |
| STORES | `stores` | Par storeId dans isStoreMember |
| CLIENTS | `globalClients` | Non — **voir SEC-001** |
| DRAFTS | `clients/{storeId}/drafts` | Oui |
| HISTORY | `clients/{storeId}/history` | Oui |
| NETWORK_BALANCES | `clients/{storeId}/networkBalances` | Oui |
| AUDIT_LOGS | `clients/{storeId}/auditLogs` | Oui (write: false — non écrit par l'app) |

### Composants clés

- `Layout.jsx` : NavBar + NetworkCardsDrawer + Chatbot flottant + slot children
- `ProtectedRoute.jsx` : garde selon `currentUser`, `userProfile`, `activeStore`
- `ErrorBoundary.jsx` : encadre `AppContent`
- `TransactionForm.jsx` : **628 lignes**, responsabilités multiples (formulaire, validation, modale, toasts)
- `FirestoreService` (`src/services/firestore.js`) : singleton de **1 321 lignes** — voir QUA-001

### Hooks personnalisés

| Hook | Rôle |
|---|---|
| `useAllTransactions.js` | Combine pendingTransactions + completedTransactions |
| `useClients.js` | Proxy sur ClientsContext |
| `useClientsFilter.js` | Filtrage local des clients |
| `useDashboardData.js` | Agrégations statistiques dashboard |
| `useExcelOperations.js` | Export/import XLSX |
| `useFormValidation.js` | Validation générique de formulaire |
| `useHistoriqueFilters.js` | Filtrage date/recherche sur l'historique |
| `useNetworkCards.js` | Lecture/écriture des soldes réseau |
| `usePagination.js` | Pagination locale en mémoire |
| `useSimpleNetworkData.js` | Compatibilité — redirige vers useNetworkCards |
| `useToast.js` | Gestion des notifications |
| `useTodayTransactions.js` | Filtre transactions du jour |
| `useUserActivity.js` | Statistiques d'activité utilisateur |

### Stack technique confirmée

| Technologie | Version | Usage |
|---|---|---|
| React | 19 | UI |
| Vite + SWC | 7 | Bundler |
| React Router DOM | v7 | Routing SPA |
| Firebase (client) | 12.2.1 | Auth + Firestore |
| Firebase Admin | 13.10.0 | Scripts Node.js uniquement |
| Tailwind CSS | v4 | Styles |
| Recharts | — | Graphiques |
| xlsx | — | Export Excel |
| vite-plugin-pwa | — | PWA + Workbox |
| n8n (webhook) | externe | Chatbot (non audité) |

### Intégrations externes

- Firebase Authentication + Firestore
- n8n (webhook `VITE_N8N_WEBHOOK_URL`) — chatbot flottant, non audité
- Aucune autre API externe identifiée

### PWA

- Workbox via vite-plugin-pwa : `NetworkFirst` pour Firebase, `CacheFirst` pour polices
- `enableMultiTabIndexedDbPersistence` activé en prod (conditionnel `VITE_FIRESTORE_OFFLINE_PERSISTENCE=true`)
- Soldes réseau persistés en localStorage — voir SEC-008

### Scripts administratifs (`scripts/`)

| Script | Risque | Flag dangereux |
|---|---|---|
| `deleteExistingAccounts.mjs` | Suppression de TOUS les comptes Auth | `--execute --confirm-delete-all` + variable d'env |
| `seedStores.mjs` | Création de boutiques | Non |
| `createTemporaryStoreAccess.mjs` | Accès temporaire | Non |
| `diagnoseAccount.mjs` | Diagnostic (lecture) | Non |
| `updateAccountPassword.mjs` | Mise à jour MDP | Non |
| `generatePasswordResetLink.mjs` | Lien de reset | Non |
| `testClientLogin.mjs` | Test de connexion | Non |
| `compatCss.mjs` | Post-build CSS | Non |

### Cloud Functions (`functions/`)

Le dossier `functions/` ne contient que `node_modules` — **aucun fichier source JavaScript n'est présent**. Aucune Cloud Function n'est déployée depuis ce dépôt.

---

## 2. Flux métier

### a) Authentification

Fichier : `src/context/AuthContext.jsx`

- **signup** : crée le compte Firebase Auth, puis écrit en batch `stores/{storeId}` + `users/{uid}`. Rollback du compte Auth orphelin uniquement si `error.code.startsWith('permission-denied')` — **voir SEC-007**.
- **signin** : `setPersistence(browserLocalPersistence)` + connexion + chargement profil Firestore + mise à jour `lastLogin`.
- **logout** : `signOut(auth)` + nettoyage des états.
- `onAuthStateChanged` (ligne ~258) : rechargement complet du profil à chaque changement d'état.

### b) Rôles

Un seul rôle défini : `store_admin` (`AUTH_ROLES.STORE_ADMIN`). Pas de caissier ni d'autre rôle dans le code. La vérification côté Firestore Rules porte sur `active == true` et `storeId is string` — le rôle n'est pas vérifié dans les règles.

### c) Boutiques

Créées à l'inscription ou via `seedStores.mjs`. Un utilisateur est rattaché à exactement une boutique via `storeId` dans son profil. L'isolation opère via `isStoreMember(storeId)` dans les règles.

### d) Clients (`globalClients`)

- CRUD dans `ClientsContext.jsx` via `firestoreService`.
- La collection `globalClients` est partagée toutes boutiques confondues. Le champ `registeredStoreId` identifie l'origine mais les règles permettent à tout utilisateur authentifié de lire tous les clients — **voir SEC-001**.
- Suppression définitive sans corbeille ni archive.

### e) Dépôts

- Type `Dépôt` (UI) / `Depot` (normalisé).
- Statut « Non Terminées » → stock réseau diminue du montant.
- Statut « Validée » → stock réseau diminue ET liquidité augmente.

### f) Retraits

- Type `Retrait`.
- Statut « Non Terminées » → stock réseau augmente.
- Paiement → liquidité diminue, stock augmente.

### g) Crédits

Le type `Crédit` est absent de `TRANSACTION_TYPES` affiché (`constants.js:15-18`) mais la logique existe encore dans `firestore.js`, `helpers.js` et les règles. Le crédit semble volontairement désactivé pour ce client — à confirmer.

### h) Transactions en attente (drafts)

Stockées dans `clients/{storeId}/drafts`. `validateTransaction` déplace atomiquement le document vers `history` et supprime le draft, en ajustant les soldes.

### i) Historique

Listener `onSnapshot` sur `clients/{storeId}/history` — **sans `.limit()`** — voir PERF-001. Filtrage et pagination entièrement en mémoire.

### j) Soldes réseau / Dashboard

- Document unique `clients/{storeId}/networkBalances/current` via `onSnapshot`.
- Sauvegardé en localStorage comme cache hors ligne — voir SEC-008.
- Dashboard agrège les transactions en mémoire (`useDashboardData`, `useTodayTransactions`).

### k) Exports Excel

`useExcelOperations.js` + `excelUtils.js` via la librairie `xlsx`. Export des clients. L'export de l'historique depuis `ActionButtons.jsx` n'a pas été audité en détail.

### l) Mode hors ligne

- `enableMultiTabIndexedDbPersistence` (conditionnel en prod).
- Service Worker Workbox.
- Soldes réseau en localStorage.
- Migration des anciennes transactions localStorage vers Firestore au premier chargement.

---

## 3. Sécurité

### [SEC-001] CRITIQUE | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `firestore.rules:97-109`
**Symbole :** `match /globalClients/{clientId}` → `allow read: if hasProfile()`
**Preuve directe :**
```
97  match /globalClients/{clientId} {
98    allow read: if hasProfile();
```
Aucune vérification de `profile().storeId == resource.data.registeredStoreId` dans la règle `read`.

**Description :** Tout utilisateur avec un profil actif peut lire l'intégralité de la collection `globalClients`, quelle que soit la boutique.

**Scénario concret :** Un utilisateur de la boutique B interroge `globalClients` via l'API Firestore et obtient les noms, prénoms, numéros personnels et codes agents de tous les clients de la boutique A.

**Impact :** Fuite de données personnelles (PII) entre boutiques concurrentes. Violation du secret commercial.

**Test recommandé :** Via l'émulateur Firestore, créer deux boutiques A et B, puis vérifier qu'un token Auth de la boutique B permet de lire un document `globalClients` dont `registeredStoreId` appartient à la boutique A.

**Correction envisagée :** Ajouter à la règle `read` :
```
allow read: if hasProfile() && resource.data.registeredStoreId == profile().storeId;
```
⚠️ Vérifier que les requêtes applicatives existantes fonctionnent encore avec ce filtre ajouté.

---

### [SEC-002] CRITIQUE | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `firestore.rules:125-134`
**Symbole :** `match /clients/{storeId}/history/{historyId}` → `allow delete: if isStoreMember(storeId)`
**Preuve directe :**
```
134   allow delete: if isStoreMember(storeId);
```

**Description :** Un membre d'une boutique peut supprimer n'importe quel document de l'historique des transactions. La piste d'audit financière peut être détruite sans trace.

**Scénario concret :** Un opérateur efface une transaction litigieuse via le bouton de suppression présent dans l'UI (`deleteFromHistory` → `deleteDocument`).

**Impact :** Impossibilité de reconstituer l'historique financier. Risque comptable et légal pour le client.

**Test recommandé :** Tenter de supprimer une transaction via l'UI et vérifier que le document Firestore est bien effacé.

**Correction envisagée :** Changer `allow delete` en `allow delete: if false` sur `history`. La suppression ne devrait être possible que via Admin SDK avec écriture préalable dans `auditLogs`.

---

### [SEC-003] ÉLEVÉ | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `scripts/deleteExistingAccounts.mjs`
**Symbole :** flags `--execute`, `--confirm-delete-all` + variable d'env

**Description :** Ce script supprime TOUS les comptes Firebase Auth du projet si les trois garde-fous sont activés simultanément.

**Scénario concret :** Un développeur confond la commande dry-run avec la commande réelle, ou configure accidentellement la variable d'environnement dans son shell.

**Impact :** Perte de tous les accès client — indisponibilité totale du service.

**Test recommandé :** Vérifier que `npm run accounts:delete:dry-run` ne déclenche aucune suppression.

**Correction envisagée :** Retirer ce script du dépôt ou le déplacer dans un dépôt d'administration séparé à accès restreint. Ajouter une documentation de risque explicite si conservé.

---

### [SEC-004] ÉLEVÉ | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `package.json:24`
**Symbole :** `"firebase-admin": "^13.10.0"` dans `dependencies` (pas `devDependencies`)

**Description :** `firebase-admin` est une dépendance de production. Bien que Vite ne l'inclue pas dans le bundle client (ses imports sont dans des fichiers `.mjs` Node), son placement dans `dependencies` crée un risque d'import accidentel dans un fichier JSX.

**Scénario concret :** Un développeur importe accidentellement `firebase-admin` dans un composant React — le SDK Admin se retrouve dans le bundle client, exposant potentiellement le chemin de la service account.

**Impact :** Risque faible immédiat mais potentiel élevé si l'import accidentel survient.

**Test recommandé :** `grep -r "firebase-admin" src/` — doit retourner zéro résultat.

**Correction envisagée :** Déplacer `firebase-admin` vers `devDependencies`.

---

### [SEC-005] ÉLEVÉ | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `firestore.rules:37`
**Symbole :** `validTransaction` — valeurs de type corrompues
**Preuve directe :**
```
data.type in ['Dépôt', 'Depot', 'Retrait', 'Crédit', 'Credit', 'DÃ©pÃ´t', 'CrÃ©dit']
```

**Description :** Les règles Firestore contiennent des valeurs UTF-8 corrompues (`DÃ©pÃ´t`, `CrÃ©dit`). Cela indique que les règles ont été éditées depuis un environnement mal configuré en encodage. Les valeurs corrompues ne devraient jamais être produites par l'application cliente, mais leur présence ouvre théoriquement la possibilité d'écrire des transactions avec ces types invalides.

**Impact :** Cohérence des données compromise — données corrompues potentiellement acceptées par les règles.

**Test recommandé :** Via l'émulateur, tenter d'écrire un document avec `type: 'DÃ©pÃ´t'` et vérifier s'il est accepté.

**Correction envisagée :** Nettoyer les valeurs corrompues des règles et s'assurer que le déploiement des règles utilise un encodage UTF-8 correct.

---

### [SEC-006] MOYEN | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `firestore.rules:48-66`
**Symbole :** `validStatus`, `isPendingStatus` — valeurs de statut corrompues
**Preuve directe :**
```
'Non TerminÃ©es', 'ValidÃ©e', 'RemboursÃ©e', 'AnnulÃ©e'
```

**Description :** Même problème d'encodage que SEC-005 pour les statuts de transaction.

**Impact :** Idem SEC-005.

**Correction envisagée :** Nettoyer les valeurs corrompues après vérification des valeurs réelles présentes en base.

---

### [SEC-007] MOYEN | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/context/AuthContext.jsx:143-149`
**Symbole :** rollback du compte Auth orphelin dans `signup`
**Preuve directe :**
```js
if (createdUser && error?.code?.startsWith('permission-denied')) {
  await deleteUser(createdUser)
}
```

**Description :** La suppression du compte Auth orphelin n'est déclenchée que si l'erreur est `permission-denied`. Toute autre erreur (réseau, quota Firestore, etc.) laisse un compte Auth créé sans profil Firestore.

**Scénario concret :** Coupure réseau pendant le signup → compte Auth créé mais sans profil → utilisateur bloqué ("Compte non rattaché à une boutique") avec un compte inutilisable.

**Impact :** Comptes orphelins accumulés, expérience utilisateur dégradée, nécessité d'intervention manuelle.

**Test recommandé :** Simuler une erreur réseau juste après `createUserWithEmailAndPassword` dans l'émulateur.

**Correction envisagée :** Tenter la suppression du compte Auth orphelin pour toute erreur, pas seulement `permission-denied` :
```js
if (createdUser) {
  try { await deleteUser(createdUser) } catch { /* log */ }
}
```

---

### [SEC-008] MOYEN | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/context/NetworkConfigContext.jsx:17-48`
**Symbole :** `NETWORK_DATA_STORAGE_KEY`, `saveNetworkDataToStorage`

**Description :** Les soldes réseau (stock et liquidité financière) sont persistés en localStorage en clair.

**Scénario concret :** Une extension de navigateur compromise lit les soldes via `localStorage.getItem(NETWORK_DATA_STORAGE_KEY)`.

**Impact :** Fuite des données financières opérationnelles (stocks, liquidités) accessibles à tout script XSS ou extension malveillante.

**Test recommandé :** Ouvrir les DevTools → Application → Local Storage, chercher la clé correspondante.

**Correction envisagée :** Ce stockage est un cache de fallback hors ligne légitime. Acceptable si le risque XSS est faible, mais la décision doit être documentée explicitement. Envisager de ne stocker que les métadonnées, pas les montants absolus.

---

### [SEC-009] MOYEN | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/config/firebase.js:82-89`
**Symbole :** `enableMultiTabIndexedDbPersistence`

**Description :** Cette API est dépréciée dans Firebase JS SDK v9+ et absente de la documentation Firebase v12. Elle est remplacée par `initializeFirestore` avec `persistentMultipleTabManager`.

**Impact :** Risque de rupture lors d'une mise à jour majeure du SDK Firebase (la fonction pourrait être retirée sans préavis).

**Test recommandé :** Vérifier si un warning de dépréciation apparaît dans la console navigateur en production.

**Correction envisagée :** Migrer vers :
```js
import { initializeFirestore, persistentMultipleTabManager } from 'firebase/firestore'
const db = initializeFirestore(app, { localCache: persistentMultipleTabManager() })
```

---

### [SEC-010] FAIBLE | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/config/firebase.js:97-103`
**Symbole :** `export const firebaseInfo`

**Description :** `projectId` et `authDomain` sont exposés dans le bundle JS client. Ceci est inhérent au fonctionnement de Firebase Web (les règles Firestore protègent les données, pas le projectId).

**Impact :** Faible — un attaquant peut identifier le projet Firebase mais ne peut pas accéder aux données sans respecter les règles.

**Test recommandé :** Inspecter le bundle JS en production pour confirmer la présence de ces valeurs.

**Correction envisagée :** Aucune modification nécessaire. Documenter que la sécurité repose sur les règles Firestore, pas sur l'obfuscation du projectId.

---

## 4. Qualité

### [QUA-001] ÉLEVÉ | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/services/firestore.js`
**Symbole :** classe `FirestoreService` — 1 321 lignes

**Description :** Le service concentre trop de responsabilités : CRUD générique, cache avec TTL, pool de listeners `onSnapshot`, transactions atomiques, logique de calcul des impacts de soldes (`applyInitialTransactionImpact`, `reverseInitialTransactionImpact`, `applySettlementImpact`, `applyLiquidityDelta`), et migration de données.

**Impact :** Impossible de tester unitairement la logique de calcul sans mocker toute la classe. Risque élevé de régression lors de l'ajout de fonctionnalités V2.

**Test recommandé :** Tenter d'écrire un test unitaire de `applyInitialTransactionImpact` sans dépendance réseau.

**Correction envisagée :** Extraire la logique de calcul des soldes dans un module pur `balanceCalculator.js` (fonctions sans état).

---

### [QUA-002] MOYEN | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/utils/constants.js:12-18`
**Symbole :** `NETWORK_OPTIONS`, `TRANSACTION_TYPES`

**Description :** `NETWORK_OPTIONS` ne liste qu'Orange alors que Moov, Telecel, Coris, Sank ont des codes définis dans `networkConfig.js`. `TRANSACTION_TYPES` n'expose pas le type `Crédit` alors que la logique existe dans `firestore.js` et les règles.

**Impact :** Un développeur V2 qui ignore ce contexte pourrait supposer que le crédit est absent ou que tous les réseaux sont actifs.

**Correction envisagée :** Ajouter un commentaire documentant les choix client :
```js
// Désactivé pour ce client — Moov/Telecel/Coris/Sank à réactiver en V2
// Crédit volontairement absent de l'UI — logique conservée pour V2
```

---

### [QUA-003] MOYEN | CONFIANCE : ÉLEVÉE

**Fichier :** `src/pages/Historique.jsx:21-39`
**Symbole :** `handleDateChange`, `handleSearch`, `handleSearchInputChange`, `handleResetToToday`, `handleDaySelect`

**Description :** Ces cinq handlers sont des wrappers d'une ligne autour des fonctions du hook, sans valeur ajoutée.

**Correction envisagée :** Utiliser directement les fonctions du hook dans le JSX.

---

### [QUA-004] MOYEN | CONFIANCE : MOYENNE (hypothèse partielle)

**Fichier :** `src/data/clients.js`, `src/data/transactions.js`
**Symbole :** `clientsInitiaux = []`, `transactionsInitiales = []`

**Description :** Ces fichiers ne contiennent que des tableaux vides. Aucun import statique n'a été trouvé dans `src/`. Ils semblent être des vestiges de l'ancienne architecture locale (avant Firestore).

**Hypothèse :** OUI — des imports dynamiques ou via barrels non explorés pourraient exister.

**Correction envisagée :** Appliquer le protocole de suppression CLAUDE.md (vérification complète des imports statiques et dynamiques avant toute action).

---

### [QUA-005] MOYEN | CONFIANCE : MOYENNE (hypothèse partielle)

**Fichiers :** `src/utils/initializeApp.jsx`, `src/utils/performanceMonitor.jsx`, `src/utils/contextFactory.jsx`

**Description :** Aucun import direct de ces fichiers n'a été trouvé dans l'arbre React principal. `initializeApp.jsx` importe `performanceMonitor.jsx` en interne, mais aucun composant ne semble importer `initializeApp.jsx`.

**Hypothèse :** OUI — un import indirect ou via barrel est possible.

**Correction envisagée :** Grep approfondi avant toute décision. Ne pas supprimer sans preuve exhaustive.

---

### [QUA-006] MOYEN | CONFIANCE : ÉLEVÉE

**Fichier :** `src/utils/cacheManager.js:200-225`
**Symbole :** `withCache` (décorateur legacy)

**Description :** Ce décorateur utilise la syntaxe de décorateur legacy (`target, propertyKey, descriptor`) non supportée nativement avec Vite + SWC sans plugin dédié. Il n'est pas utilisé dans le code source.

**Correction envisagée :** Retirer ce décorateur ou le remplacer par un wrapper de fonction standard.

---

### [QUA-007] MOYEN | CONFIANCE : ÉLEVÉE

**Fichier :** `src/services/firestore.js:302-316`
**Symbole :** `getDocument`

**Description :** Utilise `getDocs(query(..., where('__name__', '==', docRef)))` pour lire un document unique, alors que `getDoc(docRef)` serait direct, moins coûteux et plus lisible.

**Correction envisagée :** Remplacer par `getDoc(docRef)` directement.

---

### [QUA-008] FAIBLE | CONFIANCE : ÉLEVÉE

**Fichier :** `src/constants/authMessages.js:39-40`
**Symbole :** `AUTH_SUCCESS.PASSWORD_RESET_EMAIL_SENT`, `AUTH_SUCCESS.PASSWORD_RESET_SENT`

**Description :** Deux constantes distinctes avec une valeur identique.

**Correction envisagée :** Conserver une seule constante et mettre à jour les références.

---

### [QUA-009] FAIBLE | CONFIANCE : ÉLEVÉE

**Fichier :** `src/components/transactions/TransactionForm.jsx:214-224`
**Symbole :** `confirmationMessage` + `void confirmationMessage`

**Description :** Une variable est construite puis passée à `void` pour éviter un warning ESLint — elle n'est pas utilisée, révélant une refactorisation incomplète.

**Correction envisagée :** Supprimer la variable ou l'utiliser.

---

### [QUA-010] FAIBLE | CONFIANCE : ÉLEVÉE

**Fichier :** `scripts/compatCss.mjs`
**Symbole :** imports `browserslist`, `lightningcss`

**Description :** Ces dépendances sont utilisées dans le script de build post-Vite mais non déclarées explicitement dans `package.json`. Elles sont présentes en tant que transitives mais pourraient disparaître lors d'une mise à jour.

**Correction envisagée :** Ajouter `browserslist` et `lightningcss` en `devDependencies`.

---

### [QUA-011] INFORMATION | CONFIANCE : ÉLEVÉE

**Description :** Aucun fichier de test (`.test.js`, `.spec.js`, `.test.jsx`) n'a été trouvé dans le projet. L'audit repose entièrement sur la lecture statique du code.

**Impact :** Toute régression introduite lors du développement V2 sera détectée uniquement à l'exécution ou par l'utilisateur final.

**Correction envisagée :** Établir une suite de tests de caractérisation pour les fonctions critiques (`applyInitialTransactionImpact`, `validateTransaction`) avant toute modification V2.

---

## 5. Performance

### [PERF-001] ÉLEVÉ | CONFIANCE : ÉLEVÉE ✅ Vérifié

**Fichier :** `src/services/firestore.js:1102-1139`
**Symbole :** `subscribeToHistory`
**Preuve directe :**
```js
// ⚠️ Pas de orderByField pour inclure TOUS les éléments d'historique, même sans createdAt
// orderByField: 'createdAt',
```
Aucun `.limit()` dans `queryOptions` par défaut.

**Description :** La totalité de la collection `history` est chargée en temps réel sans borne de résultats ni pagination Firestore.

**Scénario concret :** Après 6 mois d'activité à 20 transactions/jour ≈ 3 600 documents chargés et maintenus en mémoire en permanence.

**Impact :** Coûts Firestore croissants (toutes les lectures sont facturées), consommation mémoire progressive, latence initiale dégradée.

**Test recommandé :** Observer le compteur de lectures Firestore dans la console Firebase après 3 mois d'activité.

**Correction envisagée :** Ajouter une pagination Firestore avec `limit(100)` + `startAfter` ou filtrer par période récente par défaut. Les filtres avancés peuvent être appliqués en mémoire sur la fenêtre paginée.

---

### [PERF-002] MOYEN | CONFIANCE : ÉLEVÉE

**Fichier :** `src/services/firestore.js:417-510`
**Symbole :** `subscribeToCollection`, pool de listeners

**Description :** Au moins 4 listeners `onSnapshot` simultanés actifs dès la connexion : `globalClients`, `drafts`, `history`, `networkBalances`.

**Impact :** 4+ connexions WebSocket permanentes vers Firestore. Acceptable pour une boutique unique, mais à surveiller en contexte multi-boutiques V2.

**Correction envisagée :** Documenter la limite et prévoir une stratégie de réduction des listeners pour la V2.

---

### [PERF-003] MOYEN | CONFIANCE : ÉLEVÉE

**Fichiers :** `src/hooks/useDashboardData.js`, `src/hooks/useAllTransactions.js`

**Description :** Le Dashboard reçoit `allTransactions` (pending + completed) et filtre en mémoire pour afficher les stats. À mesure que `completedTransactions` grossit (lié à PERF-001), les calculs mémoire se dégradent progressivement.

**Correction envisagée :** Résolu en corrigeant PERF-001 (pagination Firestore).

---

### [PERF-004] FAIBLE | CONFIANCE : ÉLEVÉE

**Fichier :** `src/utils/initializeApp.jsx`
**Symbole :** `startPeriodicReporting(120000)`

**Description :** Le monitoring périodique des performances est configuré dans `initializeApp.jsx` mais ce fichier ne semble pas être importé dans l'arbre React (voir QUA-005). Le monitoring est donc probablement inactif.

**Correction envisagée :** Résolu si QUA-005 est traité.

---

### [PERF-005] FAIBLE | CONFIANCE : MOYENNE (non testé)

**Fichier :** `src/services/firestore.js:435-437`
**Symbole :** timeout dans `subscribeToCollection`

**Description :** Un timeout de 30 secondes annule automatiquement le listener si le premier snapshot tarde à arriver. En cas de connexion lente, les données ne se chargent plus silencieusement.

**Hypothèse :** OUI — ce comportement n'a pas pu être testé sur connexion lente.

**Correction envisagée :** Augmenter le timeout ou le supprimer (le SDK Firestore gère ses propres timeouts de connexion).

---

## 6. Priorités avant V2

Par ordre de priorité descendante :

| # | Finding | Action |
|---|---|---|
| 1 | **SEC-001** | Restreindre la lecture `globalClients` à la boutique de l'utilisateur |
| 2 | **SEC-002** | Bloquer `delete` sur `history` dans les règles Firestore |
| 3 | **PERF-001** | Mettre en place une pagination Firestore sur `subscribeToHistory` |
| 4 | **SEC-005 / SEC-006** | Nettoyer les valeurs corrompues UTF-8 dans les règles Firestore |
| 5 | **QUA-001** | Extraire la logique de calcul des soldes hors de `FirestoreService` |
| 6 | **SEC-007** | Étendre le rollback du compte Auth orphelin à toutes les erreurs |
| 7 | **SEC-009** | Migrer `enableMultiTabIndexedDbPersistence` vers l'API moderne |
| 8 | **SEC-004** | Déplacer `firebase-admin` vers `devDependencies` |
| 9 | **QUA-011** | Écrire des tests de caractérisation pour les fonctions financières critiques |
| 10 | **QUA-010** | Déclarer `browserslist` et `lightningcss` en `devDependencies` |

---

## 7. Questions métier à poser au client

1. Le type de transaction **Crédit** est-il volontairement désactivé pour ce client, ou est-ce un bug ? Est-il prévu pour la V2 ?
2. Les réseaux **Moov, Telecel, Coris, Sank** sont configurés dans la logique interne mais masqués dans l'UI. Ce choix est-il permanent ou temporaire ?
3. La **suppression d'un client** ou d'une **transaction historique** est-elle une opération métier légitime ? Faut-il introduire une corbeille ou une archive ?
4. Le **chatbot n8n** est-il utilisé en production ? Le webhook `VITE_N8N_WEBHOOK_URL` est-il configuré et actif ?
5. Y a-t-il **plusieurs boutiques** en production actuellement, ou une seule ? (La réponse impacte l'urgence de SEC-001.)
6. La fonction `seedStores.mjs` a-t-elle été utilisée pour créer les comptes de production ? Le fichier `admin/store-seed.json` existe-t-il avec des données réelles hors du dépôt ?
7. Les **`auditLogs`** Firestore sont écrits uniquement via `deleteExistingAccounts.mjs` — aucune écriture par l'application cliente. Est-ce voulu ? Un journal d'audit applicatif est-il prévu en V2 ?
8. L'export Excel de `ActionButtons.jsx` exporte-t-il l'**historique des transactions** ou uniquement les clients ? (Ce composant n'a pas été audité en détail.)
9. Le **mode hors ligne** est-il une fonctionnalité critique pour les agents de terrain ? Quelle est la durée typique d'utilisation sans réseau ?

---

## 8. Éléments nécessitant validation Codex

1. **SEC-001** : Valider que l'ajout de `resource.data.registeredStoreId == profile().storeId` sur `globalClients.read` ne casse pas les requêtes applicatives existantes (notamment les recherches cross-boutiques potentielles).
2. **SEC-005 / SEC-006** : Confirmer que les valeurs corrompues UTF-8 dans les règles n'acceptent pas aujourd'hui des transactions invalides en production.
3. **SEC-009** : Valider que la migration vers `persistentMultipleTabManager` ne casse pas la persistence hors ligne sur les navigateurs cibles actuels (notamment Chrome mobile).
4. **QUA-005** : Confirmer exhaustivement que `contextFactory.jsx`, `initializeApp.jsx` et `performanceMonitor.jsx` ne sont importés nulle part dans l'arbre applicatif (grep sur imports dynamiques et barrels inclus).
5. **PERF-001** : Valider que l'ajout d'une pagination sur `subscribeToHistory` ne casse pas les calculs existants de `useDashboardData` qui consomment `allTransactions`.

---

## 9. Limites de l'audit

- Les fichiers `.env` de production n'ont pas été consultés. Les valeurs réelles de `VITE_FIRESTORE_OFFLINE_PERSISTENCE`, `VITE_USE_FIREBASE_EMULATORS`, `VITE_N8N_WEBHOOK_URL` sont inconnues.
- Le dossier `functions/` ne contient que `node_modules` — **aucune Cloud Function n'a pu être auditée**.
- Les composants suivants n'ont pas été audités en détail : `ActionButtons.jsx`, `AgentsChart.jsx`, `CAChart.jsx`, `LoyaltyChart.jsx`, `NetworkChart.jsx`, `TransactionsTodayChart.jsx`, `ClientsTable.jsx`, `NavBar.jsx`.
- Aucun test n'existe dans le projet — l'audit repose exclusivement sur la lecture statique du code.
- Le comportement en multi-onglets avec la persistence IndexedDB n'a pas été testé.
- Les fichiers `ADAPTATION_CLIENT.md` et `AGENTS.md` n'ont pas été consultés.
- La configuration de déploiement Netlify/Vercel (`netlify.toml`, `vercel.json`) n'a pas été auditée.
- Le comportement exact du chatbot n8n (Chatbot.jsx) n'a pas été audité.

---

## 10. Fichiers consultés

```
CLAUDE.md
package.json
firebase.json
firestore.rules                          ← Vérifié manuellement (SEC-001, SEC-002, SEC-005, SEC-006)
vite.config.js
src/main.jsx
src/App.jsx
src/config/firebase.js                   ← Vérifié manuellement (SEC-009, SEC-010)
src/config/clientIsolation.js
src/context/AuthContext.jsx              ← Vérifié manuellement (SEC-007) lignes 130-157
src/context/ClientsContext.jsx
src/context/transactions.jsx
src/context/NetworkConfigContext.jsx
src/context/ThemeContext.jsx             (partiel)
src/services/firestore.js                ← Vérifié manuellement (PERF-001) lignes 1095-1139
src/pages/Dashboard.jsx
src/pages/Clients.jsx
src/pages/Transactions.jsx
src/pages/Historique.jsx
src/pages/Formulaire.jsx
src/pages/Profil.jsx
src/components/auth/ProtectedRoute.jsx
src/components/transactions/TransactionForm.jsx
src/components/transactions/TransactionTable.jsx
src/components/network/NetworkCard.jsx
src/components/network/NetworkCardsDrawer.jsx
src/components/chatbot/Chatbot.jsx
src/components/ClientForm.jsx            (partiel)
src/hooks/useAllTransactions.js
src/hooks/useClients.js
src/hooks/useDashboardData.js
src/hooks/useExcelOperations.js
src/hooks/useHistoriqueFilters.js
src/hooks/useNetworkCards.js
src/hooks/useSimpleNetworkData.js
src/hooks/useUserActivity.js
src/constants/authMessages.js
src/constants/firestoreConstants.js
src/constants/index.js
src/constants/networkConfig.js
src/utils/constants.js
src/utils/helpers.js
src/utils/errorHandler.js
src/utils/excelUtils.js
src/utils/cacheManager.js
src/utils/logger.js
src/utils/initializeApp.jsx
src/utils/performanceMonitor.jsx
src/data/clients.js
src/data/transactions.js
scripts/deleteExistingAccounts.mjs
scripts/seedStores.mjs
scripts/createTemporaryStoreAccess.mjs
scripts/diagnoseAccount.mjs
scripts/updateAccountPassword.mjs
scripts/generatePasswordResetLink.mjs
scripts/testClientLogin.mjs
scripts/compatCss.mjs
admin/store-seed.example.json
```

---

## 11. Bilan de modification

| Opération | Résultat |
|---|---|
| Fichiers sources modifiés | **Aucun** |
| Fichiers sources créés | **Aucun** |
| Fichier d'audit créé | `docs/audit/claude/CLAUDE_AUDIT.md` (ce fichier) |
| git push effectué | **Non** |
| Déploiement effectué | **Non** |
| Scripts administratifs exécutés | **Non** |
| Firebase production accédé | **Non** |
