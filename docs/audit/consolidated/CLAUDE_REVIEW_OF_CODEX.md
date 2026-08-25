# REVUE CROISÉE CLAUDE / CODEX — AKAYIS CRM

Date : 2026-06-17
Branche : audit/pre-v2-local
Méthodologie : Lecture statique du code — aucun accès production

Préambule : chaque finding Codex examiné ci-dessous a été revérifié par lecture
directe des fichiers cités (`firestore.rules`, `src/context/AuthContext.jsx`,
`src/context/transactions.jsx`, `src/services/firestore.js`,
`src/components/network/NetworkCard.jsx`, `src/components/chatbot/Chatbot.jsx`,
`src/components/auth/SignInForm.jsx`, `src/utils/constants.js`,
`scripts/deleteExistingAccounts.mjs`, etc.). Les numéros de ligne ont été
réalignés sur l'état réel du dépôt au moment de la revue ; lorsqu'ils diffèrent
de ceux des deux audits, c'est signalé dans la note du finding.

---

## 1. Findings Codex confirmés

### [AKY-CRIT-001] Création de profil `users` côté client avec `storeId` arbitraire
**Verdict :** confirmé
**Identifiant Claude correspondant :** ABSENT (partiellement recoupé par SEC-001 mais pas isolé comme tel)
**Fichier :** `firestore.rules:87-92` ; consommé par `firestore.rules:13-22` (`hasProfile`, `isStoreMember`)
**Symbole :** `match /users/{userId}` → `allow create`, `profile()`, `isStoreMember`
**Preuve dans le code :**
```
87  allow create: if signedIn() &&
88    request.auth.uid == userId &&
89    request.resource.data.role == 'store_admin' &&
90    request.resource.data.active == true &&
91    request.resource.data.storeId is string &&
92    request.resource.data.storeName is string;
```
Aucune vérification que `stores/{storeId}` existe ni que `stores/{storeId}.adminUid == request.auth.uid`. Le `storeId` est accepté dès qu'il est une chaîne. Ensuite `isStoreMember(storeId)` (ligne 20-22) fait entièrement confiance à `profile().storeId`.
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** CRITIQUE
**Sévérité réelle estimée :** CRITIQUE
**Impact :** Un compte Auth nouvellement créé peut écrire son propre `users/{uid}` avec le `storeId` d'une boutique cible connue, puis lire/écrire `clients/{storeId}/drafts`, `history`, `networkBalances`, `auditLogs(read)` de cette boutique. C'est le vecteur d'escalade inter-boutiques le plus grave de l'audit.
**Test requis :** Émulateur Rules, deux boutiques A/B. L'utilisateur B crée `users/{uidB}` avec `storeId=A`, puis tente `get/list/create/update` sur `clients/A/history` et `clients/A/networkBalances/current`. Attendu après correction : refus.
**Note :** Codex a isolé ce vecteur (confiance au `storeId` écrit côté client) de manière plus précise que Claude. L'audit Claude le mentionne indirectement (« la vérification côté Rules porte sur `active` et `storeId is string` — le rôle n'est pas vérifié », section 2.b) mais ne le formalise pas comme finding critique distinct. Convergence partielle, avantage Codex sur la formalisation. Le couplage avec AKY-ELEV-006 (auto-enrôlement public) rend ce risque exploitable sans privilège préalable.

---

### [AKY-CRIT-002] `globalClients` : read/update/delete inter-boutiques
**Verdict :** confirmé
**Identifiant Claude correspondant :** SEC-001 (read uniquement)
**Fichier :** `firestore.rules:97-109` ; `src/constants/firestoreConstants.js` (mapping `CLIENTS → globalClients`)
**Symbole :** `match /globalClients/{clientId}` → `allow read`, `allow update`, `allow delete`
**Preuve dans le code :**
```
98   allow read: if hasProfile();
104  allow update: if hasProfile() &&
105    validClient(request.resource.data) &&
106    request.resource.data.registeredStoreId == resource.data.registeredStoreId;
108  allow delete: if hasProfile();
```
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** CRITIQUE
**Sévérité réelle estimée :** CRITIQUE
**Impact :** Tout profil actif peut lire l'intégralité de `globalClients` (PII inter-boutiques), supprimer n'importe quel client (`delete: if hasProfile()`), et modifier un client d'une autre boutique. La règle `update` interdit seulement de changer `registeredStoreId` ; elle n'empêche pas une boutique B de modifier les champs `nom/prenom/numeroPersonnel` d'un client appartenant à la boutique A.
**Test requis :** Émulateur, client `registeredStoreId=A`. Vérifier qu'un utilisateur B ne peut ni lire, ni modifier, ni supprimer ce document.
**Note :** Codex couvre PLUS que Claude SEC-001. Claude n'a relevé que le `read` (SEC-001). Codex relève en plus le `update` cross-boutique et le `delete` ouvert. Le `delete: if hasProfile()` est une faille distincte de SEC-001 et n'apparaît PAS dans l'audit Claude — voir aussi section 6 (divergence). Avantage net Codex sur la complétude de `globalClients`.

---

