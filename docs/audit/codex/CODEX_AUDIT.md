# Audit Codex - AKAYIS CRM

Date: 2026-06-17  
Sous-agent utilise: `code_mapper` (`Scout`)  
Mode: audit statique local, lecture seule jusqu'a la creation de ce rapport. Aucun acces Firebase production, aucun deploiement, aucun `git push`, aucun script administratif execute, aucune dependance installee ou mise a jour.  
Exclusions respectees: `docs/audit/claude/CLAUDE_AUDIT.md`, rapports Claude Code, `.env`, `.claude/**` non lus.

## Synthese

Fait: AKAYIS CRM est une SPA React/Vite/PWA connectee a Firebase Auth et Firestore. Le backend applicatif effectif est constitue des regles Firestore et de scripts Firebase Admin locaux; aucun code Cloud Functions applicatif n'a ete identifie hors `functions/node_modules`.

Fait: les routes applicatives sont definies dans `src/App.jsx:22` a `src/App.jsx:29` et protegent `/`, `/clients`, `/transactions`, `/historique`, `/formulaire`, `/profil` par `ProtectedRoute`.

Fait: les providers globaux sont empiles dans `src/App.jsx:41` a `src/App.jsx:54`: `AuthProvider`, `ThemeProvider`, `NetworkConfigProvider`, `ClientsProvider`, `TransactionsProvider`.

Risque principal: les regles Firestore accordent trop de confiance aux donnees de profil utilisateur ecrites cote client, puis autorisent des lectures/ecritures financieres et inter-boutiques sur cette base.

Hypothese a confirmer: certains choix, notamment `globalClients`, peuvent correspondre a une volonte metier de partage reseau. Les findings ci-dessous les traitent comme risques tant que cette intention n'est pas documentee et testee.

## Architecture et points d'entree

- Entree HTML: `index.html`, qui charge `/src/main.jsx`.
- Entree React: `src/main.jsx:7`, `createRoot(...).render(<App />)`.
- Routage: `src/App.jsx:22` a `src/App.jsx:29`.
- Pages: `src/pages/Dashboard.jsx`, `Clients.jsx`, `Transactions.jsx`, `Historique.jsx`, `Formulaire.jsx`, `Profil.jsx`.
- Contextes: `src/context/AuthContext.jsx`, `ClientsContext.jsx`, `transactions.jsx`, `NetworkConfigContext.jsx`, `ThemeContext.jsx`.
- Services: `src/services/firestore.js` concentre l'acces Firestore, les listeners, les transactions financieres et la migration localStorage.
- Hooks principaux: `src/hooks/useAllTransactions.js`, `useHistoriqueFilters.js`, `useDashboardData.js`, `useExcelOperations.js`, `useNetworkCards.js`.
- PWA: `vite.config.js:16` configure `VitePWA`; `src/config/firebase.js:82` active optionnellement la persistance Firestore IndexedDB en production.
- Scripts: `package.json:12` a `package.json:19` declare des commandes Firebase Admin sensibles.
- Cloud Functions: aucun fichier source direct identifie sous `functions/` hors `node_modules`.
- Integrations externes: Firebase Auth/Firestore, n8n via `VITE_N8N_WEBHOOK_URL`, Google Fonts via Workbox, export/import XLSX.

## Findings

### CRITIQUE

### AKY-CRIT-001

- Severite: CRITIQUE
- Confiance: haute
- Fichier: `firestore.rules`
- Ligne ou symbole: `hasProfile`, `isStoreMember`, `match /users/{userId}`; lignes 13-21 et 87-92
- Preuve: `users/{userId}` autorise un utilisateur connecte a creer son propre profil avec `role == 'store_admin'`, `active == true`, et un `storeId` arbitraire de type string. `hasProfile()` et `isStoreMember(storeId)` font ensuite confiance a `profile().storeId`.
- Scenario concret: un compte Auth nouvellement cree ecrit `users/{uid}` avec le `storeId` d'une autre boutique connue, puis lit/ecrit `clients/{storeId}/drafts`, `history` ou `networkBalances`.
- Impact: compromission inter-boutiques, acces aux donnees financieres, transactions et utilisateurs de la boutique cible.
- Test recommande: test Firestore Rules emulator avec deux boutiques A/B; l'utilisateur B cree son profil avec `storeId=A`, puis tente `get/list/create/update` sur `clients/A/history` et `clients/A/networkBalances/current`.
- Correction envisagee sans l'appliquer: interdire la creation de profils rattaches cote client, ou exiger une invitation serveur/custom claim; pour l'onboarding, verifier au minimum que `stores/{storeId}` existe et que `adminUid == request.auth.uid`.

