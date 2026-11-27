# Le remboursement depuis l'app Oxygen — plan d'implémentation (côté CRM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'agent rembourse son crédit (un Dépôt « Non Terminées ») ou un crédit du siège depuis l'app Oxygen ; la caissière accepte ou rejette ; l'historique de l'agent montre les tranches.

**Architecture :** deux actions de plus sur le point d'entrée privé (`rembourser`, `rembourserSiege`) créent une demande `en_attente` de nature `remboursement` ou `remb_siege`. `acceptAgentRequest` se branche sur la nature : un remboursement exécute le cœur d'« Encaisser », extrait d'`addTransactionPayment` dans un module partagé ; un remboursement siège crée la ligne « Remb. siège » Non Terminées. `lireActivite` rend les tranches (`reglements`, écrites sur la ligne à chaque tranche), le mode et la demande, et les « Remb. siège » de l'agent.

**Tech Stack :** Cloud Functions (firebase-admin, transactions Firestore), React 19, Vitest (unitaires, composants, émulateur `demo-akayis-test`).

**Spec :** contrat `C:\dev\oxygen\docs\contrats\demande-operation.md` v10 §11 (lire 11.1 à 11.4 en entier) ; la logique du CRM y est celle d'`addTransactionPayment`, `addSiegeRepayment` et `acceptAgentRequest`.

## Global Constraints

- Natures : `'operation'` (défaut, demande d'avant), `'remboursement'`, `'remb_siege'`.
- Modes : `'Orange Money' | 'Cash'`. Réserve d'un remb. siège : `Orange Money` → `'stock'`, `Cash` → `'liquidite'` ; et l'inverse pour rendre `mode` depuis `balanceType`.
- Montant : entier > 0, ≤ plafond. Plafond de `rembourser` = reste (`remainingAmount ?? montant`) − montant de l'AUTRE demande en attente (l'autre mode) sur la même ligne. Aucun minimum.
- Refus de `rembourser` : `operation_inconnue`, `pas_un_credit`, `montant_invalide`, `mode_invalide`, `deja_en_attente`, `liaison_fermee` (+ `liaison_inconnue`, `boutique_indisponible` comme `demander`). Refus de `rembourserSiege` : `montant_invalide`, `mode_invalide`, `boutique_indisponible`, `liaison_fermee` (+ `liaison_inconnue`).
- `operation_inconnue` = ligne absente des `drafts` de la boutique, d'un autre `clientId` que la liaison, ou créée hors des périodes du compte sur cette fiche (`dansLesPeriodes`, comme `lireActivite`).
- `pas_un_credit` = ligne trouvée mais pas un Dépôt (type plié `depot`, `settlementType ?? type`) « Non Terminées », ou un Remb. siège, ou un transfert d'argent.
- Demande d'un remboursement : `sens: 'depot'`, `reseau` = celui de la ligne visée ; pour le siège : `STORE_NETWORKS[0]`. `operationId` : `cibleId` à l'acceptation d'un remboursement, la ligne créée (= `demandeId`) pour un remb. siège.
- `demandeRendue` rend toujours `nature` ; `cibleId` et `mode` seulement quand la demande les porte.
- `listerBoutiques` : `remboursement: true` au niveau de la réponse (à côté de `reseaux`), seulement si le profil l'ouvre (`oxygen.remboursement`). Profil fermé : `rembourser`/`rembourserSiege` répondent 400 « Action inconnue. », comme aujourd'hui.
- Acceptation d'un remboursement, messages exacts : ligne absente des drafts → `Cette ligne n’est plus en attente.` ; ligne plus Dépôt ou autre agent → `Cette ligne a changé depuis la demande : rejetez-la.` ; montant > reste → `Montant supérieur au reste dû (X FCFA) : rejetez la demande.` (X en `toLocaleString('fr-FR')`). Code : `STORE_TRANSACTION_INVALID`. Jamais par la file d'envoi.
- Identifiant de la tranche acceptée : `pmt_${cibleId}_demande_${demandeId}`.
- Remb. siège accepté : toujours `'Non Terminées'`, dans `drafts/{demandeId}`, avec `demandeId`.
- `reglements` : `[{ montant, mode, le }]`, au plus 50 (les derniers), écrit à chaque tranche d'`addTransactionPayment` et à chaque acceptation ; `le` = instant de la caisse (`faitLe`) sinon `new Date()` (pas `serverTimestamp`, interdit dans un tableau).
- `lireActivite` : `operatorName` retiré de toutes les lignes ; `mode` (= `paymentMethod`, ou tiré de `balanceType` pour un remb. siège), `demandeId`, `reglements` (en ms) ajoutés quand présents ; « Remb. siège » rendus avec SEULEMENT `id, source, storeId, storeName, type, montant, mode, statut, demandeId, reseau, code, date, createdAt, updatedAt, deletedAt` ; `statut` = `'Supprimée'` si `deletedAt` ou statut plié `supprimee`/`annulee`, sinon `'Validée'`. Jamais `reste`, `validatedAt`, `envoyeAuSiege`, `resteAuSiege`, `envoisSiege` sur eux. Les transferts d'argent restent exclus.
- Caisse : texte de la marque `Remboursement demandé par l’agent` ; `Demande de l’agent` pour un remb. siège ; gestes `Accepter` et `Rejeter` pour les deux natures nouvelles ; une demande `operation` garde Non terminée / Valider / Rejeter.
- Messages courts, rien n'attend le réseau sauf la réponse à une demande (déjà le cas). AGENTS.md : aucun déploiement, aucun push sans demande.

