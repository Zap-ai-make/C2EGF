# Validation Codex de LOT_0_TEST_STRATEGY

Date : 2026-06-18

Perimetre : validation documentaire independante de `docs/audit/consolidated/LOT_0_TEST_STRATEGY.md`, en lecture seule du code et des configurations.

Sous-agent explicitement utilise : `reviewer` (`Sentinel`, id `019ed9d2-4cd6-77d2-9cc9-1f7edffa92b8`). Son verdict independant est integre : corrections obligatoires avant demarrage.

Garanties de cette validation : aucun fichier existant modifie, aucun fichier source modifie, aucune dependance installee, aucun emulateur lance, aucun test/lint/build lance, aucun commit, aucun push, aucun deploiement.

---

## Verdict

**ACCEPTABLE SOUS CONDITIONS**

Le document de strategie est globalement coherent avec l'etat reel du depot et avec le `MASTER_AUDIT.md`, mais il ne doit pas etre utilise tel quel pour commencer le Lot 0. Les corrections documentaires obligatoires ci-dessous doivent etre appliquees avant execution.

Decision explicite : **le Lot 0 peut commencer apres correction documentaire obligatoire**. En l'etat actuel du document, **non**.

---

## Points verifies

- Etat actuel des scripts et dependances : `package.json:6-20` ne contient aucun script de test ; `package.json:33-44` ne contient aucun outil de test.
- Stack courante : React `^19.1.1`, Firebase client `^12.2.1`, Firebase Admin `^13.10.0`, Vite `^7.1.2` dans `package.json:21-43`; lockfile installe Vite `7.1.5` (`package-lock.json:9505-9507`).
- Configuration Firebase : `firebase.json:1-5` ne declare que les regles Firestore ; `.firebaserc:1-4` pointe le projet par defaut vers `taofic-ajagbe`.
- Configuration Vite : PWA chargee dans `vite.config.js:16-142`, avec `devOptions.enabled: true` aux lignes `22-25`.
- Regles Firestore : `validTransaction` est une fonction de regle (`firestore.rules:35-40`), `users.create` accepte un `storeId` string sans verification d'appartenance (`firestore.rules:87-92`), `globalClients` est permissif en lecture/update/delete (`firestore.rules:97-109`), `history.delete` est autorise (`firestore.rules:125-134`), `networkBalances` ne valide que `balances is map` (`firestore.rules:137-142`).
- Code applicatif : `validateTransactionForm` est un validateur UI (`src/utils/helpers.js:203-205`), `validateTransaction` est une operation Firestore async Drafts -> History (`src/services/firestore.js:1156-1223`), pas un validateur pur.
- Fonctions financieres : `applyLiquidityDelta` (`src/services/firestore.js:652-681`), `applyInitialTransactionImpact` (`src/services/firestore.js:711-744`), `reverseInitialTransactionImpact` (`src/services/firestore.js:746-760`), `applySettlementImpact` (`src/services/firestore.js:763-773`).
- Structure reelle consultee : `src/` contient notamment `components`, `config`, `constants`, `context`, `hooks`, `pages`, `services`, `utils`; `scripts/` contient les scripts Admin/client listes dans `package.json`.
- Absence de tests existants : recherche `*.test.*` / `*.spec.*` sans resultat.

---

## Erreurs factuelles ou formulations a corriger

1. **Vitest sans test valide a l'etape 1**

   `LOT_0_TEST_STRATEGY.md:399` indique que `npx vitest run --reporter=verbose` doit trouver 0 test et sortir en exit 0. Ce critere est fragile : selon la configuration Vitest et les options retenues, l'absence de fichiers de test peut etre traitee comme une erreur. Le critere doit etre reformule en test de demarrage reproductible : creer un test smoke minimal temporaire ou permanent (`tests/unit/smoke.test.js`) qui verifie que le runner demarre, puis le remplacer par les vrais tests de caracterisation.

2. **Installation de coverage trop tot**

   `LOT_0_TEST_STRATEGY.md:391-395` installe `vitest @vitest/coverage-v8 jsdom` des l'etape 1, alors que le coverage est configure en etape 7 (`LOT_0_TEST_STRATEGY.md:451-456`). Pour respecter l'atomicite et eviter un changement groupe, installer `vitest` et `jsdom` d'abord, puis `@vitest/coverage-v8` seulement a l'etape coverage.