### AKY-CRIT-002

- Severite: CRITIQUE
- Confiance: haute
- Fichier: `firestore.rules`, `src/constants/firestoreConstants.js`
- Ligne ou symbole: `match /globalClients/{clientId}`; `FIRESTORE_CONFIG.COLLECTIONS.CLIENTS`
- Preuve: `firestore.rules:97` a `firestore.rules:108` autorise `read` a tout `hasProfile()`, autorise `update` sans verifier que `resource.data.registeredStoreId == profile().storeId`, et autorise `delete` a tout profil actif. `src/constants/firestoreConstants.js:7` mappe `CLIENTS` vers `globalClients`.
- Scenario concret: une boutique authentifiee liste, modifie ou supprime un client cree par une autre boutique.
- Impact: fuite de donnees personnelles, corruption ou suppression inter-boutiques, perte de confiance dans les exports et recherches client.
- Test recommande: dans l'emulator, creer un client `registeredStoreId=A`; verifier qu'un utilisateur de boutique B ne peut ni lire, ni modifier, ni supprimer ce document.
- Correction envisagee sans l'appliquer: limiter `read/update/delete` a `resource.data.registeredStoreId == profile().storeId`, ou migrer vers une collection par boutique si le partage global n'est pas une exigence metier.

### ELEVE

### AKY-ELEV-003

- Severite: ELEVE
- Confiance: haute
- Fichier: `firestore.rules`, `src/context/transactions.jsx`, `src/services/firestore.js`
- Ligne ou symbole: `drafts.delete`, `history.delete`, `deleteTransaction`, `deleteFromHistory`
- Preuve: `firestore.rules:122` autorise la suppression des drafts par tout membre de boutique; `firestore.rules:134` autorise la suppression de l'historique; `firestore.rules:151` interdit l'ecriture dans `auditLogs`. Cote UI, `src/context/transactions.jsx:184` a `src/context/transactions.jsx:194` supprime soit un draft soit une entree d'historique.
- Scenario concret: un utilisateur supprime une transaction financiere historique apres validation.
- Impact: perte de piste d'audit, litiges non resolvables, non-respect de l'exigence "toute operation financiere doit preserver une piste d'audit".
- Test recommande: creer une transaction validee en emulator, la supprimer via les droits d'un membre boutique, puis verifier que `clients/{storeId}/auditLogs` et l'historique ne conservent aucune trace.
- Correction envisagee sans l'appliquer: remplacer les suppressions par annulation immuable avec statut, `cancelledAt`, `cancelledBy`, justification obligatoire et ecriture d'audit atomique.

### AKY-ELEV-004

- Severite: ELEVE
- Confiance: haute
- Fichier: `firestore.rules`, `src/components/network/NetworkCard.jsx`, `src/services/firestore.js`
- Ligne ou symbole: `networkBalances`, `saveAmount`, `setNetworkBalance`
- Preuve: `firestore.rules:137` a `firestore.rules:141` autorise `create/update` de `networkBalances/current` si `balances is map`, sans schema strict ni role. `src/components/network/NetworkCard.jsx:52` a `src/components/network/NetworkCard.jsx:60` permet l'edition directe des soldes; `src/services/firestore.js:825` a `src/services/firestore.js:841` ecrit le nouveau montant.
- Scenario concret: un utilisateur ajuste manuellement le stock ou la liquidite hors transaction, ou injecte un reseau/champ inattendu dans la map.
- Impact: soldes financiers non fiables, ecarts non justifies, absence d'audit.
- Test recommande: depuis un membre boutique, mettre a jour `balances` avec un reseau arbitraire et un montant incoherent; verifier que les regles l'acceptent aujourd'hui.
- Correction envisagee sans l'appliquer: valider le schema complet des soldes, reserver l'edition manuelle a un role explicite, journaliser toute correction, et preferer des transitions transactionnelles derivees des operations.

### AKY-ELEV-005

- Severite: ELEVE
- Confiance: moyenne-haute
- Fichier: `src/services/firestore.js`
- Ligne ou symbole: `deleteFromHistory`
- Preuve: `src/services/firestore.js:1098` a `src/services/firestore.js:1099` appelle `deleteDocument(HISTORY, historyId)` sans compensation des soldes reseau, alors que `addTransaction` et `validateTransaction` impactent `networkBalances` dans des `runTransaction`.
- Scenario concret: une transaction validee ayant modifie les soldes est supprimee de l'historique; les soldes restent inchanges.
- Impact: divergence definitive entre historique financier et soldes courants.
- Test recommande: creer une transaction validee, noter `networkBalances/current`, supprimer l'entree history, puis comparer les soldes.
- Correction envisagee sans l'appliquer: interdire la suppression d'historique; si une correction metier est necessaire, creer une operation inverse auditee dans une transaction Firestore.