### [AKY-ELEV-003] Suppression de l'historique financier autorisée (perte de piste d'audit)
**Verdict :** confirmé
**Identifiant Claude correspondant :** SEC-002 (history.delete)
**Fichier :** `firestore.rules:122` (drafts.delete), `firestore.rules:134` (history.delete), `firestore.rules:149-152` (auditLogs write:false) ; `src/context/transactions.jsx:184-194`
**Symbole :** `allow delete` sur `drafts` et `history` ; `deleteTransaction`, `deleteFromHistory`
**Preuve dans le code :**
```
firestore.rules:134   allow delete: if isStoreMember(storeId);   // history
src/context/transactions.jsx:190-193
  if (isDraft) { await firestoreService.deleteDraft(id) }
  else { await firestoreService.deleteFromHistory(id) }
```
`auditLogs` est en `write: if false` (ligne 151) : aucune trace n'est écrite par l'application avant suppression.
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** ÉLEVÉ
**Sévérité réelle estimée :** ÉLEVÉ (frontière CRITIQUE selon l'exigence CLAUDE.md « toute opération financière doit préserver une piste d'audit »)
**Impact :** Un membre de boutique peut supprimer définitivement une transaction validée via l'UI, sans trace. Violation directe d'une règle métier explicite du projet.
**Test requis :** Émulateur, créer une transaction validée, la supprimer avec les droits d'un membre, vérifier l'absence de trace dans `auditLogs` et `history`.
**Note :** Convergence forte Claude SEC-002 / Codex AKY-ELEV-003. Codex relie en plus le chemin UI complet (`transactions.jsx:184-194`) et l'absence d'écriture `auditLogs`, ce qui renforce le finding. Claude classe « CRITIQUE », Codex « ÉLEVÉ » — voir section 6.

---

### [AKY-ELEV-005] `deleteFromHistory` sans compensation des soldes réseau
**Verdict :** confirmé
**Identifiant Claude correspondant :** ABSENT (Claude couvre la suppression sous SEC-002 mais PAS l'incohérence de solde)
**Fichier :** `src/services/firestore.js:1098-1100`
**Symbole :** `deleteFromHistory`
**Preuve dans le code :**
```js
async deleteFromHistory(historyId) {
  return this.deleteDocument(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, historyId)
}
```
Aucune logique de compensation. À comparer avec `addTransaction`, `validateTransaction` et `setNetworkBalance` qui utilisent `runTransaction` pour modifier `networkBalances`.
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** ÉLEVÉ (confiance moyenne-haute selon Codex)
**Sévérité réelle estimée :** ÉLEVÉ
**Impact :** Supprimer une transaction validée laisse `networkBalances/current` figé à sa valeur post-transaction → divergence définitive entre l'historique et les soldes courants. Conséquence comptable concrète, distincte de la simple perte de piste d'audit.
**Test requis :** Émulateur, créer une transaction validée, noter `networkBalances/current`, supprimer l'entrée `history`, comparer. Attendu : les soldes ne sont plus cohérents avec l'historique.
**Note :** Finding important ABSENT de l'audit Claude. Claude traite la suppression d'historique sous l'angle « piste d'audit » (SEC-002) mais ne relève pas l'incohérence comptable des soldes. Avantage Codex. La correction de SEC-002/AKY-ELEV-003 (bloquer `delete`) neutralise aussi ce risque ; si une annulation métier est introduite, elle devra passer par une opération inverse transactionnelle.

---

### [AKY-ELEV-006] Auto-enrôlement public de boutique en production
**Verdict :** confirmé
**Identifiant Claude correspondant :** ABSENT (Claude décrit le flux signup en 2.a mais sans en faire un finding de sécurité)
**Fichier :** `src/context/AuthContext.jsx:95-141` ; `src/components/auth/SignInForm.jsx:152-166` ; `firestore.rules:71-76` (stores.create) et `firestore.rules:87-92` (users.create)
**Symbole :** `signup`, bouton « Créer un compte boutique », `stores.create`, `users.create`
**Preuve dans le code :**
```
src/components/auth/SignInForm.jsx:160  "Créer un compte boutique"
src/context/AuthContext.jsx:107  createUserWithEmailAndPassword(...)
src/context/AuthContext.jsx:131-134  batch.set(stores/{storeId}) + batch.set(users/{uid})
firestore.rules:71-76  allow create (stores) if signedIn() && adminUid == auth.uid
```
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** ÉLEVÉ
**Sévérité réelle estimée :** ÉLEVÉ (sous réserve de validation métier — voir section 8 ; pourrait être un choix volontaire)
**Impact :** Toute personne externe peut créer une boutique active sans validation administrative. Combiné à AKY-CRIT-001, l'attaquant obtient un compte légitime puis pivote vers une autre boutique.
**Test requis :** Émulateur, créer un compte depuis l'UI, vérifier la création de `stores/{id}` et `users/{uid}` sans approbation externe.
**Note :** Finding ABSENT de l'audit Claude en tant que risque. Claude documente le flux mais ne le qualifie pas de surface d'attaque. La sévérité réelle dépend de l'intention métier (l'inscription publique est-elle voulue ?) — c'est la première question à trancher, car elle conditionne AKY-CRIT-001.

---