## Review Focus

1. Deux demandes (Orange Money + Cash) acceptées après un « Encaisser » de la caissière : la seconde dépasse le reste → refusée avec le message du reste, la demande reste en attente (Task 4).
2. Réponse perdue, la caissière reclique « Accepter » : aucune seconde tranche, mêmes soldes (Task 4).
3. La ligne visée est partie (encaissée en entier, ou « Valider » sous un autre identifiant) : « Accepter » refusé `Cette ligne n’est plus en attente.`, « Rejeter » marche (Task 4, Task 6).
4. La caissière a modifié l'agent ou le type de la ligne entre-temps : refus `Cette ligne a changé…` (Task 4).
5. Un remb. siège annulé par la boutique : l'agent le lit `Supprimée`, et un remb. siège en cours d'envoi au siège se lit `Validée` sans aucun montant d'envoi (Task 5).

---

### Task 1 : le cœur d'« Encaisser », partagé, et `reglements`

**Files:**
- Create: `functions/src/settlements/tranche.js`
- Modify: `functions/src/settlements/addTransactionPayment.js` (le corps de la transaction, l. ~178-327, passe par le module)
- Test: `tests/unit/tc-417-tranche-reglement.test.js` ; régression : `tests/functions/tc-061-settlements-callable-e2e.test.js`, `tc-235-code-agent-reglement.test.js`

**Interfaces:**
- Produces :
  - `REGLEMENTS_MAX = 50`
  - `calculerTranche({ draft, amount, paymentMethod, agentCode, balances, le }) → { effectiveType, originalAmount, paidAmount, refundedAmount, remainingAmount, newPaid, newRemaining, fullySettled, affectedNetwork, previousBalanceEntry, newBalanceEntry, nextBalances, newSummary, codesAgent, reglements }` — pur ; lève `DealerRequestError` `SETTLEMENT_ALREADY_SETTLED` / `SETTLEMENT_EXCEEDS_REMAINING` (messages actuels inchangés).
  - `ecrireTranche(t, { db, storeId, draftId, draft, calcul, paymentMethod, settlementId, settlementData, faitLe, now }) → { fullySettled, historyId? }` — écrit soldes, settlement(s), ligne (draft mis à jour ou history + delete), avec `reglements` dans les deux cas. N'écrit rien d'autre et ne lit rien : l'appelant a lu `historyRef` avant (règle des transactions Firestore).
  - `historyRefDe(db, storeId, draftId)`.

- [ ] **Step 1 : tests TC-417 (pur)**
  - `[TC-417-01]` dépôt 50 000, tranche 20 000 Cash, `le` = Date fixe → `newRemaining 30000`, `fullySettled false`, `reglements` = `[{ montant: 20000, mode: 'Cash', le }]`, liquidité +20 000.
  - `[TC-417-02]` reglements existants (2) + une tranche → 3 éléments, ordre conservé ; 50 existants + 1 → 50, le plus ancien tombé.
  - `[TC-417-03]` montant > reste → `SETTLEMENT_EXCEEDS_REMAINING` ; reste 0 → `SETTLEMENT_ALREADY_SETTLED`.
  - `[TC-417-04]` retrait, Orange Money → stock − montant ; `fullySettled` au reste 0.