### AKY-ELEV-006

- Severite: ELEVE
- Confiance: haute
- Fichier: `src/context/AuthContext.jsx`, `src/components/auth/SignInForm.jsx`, `firestore.rules`
- Ligne ou symbole: `signup`, bouton "Creer un compte boutique", `stores.create`, `users.create`
- Preuve: `src/context/AuthContext.jsx:95` a `src/context/AuthContext.jsx:134` cree un compte Auth puis ecrit `stores/{storeId}` et `users/{uid}`. `src/components/auth/SignInForm.jsx:152` a `src/components/auth/SignInForm.jsx:161` expose le parcours "Nouvelle boutique". Les regles `firestore.rules:69` a `firestore.rules:76` et `firestore.rules:87` a `firestore.rules:92` permettent cet onboarding cote client.
- Scenario concret: en production, une personne externe cree une boutique active sans validation administrative.
- Impact: abus de comptes, donnees parasites, surface d'attaque plus large. L'impact inter-boutiques devient critique si combine avec AKY-CRIT-001.
- Test recommande: en emulator, creer un compte depuis l'UI et verifier les documents `stores` et `users` crees sans approbation externe.
- Correction envisagee sans l'appliquer: desactiver l'inscription publique en production ou remplacer par invitation/Admin; documenter explicitement si l'auto-enrolement est volontaire.

### MOYEN

### AKY-MOY-007

- Severite: MOYEN
- Confiance: haute
- Fichier: `src/context/transactions.jsx`, `src/services/firestore.js`, `src/hooks/useHistoriqueFilters.js`
- Ligne ou symbole: `subscribeToDrafts`, `subscribeToHistory`, `subscribeToCollection`, `filteredTransactions`
- Preuve: `src/context/transactions.jsx:69` et `src/context/transactions.jsx:80` installent deux listeners temps reel. `src/services/firestore.js:428` a `src/services/firestore.js:432` indique "Pas de limite par defaut". `src/hooks/useHistoriqueFilters.js:15` a `src/hooks/useHistoriqueFilters.js:20` filtre ensuite l'historique en memoire.
- Scenario concret: avec plusieurs milliers de transactions, l'ouverture de l'historique ou du dashboard charge toute la collection `history`.
- Impact: couts Firestore, latence, memoire navigateur, risque de timeouts et experience degradee.
- Test recommande: seed emulator avec 10 000 transactions history, mesurer nombre de documents lus, temps d'affichage et memoire.
- Correction envisagee sans l'appliquer: requetes bornees par date, pagination serveur avec curseurs, index Firestore et listeners limites aux vues actives.

### AKY-MOY-008

- Severite: MOYEN
- Confiance: haute
- Fichier: `src/components/ClientForm.jsx`, `src/context/NetworkConfigContext.jsx`, `src/config/firebase.js`
- Ligne ou symbole: `CLIENT_FORM_DRAFT_KEY`, `NETWORK_DATA_STORAGE_KEY`, `enableMultiTabIndexedDbPersistence`
- Preuve: `src/components/ClientForm.jsx:26` et `src/components/ClientForm.jsx:64` lisent/ecrivent un brouillon client en `localStorage`. `src/context/NetworkConfigContext.jsx:31`, `src/context/NetworkConfigContext.jsx:48` et `src/context/NetworkConfigContext.jsx:73` persistent les soldes reseau localement. `src/config/firebase.js:82` a `src/config/firebase.js:83` active optionnellement la persistance IndexedDB Firestore en production.
- Scenario concret: sur un ordinateur partage ou perdu, un brouillon client, des soldes ou des donnees Firestore restent consultables apres deconnexion.
- Impact: exposition de donnees personnelles et financieres locales.
- Test recommande: saisir un brouillon client et charger des donnees, se deconnecter, puis inspecter Application Storage (`localStorage`, IndexedDB, Cache Storage).
- Correction envisagee sans l'appliquer: TTL pour brouillons, purge au logout, bouton "effacer les donnees locales", minimisation des donnees persistees et decision documentee sur IndexedDB en prod.

### AKY-MOY-009

