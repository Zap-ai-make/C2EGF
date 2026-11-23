# Transferts d'argent (Western Union, Ria, MoneyGram, autres) — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une boutique qui fait aussi Western Union, Ria, MoneyGram ou un autre service coche une option dans Profil → Configuration ; un onglet de saisie dédié apparaît, et ses soldes suivent la caisse réelle jusqu'à l'envoi au siège ou l'encaissement.

**Architecture:** une famille d'opérations à part, calquée sur le remboursement au siège : quatre actions propres dans `storeTransactionCommand` (impacts une réserve à la fois, le + d'abord), une option `transfertsArgent` sur `stores/{storeId}` écrite par une action serveur, un type de file d'envoi unique qui porte la commande telle quelle, et des lecteurs qui ignorent ou étiquettent la ligne. Le moteur des dépôts et retraits n'est pas touché.

**Tech Stack:** React 19 + Vite + Tailwind v4, Firebase Cloud Functions Node 22 (Firestore Admin), Vitest (+ émulateur Firestore `demo-akayis-test`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-23-transferts-argent-design.md` — l'exécutant lit la spec ET ce plan.

## Global Constraints

- Type unique des lignes : `'Transfert argent'` — jamais affiché tel quel ; libellé affiché `${service} · Transfert` ou `${service} · Retrait` (`servicePrecise` remplace « Autres » quand il est rempli).
- Services : `['Western Union', 'Ria', 'MoneyGram', 'Autres']` ; opérations : `['transfert', 'retrait']` ; réserves : `['stock', 'liquidite']` (libellés « Stock » / « Espèce »).
- Bornes : `nomClient` obligatoire ≤ 60 car. ; `servicePrecise` ≤ 40 ; `telephone` chiffres seulement ≤ 15 (espaces retirés) ; `codeTransfert` ≤ 30 ; montant entier FCFA > 0 ; tranches gardées ≤ 50.
- **Jamais** de champ `client`, `clientId` ou `code` sur une ligne de transfert.
- Pas de « Valider » : toute saisie est `Non Terminées`. « Envoyer au siège » (transfert) et « Encaisser » (retrait) passent **toujours par le stock**.
- Pas de frais ni de commission dans le logiciel.
- Réseau : `STORE_NETWORKS[0]` (serveur) / `NETWORK_OPTIONS[0]` (front) ; « Espèce » = liquidité de ce réseau.
- Drapeau de profil `moneyTransfer.enabled` : `false` dans `_pilot.js`, `true` dans `c2egf-burkina.js` ; constante générée `MONEY_TRANSFER_ENABLED`.
- Messages caissière courts (voir chaque tâche) ; aucune attente du réseau, sauf la case de Configuration.
- Toute commande d'émulateur force `demo-akayis-test` (`npm run test:functions`). Jamais de déploiement, jamais de `git push` (AGENTS.md).
- Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Double clic sur « Non Terminées » ou sur « Confirmer » d'une tranche** → une seule opération (verrou synchrone `useRef`, comme `TransactionForm` et `EnvoiSiegeMenu`). Test : Task 11 `[TC-412-07]`, Task 12 `[TC-413-05]`.
- **Ligne de transfert ouverte dans « Modifier » d'une PWA ancienne** (`updateDraft`, `trashDraft`…) → refus métier définitif, soldes intacts. Test : Task 5 `[TC-406-*]`.
- **Boutique qui décoche l'option avec des lignes en attente** → elles se ferment toujours (tranche, annulation, modification). Test : Task 4 `[TC-405-14]`.
- **Saisie entièrement hors ligne puis tranche hors ligne sur la même ligne** → soldes provisoires justes, une seule application au retour. Test : Task 8 `[TC-409-04]`.
- **Nom avec espaces multiples / téléphone « 70 12 34 56 »** → nom compacté, téléphone sans espaces, refus si lettres. Test : Task 7 `[TC-408-03]`, Task 4 `[TC-405-02]`.

---

## Carte des fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `src/pages/Profil.jsx` | retrait des 3 blocs, carte Configuration | 1, 10 |
| `src/hooks/useUserActivity.js` | supprimé | 1 |
| `src/components/profil/NumerosBoutique.jsx` | prop `sansCadre` | 1 |
| `config/clients/_pilot.js`, `config/clients/c2egf-burkina.js` | drapeau `moneyTransfer` | 2 |
| `scripts/lib/generateStoreProfile.mjs`, `functions/src/config/storeProfile.js` (généré) | `MONEY_TRANSFER_ENABLED` | 2 |
| `functions/src/storeTransactions/transfertArgent.js` (nouveau) | constantes + impacts purs serveur | 2 |
| `functions/src/storeTransactions/storeTransactionCommand.js` | `updateStoreSettings`, 4 actions, gardes | 3, 4, 5 |
| `functions/src/settlements/addTransactionPayment.js`, `addTransactionRefund.js` | gardes | 5 |
| `functions/src/dealerMetrics/listOutstandingDrafts.js`, `functions/src/oxygen/pointEntreeOxygen.js`, `functions/src/clients/historiqueClient.js` | ignorer la ligne | 6 |
| `src/utils/transfertArgent.js` (nouveau) | constantes + fonctions pures front | 7 |
| `src/services/fileEnvoi.js`, `src/services/envois.js`, `src/utils/envoisEnAttente.js`, `src/components/EnvoisListe.jsx` | file d'envoi | 8 |
| `src/context/transactions.jsx`, `src/utils/helpers.js` | gestes, boutons, export | 9, 13 |
| `src/context/AuthContext.jsx`, `src/services/reglagesBoutiqueService.js` (nouveau), `src/components/profil/CaseTransfertsArgent.jsx` (nouveau) | l'option | 10 |
| `src/components/transactions/TransfertArgentForm.jsx` (nouveau), `src/pages/Transactions.jsx` | onglets + formulaire | 11 |
| `src/components/transactions/TransactionTable.jsx`, `src/components/transactions/TrancheTransfertMenu.jsx` (nouveau), `src/components/historique/HistoriqueTable.jsx`, `src/index.css` | lignes et menus | 12 |
| `src/utils/caisse.js`, `src/services/chiffreAffairesService.js`, `src/utils/reseauStats.js`, `src/utils/argentDehors.js`, `src/lib/ia/outils.js`, `src/lib/ia/preparations.js`, `src/content/aideFiches.js` | lecteurs | 13 |

Numéros de TC : 402 à 414 (le dernier existant est 401).

---

### Task 1 : Profil — retrait des trois blocs, carte Configuration

**Files:**
- Modify: `src/pages/Profil.jsx` (lignes 9, 29-30, 35, 124-144, 166-231)
- Modify: `src/components/profil/NumerosBoutique.jsx`
- Delete: `src/hooks/useUserActivity.js`
- Modify: `tests/components/tc-400-numeros-boutique-profil.test.jsx:36`, `tests/components/tc-355-envois-a-l-ecran.test.jsx:39`, `tests/unit/tc-346-demarrage-hors-ligne.test.jsx:57` (retirer le `vi.mock` de `useUserActivity`)
- Test: `tests/components/tc-402-profil-configuration.test.jsx`

**Interfaces:**
- Produces: `NumerosBoutique({ storeId, sansCadre = false })` — avec `sansCadre`, rendu dans une `<section>` avec un `<h3>` « Numéros de la boutique », sans la carte blanche. Dans `Profil.jsx`, une carte `<h2>Configuration</h2>` (visible si `role === STORE_ADMIN && activeStore?.id`) qui contient `<NumerosBoutique storeId sansCadre />` ; la Task 10 y ajoutera `<CaseTransfertsArgent />`.

- [ ] **Step 1 : écrire le test qui échoue** — `tc-402-profil-configuration.test.jsx`, mêmes mocks que TC-400 (sans `useUserActivity`) :

```js
it('[TC-402-01] ni ID utilisateur, ni Statut du compte, ni Activité', async () => {
  render(<MemoryRouter><Profil /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Configuration' })
  expect(screen.queryByText('ID Utilisateur')).toBeNull()
  expect(screen.queryByText('Statut du compte')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Activité' })).toBeNull()
  expect(screen.getByText('Date de création')).toBeInTheDocument()
})
it('[TC-402-02] les numéros vivent dans la carte Configuration', async () => {
  render(<MemoryRouter><Profil /></MemoryRouter>)
  const carte = (await screen.findByRole('heading', { name: 'Configuration' })).closest('div')
  expect(within(carte).getByRole('heading', { name: 'Numéros de la boutique', level: 3 })).toBeInTheDocument()
})
it('[TC-402-03] system_manager : pas de carte Configuration', …)
```

- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/components/tc-402-profil-configuration.test.jsx` — attendu : FAIL (« Configuration » introuvable).
- [ ] **Step 3 : implémenter** — retirer `userId`, `isEmailVerified`, les deux blocs (ID, Statut), toute la carte « Activité » et l'import/appel de `useUserActivity` ; ajouter la carte Configuration ; prop `sansCadre` dans `NumerosBoutique`. TC-400-05 cherche le titre par son nom : il reste vert au niveau 3.
- [ ] **Step 4 : vérifier la suppression du hook** (règle AGENTS.md) : `grep -rn "useUserActivity" src scripts tests vite.config.js` ne renvoie que les trois `vi.mock` à retirer ; aucun `import(` dynamique ; puis supprimer le fichier et les trois `vi.mock`.
- [ ] **Step 5 : lancer** `npm run test:components && npm run test:unit` — attendu : PASS (TC-400, TC-402, TC-355, TC-346 compris).
- [ ] **Step 6 : commit** `feat(profil): carte Configuration, retrait de l'ID, du statut et de l'activité`.

---

### Task 2 : Drapeau de profil et impacts purs côté serveur

**Files:**
- Modify: `config/clients/_pilot.js` (après `siegeRepayment`, l. ~85), `config/clients/c2egf-burkina.js` (après `siegeRepayment`, l. ~82)
- Modify: `scripts/lib/generateStoreProfile.mjs` (validation l. ~86, sortie l. ~141) puis régénérer `functions/src/config/storeProfile.js` (`node scripts/generate-functions-config.mjs --client c2egf_burkina`) ; documenter la constante dans l'en-tête comme `SIEGE_REPAYMENT_ENABLED`
- Create: `functions/src/storeTransactions/transfertArgent.js`
- Test: `tests/unit/tc-403-transfert-argent-impacts-serveur.test.js`

**Interfaces:**
- Produces (`functions/src/storeTransactions/transfertArgent.js`, pur, sur le modèle de `rembSiege.js`) :
  - `TYPE_TRANSFERT_ARGENT = 'Transfert argent'`, `SERVICES_TRANSFERT`, `OPERATIONS_TRANSFERT`, `TRANCHES_MAX = 50`
  - `MESSAGE_GESTE_TRANSFERT = 'Une ligne de transfert se traite par ses propres boutons.'`
  - `estTransfertArgent(doc) -> boolean`
  - `impactSaisieTransfert(balances, network, { operation, balanceType, montant }) -> balances`
  - `impactTrancheTransfert(balances, network, { operation }, montant) -> balances`
  - `impactModificationTransfert(balances, network, avant, apres) -> balances` (même `operation`)
  - `impactAnnulationTransfert(balances, network, { operation, balanceType, montant, montantTraite }) -> balances`
  - Chaque jambe est `applyReplenishmentImpact` (+) ou `applyReplenishmentReturnImpact` (−) de `../settlements/financialUtils.js` ; **le + d'abord**.
- Produces : `MONEY_TRANSFER_ENABLED` dans `functions/src/config/storeProfile.js` ; `moneyTransfer: Object.freeze({ enabled })` dans les profils, avec le commentaire d'axe dans `_pilot.js`.

- [ ] **Step 1 : test qui échoue** — soldes de départ `{ Orange: { stock: 300_000, liquidite: 200_000 } }` :

```js
it('[TC-403-01] transfert reçu en Espèce : +50 000 espèce', () =>
  expect(impactSaisieTransfert(B, 'Orange', { operation: 'transfert', balanceType: 'liquidite', montant: 50_000 }).Orange).toEqual({ stock: 300_000, liquidite: 250_000 }))
it('[TC-403-02] retrait payé en Stock : −75 000 stock', …)            // { stock: 225_000, liquidite: 200_000 }
it('[TC-403-03] retrait payé en Espèce au-delà du disponible : lève', () =>
  expect(() => impactSaisieTransfert(B, 'Orange', { operation: 'retrait', balanceType: 'liquidite', montant: 250_000 })).toThrow())
it('[TC-403-04] tranche d’un transfert : −stock ; d’un retrait : +stock', …)
it('[TC-403-05] annulation d’un transfert reçu en Stock, 20 000 envoyés : passe à stock nul (le + d’abord)', () => {
  const vide = { Orange: { stock: 30_000, liquidite: 0 } }
  expect(impactAnnulationTransfert(vide, 'Orange', { operation: 'transfert', balanceType: 'stock', montant: 50_000, montantTraite: 20_000 }).Orange.stock).toBe(0)
})
it('[TC-403-06] annulation d’un retrait payé en Espèce, 75 000 encaissés : +75 000 espèce puis −75 000 stock', …)
it('[TC-403-07] modification d’un retrait 75 000 Stock → 60 000 Espèce', …) // stock +75 000, espèce −60 000
it('[TC-403-08] le générateur refuse moneyTransfer.enabled non booléen et écrit MONEY_TRANSFER_ENABLED', …)
```

- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/unit/tc-403-transfert-argent-impacts-serveur.test.js` — FAIL (module absent).
- [ ] **Step 3 : implémenter** le module, le drapeau et le générateur (« absent vaut éteint », message `Profil invalide : moneyTransfer.enabled doit être un booléen.`).
- [ ] **Step 4 : lancer** le test, puis `npm run check:generated` — PASS.
- [ ] **Step 5 : commit** `feat(functions): drapeau moneyTransfer et impacts purs des transferts d'argent`.

---

### Task 3 : Action serveur `updateStoreSettings`

**Files:**
- Modify: `functions/src/storeTransactions/storeTransactionCommand.js` (liste blanche du payload l. 379 : ajouter `'transfertsArgent'` ; nouveau bloc juste après `updateStoreNumbers`, l. ~462, donc **avant** la lecture des soldes)
- Test: `tests/functions/tc-404-reglages-boutique.test.js` (gabarit : `tc-384-remb-siege-drapeau.test.js`)

**Interfaces:**
- Produces : action `updateStoreSettings` `{ transfertsArgent: boolean }` → `{ transfertsArgent: boolean }` (+ `inchange: true` si rien ne change). Écrit `stores/{storeId}.transfertsArgent` et `reglagesModifiesLe: serverTimestamp()`, journal `auditLogs` `{ action, uid, avant: { transfertsArgent }, apres: { transfertsArgent }, createdAt }`.
- Refus : rôle ≠ `store_admin` → `ROLE_FORBIDDEN` « Seul le compte boutique modifie ses réglages. » ; non booléen → `STORE_TRANSACTION_INVALID` « Réglage invalide. » ; drapeau éteint → `STORE_TRANSACTION_INVALID` « Les transferts d’argent sont désactivés. » (contrôle avant `runTransaction`, comme `ACTIONS_REMB_SIEGE`).

- [ ] **Step 1 : tests qui échouent** — deux boutiques (`boutique-a`, `boutique-b`) :
  - `[TC-404-01]` coche puis décoche : la fiche de A porte `true` puis `false`, B n'a pas le champ, deux journaux.
  - `[TC-404-02]` même valeur : `inchange: true`, aucun journal.
  - `[TC-404-03]` `'oui'` refusé ; `[TC-404-04]` un `dealer` refusé `ROLE_FORBIDDEN` ; `[TC-404-05]` boutique sans soldes : accepté.
  - Fichier à part `tc-404-reglages-boutique-drapeau.test.js` : `[TC-404-06]` drapeau éteint (`vi.mock` de `storeProfile.js`, `MONEY_TRANSFER_ENABLED: false`) → refus « désactivés ».
- [ ] **Step 2 : lancer** `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-404"` — FAIL (« Commande inconnue »).
- [ ] **Step 3 : implémenter** le bloc.
- [ ] **Step 4 : relancer** — PASS.
- [ ] **Step 5 : commit** `feat(functions): updateStoreSettings, l'option transferts d'argent de la boutique`.

---

### Task 4 : Les quatre actions du transfert d'argent

**Files:**
- Modify: `functions/src/storeTransactions/storeTransactionCommand.js` — `ACTIONS_TRANSFERT_ARGENT` à côté de `ACTIONS_REMB_SIEGE` (l. 237) ; `cleanTransfertArgent(input)` à côté de `cleanRembSiege` ; contrôle du drapeau à côté de celui du remboursement (l. 393) ; les quatre blocs après `trashSiegeRepayment` (l. ~1121)
- Test: `tests/functions/tc-405-transfert-argent-commandes.test.js`, `tests/functions/tc-405-transfert-argent-drapeau.test.js`

**Interfaces:**
- Consumes : Task 2 (impacts, constantes), Task 3 (champ `transfertsArgent` de la fiche).
- Produces (charges exactes que le front enverra) :
  - `addMoneyTransfer` `{ transaction: { service, servicePrecise?, operation, nomClient, telephone?, codeTransfert?, montant, balanceType } }` → `{ id }`. Refusé si `store.transfertsArgent !== true` : « Transferts d’argent non activés pour cette boutique. ». Crée toujours dans `drafts` : `type`, `reseau` posés par le serveur, `statut: 'Non Terminées'`, `montantTraite: 0`, `resteATraiter: montant`, `tranches: []`, + `storeId`, `storeName`, `operator*`, datation, `updatedAt` (comme `addSiegeRepayment`).
  - `settleMoneyTransfer` `{ draftId, amount }` → `{ settled: true, resteATraiter, historyId? }`. Calque **exact** de `sendToSiege` (idempotence par `tranches[].id === commandeId`, passage à `history/{draftId}` à reste nul, `IDEMPOTENCY_CONFLICT`). Refus `amount > reste` : « Montant supérieur au reste. Reste : X FCFA ».
  - `updateMoneyTransfer` `{ draftId, updates }` → `{ id }`. Champs retenus : `service, servicePrecise, nomClient, telephone, codeTransfert, montant, balanceType`. Refus `montantTraite > 0` → `SETTLED_DRAFT_IMMUTABLE` « Une opération déjà traitée en partie ne se modifie plus. ». Idempotence par `derniereCommande`. Journal `modifications` si le montant change.
  - `trashMoneyTransfer` `{ draftId }` ou `{ historyId }` → `{ trashed: true, historyId }`. Calque de `trashSiegeRepayment`.
  - Chaque action refuse une ligne qui n'est pas `estTransfertArgent` : « Cette ligne n’est pas un transfert d’argent. ».
  - `cleanTransfertArgent` : objet ≤ 20 000 car. JSON ; `service ∈ SERVICES_TRANSFERT` (« Service : Western Union, Ria, MoneyGram ou Autres. ») ; `operation ∈ OPERATIONS_TRANSFERT` ; `balanceType ∈ stock|liquidite` ; `nomClient` compacté (`/\s+/g → ' '`, trim), 1-60 (« Nom du client obligatoire (60 caractères au plus). ») ; `servicePrecise` gardé seulement si `service === 'Autres'`, ≤ 40 ; `telephone` espaces retirés, `/^\d{0,15}$/` (« Téléphone : chiffres seulement. ») ; `codeTransfert` trim ≤ 30 ; `montant` par `cleanAmount`. Ne renvoie **jamais** `client`, `clientId`, `code`.

- [ ] **Step 1 : tests qui échouent** — boutique A avec option, boutique B sans, soldes `{ stock: 300_000, liquidite: 200_000 }`, chaque test vérifie soldes et documents :
  - `[TC-405-01]` T1 : transfert WU 50 000 Espèce → espèce 250 000, brouillon complet, ni `client`/`clientId`/`code`.
  - `[TC-405-02]` nom `'  DIALLO   Awa '` → `'DIALLO Awa'` ; téléphone `'70 12 34 56'` → `'70123456'` ; `'70AB'` refusé.
  - `[TC-405-03]` `servicePrecise` ignoré hors « Autres ».
  - `[TC-405-04]` R3 : retrait 250 000 Espèce refusé, soldes intacts.
  - `[TC-405-05]` T2 : transfert Ria 50 000 Stock, tranches 20 000 puis 30 000 → la ligne passe à `history`, `statut: 'Validée'`, stock 300 000.
  - `[TC-405-06]` R1 : retrait MoneyGram 75 000 Espèce, encaisser 75 000 → espèce 125 000, stock 375 000, ligne validée.
  - `[TC-405-07]` tranche > reste refusée ; tranche de transfert > stock refusée.
  - `[TC-405-08]` modification avant tranche (montant + réserve) → soldes recalculés, journal ; après tranche → `SETTLED_DRAFT_IMMUTABLE` ; `operation` dans `updates` ignorée.
  - `[TC-405-09]` A1 : T2 annulé après 20 000 envoyés → stock 280 000 → la ligne finit `Supprimée` dans `history`.
  - `[TC-405-10]` A2 : R1 annulé avant encaissement → espèce 200 000.
  - `[TC-405-11]` annulation d'une ligne validée (`historyId`) ; deuxième annulation refusée sans `commandeId`, idempotente avec.
  - `[TC-405-12]` idempotence des quatre actions avec le même `commandeId` (soldes appliqués une seule fois), y compris la tranche rejouée après passage à l'historique.
  - `[TC-405-13]` O2 : boutique B, `addMoneyTransfer` refusé.
  - `[TC-405-14]` O1 : boutique A décochée après saisie → tranche, modification et annulation passent.
  - `[TC-405-15]` les actions du transfert refusent un brouillon « Remb. siège » et `sendToSiege` refuse une ligne de transfert.
  - Fichier drapeau : `[TC-405-16]` drapeau éteint → les quatre actions refusent « désactivés ».
- [ ] **Step 2 : lancer** `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-405"` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-405, puis TC-384 et TC-381 (non-régression du remboursement) — PASS.
- [ ] **Step 5 : commit** `feat(functions): les quatre commandes du transfert d'argent`.

---

### Task 5 : Gardes des commandes génériques

**Files:**
- Modify: `functions/src/storeTransactions/storeTransactionCommand.js` — `UNCANCELLABLE_TYPES` (l. 74) reçoit `TYPE_TRANSFERT_ARGENT` (couvre `cancelHistory`, `trashHistory`, `reopenHistory`, `correctHistory`) ; `refuserSiTransfertArgent(doc)` (même code, `MESSAGE_GESTE_TRANSFERT`) appelée juste après chaque `refuserSiRembSiege` (l. 553, 588, 614, 694)
- Modify: `functions/src/settlements/addTransactionPayment.js:161`, `addTransactionRefund.js:147` — même refus pour `estTransfertArgent(draft)`
- Test: `tests/functions/tc-406-transfert-argent-gestes-generiques.test.js` (gabarit : `tc-381-remb-siege-gestes-generiques.test.js`)

**Interfaces:**
- Consumes : `estTransfertArgent`, `MESSAGE_GESTE_TRANSFERT`, `TYPE_TRANSFERT_ARGENT` (Task 2).

- [ ] **Step 1 : tests qui échouent** — un brouillon et une ligne d'historique de transfert ; pour chacun, `STORE_TRANSACTION_INVALID` et soldes intacts :
  `[TC-406-C1]` `add` avec `type: 'Transfert argent'` refusé (type hors profil — passe déjà, verrouille) ; `[TC-406-G2]` `updateDraft` (message de la garde) ; `[G3]` `deleteDraft` ; `[G4]` `trashDraft` ; `[G5]` `validateDraft` (la ligne reste dans `drafts`) ; `[G6]` `addTransactionPayment` ; `[G7]` `trashHistory` ; `[G8]` `cancelHistory` ; `[G9]` `addTransactionRefund` ; `[G10]` `reopenHistory` ; `[G11]` `correctHistory`.
- [ ] **Step 2 : lancer** `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-406"` — FAIL sur G2-G11 (aujourd'hui la ligne passe ou lève une erreur nue).
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-406 et TC-381 — PASS.
- [ ] **Step 5 : commit** `feat(functions): les commandes génériques refusent une ligne de transfert`.

---

### Task 6 : Lecteurs serveur

**Files:**
- Modify: `functions/src/dealerMetrics/listOutstandingDrafts.js:60`, `functions/src/oxygen/pointEntreeOxygen.js:439`, `functions/src/clients/historiqueClient.js:154`
- Test: `tests/unit/tc-407-transfert-argent-lecteurs-serveur.test.js`

**Interfaces:**
- Consumes : `estTransfertArgent` (Task 2).

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-407-01]` l'agrégat des brouillons du dealer ignore un brouillon de transfert et ne le compte pas parmi les illisibles (gabarit TC-213).
  - `[TC-407-02]` le point d'entrée Oxygen renvoie `null` pour une ligne de transfert.
  - `[TC-407-03]` `historiqueClient` : une ligne de transfert (sans `clientId` ni `code`) n'apparaît dans l'historique d'aucun agent ; si elle passait par `ligneDeDocument`, `reste: 0` (gabarit TC-255).
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/unit/tc-407-transfert-argent-lecteurs-serveur.test.js` — FAIL sur 01-02.
- [ ] **Step 3 : implémenter** (`continue` / `return null` / `reste: 0` à côté du cas `estRembSiege`).
- [ ] **Step 4 : relancer** — PASS, ainsi que TC-213, TC-255, TC-377.
- [ ] **Step 5 : commit** `feat(functions): Oxygen, dealer et historique d'agent ignorent les transferts d'argent`.

---

### Task 7 : Fonctions pures côté navigateur

**Files:**
- Create: `src/utils/transfertArgent.js`
- Test: `tests/unit/tc-408-transfert-argent-preparation.test.js`

**Interfaces:**
- Produces :
  - `TYPE_TRANSFERT_ARGENT`, `SERVICES_TRANSFERT`, `OPERATIONS_TRANSFERT` (recopiés : `functions/` ne s'importe pas)
  - `TRANSFERT_ARGENT_ACTIF = activeProfile.moneyTransfer?.enabled === true`
  - `estTransfertArgent(ligne) -> boolean`
  - `libelleTransfert(ligne) -> string` — `'Western Union · Transfert'`, `'Wari · Retrait'` (Autres + `servicePrecise: 'Wari'`), `'Autres · Retrait'`
  - `evaluerTransfertArgent({ service, servicePrecise, operation, nomClient, telephone, codeTransfert, montant, balanceType, stock, liquidite }) -> { ok: boolean, raison: string }` — première raison dans cet ordre : « Choisissez le service. », « Choisissez Transfert ou Retrait. », « Nom du client obligatoire. », « Téléphone : chiffres seulement. », « Montant invalide (entier supérieur à 0). », « Choisissez Stock ou Espèce. », puis pour un retrait « Stock insuffisant. » / « Espèce insuffisante. »
  - `preparerTransfertArgent(champs) -> { ok: true, transaction, details } | { ok: false, raison }` — `transaction` = charge exacte de `addMoneyTransfer` (Task 4), nom compacté, téléphone sans espaces, `servicePrecise` seulement avec « Autres », montant en nombre ; `details` = `{ service: libelle du service, operation: 'Transfert'|'Retrait', clientName, amount (formaté fr-FR), reserve: 'Reçu en Stock'|'Payé en Espèce'… }`
  - `montantTranchePropose({ ligne, stock }) -> number` — transfert : `montantRetourPropose({ reste, disponible: stock })` (`ravitaillement.js`) ; retrait : le reste
  - `verifierTrancheTransfert({ ligne, montant, stock }) -> { ok: true, valeur } | { ok: false, motif: 'montant'|'reste'|'stock', raison }` — plafond stock seulement pour un transfert ; raisons comme `verifierEnvoiSiege`
  - `consequenceAnnulationTransfert(ligne) -> string` — transfert : « Les 50 000 FCFA reçus sortiront de l’espèce ; les 20 000 FCFA déjà envoyés au siège reviendront au stock. » ; retrait : « Les 75 000 FCFA payés reviendront à l’espèce ; les 75 000 FCFA déjà encaissés sortiront du stock. » (seconde proposition omise si rien n'est traité)
  - `resumeTransfert(ligne) -> { operation, montant, balanceType, montantTraite }`
  - `effetTransfertSurLesSoldes(soldes, reseau, commande, avant) -> soldes | null` — mêmes jambes, même ordre que Task 2, sur le modèle d'`effetRembSiegeSurLesSoldes` (`adjustBalanceValue`)

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-408-01]` chaque raison d'`evaluerTransfertArgent`, dans l'ordre.
  - `[TC-408-02]` retrait 250 000 Espèce avec liquidité 200 000 → « Espèce insuffisante. » ; transfert du même montant → ok.
  - `[TC-408-03]` `preparerTransfertArgent` : nom compacté, `'70 12 34 56'` → `'70123456'`, `servicePrecise` retiré hors « Autres », aucune clé `client`/`clientId`/`code`.
  - `[TC-408-04]` `libelleTransfert` (trois cas ci-dessus).
  - `[TC-408-05]` `montantTranchePropose` et `verifierTrancheTransfert` (transfert plafonné au stock, retrait non).
  - `[TC-408-06]` `effetTransfertSurLesSoldes` pour les quatre actions, égal aux soldes de TC-403.
  - `[TC-408-07]` `consequenceAnnulationTransfert` (les deux phrases, avec et sans tranches).
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/unit/tc-408-transfert-argent-preparation.test.js` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — PASS.
- [ ] **Step 5 : commit** `feat: fonctions pures du transfert d'argent côté navigateur`.

---

### Task 8 : File d'envoi

**Files:**
- Modify: `src/services/fileEnvoi.js` (après `REMB_SIEGE`, l. 46), `src/services/envois.js:52`, `src/utils/envoisEnAttente.js` (projections l. ~295-376, soldes l. ~457), `src/components/EnvoisListe.jsx`
- Test: `tests/unit/tc-409-transfert-argent-file.test.js` (gabarit : `tc-386-remb-siege-file.test.js`)

**Interfaces:**
- Consumes : Task 7 (`effetTransfertSurLesSoldes`, `TYPE_TRANSFERT_ARGENT`, `libelleTransfert`).
- Produces : `TRANSFERT_ARGENT = 'transfert_argent'` ; charge `{ commande, reseau, avant? }` envoyée telle quelle (`runStoreTransactionCommand({ ...charge.commande, ...reconnue })`) ; `EFFETS_TRANSFERT_ARGENT` projette `addMoneyTransfer` (nouvelle non terminée marquée), `settleMoneyTransfer` (tranche `{ id: op.id, montant }`, passage à l'historique à reste nul), `updateMoneyTransfer` (champs de Task 4), `trashMoneyTransfer` ; `TRANSFERT_ARGENT` ajouté à `VISIBLES_REFUSEES`. `EnvoisListe` : « Western Union · Transfert de 50 000 FCFA — DIALLO Awa », « Envoi au siège de 20 000 FCFA », « Encaissement de 75 000 FCFA », « Modification », « Annulation ».

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-409-01]` `executerEnvoi` d'une opération `TRANSFERT_ARGENT` appelle le serveur avec la commande + `commandeId` + `ageMs`.
  - `[TC-409-02]` saisie en file → ligne visible dans les non terminées, soldes provisoires = TC-403-01.
  - `[TC-409-03]` tranche en file sur une ligne serveur → `montantTraite`/`resteATraiter` projetés.
  - `[TC-409-04]` saisie **et** tranche hors ligne sur la même ligne → soldes provisoires justes ; au retour, la projection disparaît quand les deux sont envoyées (pas de double application).
  - `[TC-409-05]` annulation en file → la ligne disparaît des non terminées, soldes rendus.
  - `[TC-409-06]` libellés d'`EnvoisListe`.
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/unit/tc-409-transfert-argent-file.test.js` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-409 et TC-386 — PASS.
- [ ] **Step 5 : commit** `feat(file): les transferts d'argent partent par la file d'envoi`.

---

### Task 9 : Contexte des transactions et boutons d'une ligne

**Files:**
- Modify: `src/context/transactions.jsx` (à côté de `envoyerRembSiege`, l. 520-560 ; annulation refusée l. ~656 ; `trashTransaction` l. ~686 ; `getActionButtons` l. 793-813 ; `value` l. ~834)
- Modify: `src/utils/helpers.js:190-225` (`getAvailableActions`)
- Test: `tests/components/tc-410-transfert-argent-contexte.test.jsx` (gabarit : `tc-386-remb-siege-contexte.test.jsx`)

**Interfaces:**
- Consumes : Task 7 (`estTransfertArgent`, `resumeTransfert`), Task 8 (`TRANSFERT_ARGENT`).
- Produces (dans `useTransactions()`) :
  - `ajouterTransfertArgent(transaction) -> Promise<{ statut }>` → `addMoneyTransfer`
  - `traiterTransfertArgent(draftId, montant) -> Promise<{ statut }>` → `settleMoneyTransfer`
  - `modifierTransfertArgent(draftId, updates) -> Promise<{ statut }>` → `updateMoneyTransfer` avec `avant: resumeTransfert(ligne)`
  - `trashTransaction` route une ligne de transfert vers `trashMoneyTransfer` (`id: transfert_argent-annulation-${id}`), comme `estRembSiege`
  - `getAvailableActions(transactionType, operation)` : nouvelle clé par défaut `trancheTransfert: false` ; cas `'Transfert argent'` → `trancheTransfert: true` (ni encaisser, ni payerPar, ni rembourser, ni envoyerSiege). `reglement.js` continue d'appeler `getAvailableActions(type)`.
  - `getActionButtons(transaction)` passe `transaction.operation` ; transfert avec `montantTraite > 0` → `modifier: false`, `annuler` reste.

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-410-01]` les trois fonctions soumettent `TRANSFERT_ARGENT` avec la bonne commande (et partent en direct sans file).
  - `[TC-410-02]` annuler une ligne de transfert (brouillon puis validée) envoie `trashMoneyTransfer` avec `draftId` / `historyId`.
  - `[TC-410-03]` `getActionButtons` : `{ modifier: true, trancheTransfert: true, encaisser: false, payerPar: false }` ; après tranche, `modifier: false`.
  - `[TC-410-04]` `getAvailableActions('Dépôt')`, `('Retrait')`, `('Remb. siège')` inchangés (plus `trancheTransfert: false`).
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/components/tc-410-transfert-argent-contexte.test.jsx` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-410, TC-386, TC-103 — PASS.
- [ ] **Step 5 : commit** `feat: gestes du transfert d'argent dans le contexte des transactions`.

---

### Task 10 : La case de Configuration

**Files:**
- Modify: `src/context/AuthContext.jsx` (`fetchStoreProfile` l. 48-52 ; nouvelle fonction exposée dans `value`)
- Create: `src/services/reglagesBoutiqueService.js`
- Create: `src/components/profil/CaseTransfertsArgent.jsx`
- Modify: `src/pages/Profil.jsx` (carte Configuration de la Task 1)
- Test: `tests/components/tc-411-case-transferts-argent.test.jsx`

**Interfaces:**
- Consumes : Task 1 (carte), Task 3 (`updateStoreSettings`), Task 7 (`TRANSFERT_ARGENT_ACTIF`).
- Produces :
  - `activeStore.transfertsArgent: boolean` (`storeData.transfertsArgent === true`)
  - `useAuth().mettreAJourBoutique(champs: object) -> void` — fusionne dans l'état `activeStore` seulement (n'appelle **pas** `firestoreService.setActiveStore`, qui couperait les abonnements)
  - `enregistrerTransfertsArgent(actif: boolean) -> Promise<{ transfertsArgent: boolean }>` — `runStoreTransactionCommand({ action: 'updateStoreSettings', transfertsArgent: actif })`, **jamais par la file**
  - `<CaseTransfertsArgent />` — rendue seulement si `TRANSFERT_ARGENT_ACTIF` ; case native libellée « Western Union, Ria, MoneyGram et autres », aide « Ajoute un onglet dans « Enregistrer une transaction ». » ; au clic : hors ligne → « Connexion nécessaire. » sans appel ; sinon case désactivée pendant l'appel, puis « Enregistré. » et `mettreAJourBoutique({ transfertsArgent })` ; refus → message du serveur, case revenue à l'état d'avant.

- [ ] **Step 1 : tests qui échouent** (mocks : service, `useEnLigne`, `useAuth`, `transfertArgent.js` avec `TRANSFERT_ARGENT_ACTIF` pilotable) :
  - `[TC-411-01]` cochée si `activeStore.transfertsArgent` ; clic → service appelé avec `false`, « Enregistré. », `mettreAJourBoutique({ transfertsArgent: false })`.
  - `[TC-411-02]` hors ligne → « Connexion nécessaire. », service non appelé, case inchangée.
  - `[TC-411-03]` refus du serveur → message affiché, case revenue.
  - `[TC-411-04]` drapeau de profil éteint → rien n'est rendu.
  - `[TC-411-05]` `resolveAuthenticatedProfile` renvoie `transfertsArgent: true` quand la fiche le porte, `false` sinon.
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/components/tc-411-case-transferts-argent.test.jsx` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-411, TC-402, TC-400 — PASS.
- [ ] **Step 5 : commit** `feat(profil): la case transferts d'argent dans Configuration`.

---

### Task 11 : Les onglets et le formulaire de transfert

**Files:**
- Create: `src/components/transactions/TransfertArgentForm.jsx`
- Modify: `src/pages/Transactions.jsx` (Dialog l. 234-255)
- Test: `tests/components/tc-412-transfert-argent-formulaire.test.jsx`

**Interfaces:**
- Consumes : Task 7 (`evaluerTransfertArgent`, `preparerTransfertArgent`, `estTransfertArgent`, `TRANSFERT_ARGENT_ACTIF`), Task 9 (`ajouterTransfertArgent`, `modifierTransfertArgent`, `editingTransaction`, `clearEditTransaction`), Task 10 (`activeStore.transfertsArgent`) ; `useSimpleNetworkData().getStock(NETWORK_OPTIONS[0])` et `.getNetworkLiquidite(NETWORK_OPTIONS[0])`.
- Produces :
  - `TransfertArgentForm({ onComplete, onCancel, annoncer })` — champs et ordre de la spec (§ « La fenêtre ») : Service (4 radios), « Précisez (facultatif) » seulement avec Autres, Opération (Transfert / Retrait), Nom du client, Téléphone (facultatif), Code (facultatif), Montant, « Reçu en » (transfert) ou « Payé en » (retrait) ; aucun radio coché d'office ; un seul bouton « Non Terminées », grisé avec la raison d'`evaluerTransfertArgent` affichée au-dessus (bandeau `warn` comme `TransactionForm`) ; fenêtre « Confirmer la transaction » (Service, Opération, Client, Montant, Reçu/Payé en) ; verrou synchrone `useRef` sur « Confirmer » ; après saisie : champs vidés, fenêtre ouverte ; en modification : champs remplis depuis la ligne, Opération désactivée, bouton « Sauvegarder », `onComplete()` après succès.
  - Dans `Transactions.jsx` : `ongletsVisibles = TRANSFERT_ARGENT_ACTIF && activeStore?.transfertsArgent === true` (ou ligne de transfert en modification) ; état `onglet: 'agent'|'transfert'` (défaut `'agent'`, conservé entre deux saisies, remis à `'agent'` à la fermeture) ; deux boutons `role="tab"` dans un `role="tablist"` : « Agent » et « Western Union · Ria · MoneyGram » ; en modification, l'onglet de la ligne est imposé et l'autre `disabled`. `<TransactionForm>` n'est monté que sur l'onglet Agent.

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-412-01]` sans option (ou drapeau éteint) : aucun `tablist`, `TransactionForm` monté.
  - `[TC-412-02]` avec option : onglet « Agent » sélectionné par défaut ; clic sur l'autre → champs du transfert, plus de recherche d'agent.
  - `[TC-412-03]` « Précisez » n'apparaît qu'avec Autres ; « Reçu en » devient « Payé en » avec Retrait.
  - `[TC-412-04]` bouton grisé tant qu'il manque un champ, avec la raison (« Choisissez le service. » d'abord) ; pas de bouton « Valider ».
  - `[TC-412-05]` saisie complète → confirmation → `ajouterTransfertArgent` reçoit la charge exacte de la Task 4 ; champs vidés, onglet transfert toujours affiché.
  - `[TC-412-06]` retrait 250 000 Espèce avec liquidité 200 000 → « Espèce insuffisante. », bouton grisé.
  - `[TC-412-07]` deux clics sur « Confirmer » dans le même tick → un seul appel.
  - `[TC-412-08]` modification d'une ligne de transfert : onglet imposé, Opération désactivée, `modifierTransfertArgent(id, updates)` puis `onComplete`.
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/components/tc-412-transfert-argent-formulaire.test.jsx` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-412, TC-387, TC-302 — PASS.
- [ ] **Step 5 : commit** `feat: onglet Western Union · Ria · MoneyGram dans Enregistrer une transaction`.

---

### Task 12 : Les lignes en attente, le menu de tranche, l'historique

**Files:**
- Create: `src/components/transactions/TrancheTransfertMenu.jsx`
- Modify: `src/components/transactions/TransactionTable.jsx` (cellule client l. 757, détail l. 772-780, boutons l. ~830, menus l. ~915, dialogue d'annulation l. ~1128-1140, filtre de recherche)
- Modify: `src/components/historique/HistoriqueTable.jsx` (l. 113, 327, 598), `src/index.css` (jetons après `--color-siege-soft`, l. 71, contraste noté l. 35)
- Test: `tests/components/tc-413-transfert-argent-tableau.test.jsx` (gabarit : `tc-388-remb-siege-tableau.test.jsx`)

**Interfaces:**
- Consumes : Task 7 (`libelleTransfert`, `montantTranchePropose`, `verifierTrancheTransfert`, `consequenceAnnulationTransfert`, `estTransfertArgent`), Task 9 (`trancheTransfert`, `traiterTransfertArgent`, `trashTransaction`).
- Produces :
  - `TrancheTransfertMenu({ ligne, onValider })` — titre « Envoyer au siège » (transfert) ou « Encaisser » (retrait) ; nom du client, « Reste : X FCFA », et pour un transfert « Stock disponible : X FCFA » ; montant pré-rempli par `montantTranchePropose` (suit le stock tant qu'il n'est pas tapé) ; bouton « Confirmer » ; verrou synchrone. Ne modifie pas `EnvoiSiegeMenu`.
  - Ligne de transfert : nom = `nomClient`, nature = `libelleTransfert(ligne)`, « Reçu en Stock » / « Payé en Espèce », « Envoyé : X » ou « Encaissé : X » et « Reste : X » dès qu'une tranche est faite ; bouton `trancheTransfert` libellé selon l'opération ; teinte par jetons `--color-transfert` / `--color-transfert-soft` (à choisir, contraste ≥ 4,5:1 sur blanc, noté dans le commentaire l. 35).
  - Recherche des non terminées : `nomClient`, `telephone` et `codeTransfert` sont cherchables.
  - Dialogue d'annulation : `consequenceAnnulationTransfert(ligne)`.
  - `HistoriqueTable` : libellé `libelleTransfert`, réserve affichée, pas de « Corriger », « Annuler » vers `trashTransaction`.

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-413-01]` une ligne transfert en attente affiche « DIALLO Awa », « Western Union · Transfert », « Reçu en Espèce », et le bouton « Envoyer au siège » ; une ligne retrait affiche « Encaisser » ; ni « Encaisser » (dépôt) ni « Payer par ».
  - `[TC-413-02]` « Envoyer au siège » : menu pré-rempli au stock quand le reste le dépasse ; > stock refusé avec la raison ; « Confirmer » → `traiterTransfertArgent(id, montant)`.
  - `[TC-413-03]` « Encaisser » : pré-rempli au reste, sans plafond de stock.
  - `[TC-413-04]` « Envoyé : 20 000 » et « Reste : 30 000 » après une tranche ; « Modifier » absent.
  - `[TC-413-05]` deux clics « Confirmer » dans le menu → un seul appel.
  - `[TC-413-06]` la recherche par code de transfert retrouve la ligne.
  - `[TC-413-07]` dialogue d'annulation : la phrase de `consequenceAnnulationTransfert`.
  - `[TC-413-08]` historique : libellé, pas de « Corriger ».
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/components/tc-413-transfert-argent-tableau.test.jsx` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-413, TC-388, TC-391, TC-103, TC-260 — PASS.
- [ ] **Step 5 : commit** `feat: lignes de transfert d'argent dans les non terminées et l'historique`.

---

### Task 13 : Lecteurs côté navigateur

**Files:**
- Modify: `src/utils/caisse.js` (`natureEnAttente` l. 26, `sommesEnAttente` l. 56, `totalCaisse` l. 114) et ses appelants (`TransactionTable.jsx` cases l. ~600-650, barre des soldes)
- Modify: `src/services/chiffreAffairesService.js:112`, `src/utils/reseauStats.js` (l. 51, 63), `src/utils/argentDehors.js:92`, `src/utils/helpers.js` (`createExportData` l. 368), `src/lib/ia/outils.js` (l. 167, 380, 441), `src/lib/ia/preparations.js:331`, `src/content/aideFiches.js` (l. ~206)
- Test: `tests/unit/tc-414-transfert-argent-lecteurs.test.js`

**Interfaces:**
- Consumes : Task 7.
- Produces :
  - `natureEnAttente` → `'transfert'` pour une ligne de transfert ; `sommesEnAttente` ajoute `transfertsDus, nbTransfertsDus` (reste des transferts) et `retraitsARecevoir, nbRetraitsARecevoir` (reste des retraits), reste lu par `resteATraiter` sinon `montant − montantTraite`.
  - `totalCaisse({ stock, liquidite, depots, retraits, siege, transfertsDus = 0, retraitsARecevoir = 0 })` = formule actuelle `− transfertsDus + retraitsARecevoir`. Les cases des non terminées montrent ces deux restes sur le modèle de la case « siège ».
  - `TYPES_HORS_CA` reçoit `'Transfert argent'` ; `compteCommeVisite` et `compteCommeVolume` → `false` ; `argentDehors` l'ignore ; export : `'Client': nomClient`, `'Type': libelleTransfert`, `'Code': codeTransfert` ; IA : hors totaux et hors créances comme `estRembSiege` ; une fiche d'aide « Western Union · Ria · MoneyGram » de trois lignes au plus.

- [ ] **Step 1 : tests qui échouent** :
  - `[TC-414-01]` cas C de la spec : T1 en attente puis R1 en attente → `totalCaisse` identique avant, après chaque saisie et après chaque tranche.
  - `[TC-414-02]` `sommesEnAttente` : dépôts et retraits d'agent inchangés en présence de lignes de transfert.
  - `[TC-414-03]` chiffre d'affaires, `reseauStats` (visite et volume), `argentDehors` ignorent la ligne.
  - `[TC-414-04]` `createExportData` : la ligne garde son nom, son libellé, son code.
  - `[TC-414-05]` IA : `totaliser` et la liste des créances ne comptent pas la ligne.
  - `[TC-414-06]` la fiche d'aide existe (gabarit TC-225).
- [ ] **Step 2 : lancer** `npx vitest run --config vitest.config.js tests/unit/tc-414-transfert-argent-lecteurs.test.js` — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** TC-414, TC-224, TC-390, TC-272, TC-105, TC-389, TC-301, TC-314, TC-225 — PASS.
- [ ] **Step 5 : commit** `feat: caisse, chiffre d'affaires, statistiques, export et assistant connaissent les transferts`.

---

### Task 14 : Vérification d'ensemble et bilan

**Files:**
- Modify: `audit/BILAN.md` (nouvelle section : ce qui est livré, ordre de déploiement)
- Modify: `docs/client-profiles.md` (l'axe `moneyTransfer`)

- [ ] **Step 1 :** `npm run quality:check` — attendu : tout vert (génération, secrets, audit, lint, unit, components, build).
- [ ] **Step 2 :** `npm run test:functions` — attendu : tout vert (TC-381, 384, 404, 405, 406 compris).
- [ ] **Step 3 :** lancer l'app sur les émulateurs (`npm run emulateurs` + `npm run dev`), boutique de test : cocher l'option, saisir T1 et R1, une tranche chacun, annuler une ligne ; capturer Profil (Configuration), la fenêtre aux deux onglets, les non terminées, à 390 px et 1440 px (`audit/captures-*.mjs` comme gabarit). Vérifier les soldes à l'écran contre le tableau de la spec.
- [ ] **Step 4 :** relire le diff complet (`git diff main...HEAD --stat`, puis fichier par fichier) : aucun changement du comportement des dépôts, retraits et remboursements au siège.
- [ ] **Step 5 :** écrire la section du bilan et l'axe dans `docs/client-profiles.md` ; rappeler l'ordre de déploiement : **functions d'abord**, puis le front (décision et geste humains, `docs/deployer-les-functions.md`).
- [ ] **Step 6 : commit** `docs: bilan, les transferts d'argent (non déployé)`.