3. **Version de `@firebase/rules-unit-testing` incoherente**

   Le document mentionne une ligne `9.x` a verifier (`LOT_0_TEST_STRATEGY.md:60`) puis `^4 ou ligne courante` (`LOT_0_TEST_STRATEGY.md:126`). Cette contradiction doit etre remplacee par une consigne unique : verifier la version exacte et les `peerDependencies` avec `npm view @firebase/rules-unit-testing version peerDependencies` avant installation, sans supposer une ligne majeure.

4. **Compatibilites declarees trop affirmatives**

   Les recommandations `Vitest ^3` (`LOT_0_TEST_STRATEGY.md:72-73`) et `@testing-library/react ^16` (`LOT_0_TEST_STRATEGY.md:90-91`) sont plausibles pour React 19 / Vite 7, mais doivent rester formulees comme contraintes a verifier au moment de l'installation. Le rapport ne doit pas dire "compatibilite confirmee" quand il indique aussi "A VERIFIER".

5. **Commande `test` trop large pour Firestore**

   `LOT_0_TEST_STRATEGY.md:364-369` propose `test: vitest run` et `test:firestore: firebase emulators:exec --only firestore "vitest run tests/firestore"`. Si `vitest run` inclut aussi `tests/firestore`, les tests de regles peuvent etre lances hors emulateur. Il faut exclure `tests/firestore` du script general ou definir des projets Vitest separes.

6. **Projet Firebase de test non force dans les commandes**

   `LOT_0_TEST_STRATEGY.md:438` propose `firebase emulators:exec --only firestore "npx vitest run tests/firestore"` sans `--project demo-akayis-test`, alors que `.firebaserc:1-4` pointe vers un projet par defaut reel. Meme avec emulateur, les commandes doivent forcer un `projectId` `demo-*` et les tests doivent refuser tout projet non `demo-*`.

---

## Risques non couverts

1. **Caracterisation dashboard manquante**

   `MASTER_AUDIT.md:685-690` demande de caracteriser `useDashboardData` / `useAllTransactions` sur un dataset connu. Or les TC-001 a TC-010 de `LOT_0_TEST_STRATEGY.md:209-307` ne couvrent pas ces hooks. Le code existe dans `src/hooks/useDashboardData.js:12-58` et `src/hooks/useAllTransactions.js:8-33`. C'est un manque avant les lots de performance, pagination et audit qualite.

2. **Garde-fou anti-production trop tardif**

   `src/config/firebase.js:67-75` connecte les emulateurs seulement si `VITE_USE_FIREBASE_EMULATORS === 'true'`; `src/config/firebase.js:97-103` expose le `projectId`. La strategie mentionne le risque (`LOT_0_TEST_STRATEGY.md:472-476`) mais ne prevoit pas un test/garde-fou executable des l'installation de l'infrastructure.

3. **Auth emulator ou mock a trancher pour TC-005**

   TC-005 concerne le rollback Auth (`LOT_0_TEST_STRATEGY.md:249-257`, code `src/context/AuthContext.jsx:95-150`). L'etape 6 dit "si l'emulateur Auth est configure ; sinon mocker" (`LOT_0_TEST_STRATEGY.md:447`), mais l'etape 5 ne configure que Firestore. Le document doit choisir explicitement : mock pur en Lot 0, ou ajout controle de l'emulateur Auth.

4. **Baseline prealable au code mort insuffisante**

   `LOT_0_TEST_STRATEGY.md:517-535` exclut correctement la suppression de code mort, mais ne prevoit pas l'artefact qui rendra l'audit approfondi reproductible : inventaire imports statiques, imports dynamiques, scripts, configs, routes, references metier. `MASTER_AUDIT.md:786-792` rappelle que le code mort suspect n'est pas prouve.

---

## Corrections obligatoires

1. Ajouter un TC de caracterisation dashboard couvrant `useDashboardData` et `useAllTransactions`, avec dataset fixe et date controlee, sans refactor metier.
2. Reformuler l'etape 1 : ne pas exiger qu'une suite vide Vitest sorte en exit 0 ; utiliser un smoke test minimal reproductible.
3. Separer l'installation/configuration de `@vitest/coverage-v8` de l'installation initiale de Vitest/jsdom.
4. Corriger la strategie npm pour que les tests Firestore ne puissent pas etre executes hors `firebase emulators:exec`.
5. Forcer `--project demo-akayis-test` dans les commandes emulateur et ajouter un garde-fou de test qui echoue si le `projectId` ne commence pas par `demo-`.
6. Clarifier la version de `@firebase/rules-unit-testing` : supprimer la contradiction `9.x` / `^4` et imposer une verification `npm view` avant installation.
7. Decider explicitement pour TC-005 : mock Auth en Lot 0 ou configuration Auth emulator avec ports dedies.
8. Ajouter un livrable prealable a l'audit qualite/code mort : baseline d'imports statiques/dynamiques, scripts, configs et usages metier, sans suppression.