- Severite: MOYEN
- Confiance: haute
- Fichier: `src/components/chatbot/Chatbot.jsx`
- Ligne ou symbole: `WEBHOOK_URL`, `sendMessage`
- Preuve: `src/components/chatbot/Chatbot.jsx:11` lit `VITE_N8N_WEBHOOK_URL`; `src/components/chatbot/Chatbot.jsx:48` a `src/components/chatbot/Chatbot.jsx:57` envoie le message utilisateur et un timestamp par `fetch` sans redaction PII, proxy serveur, consentement explicite ou contexte d'autorisation.
- Scenario concret: un agent colle des informations client ou transactionnelles dans le chatbot; elles partent vers un webhook n8n configure.
- Impact: fuite potentielle de donnees personnelles ou financieres vers une integration externe.
- Test recommande: pointer le webhook vers un collecteur local en dev, envoyer un message contenant PII, verifier le payload.
- Correction envisagee sans l'appliquer: proxy serveur controle, allowlist d'URL, redaction PII, avertissement utilisateur, journalisation minimale et decision metier sur les donnees autorisees.

### AKY-MOY-010

- Severite: MOYEN
- Confiance: haute
- Fichier: `src/config/clientIsolation.js`, `src/services/firestore.js`
- Ligne ou symbole: `getFirestoreCollectionPath`, `resolveCollectionPath`
- Preuve: `src/config/clientIsolation.js:17` a `src/config/clientIsolation.js:23` prevoit un namespace `clients/{CLIENT_ID}/{collectionName}`. Mais `src/services/firestore.js:90` a `src/services/firestore.js:94` exclut `users`, `stores` et `globalClients` de ce namespace, et `src/services/firestore.js:97` a `src/services/firestore.js:101` route les autres collections sous la boutique active.
- Scenario concret: l'equipe croit isoler toutes les donnees par `VITE_CLIENT_ID`, mais les clients globaux et les profils restent a la racine.
- Impact: confusion de configuration multi-tenant, regles difficiles a raisonner, risque de migration incomplete.
- Test recommande: en emulator, creer un compte et un client avec differents `VITE_CLIENT_ID`; inspecter les chemins reels ecrits.
- Correction envisagee sans l'appliquer: documenter le modele final, aligner code/regles/docs, et caracteriser par tests les chemins de chaque collection.

### FAIBLE

### AKY-FAIBLE-011

- Severite: FAIBLE
- Confiance: moyenne
- Fichier: `src/utils/contextFactory.jsx`, `src/components/dashboard/shared/ChartTooltip.jsx`, `src/components/dashboard/shared/ChartLegend.jsx`
- Ligne ou symbole: exports non references par recherche statique
- Preuve: le sous-agent n'a pas trouve d'import statique explicite pour ces fichiers. Je ne les qualifie pas de morts: aucune preuve dynamique complete n'a ete produite.
- Scenario concret: de la dette de code ou des composants d'une ancienne refactorisation restent dans le depot.
- Impact: complexite de maintenance, bruit d'audit.
- Test recommande: analyse bundler + recherche imports dynamiques + verification scripts/configs avant toute suppression.
- Correction envisagee sans l'appliquer: ne rien supprimer sans preuve complete et possibilite de restauration par commit local.

### INFORMATION

### AKY-INFO-012

- Severite: INFORMATION
- Confiance: haute
- Fichier: `package.json`, `scripts/*.mjs`
- Ligne ou symbole: scripts `account:*`, `seed:stores`, `accounts:delete`
- Preuve: `package.json:12` a `package.json:19` declare des scripts Firebase Admin. `scripts/deleteExistingAccounts.mjs:22` a `scripts/deleteExistingAccounts.mjs:29` ajoute un garde-fou pour `--execute`, mais `scripts/seedStores.mjs:9` a `scripts/seedStores.mjs:17` et `scripts/updateAccountPassword.mjs:20` a `scripts/updateAccountPassword.mjs:29` peuvent agir sur le projet des credentials fournis.
- Scenario concret: un operateur lance un script avec `GOOGLE_APPLICATION_CREDENTIALS` pointant vers production.
- Impact: modification de comptes, seed ou suppression sur un projet reel.
- Test recommande: ajouter un test/controle local qui refuse tout `projectId` non emulator/non allowlist avant initialisation Admin.
- Correction envisagee sans l'appliquer: garde-fou centralise `assertSafeFirebaseProject`, README admin explicite, scripts separes du flux applicatif, dry-run par defaut partout.

### AKY-INFO-013