### [AKY-ELEV-004] Édition manuelle des soldes réseau sans schéma strict ni rôle
**Verdict :** confirmé
**Identifiant Claude correspondant :** ABSENT
**Fichier :** `firestore.rules:137-143` ; `src/components/network/NetworkCard.jsx:52-67` ; `src/services/firestore.js:825-844`
**Symbole :** `networkBalances` (rules), `saveAmount`, `setNetworkBalance`
**Preuve dans le code :**
```
firestore.rules:139-141  allow create, update: if isStoreMember(storeId) &&
    balanceId == 'current' && request.resource.data.balances is map;
src/components/network/NetworkCard.jsx:52-60  saveAmount → updateLiquidity / updateStock
src/services/firestore.js:838-841  tx.set(balanceRef, { balances: nextBalances, ... }, { merge: true })
```
La règle ne valide que `balances is map` — aucun schéma de réseaux/champs, aucun rôle. `setNetworkBalance` clampe à `Math.max(0, ...)` côté applicatif mais n'impose pas d'allowlist de réseaux.
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** ÉLEVÉ
**Sévérité réelle estimée :** MOYEN à ÉLEVÉ (l'édition manuelle est exposée dans l'UI et semble une fonctionnalité voulue ; le risque réel est l'absence de schéma et d'audit, pas l'édition en soi)
**Impact :** Un membre peut ajuster stock/liquidité hors transaction, ou injecter via l'API Firestore une map `balances` arbitraire (réseau inconnu, champ inattendu) que les règles acceptent. Soldes non fiables, écarts non justifiés, aucun audit.
**Test requis :** Émulateur, écrire `networkBalances/current` avec un réseau arbitraire et un montant incohérent ; vérifier l'acceptation actuelle. Attendu après correction : refus hors schéma.
**Note :** ABSENT de l'audit Claude. Claude couvre les soldes côté localStorage (SEC-008) mais pas la validation Firestore. Avantage Codex. Nécessite validation métier (qui peut éditer manuellement ? — voir section 8).

---

### [AKY-MOY-007] Historique chargé sans borne (pagination mémoire)
**Verdict :** confirmé
**Identifiant Claude correspondant :** PERF-001 (+ PERF-002, PERF-003)
**Fichier :** `src/services/firestore.js:1102-1140` (`subscribeToHistory`), `src/services/firestore.js:428-432` (« Pas de limite par défaut ») ; `src/context/transactions.jsx:69,80` ; `src/hooks/useHistoriqueFilters.js`
**Symbole :** `subscribeToHistory`, `subscribeToCollection`, `subscribeToDrafts`
**Preuve dans le code :**
```js
src/services/firestore.js:1103-1107
  let queryOptions = { /* orderByField commenté, aucun limit */ }
src/services/firestore.js:431  // Pas de limite par défaut - uniquement si explicitement demandée
```
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** MOYEN
**Sévérité réelle estimée :** ÉLEVÉ (cohérent avec Claude) — coût Firestore croissant et facturé sur chaque lecture
**Impact :** Toute la collection `history` chargée en temps réel et maintenue en mémoire ; le dashboard et l'historique se dégradent avec le volume.
**Test requis :** Seed émulateur (p.ex. 10 000 documents), mesurer nombre de lectures, temps d'affichage, mémoire.
**Note :** Convergence Claude/Codex sur le fait. Divergence de sévérité : Claude ÉLEVÉ, Codex MOYEN — voir section 6. La validation Claude (point 5 section 8 de l'audit Claude) reste pertinente : la pagination ne doit pas casser `useDashboardData` qui consomme `allTransactions`.

---

### [AKY-INFO-012] Scripts Firebase Admin pouvant cibler la production
**Verdict :** confirmé
**Identifiant Claude correspondant :** SEC-003 (partiel — Claude ne cible que `deleteExistingAccounts`)
**Fichier :** `scripts/deleteExistingAccounts.mjs:6-30` ; `scripts/seedStores.mjs` ; `scripts/updateAccountPassword.mjs` ; `package.json` (scripts `account:*`, `seed:stores`, `accounts:delete`)
**Symbole :** garde-fous `--execute`, `--confirm-delete-all`, `AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS`
**Preuve dans le code :**
```js
scripts/deleteExistingAccounts.mjs:22-29
  if (execute && (!confirmedDeleteAll || !allowDeleteAll)) { throw ... }
scripts/deleteExistingAccounts.mjs:11-15
  initializeApp({ credential: serviceAccountPath ? cert(...) : applicationDefault() })
```
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** INFORMATION
**Sévérité réelle estimée :** ÉLEVÉ pour `deleteExistingAccounts` (destruction totale), MOYEN pour les autres scripts (aucun garde `assertSafeFirebaseProject`, aucune allowlist de projet)
**Impact :** Tout script s'exécute sur le projet pointé par `GOOGLE_APPLICATION_CREDENTIALS`. Aucun script ne vérifie que le projet est un émulateur ou un projet autorisé avant `initializeApp`.
**Test requis :** Vérifier que `npm run accounts:delete:dry-run` ne supprime rien ; ajouter un contrôle local refusant tout `projectId` hors allowlist.
**Note :** Codex va plus loin que Claude SEC-003 en généralisant à TOUS les scripts Admin et en proposant un garde-fou centralisé `assertSafeFirebaseProject`. `deleteExistingAccounts` dispose déjà de 3 garde-fous (point positif partagé par les deux audits). La divergence de sévérité (Claude ÉLEVÉ vs Codex INFORMATION) est discutable — voir section 6.

---

### [AKY-INFO-013] Absence totale de tests
**Verdict :** confirmé
**Identifiant Claude correspondant :** QUA-011
**Fichier :** `package.json` (seul script `lint`, aucun `test`/`vitest`/`emulators:exec`)
**Symbole :** scripts npm
**Preuve dans le code :** Aucun fichier `*.test.*`/`*.spec.*` dans le dépôt ; `package.json` ne déclare ni runner de test ni dépendance `@firebase/rules-unit-testing`.
**Niveau de confiance :** ÉLEVÉ
**Sévérité Codex :** INFORMATION
**Sévérité réelle estimée :** ÉLEVÉ comme prérequis V2 (bloquant pour toute modification métier selon CLAUDE.md)
**Impact :** Aucune caractérisation automatisée des règles, des soldes ou des transactions avant la V2.
**Test requis :** Mettre en place une suite Rules émulateur multi-boutiques + tests de caractérisation dépôt/retrait/validation/suppression.
**Note :** Convergence Claude QUA-011 / Codex AKY-INFO-013. Les deux audits le classent en information mais le placent en priorité haute pour la V2. Conforme à CLAUDE.md (« ne jamais modifier une règle métier sans test de caractérisation »).

---

## 2. Findings Codex partiellement confirmés

### [AKY-MOY-008] Données sensibles persistées localement (localStorage / IndexedDB)
**Verdict :** partiellement confirmé
**Identifiant Claude correspondant :** SEC-008 (soldes réseau) + SEC-009 (persistance IndexedDB)
**Fichier :** `src/components/ClientForm.jsx` (`CLIENT_FORM_DRAFT_KEY`) ; `src/context/NetworkConfigContext.jsx:17-73` (`NETWORK_DATA_STORAGE_KEY`) ; `src/config/firebase.js:82-89` (`enableMultiTabIndexedDbPersistence`)
**Symbole :** `CLIENT_FORM_DRAFT_KEY`, `NETWORK_DATA_STORAGE_KEY`, persistance IndexedDB
**Preuve dans le code :** Soldes réseau et brouillons clients persistés en clair côté navigateur ; IndexedDB Firestore optionnelle en prod (conditionnée par `VITE_FIRESTORE_OFFLINE_PERSISTENCE`).
**Niveau de confiance :** ÉLEVÉ sur les faits ; MOYEN sur l'impact (dépend du type de poste — partagé/personnel)
**Sévérité Codex :** MOYEN
**Sévérité réelle estimée :** MOYEN (cache de fallback hors ligne légitime ; le risque dépend du contexte des postes agents)
**Impact :** Sur poste partagé/perdu, brouillons clients et soldes restent consultables après déconnexion ; pas de purge au logout.
**Test requis :** Saisir un brouillon, charger des soldes, se déconnecter, inspecter Application Storage.
**Note :** Codex regroupe en un seul finding ce que Claude éclate en SEC-008 (soldes localStorage) et SEC-009 (IndexedDB). Codex ajoute le brouillon client `ClientForm` que Claude n'avait pas relevé sous cet angle. Partiellement confirmé car le risque réel est conditionné par la question métier « postes personnels ou partagés ? » (section 8). À noter : Claude SEC-009 traite aussi la DÉPRÉCIATION de l'API `enableMultiTabIndexedDbPersistence` (axe maintenabilité) que Codex n'aborde pas.

---

### [AKY-MOY-009] Chatbot n8n : envoi de données sans rédaction PII
**Verdict :** partiellement confirmé
**Identifiant Claude correspondant :** ABSENT (Claude marque le chatbot « non audité »)
**Fichier :** `src/components/chatbot/Chatbot.jsx:11,29-59`
**Symbole :** `WEBHOOK_URL`, `sendMessage`
**Preuve dans le code :**
```js
src/components/chatbot/Chatbot.jsx:11  const WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || ''
src/components/chatbot/Chatbot.jsx:54-57  body: JSON.stringify({ message: messageContent, timestamp })
```
**Niveau de confiance :** ÉLEVÉ sur le mécanisme ; MOYEN sur l'impact
**Sévérité Codex :** MOYEN
**Sévérité réelle estimée :** MOYEN à FAIBLE (le chatbot n'envoie que le `message` saisi + timestamp — il n'extrait pas automatiquement de PII. Le risque est que l'agent COLLE volontairement des données. Si `VITE_N8N_WEBHOOK_URL` est vide, aucun envoi)
**Impact :** Fuite potentielle de PII vers une intégration externe, uniquement si l'agent saisit des données sensibles ET si le webhook est configuré.
**Test requis :** Pointer le webhook vers un collecteur local, envoyer un message contenant des PII, vérifier le payload. Confirmer en prod la valeur réelle de `VITE_N8N_WEBHOOK_URL`.
**Note :** Partiellement confirmé : le finding est réel mais l'impact dépend (a) de la configuration du webhook en production, (b) du comportement de l'agent. Le header `Access-Control-Allow-Origin: '*'` côté requête (ligne 52) est inutile/inerte (header de réponse, non de requête) — détail mineur non relevé par Codex. Claude n'a pas audité ce composant : avantage Codex.

---

### [AKY-MOY-010] Modèle multi-tenant ambigu (`globalClients`/`users`/`stores` hors namespace)
**Verdict :** partiellement confirmé
**Identifiant Claude correspondant :** ABSENT (recoupe le tableau « Collections Firestore » de la section 1 de Claude, sans finding dédié)
**Fichier :** `src/config/clientIsolation.js:17-23` ; `src/services/firestore.js:88-102`
**Symbole :** `getFirestoreCollectionPath`, `resolveCollectionPath`
**Preuve dans le code :**
```js
src/services/firestore.js:88-102
  resolveCollectionPath(collectionName) {
    if (collectionName === USERS || STORES || CLIENTS) return collectionName
    if (!this.activeStore?.id) return getFirestoreCollectionPath(collectionName)
    return `clients/${this.activeStore.id}/${collectionName}`
  }
```
`users`, `stores`, `globalClients` (CLIENTS) restent à la racine ; les autres collections sont préfixées par `clients/{storeId}/`.
**Niveau de confiance :** ÉLEVÉ sur le fait
**Sévérité Codex :** MOYEN
**Sévérité réelle estimée :** FAIBLE à MOYEN (c'est une dette de clarté/documentation, pas une faille active ; aucune fuite directe — les règles, pas le chemin, gouvernent l'accès)
**Impact :** Confusion de configuration multi-tenant ; risque de migration incomplète en V2 si l'équipe suppose une isolation totale par `VITE_CLIENT_ID`.
**Test requis :** Émulateur, créer compte+client avec différents `VITE_CLIENT_ID`, inspecter les chemins réels écrits.
**Note :** Finding de maintenabilité plutôt que de sécurité. Confirmé sur le fait mais la sévérité MOYEN de Codex paraît élevée pour de la dette documentaire. À aligner avec QUA de Claude.

---

## 3. Findings Codex contestés

Aucun finding Codex n'est contesté sur le fond. Tous les findings vérifiés
correspondent à un fait observable dans le code. Les écarts relevés portent sur
la sévérité (section 6) ou sur le périmètre d'impact (déclassés en « partiellement
confirmés », section 2), non sur l'existence du fait.

---

## 4. Faux positifs possibles

### [AKY-FAIBLE-011] Fichiers potentiellement non référencés
**Verdict :** faux positif possible (pour partie) — prudence correcte de Codex
**Identifiant Claude correspondant :** QUA-005 (`contextFactory.jsx`) ; non couvert pour `ChartTooltip`/`ChartLegend`
**Fichier :** `src/utils/contextFactory.jsx` ; `src/components/dashboard/shared/ChartTooltip.jsx` ; `src/components/dashboard/shared/ChartLegend.jsx`
**Symbole :** exports non référencés par recherche statique
**Preuve dans le code :**
- `contextFactory` : grep sur tout le dépôt (hors `node_modules`) → références UNIQUEMENT dans les deux fichiers d'audit. Aucun import dans `src/` ni `scripts/`. Le fichier existe (`src/utils/contextFactory.jsx`).
- `ChartTooltip` / `ChartLegend` : ces composants se déclarent et s'exportent (`export default`) mais AUCUN import n'a été trouvé dans `src/` (grep ciblé). Donc aucun importeur statique détecté.
**Niveau de confiance :** MOYEN (absence d'import statique confirmée ; imports dynamiques/barrels non exhaustivement écartés)
**Sévérité Codex :** FAIBLE
**Sévérité réelle estimée :** FAIBLE (dette de code, pas un risque)
**Impact :** Bruit de maintenance.
**Test requis :** Analyse bundler (`vite build` + inspection du graphe), recherche d'imports dynamiques (`import(`), vérification scripts/configs, AVANT toute suppression. Conforme au protocole de suppression CLAUDE.md.
**Note :** Codex a eu raison de ne PAS qualifier ces fichiers de « morts ». Mon contrôle confirme l'absence d'import statique pour les trois, ce qui RENFORCE la suspicion sans la prouver. CLAUDE.md interdit toute suppression sur la seule base d'un signalement d'outil. À traiter dans un lot « nettoyage » dédié, avec preuve complète et restauration possible par commit local. Divergence mineure : Claude (QUA-005) cite aussi `initializeApp.jsx` et `performanceMonitor.jsx` que Codex ne mentionne pas (voir section 5).

---

## 5. Findings importants absents de Codex

### [SEC-007] Rollback du compte Auth orphelin limité à `permission-denied`
**Présent dans Codex :** NON
**Sévérité Claude :** MOYEN
**Pourquoi c'est important :** Intégrité des données / expérience utilisateur. Toute erreur non-`permission-denied` (réseau, quota) pendant le signup laisse un compte Auth créé sans profil Firestore → compte orphelin inutilisable, nécessitant une intervention manuelle. C'est un défaut d'intégrité transactionnelle entre Auth et Firestore que Codex n'a pas relevé.
**Fichier :** `src/context/AuthContext.jsx:142-150`
**Preuve :**
```js
const createdUser = auth.currentUser
if (createdUser && error?.code?.startsWith('permission-denied')) {
  try { await deleteUser(createdUser) } catch (deleteError) { ... }
}
```
Le rollback ne se déclenche que pour `permission-denied`.

---

### [SEC-009] API `enableMultiTabIndexedDbPersistence` dépréciée
**Présent dans Codex :** NON (Codex mentionne l'API au titre de la persistance locale AKY-MOY-008, mais PAS son obsolescence)
**Sévérité Claude :** MOYEN
**Pourquoi c'est important :** Maintenabilité / risque de rupture. Cette API est dépréciée depuis Firebase JS SDK v9+ et remplacée par `initializeFirestore({ localCache: persistentMultipleTabManager() })`. Risque de rupture silencieuse à la prochaine mise à jour majeure du SDK (actuellement v12.2.1).
**Fichier :** `src/config/firebase.js:82-89`
**Preuve :** Usage de `enableMultiTabIndexedDbPersistence` conditionné par `VITE_FIRESTORE_OFFLINE_PERSISTENCE`.

---

### [SEC-005 / SEC-006] Valeurs UTF-8 corrompues dans les règles
**Présent dans Codex :** NON (Codex le NOTE en « Limites de l'audit » : « certaines sorties PowerShell affichent des accents altérés ; les recherches `rg` confirment que des valeurs métier accentuées existent aussi en UTF-8 »)
**Sévérité Claude :** ÉLEVÉ (SEC-005) / MOYEN (SEC-006)
**Pourquoi c'est important :** Intégrité des données. Les règles acceptent des types/statuts à encodage corrompu (`DÃ©pÃ´t`, `CrÃ©dit`, `Non TerminÃ©es`, `ValidÃ©e`, ...) en plus des valeurs correctes. Confirmé par lecture directe.
**Fichier :** `firestore.rules:37` (types) ; `firestore.rules:47-67` (statuts)
**Preuve :**
```
37  data.type in ['Dépôt', 'Depot', 'Retrait', 'Crédit', 'Credit', 'DÃ©pÃ´t', 'CrÃ©dit']
49-60  'Non TerminÃ©es', 'ValidÃ©e', 'RemboursÃ©e', 'AnnulÃ©e'
```
**Note de prudence :** La présence côté règles signifie que ces valeurs sont ACCEPTÉES en écriture si un client les envoie. Avant nettoyage, vérifier qu'aucun document de production existant ne porte déjà ces valeurs corrompues (risque de rendre des documents illisibles par les règles `update`). Codex recommande à juste titre de traiter l'encodage « séparément et testé ».

---

### [QUA-007] `getDocument` lit un document via `getDocs(query(where('__name__'...)))`
**Présent dans Codex :** NON
**Sévérité Claude :** MOYEN
**Pourquoi c'est important :** Performance + lisibilité. Une lecture de document unique passe par une requête `where('__name__', '==', ...)` au lieu d'un `getDoc(docRef)` direct — plus coûteux et moins lisible.
**Fichier :** `src/services/firestore.js:301-316`
**Preuve :**
```js
const docSnap = await getDocs(query(this.collectionRef(collectionName), where('__name__', '==', docRef)))
```

### Autres findings Claude absents de Codex (axe qualité/dette)
- **QUA-001** (FirestoreService monolithe ~1 321 lignes) : absent de Codex en tant que finding qualité formel ; Codex le constate factuellement (« `firestore.js` concentre l'accès Firestore, les listeners, les transactions, la migration »).
- **QUA-006** (décorateur legacy `withCache` inutilisé), **QUA-008** (constantes dupliquées `authMessages`), **QUA-009** (`void confirmationMessage`), **QUA-010** (`browserslist`/`lightningcss` non déclarés), **QUA-002** (NETWORK_OPTIONS/Crédit) : tous absents de Codex.
  - Note de mise à jour sur QUA-002 : le commentaire de documentation recommandé par Claude est DÉJÀ présent dans `src/utils/constants.js:10-11` (« Options réseau visibles pour ce client. Les autres réseaux restent dans la logique interne... »). Le volet NETWORK_OPTIONS de QUA-002 est donc partiellement obsolète ; reste le volet « type Crédit absent de TRANSACTION_TYPES » (`constants.js:15-18`), toujours valide.
- **SEC-004** (`firebase-admin` en `dependencies`) : absent de Codex.

---

## 6. Divergences avec l'audit Claude

| Sujet | Claude | Codex | Verdict après vérification |
|---|---|---|---|
| `globalClients` | SEC-001, read uniquement, CRITIQUE | AKY-CRIT-002, read+update+delete, CRITIQUE | **Codex plus complet.** Le `delete: if hasProfile()` (ligne 108) et l'`update` cross-boutique sont réels et absents de Claude. |
| Profil `users` à `storeId` arbitraire | Mentionné en prose (2.b), pas de finding | AKY-CRIT-001, CRITIQUE | **Codex plus précis.** Vecteur d'escalade racine, à formaliser comme critique. |
| Suppression historique | SEC-002, CRITIQUE | AKY-ELEV-003, ÉLEVÉ | Convergence sur le fait. Divergence sévérité. **Trancher CRITIQUE** au vu de l'exigence CLAUDE.md sur la piste d'audit financière. |
| Incohérence soldes après delete | Absent | AKY-ELEV-005, ÉLEVÉ | **Codex seul.** Risque comptable distinct, confirmé. |
| Auto-enrôlement public | Décrit, pas de finding | AKY-ELEV-006, ÉLEVÉ | **Codex seul.** Sévérité conditionnée par l'intention métier. |
| Édition manuelle soldes (rules) | Absent | AKY-ELEV-004, ÉLEVÉ | **Codex seul.** Confirmé ; sévérité réelle MOYEN-ÉLEVÉ. |
| Historique non borné | PERF-001, ÉLEVÉ | AKY-MOY-007, MOYEN | Convergence sur le fait. **Retenir ÉLEVÉ** (coût Firestore facturé, dégradation cumulative). |
| Scripts Admin | SEC-003, ÉLEVÉ (un seul script) | AKY-INFO-012, INFORMATION (tous) | Codex plus large, Claude plus alarmiste. **Retenir ÉLEVÉ pour `deleteExistingAccounts`, MOYEN pour les autres**, + garde-fou centralisé proposé par Codex. |
| Encodage UTF-8 règles | SEC-005/006, ÉLEVÉ/MOYEN | Note en « Limites », pas de finding | **Claude seul.** Confirmé par lecture directe. |
| Rollback Auth orphelin | SEC-007, MOYEN | Absent | **Claude seul.** Confirmé. |
| Dépréciation IndexedDB API | SEC-009, MOYEN | Absent (n'évoque que la persistance) | **Claude seul.** Confirmé. |
| `firebase-admin` en deps | SEC-004, ÉLEVÉ | Absent | **Claude seul.** À vérifier dans `package.json`. |
| Chatbot n8n | « non audité » | AKY-MOY-009, MOYEN | **Codex seul.** Confirmé, impact conditionnel. |
| Qualité/dette (QUA-001 à 010) | 10 findings | Constats épars, pas de findings | **Claude plus complet sur l'axe qualité.** |

Synthèse : Codex est plus fort sur la sécurité des règles Firestore et
l'intégrité financière (vecteur d'escalade `users`, complétude `globalClients`,
incohérence des soldes, enrôlement public). Claude est plus fort sur la dette
de code, l'encodage des règles, l'intégrité du signup et les détails de
maintenabilité. Les deux audits sont complémentaires ; aucun ne couvre seul
l'ensemble du risque.

---

## 7. Priorités proposées (ordre consolidé)

| # | Référence consolidée | Action | Sévérité retenue |
|---|---|---|---|
| 1 | AKY-CRIT-001 | Empêcher la création côté client d'un profil `users` avec `storeId` arbitraire (vérifier `stores/{storeId}.adminUid == auth.uid` ou onboarding serveur) | CRITIQUE |
| 2 | AKY-CRIT-002 / SEC-001 | Restreindre `globalClients` read/update/delete à `registeredStoreId == profile().storeId` | CRITIQUE |
| 3 | AKY-ELEV-003 / SEC-002 | Bloquer `delete` sur `history` (et encadrer `drafts.delete`) ; pas de suppression silencieuse | CRITIQUE/ÉLEVÉ |
| 4 | AKY-ELEV-006 | Décider de l'inscription publique ; désactiver ou encadrer (dépend de la réponse métier) | ÉLEVÉ |
| 5 | AKY-ELEV-005 | Neutraliser l'incohérence soldes/historique (résolu si delete bloqué ; sinon opération inverse auditée) | ÉLEVÉ |
| 6 | AKY-ELEV-004 | Valider le schéma `networkBalances` côté règles ; encadrer l'édition manuelle | ÉLEVÉ |
| 7 | SEC-005 / SEC-006 | Nettoyer les valeurs UTF-8 corrompues dans les règles (après vérif. des données existantes) | ÉLEVÉ |
| 8 | AKY-MOY-007 / PERF-001 | Pagination Firestore sur `subscribeToHistory` (sans casser `useDashboardData`) | ÉLEVÉ |
| 9 | AKY-INFO-013 / QUA-011 | Suite de tests Rules émulateur + caractérisation des fonctions financières | ÉLEVÉ (prérequis V2) |
| 10 | AKY-INFO-012 / SEC-003 | Garde-fou `assertSafeFirebaseProject` sur tous les scripts Admin | ÉLEVÉ/MOYEN |
| 11 | SEC-007 | Étendre le rollback du compte Auth orphelin à toutes les erreurs | MOYEN |
| 12 | AKY-MOY-008 / SEC-008 | Purge des données locales au logout ; décision documentée sur IndexedDB prod | MOYEN |
| 13 | AKY-MOY-009 | Encadrer le chatbot (allowlist, avertissement, rédaction PII) — selon réponse métier | MOYEN |
| 14 | SEC-009 | Migrer vers `persistentMultipleTabManager` | MOYEN |
| 15 | SEC-004 | Déplacer `firebase-admin` vers `devDependencies` | ÉLEVÉ (faible probabilité, fort impact) |
| 16 | QUA-001 | Extraire la logique de calcul des soldes (`balanceCalculator.js`) | MOYEN (dette) |
| 17 | QUA-002/006/007/008/009/010, AKY-MOY-010, AKY-FAIBLE-011 | Nettoyage et dette de code, avec preuves | FAIBLE/MOYEN |

---

## 8. Questions nécessitant une validation métier

1. **Inscription publique de boutique** (AKY-ELEV-006) : est-elle volontaire en production, ou faut-il passer à un onboarding par invitation/Admin ? **Conditionne la sévérité de AKY-CRIT-001/006.**
2. **`globalClients`** (AKY-CRIT-002 / SEC-001) : les clients doivent-ils être visibles/modifiables par toutes les boutiques (partage réseau volontaire) ou strictement par la boutique d'enregistrement ?
3. **Suppression d'historique** (AKY-ELEV-003/005 / SEC-002) : une transaction validée peut-elle être supprimée, ou doit-elle seulement être annulée avec piste d'audit ? Faut-il une corbeille/archive ?
4. **Édition manuelle des soldes** (AKY-ELEV-004) : qui est autorisé à ajuster stock/liquidité hors transaction, et avec quelle justification/audit ?
5. **Chatbot n8n** (AKY-MOY-009) : le webhook est-il configuré en production ? Le chatbot peut-il recevoir des données client/transactionnelles ?
6. **Postes agents** (AKY-MOY-008 / SEC-008) : personnels, partagés ou publics ? Détermine l'urgence de la purge locale.
7. **Encodage des règles** (SEC-005/006) : des documents de production portent-ils déjà des types/statuts à encodage corrompu ? (À vérifier avant nettoyage pour ne pas bloquer leurs `update`.)
8. **Type Crédit / réseaux masqués** (QUA-002) : désactivation permanente ou temporaire (V2) ?

---

## 9. Recommandation sur l'ordre des lots de correction

Principe directeur (CLAUDE.md) : test de caractérisation AVANT toute modification
de règle métier ; ne jamais mélanger refactor et changement de comportement dans
le même lot ; correction minimale et réversible par commit local.

- **Lot 0 — Tests de caractérisation (prérequis, aucun changement métier).**
  Mettre en place l'émulateur Firestore + `@firebase/rules-unit-testing`. Écrire
  les tests qui CAPTURENT le comportement ACTUEL (multi-boutiques, dépôt/retrait/
  validation, suppression, soldes). Ces tests deviendront le filet de sécurité.
  Couvre AKY-INFO-013 / QUA-011. Aucune règle ni logique modifiée.

- **Lot 1 — Règles Firestore : isolation et profils.** AKY-CRIT-001 puis
  AKY-CRIT-002. Modifier `firestore.rules` uniquement, avec les tests du Lot 0 en
  rouge→vert. Tester avec au moins deux boutiques (exigence CLAUDE.md). Décision
  métier requise (questions 1 et 2) AVANT ce lot.

- **Lot 2 — Immutabilité financière.** AKY-ELEV-003 (bloquer `history.delete`),
  ce qui neutralise AKY-ELEV-005. Encadrer `drafts.delete`. Conditionné par la
  question 3. Règles + éventuel ajustement UI (désactiver le bouton) — mais UI et
  règles dans des sous-lots distincts (pas de mélange refactor/comportement).

- **Lot 3 — Schéma soldes réseau.** AKY-ELEV-004. Règles + validation. Conditionné
  par la question 4.

- **Lot 4 — Encodage des règles.** SEC-005/006, après vérification des données
  existantes (question 7). Lot isolé et testé (recommandation Codex).

- **Lot 5 — Performance historique.** AKY-MOY-007 / PERF-001. Pagination Firestore,
  en validant que `useDashboardData` reste correct (test de caractérisation Lot 0).

- **Lot 6 — Intégrité signup.** SEC-007 (rollback élargi). Lot applicatif isolé.

- **Lot 7 — Scripts Admin.** AKY-INFO-012 / SEC-003. Garde-fou `assertSafeFirebaseProject`.

- **Lot 8 — Hygiène dépendances.** SEC-004 (`firebase-admin` → devDeps),
  QUA-010 (`browserslist`/`lightningcss`). Un changement de dépendance à la fois
  (CLAUDE.md : ne jamais tout mettre à jour en une opération).

- **Lot 9 — Données locales / SDK.** AKY-MOY-008 (purge logout), SEC-009 (migration
  API persistance). Conditionné par la question 6.

- **Lot 10 — Chatbot.** AKY-MOY-009, selon question 5.

- **Lot 11 — Dette de code (nettoyage).** QUA-001 (extraction calcul soldes — refactor
  pur, couvert par Lot 0), QUA-002/006/007/008/009, AKY-MOY-010, AKY-FAIBLE-011
  (suppression seulement après preuve complète d'absence d'import). Aucun changement
  de comportement métier.

Ordre de priorité d'exécution : Lot 0 → 1 → 2 → 4 → 5 → 3 → 6 → 7 → 8 → 9 → 10 → 11.
(Le Lot 4 remonte avant le Lot 3 car il est indépendant et à faible risque une fois
les données vérifiées.)

---

## 10. Fichiers consultés

```
CLAUDE.md
docs/audit/claude/CLAUDE_AUDIT.md
docs/audit/codex/CODEX_AUDIT.md
firestore.rules                                  (lecture complète, lignes 1-159)
src/context/AuthContext.jsx                      (lignes 1-160 — signup + rollback)
src/context/transactions.jsx                     (lignes 60-199 — subscribe + deleteTransaction)
src/services/firestore.js                        (88-102, 300-317, 415-459, 820-844, 1090-1140)
src/components/network/NetworkCard.jsx           (40-69 — saveAmount)
src/components/chatbot/Chatbot.jsx               (1-60 — WEBHOOK_URL, sendMessage)
src/components/auth/SignInForm.jsx               (145-169 — parcours "Créer un compte boutique")
src/utils/constants.js                           (1-30 — NETWORK_OPTIONS, TRANSACTION_TYPES)
scripts/deleteExistingAccounts.mjs               (1-40 — garde-fous)
src/utils/contextFactory.jsx                     (existence confirmée)
src/components/dashboard/shared/ChartTooltip.jsx (existence + absence d'import)
src/components/dashboard/shared/ChartLegend.jsx  (existence + absence d'import)
```
Recherches transverses : grep `contextFactory` (dépôt hors node_modules → uniquement
docs d'audit) ; grep `ChartTooltip|ChartLegend` (src → aucun import).

---

## 11. Bilan de modification

| Opération | Résultat |
|---|---|
| Fichiers sources modifiés | **Aucun** |
| Fichiers sources créés | **Aucun** |
| Fichier de revue créé | `docs/audit/consolidated/CLAUDE_REVIEW_OF_CODEX.md` (ce fichier) |
| Scripts administratifs exécutés | **Non** |
| Dépendances installées/mises à jour | **Non** |
| Firebase production accédé | **Non** |
| git commit / push / déploiement | **Non** |