---

## Corrections recommandees

- Remplacer le script `validate` propose par une commande explicite : `npm run lint && npm run test:unit && npm run test:components && npm run test:firestore && npm run build`.
- Ajouter des commandes PowerShell mesurables pour les criteres d'acceptation : `git status --short`, `rg "firebase-admin" src`, `rg "VITE_FIREBASE_PROJECT_ID|FIRESTORE_EMULATOR_HOST|VITE_USE_FIREBASE_EMULATORS" tests .env.test*`.
- Ajouter une section "sorties attendues" pour Windows PowerShell, notamment pour l'etat git et l'absence d'import `firebase-admin` dans `src/`.
- Garder Playwright hors Lot 0. `LOT_0_TEST_STRATEGY.md:142-149` et `458-461` le reportent deja ; il faut retirer le caractere "optionnel dans Lot 0" et en faire une decision post-Lot 0.
- Ajouter `firebase-tools` comme pre-requis explicite et choisir entre installation en `devDependencies` ou usage global documente ; sans cela le script `test:firestore` n'est pas reproductible.
- Preciser que l'ajout `firebase.json` doit contenir au minimum `emulators.firestore.host/port`, et `emulators.auth` seulement si TC-005 utilise l'Auth emulator.

---

## Ordre d'execution revise

1. Verrou documentaire et garde-fou anti-production : definir `projectId` `demo-akayis-test`, commandes avec `--project`, interdiction de charger `.env` production, choix mock/Auth emulator pour TC-005.
2. Installer/configurer `vitest` et `jsdom` uniquement ; creer un smoke test minimal.
3. Installer/configurer React Testing Library ; valider un rendu trivial.
4. Creer fixtures A/B, users, transactions, dataset dashboard ; verifier les imports ESM.
5. Ecrire tests unitaires TC-001 a TC-006 et TC dashboard/useAllTransactions, sans extraction.
6. Configurer `firebase.json` pour emulateurs et installer `@firebase/rules-unit-testing` apres verification de version ; ajouter `firebase-tools` de facon reproductible ou documenter son pre-requis.
7. Ecrire tests Firestore TC-007 a TC-010 et scenarios section 6 avec deux boutiques A/B, roles, creation de profils, `globalClients`, `history`, `networkBalances`.
8. Configurer coverage et `validate` apres premiers tests verts.
9. Produire la baseline d'audit qualite/code mort : imports statiques, imports dynamiques, scripts, configs, routes et usages metier. Aucune suppression.
10. Executer la porte finale : lint, unit, components, firestore via emulateur, coverage, build, puis revue du diff.

---

## Decision finale

Le Lot 0 est **acceptable sous conditions**. Il peut commencer apres correction documentaire, car les erreurs relevees concernent la strategie, l'ordre et les garde-fous, pas une impossibilite technique.

Sans ces corrections, le risque principal est de lancer des tests Firestore hors cadre d'emulateur, de croire Vitest valide sans test reel, de manquer la caracterisation dashboard exigee par le MASTER, et de laisser un angle mort avant l'audit qualite/code mort.

---

## Revalidation après corrections documentaires

Date : 2026-06-18

Sous-agent explicitement utilisé : `reviewer` (`Guard`, id `019ed9ff-8cdc-74a2-a642-02cb29ff2a2f`). Relecture effectuée en lecture seule, sans test, sans émulateur, sans installation, sans commit.

### Statut des sept conditions