- Severite: INFORMATION
- Confiance: haute
- Fichier: `package.json`
- Ligne ou symbole: scripts de test
- Preuve: aucune commande `test`, `vitest`, `jest`, `playwright`, `firebase emulators:exec` ou dependance de tests Firestore Rules n'a ete trouvee dans `package.json`; `package.json:10` contient seulement `lint`.
- Scenario concret: une correction de regles ou de logique soldes part en V2 sans caracterisation automatisable.
- Impact: regressions metier et securite difficiles a detecter.
- Test recommande: ajouter d'abord une suite Firestore Rules emulator multi-boutiques, puis tests de caracterisation depot/retrait/credit/suppression/annulation.
- Correction envisagee sans l'appliquer: introduire des tests cibles avant toute modification metier, conformement a `AGENTS.md`.

## Validations observees

- Le sous-agent personnalise `code_mapper` a ete utilise explicitement pour l'audit approfondi independant.
- Les findings majeurs ont ete verifies directement dans le code avant creation du rapport.
- Une validation independante en lecture seule a ete effectuee par le sous-agent `reviewer`.
- L'etat Git a ete verifie avant et apres creation du rapport.

## Tests manquants prioritaires

- Tests Firestore Rules multi-boutiques avec au moins deux boutiques et deux utilisateurs.
- Tests de caracterisation depot, retrait, credit, validation de draft et impact sur `networkBalances`.
- Tests suppression/annulation pour verifier l'immutabilite et la piste d'audit.
- Tests import/export XLSX/XLSM avec donnees clients sensibles.
- Tests offline/logout/localStorage/IndexedDB pour les donnees persistantes locales.
- Tests de performance sur historique volumineux et pagination serveur.

## Changements hors perimetre

- Aucun fichier source applicatif modifie.
- Aucun fichier supprime.
- Aucun script Firebase Admin execute.
- Aucun lint, test ou build lance.
- Aucun commit, push, deploiement ou pull request.

## Points positifs

- Les operations de creation, validation et modification de certaines transactions utilisent `runTransaction`, ce qui reduit les risques de concurrence sur les soldes.
- Les scripts de suppression globale disposent deja de plusieurs garde-fous (`--execute`, `--confirm-delete-all`, variable d'environnement).
- La configuration Firebase client peut utiliser les emulateurs en developpement via `VITE_USE_FIREBASE_EMULATORS`.
- Les regles Firestore contiennent un deny-all final sur `/{document=**}`.

## Verdict final

Le projet est fonctionnellement structure mais presente des risques de securite et d'audit financier incompatibles avec une V2 sans tests prealables. Les priorites doivent etre les regles Firestore multi-boutiques, l'immutabilite/audit des operations financieres et la clarification du modele `globalClients`.

## Priorites avant la V2

1. Corriger et tester les regles Firestore multi-boutiques, surtout profils `users`, `globalClients`, `drafts`, `history`, `networkBalances`.
2. Rendre les operations financieres immuables ou auditees: pas de suppression silencieuse, pas de correction de solde sans justification.
3. Clarifier le modele metier des clients: global partage ou strictement boutique.
4. Borner les lectures Firestore et remplacer les filtres purement memoire par pagination/requetes indexees.
5. Ajouter les tests de caracterisation avant refactor: regles, soldes, validation de transactions, import/export, offline/logout.

## Questions metier a poser

- L'inscription publique d'une nouvelle boutique est-elle autorisee en production?
- Les clients doivent-ils etre visibles par toutes les boutiques ou uniquement par la boutique d'enregistrement?
- Qui peut modifier manuellement stock et liquidite, et avec quelle justification?
- Une transaction historique peut-elle etre supprimee, ou doit-elle seulement etre annulee?
- Le chatbot est-il autorise a recevoir des donnees client ou transactionnelles?
- Les postes utilises par les agents sont-ils personnels, partages ou publics?

## Elements necessitant une validation Claude

- Rejouer les findings Firestore dans l'emulator avec deux boutiques et deux utilisateurs.
- Confirmer l'intention metier de `globalClients`.
- Confirmer si l'auto-enrolement boutique est voulu ou temporaire.
- Verifier les parcours reels du client avant de modifier l'immutabilite des transactions.
- Comparer cet audit avec les rapports Claude sans me demander de les lire dans cette mission.

## Limites de l'audit

- Audit statique uniquement; aucun lint, test, build ou script Admin n'a ete execute.
- Aucun acces reseau distant ni Firebase production.
- `.env`, `.claude/**`, `CLAUDE.md`, `docs/audit/claude/**` et rapports Claude Code non lus.
- Les fichiers signales comme potentiellement inutilises ne doivent pas etre supprimes sans preuve complete d'absence d'import statique, dynamique, script, configuration et usage metier.
- Certaines sorties PowerShell affichent des accents alteres; les recherches `rg` confirment que des valeurs metier accentuees existent aussi en UTF-8. Toute correction d'encodage doit etre traitee separement et testee.