- [ ] **Step 2 :** `npx vitest run tests/unit/tc-417-tranche-reglement.test.js` → FAIL (module absent).
- [ ] **Step 3 :** créer `tranche.js` en DÉPLAÇANT la logique d'`addTransactionPayment` (épinglage du type, init paresseuse, impact, summary, document settlement, écritures), plus `reglements`. `addTransactionPayment` garde lectures, idempotence, gardes remb. siège / transfert, construction de `settlementData` via `buildSettlementAuditBase`, et appelle `calculerTranche` puis `ecrireTranche` avec `le: faitLe ?? new Date()`.
- [ ] **Step 4 :** TC-417 PASS ; puis `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-061-settlements-callable-e2e.test.js tests/functions/tc-235-code-agent-reglement.test.js"` → PASS (comportement inchangé) ; ajouter à TC-061 `[TC-061-RG]` : deux tranches (Orange Money puis Cash) → la ligne d'historique porte `reglements` de 2 éléments, modes dans l'ordre, `le` Timestamp.
- [ ] **Step 5 :** commit `refactor(reglement): le cœur d'Encaisser partagé, et les tranches sur la ligne`.

### Task 2 : la demande de remboursement, règles pures, et l'axe du profil

**Files:**
- Modify: `functions/src/oxygen/demande.js`, `config/clients/_pilot.js` (`oxygen.remboursement: false`), `config/clients/c2egf-burkina.js` (`oxygen.remboursement: true`), `scripts/lib/generateOxygenProfile.mjs` (booléen exigé, émet `OXYGEN_REMBOURSEMENT`), `functions/src/config/oxygenProfile.js` (régénéré), `functions/src/oxygen/genererCodeLiaison.js` (`OXYGEN_DU_PROFIL.remboursement`), `docs/client-profiles.md` (une ligne)
- Test: `tests/unit/tc-418-remboursement-regles.test.js`, `tests/unit/tc-375-profil-oxygen.test.js`, tests existants qui figent `demandeRendue` (TC-393 : ajouter `nature: 'operation'`)

**Interfaces:**
- Produces (dans `demande.js`) :
  - `NATURES_DEMANDE = Object.freeze({ OPERATION: 'operation', REMBOURSEMENT: 'remboursement', REMB_SIEGE: 'remb_siege' })`
  - `MODES_REMBOURSEMENT = ['Orange Money', 'Cash']`
  - `reserveDuMode(mode) → 'stock'|'liquidite'` ; `modeDeReserve(balanceType) → 'Orange Money'|'Cash'|null`
  - `plafondRemboursement({ reste, autres }) → number` où `autres` = montants des autres demandes en attente (autre mode) ; jamais < 0
  - `demandeRendue` : `+ nature` (défaut `'operation'`), `+ cibleId`, `+ mode` si présents.
  - `OXYGEN_DU_PROFIL.remboursement: boolean`.

- [ ] **Step 1 : tests**
  - `[TC-418-01]` `plafondRemboursement({ reste: 20000, autres: [] })` = 20000 ; `autres: [8000]` = 12000 ; `autres: [25000]` = 0.
  - `[TC-418-02]` `reserveDuMode('Orange Money')` = `'stock'`, `'Cash'` = `'liquidite'` ; `modeDeReserve('stock')` = `'Orange Money'`, `'liquidite'` = `'Cash'`, `'autre'` = null.
  - `[TC-418-03]` `demandeRendue` d'une demande d'avant → `nature: 'operation'`, sans `cibleId` ni `mode` ; d'un remboursement → `nature`, `cibleId`, `mode` rendus.
  - TC-375 : `remboursement` non booléen → le générateur lève ; anti-dérive vert après régénération ; `OXYGEN_REMBOURSEMENT` vaut true pour C2EGF.