| Condition | Statut | Justification |
|---|---|---|
| 1. Test dashboard `useDashboardData` / `useAllTransactions`, dataset déterministe, date contrôlée, sans refactor métier | **Levée** | TC-011 couvre les deux hooks, impose fixtures fixes, `vi.setSystemTime`, et interdit la refactorisation métier (`LOT_0_TEST_STRATEGY.md:320-334`). Les fixtures et le fichier de test sont prévus (`:473`, `:481`) et le risque d’horloge est documenté (`:567`). |
| 2. Étape Vitest validée par un vrai smoke test | **Levée** | L’étape 1 crée `tests/unit/smoke.test.js` avec assertion réelle et exige une sortie `1 passed`, jamais une suite vide (`LOT_0_TEST_STRATEGY.md:444-456`, critère `:591`). |
| 3. Installation de `@vitest/coverage-v8` séparée | **Levée** | L’étape 1 installe seulement `vitest jsdom` (`LOT_0_TEST_STRATEGY.md:435-440`) ; le coverage est installé séparément à l’étape 7 (`:530-535`). |
| 4. Tests Firestore uniquement via `firebase emulators:exec` | **Levée** | `test:firestore` encapsule `firebase emulators:exec` (`LOT_0_TEST_STRATEGY.md:394`) ; le script général exclut `tests/firestore` (`:401`) ; l’avertissement interdit `npx vitest run tests/firestore` hors enveloppe (`:512-518`). |
| 5. `--project demo-akayis-test` obligatoire + garde-fou `demo-` | **Levée** | La commande force `--project demo-akayis-test` (`LOT_0_TEST_STRATEGY.md:514`) et le `beforeAll` échoue si `projectId` est absent ou ne commence pas par `demo-` (`:501-510`). Le risque `.firebaserc` réel est nommé (`:511`, `:558-560`). |
| 6. `@firebase/rules-unit-testing` sans version contradictoire + commande `npm view` | **Partiellement levée** | Les versions contradictoires `9.x` / `^4` sont supprimées et la vérification `version` + `peerDependencies` est imposée (`LOT_0_TEST_STRATEGY.md:61`, `:125-133`, `:487-492`). Réserve mineure : le document utilise deux commandes séparées, pas la forme exacte demandée `npm view @firebase/rules-unit-testing version peerDependencies`. |
| 7. TC-005 mock Firebase Auth, émulateur Auth reporté, aucun appel auth production | **Levée** | TC-005 tranche explicitement pour `vi.mock('firebase/auth')`, reporte l’émulateur Auth et interdit tout appel à l’authentification production (`LOT_0_TEST_STRATEGY.md:256-268`). L’étape 6 le rappelle (`:526-527`) et la section risque confirme l’absence d’appel auth prod (`:561`). |

### Réserves restantes

- Le rapport de validation initial listait huit corrections obligatoires, pas sept : la baseline préalable à l’audit qualité/code mort (`imports statiques/dynamiques, scripts, configs, usages métier`) reste absente comme livrable structuré dans `LOT_0_TEST_STRATEGY.md`. Référence initiale : `CODEX_VALIDATION_OF_LOT_0_STRATEGY.md:87-94` et ordre révisé `:119`.
- TC-005 présente une incohérence d’ordre : le tableau de séquence le rattache à l’étape 4 (`LOT_0_TEST_STRATEGY.md:427`), tandis que le détail le place en intégration étape 6 (`:482`, `:526-527`).
- Les commandes PowerShell mesurables recommandées (`git status --short`, `rg "firebase-admin" src`, vérification env test) ne sont pas intégrées comme critères opérationnels complets ; la stratégie ne conserve qu’une vérification finale partielle (`LOT_0_TEST_STRATEGY.md:689-694`).
- La condition 6 doit idéalement ajouter la commande exacte `npm view @firebase/rules-unit-testing version peerDependencies` en plus ou à la place des deux commandes séparées.

### Verdict final

**NON VALIDÉ**

Justification concise : les sept corrections demandées sont largement traitées, mais pas totalement levées au sens strict à cause de la commande `npm view` non présente sous la forme exacte demandée. Surtout, la comparaison avec la validation initiale laisse une correction obligatoire non reprise (baseline préalable à l’audit qualité/code mort) et une incohérence d’ordre sur TC-005. Le Lot 0 ne doit donc pas démarrer tant que ces réserves documentaires n’ont pas été corrigées.

---

## Revalidation finale

Date : 2026-06-18

Sous-agent explicitement utilisé : `reviewer` (`Audit`, id `019eda0f-371f-7ff2-871f-de7a74e0870c`). Relecture effectuée en lecture seule, sans test, sans émulateur, sans installation, sans commit.

### Statut des réserves