- [ ] **Step 2 :** lancer les trois fichiers → FAIL.
- [ ] **Step 3 :** implémenter ; régénérer avec `node scripts/generate-functions-config.mjs --client c2egf_burkina` ; `npm run check:generated` vert.
- [ ] **Step 4 :** tests PASS, et TC-393 mis à jour PASS.
- [ ] **Step 5 :** commit `feat(oxygen): la demande de remboursement, ses règles et son drapeau de profil`.

### Task 3 : `rembourser`, `rembourserSiege`, et le drapeau de `listerBoutiques`

**Files:**
- Modify: `functions/src/oxygen/pointEntreeOxygen.js` (deux actions dans `ACTIONS`, seulement si `oxygen.remboursement` ; `listerBoutiques`)
- Test: `tests/functions/tc-420-remboursement-point-entree.test.js` (même gabarit que `tc-393-demandes-agent-oxygen.test.js`)

**Interfaces:**
- Consumes : Task 2 (`NATURES_DEMANDE`, `MODES_REMBOURSEMENT`, `plafondRemboursement`, `demandeRendue`), `dansLesPeriodes`, `liaisonDuCompte`, `codeReseauDeFiche`, `estRembSiege`, `estTransfertArgent`.
- Produces : documents `clients/{boutiqueId}/demandesAgent/{cle}` de forme `demander` + `nature`, `cibleId` (remboursement), `mode`. Les autres demandes en attente sur la ligne se lisent par `where('cibleId', '==', operationId)` SEULE (égalité unique, index automatique), `etat` filtré en mémoire, `limit(20)`.

- [ ] **Step 1 : tests (émulateur)**
  - `[TC-420-01]` `rembourser` 5 000 Cash sur un dépôt Non Terminées 20 000 de l'agent → `{ ok: true, demande: { nature: 'remboursement', cibleId, mode: 'Cash', sens: 'depot', reseau: 'Orange', montant: 5000, etat: 'en_attente' } }` ; même `cle` rejouée → même demande, un seul document.
  - `[TC-420-02]` refus dans l'ordre des cas : ligne d'un autre agent, absente, ou créée avant la liaison → `operation_inconnue` ; un retrait / un remb. siège → `pas_un_credit` ; `montant: 0`, `1.5`, au-dessus du reste → `montant_invalide` ; `mode: 'Moov'` → `mode_invalide`.
  - `[TC-420-03]` Orange Money 12 000 en attente, puis Cash 9 000 sur un reste de 20 000 → `montant_invalide` ; Cash 8 000 → ok ; un second Orange Money → `deja_en_attente`.
  - `[TC-420-04]` `rembourserSiege` 3 000 Orange Money → `nature: 'remb_siege'`, `mode`, `sens: 'depot'`, `reseau: 'Orange'`, sans `cibleId` ; boutique inactive → `boutique_indisponible` ; liaison fermée → `liaison_fermee`.
  - `[TC-420-05]` `annuler`, `lireDemandes`, `etatDemande` rendent `nature`/`cibleId`/`mode`.
  - `[TC-420-06]` `listerBoutiques` → `remboursement: true` à côté de `reseaux` ; profil fermé (`oxygen: { ...OXYGEN, remboursement: false }`) → pas de champ, et `rembourser` → 400.
- [ ] **Step 2 :** lancer TC-420 sur l'émulateur → FAIL.
- [ ] **Step 3 :** implémenter. Validation de forme comme `demander` (`validerCommun`, `FORMAT_ID`, `estInstant(saisieLe)`, 400 sur une forme fausse) ; refus métier en 200. `agent` copié comme `demander`.
- [ ] **Step 4 :** TC-420 PASS, TC-377 et TC-393 PASS.
- [ ] **Step 5 :** commit `feat(oxygen): rembourser et rembourserSiege sur le point d'entrée`.

### Task 4 : Accepter un remboursement, accepter un remboursement siège

**Files:**
- Modify: `functions/src/storeTransactions/storeTransactionCommand.js` (`acceptAgentRequest` : la validation de `statut` ne vaut que pour la nature `operation` ; deux branches ; extraire de `addSiegeRepayment` un `donneesRembSiege(...)` local réutilisé par les deux)
- Test: `tests/functions/tc-421-remboursement-acceptation.test.js`

**Interfaces:**
- Consumes : Task 1 (`calculerTranche`, `ecrireTranche`, `historyRefDe`), Task 2 (`NATURES_DEMANDE`, `reserveDuMode`), `buildSettlementAuditBase`, `impactSaisie`, `cleanRembSiege`, `clientDeFiche`, `codeReseauDeFiche`.
- Produces : réponse `{ accepted: true, operationId, fullySettled? }` ; le signal du §10 part comme aujourd'hui (même action).

- [ ] **Step 1 : tests (émulateur)**
  - `[TC-421-01]` remboursement Cash 5 000 accepté → demande `validee`, `operationId = cibleId` ; ligne `paidAmount 5000`, `remainingAmount 15000`, `settlementStatus 'partial'`, `reglements[0]` `{ montant: 5000, mode: 'Cash' }` ; liquidité +5 000 ; settlement `pmt_{cibleId}_demande_{demandeId}` présent.
  - `[TC-421-02]` remboursement du reste entier en Orange Money → ligne dans `history/{cibleId}`, `statut 'Encaissé par Orange Money'`, `paymentMethod`, `validatedAt` ; stock Orange + montant.
  - `[TC-421-03]` rejouer l'acceptation → `idempotent: true`, une seule tranche, soldes inchangés.
  - `[TC-421-04]` (Review 1) caissière encaisse 10 000 puis accepte une demande de 15 000 sur 20 000 → refus `Montant supérieur au reste dû (10 000 FCFA) : rejetez la demande.`, demande toujours `en_attente`.
  - `[TC-421-05]` (Review 3, 4) ligne partie → `Cette ligne n’est plus en attente.` ; ligne passée à un autre agent ou en Retrait → `Cette ligne a changé depuis la demande : rejetez-la.` ; `rejectAgentRequest` marche dans les deux cas.
  - `[TC-421-06]` remb. siège Orange Money 3 000 accepté (sans `statut` dans la commande) → `drafts/{demandeId}` `type 'Remb. siège'`, `statut 'Non Terminées'`, `balanceType 'stock'`, `resteAuSiege 3000`, `demandeId` ; stock +3 000 ; Cash → `liquidite`.
  - `[TC-421-07]` une demande `operation` sans `statut` valable reste refusée `Statut initial non autorisé.` (comportement d'avant).
- [ ] **Step 2 :** lancer TC-421 → FAIL.
- [ ] **Step 3 :** implémenter. Lectures avant toute écriture : demande, draft `drafts/{cibleId}`, puis `historyRefDe` seulement si `calcul.fullySettled`. `settlementData` : `buildSettlementAuditBase` avec l'acteur = la caissière, `agentCode: null`, `idempotencyKey: demandeId`.
- [ ] **Step 4 :** TC-421 PASS ; suites des demandes (TC-393 et celles de `acceptAgentRequest`) PASS.
- [ ] **Step 5 :** commit `feat(caisse): accepter le remboursement de l'agent fait ce que fait Encaisser`.

### Task 5 : `lireActivite` rend les tranches, le mode, la demande et les remb. siège

**Files:**
- Modify: `functions/src/oxygen/pointEntreeOxygen.js` (`enLigne` dans `lireActivite`)
- Test: `tests/functions/tc-377-liaison-oxygen.test.js` (TC-377-RS devient la lecture des remb. siège)

**Interfaces:**
- Consumes : Task 2 (`modeDeReserve`), `estRembSiege`, `ligneDeDocument`.

- [ ] **Step 1 : tests**
  - `[TC-377-RS]` (réécrit, Review 5) un remb. siège de l'agent en cours d'envoi (`envoyeAuSiege` 1 000 sur 3 000) → rendu `{ type: 'Remb. siège', montant: 3000, mode: 'Orange Money', statut: 'Validée', demandeId }` et AUCUNE des clés `reste`, `validatedAt`, `envoyeAuSiege`, `resteAuSiege`, `envoisSiege`, `operatorName` ; le même avec `deletedAt` → `statut 'Supprimée'`.
  - `[TC-377-42]` une ligne réglée en deux tranches rend `mode` (le dernier), `reglements` en ms dans l'ordre, `demandeId` ; aucune ligne ne porte `operatorName`.
  - `[TC-377-43]` une ligne sans `reglements` n'a pas la clé `reglements`.
  - `[TC-377-TA]` inchangé : les transferts d'argent restent exclus.
- [ ] **Step 2 :** TC-377 → FAIL.
- [ ] **Step 3 :** implémenter dans `enLigne` (pas dans `ligneDeDocument`, que le CRM lit aussi pour son panneau historique).
- [ ] **Step 4 :** TC-377 PASS.
- [ ] **Step 5 :** commit `feat(oxygen): l'historique de l'agent lit les tranches et ses remboursements siège`.

### Task 6 : la caisse voit et répond

**Files:**
- Modify: `src/utils/demandesAgent.js` (`ligneDeDemande` : `nature` défaut `'operation'`, `cibleId`, `mode`, `type` = `'Remb. siège'` pour `remb_siege`), `src/services/demandesAgentService.js` (`accepterRemboursementAgent(demandeId)` → `{ action: 'acceptAgentRequest', demandeId }`), `src/components/transactions/LigneDemandeAgent.jsx` (prop `cible` ; gestes par nature), `src/components/transactions/TransactionTable.jsx` (`cible` = la non terminée d'`id === demande.cibleId` ; geste `accepter`), `src/content/aideFiches.js` (une phrase dans la fiche des demandes d'agent)
- Test: `tests/components/tc-422-remboursement-caisse.test.jsx`, `tests/unit/` du fichier qui teste `ligneDeDemande`

**Interfaces:**
- Consumes : la forme Firestore des Tasks 3 et 4.
- Produces : `LigneDemandeAgent({ demande, cible, styles, maintenant, dejaSaisieMs, enCours, onRepondre })` ; gestes `'nonTerminee' | 'valider' | 'rejeter' | 'accepter'`.

- [ ] **Step 1 : tests**
  - `[TC-422-01]` remboursement 5 000 Cash dont la ligne visée (dépôt 20 000, reste 12 000) est dans les non terminées → ligne en tête, texte `Remboursement demandé par l’agent`, `5 000 FCFA`, `Cash`, `Reste : 12 000 sur 20 000 FCFA` ; boutons `Accepter` et `Rejeter` seulement ; la ligne visée reste à sa place avec ses gestes.
  - `[TC-422-02]` « Accepter » appelle `accepterRemboursementAgent('d-1')` ; « Rejeter » appelle `rejeterDemandeAgent('d-1')`.
  - `[TC-422-03]` (Review 3) ligne visée absente → texte `Cette ligne n’est plus en attente.`, les deux boutons présents.
  - `[TC-422-04]` remb. siège → type `Remb. siège`, marque `Demande de l’agent`, mode lisible, `Accepter`/`Rejeter`.
  - `[TC-422-05]` une demande `operation` garde `Non terminée`, `Valider`, `Rejeter` (non-régression).
  - unitaire `ligneDeDemande` : une demande d'avant → `nature: 'operation'`.
- [ ] **Step 2 :** lancer → FAIL.
- [ ] **Step 3 :** implémenter (teinte agent existante, mêmes colonnes ; « Accepter » en bouton plein comme « Valider »).
- [ ] **Step 4 :** PASS ; `npm run quality:check` vert.
- [ ] **Step 5 :** commit `feat(caisse): le remboursement demandé par l'agent, accepter ou rejeter`.

### Task 7 : bilan, mise en service, relecture

**Files:**
- Modify: `audit/BILAN.md` (section « Évolution — le remboursement depuis l'app »), `docs/deployer-les-functions.md` (l'ordre ci-dessous)

- [ ] **Step 1 :** écrire la mise en service : (1) push du front, Production vérifiée, postes rechargés — un poste à l'ancienne lirait un remboursement comme une demande de dépôt ; (2) functions `storeTransactionCommand`, `addTransactionPayment`, `pointEntreeOxygen` ; (3) prévenir Oxygen (le drapeau est alors levé).
- [ ] **Step 2 :** `npm run quality:check` et `npm run test:functions` verts (relancer seul tout fichier qui dépasse un délai et le dire).
- [ ] **Step 3 :** relecture indépendante de la branche (agent `code-reviewer`), corrections avec leurs tests.
- [ ] **Step 4 :** commit `docs: bilan et mise en service du remboursement depuis l'app`.