| Réserve | Statut | Justification |
|---|---|---|
| 1. Commande exacte `npm view @firebase/rules-unit-testing version peerDependencies` | **Levée** | La commande apparaît telle quelle dans les contraintes Firebase et dans l’étape 5 (`LOT_0_TEST_STRATEGY.md:65`, `:131-135`, `:521-525`). |
| 2. Baseline préalable à l’audit qualité/code mort | **Levée** | La section `9 bis` définit la baseline avec lint, build, unit, Firestore, coverage, inventaires, routes/scripts/dépendances, candidats inutilisés non confirmés, tailles/lignes, état git, date/branche/hash, sans suppression ni refactorisation (`LOT_0_TEST_STRATEGY.md:645-670`). |
| 3. Ordre de TC-005 cohérent | **Levée** | TC-005 impose le mock Auth avant exécution, reste hors émulateur Auth et interdit tout accès Auth production (`LOT_0_TEST_STRATEGY.md:259-268`, `:512`, `:559`). |
| 4. Commandes Windows PowerShell complètes et copiables | **Non levée - bloquant** | La commande PowerShell directe de validation omet `npm run test:components` (`LOT_0_TEST_STRATEGY.md:585-588`), alors que TC-005 passe par `test:components` (`:680`) et que le script npm `validate` l’inclut (`:401`). |
| 5. Tests Firestore avec `--project demo-akayis-test` | **Levée** | Les scripts et commandes Firestore forcent `--project demo-akayis-test` (`LOT_0_TEST_STRATEGY.md:399`, `:547`, `:562`, `:681`). |
| 6. Aucun script ne dépend implicitement du projet réel `.firebaserc` | **Levée** | Le projet réel `.firebaserc` est identifié et la stratégie interdit de s’y reposer implicitement pour les commandes Lot 0 (`.firebaserc:1-4`, `LOT_0_TEST_STRATEGY.md:412`, `:423`, `:544`, `:616-618`). |
| 7. Aucune correction métier, suppression, refactorisation ou déploiement | **Levée** | Le hors périmètre interdit correction des règles, suppression, refactorisation, déploiement et changement métier (`LOT_0_TEST_STRATEGY.md:692-710`). |

### Anomalie bloquante restante

**BLOC-01 — Commande PowerShell `validate` incomplète.** La commande directe de porte qualité documentée à `LOT_0_TEST_STRATEGY.md:585-588` lance `lint`, `test:unit`, `test:firestore`, puis `build`, mais pas `test:components`. Un opérateur qui copierait cette commande pourrait valider le Lot 0 sans exécuter TC-005, alors que TC-005 est explicitement rattaché à `test:components` (`LOT_0_TEST_STRATEGY.md:680`). La correction documentaire attendue est d’ajouter `npm run test:components` entre `test:unit` et `test:firestore` dans cette commande PowerShell directe.

### Verdict final

**NON VALIDÉ**

Justification concise : toutes les réserves ouvertes sont levées sauf la complétude des commandes Windows PowerShell. Comme cette anomalie peut faire sauter TC-005 dans la porte qualité copiée manuellement, elle reste bloquante pour démarrer le Lot 0.

---

## Décision finale après levée de BLOC-01

Date : 2026-06-18

Sous-agent explicitement utilisé : `reviewer` (`Sentinel the 2nd`, id `019eda1f-e064-7132-bcaf-a1a8dce50c55`). Relecture ciblée effectuée en lecture seule, sans test, sans émulateur, sans installation, sans commit.

### Statut de BLOC-01

**BLOC-01 est levé.**

- La commande PowerShell directe de validation globale contient `npm run lint`, `npm run build`, `npm run test:unit`, `npm run test:components`, `npm run test:firestore` et `npm run test:coverage` (`LOT_0_TEST_STRATEGY.md:586-588`).
- Chaque commande après `npm run lint` est protégée par `if ($?)`, donc ne s’exécute que si la précédente a réussi (`LOT_0_TEST_STRATEGY.md:588`).
- Le script npm `validate` documenté couvre le même périmètre : lint, build, unit, components, firestore, coverage (`LOT_0_TEST_STRATEGY.md:397-402`).
- TC-005 est explicitement exécuté par `npm run test:components` (`LOT_0_TEST_STRATEGY.md:274`, `:681`).
- `npm run test:components` est présenté comme obligatoire, pas optionnel (`LOT_0_TEST_STRATEGY.md:409-411`, `:586-588`).
- `npm run test:firestore` reste encapsulé dans `firebase emulators:exec --only firestore --project demo-akayis-test` (`LOT_0_TEST_STRATEGY.md:399-400`).

### Anomalie bloquante restante

**Aucune anomalie bloquante restante sur BLOC-01.**

### Verdict final

**VALIDÉ POUR DÉMARRER LE LOT 0**
