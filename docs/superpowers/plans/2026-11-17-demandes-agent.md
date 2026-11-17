# Demandes d'agent côté CRM — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'agent lance un dépôt ou un retrait depuis Oxygen ; la caissière le voit dans les Non Terminées et répond « Non terminée », « Valider » ou « Rejeter ».

**Architecture :**
- Un module pur, `functions/src/oxygen/demande.js`, contient les états, la forme rendue et la lecture de la fiche. Le point d'entrée et la commande s'en servent tous les deux.
- `pointEntreeOxygen.js` gagne 5 actions, et `storeTransactionCommand.js` en gagne 2.
- Côté caisse, un hook écoute les demandes en attente, et une ligne dédiée les montre en tête du tableau.

**Tech Stack :** Firebase Functions gen2 (firebase-admin), règles Firestore, React 19 / Tailwind v4, Vitest, Testing Library, émulateurs `demo-akayis-test`.

**Spec :** `docs/superpowers/specs/2026-11-17-demandes-agent-design.md`. Le contrat Oxygen v4 se trouve dans `C:\dev\oxygen\docs\contrats\demande-operation.md` ; son §8 est précisé par la spec, et la spec fait foi.

## Global Constraints

- **Rien ne sort de la machine.** Aucun déploiement, aucun `git push`, aucune pull request. Tout tourne sur les émulateurs `demo-*`, jamais sur la production.
- **Git :** les commandes git sont préfixées par `rtk`. Les messages de commit sont en français ASCII et se terminent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. On ne commite jamais les fichiers non suivis listés dans AGENTS.md (`audit/*.mjs|json|png`, `vercel-env.ps1`, `.vitest/`, `METHODE-REFONTE-DESIGN.md`).
- **`functions/` n'importe rien de `src/`.**
- **Données :**
  - les états sont `en_attente`, `validee`, `rejetee` et `annulee_agent` ;
  - l'id de la demande est la `cle`, au format `[A-Za-z0-9_-]{1,160}` ;
  - une opération créée depuis une demande porte l'id `demandeId`.
- **Aucune limite métier sur le nombre de demandes.** Les seules bornes sont des bornes de lecture : `limit(200)`, et 50 lignes d'historique pour `servies`.
- **Refus métier en 200 `{ ok:false, raison }`.** Les raisons possibles sont :
  - `liaison_inconnue` et `liaison_fermee` ;
  - `boutique_indisponible` ;
  - `montant_invalide` et `reseau_invalide` ;
  - `demande_inconnue`.

  Une demande mal formée reçoit 400. Un distributeur éteint par le profil reçoit 403.
- **Textes affichés**, au caractère près :
  - « Demande de l'agent », « Non terminée », « Valider », « Rejeter », « Déjà saisi à HH:MM ? » ;
  - « L'agent a annulé cette demande. » et « Cette demande a déjà été rejetée. ».
- **Couleurs :** `--color-agent: #5b3ba8`, `--color-agent-soft: #f1edfb`, `--color-agent-line: #d9cff3`.

## Review Focus

1. **Course avec une annulation.** L'agent annule pendant que la caissière clique Valider. On attend `DEMANDE_CLOSE`, sans opération créée ni solde touché. Test : TC-394-05.
2. **Solde insuffisant à la validation.** La demande reste `en_attente`, les soldes ne bougent pas, et la caisse affiche un toast. Tests : TC-394-06 et TC-397-07.
3. **Réponse perdue, Valider recliqué.** Une seule opération et un seul mouvement de solde. Test : TC-394-03.
4. **Règle pas encore déployée** (`permission-denied`) **ou poste hors ligne.** Aucune ligne de demande, aucun bandeau, et le tableau marche comme avant. Tests : TC-397-09 et TC-397-10.
5. **La fiche a perdu son code Orange depuis la demande.** Refus clair, et la demande reste en attente. Test : TC-394-08.

---

### Task 1 : le module pur `demande.js` et les index

**Files :**
- Create : `functions/src/oxygen/demande.js`
- Modify : `firestore.indexes.json` (deux index `COLLECTION_GROUP` sur `demandesAgent`)
- Test : `tests/unit/tc-392-demande-agent.test.js`

**Interfaces :**
- Produces, dans `functions/src/oxygen/demande.js`. Rien n'y fait d'I/O ; la seule importation est `enMs`, de `./liaison.js`.
  - `COLLECTION_DEMANDES = 'demandesAgent'`
  - `ETATS_DEMANDE = Object.freeze({ EN_ATTENTE: 'en_attente', VALIDEE: 'validee', REJETEE: 'rejetee', ANNULEE_AGENT: 'annulee_agent' })`
  - `TYPE_DU_SENS = Object.freeze({ depot: 'Dépôt', retrait: 'Retrait' })`
  - `RETENUE_DEMANDES_MS = 7 * 24 * 60 * 60 * 1000`
  - `LIMITE_DEMANDES = 200`
  - `codeReseauDeFiche(fiche, reseau) → string`, soit `String(fiche?.[reseau.toLowerCase()] ?? '').trim()`. Rend `''` si la fiche n'a pas de code.
  - `clientDeFiche(clientId, fiche) → { id, nom?, prenom?, orange?, codeAgent?, numeroAgent? }`. Seules les clés présentes sur la fiche sont gardées.
  - `demandeRendue(id, donnees) → { id, boutiqueId, boutiqueNom, sens, reseau, montant, etat, creeLe, reponduLe, operationId }`. Les dates sont en ms via `enMs` ; une absente vaut `null`, et `operationId` absent vaut `null`.

- [ ] **Step 1 : écrire les tests qui échouent (TC-392)**

```js
// [TC-392-01] demandeRendue : dates en ms, null quand absentes, rien d'autre
expect(demandeRendue('k1', { boutiqueId: 'b1', boutiqueNom: 'B1', sens: 'depot', reseau: 'Orange', montant: 5000,
  etat: 'en_attente', creeLe: Timestamp.fromMillis(1000), reponduLe: null, compteOxygen: 'x', clientId: 'c' }))
  .toEqual({ id: 'k1', boutiqueId: 'b1', boutiqueNom: 'B1', sens: 'depot', reseau: 'Orange', montant: 5000,
    etat: 'en_attente', creeLe: 1000, reponduLe: null, operationId: null })
// [TC-392-02] codeReseauDeFiche lit le champ du réseau, espaces retirés ; '' sans code
expect(codeReseauDeFiche({ orange: ' 70123456 ' }, 'Orange')).toBe('70123456')
expect(codeReseauDeFiche({ nom: 'A' }, 'Orange')).toBe('')
// [TC-392-03] clientDeFiche garde les seules clés présentes
expect(clientDeFiche('c1', { nom: 'KABORE', prenom: 'Awa', orange: '7012', telephone: '1' }))
  .toEqual({ id: 'c1', nom: 'KABORE', prenom: 'Awa', orange: '7012' })
// [TC-392-04] index : demandesAgent (compteOxygen ASC, etat ASC) en COLLECTION_GROUP
// [TC-392-05] index : demandesAgent (compteOxygen ASC, reponduLe DESC) en COLLECTION_GROUP
```

Le helper `composite` des tests d'index se copie depuis `tests/unit/tc-379-index-liaison-oxygen.test.js`. `Timestamp` vient de `firebase-admin/firestore`.

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run --config vitest.config.js tests/unit/tc-392-demande-agent.test.js`
Expected : FAIL, avec un import introuvable et les index absents.

- [ ] **Step 3 : écrire `demande.js` et ajouter les deux index à `firestore.indexes.json`**

- [ ] **Step 4 : relancer**

Run : la même commande.
Expected : 5/5 PASS.

- [ ] **Step 5 : commit** — `feat: module pur des demandes d'agent et leurs index`

---

### Task 2 : `demander`, `etatDemande` et `annuler`

**Files :**
- Modify : `functions/src/oxygen/pointEntreeOxygen.js` (nouvelle section « Les demandes d'opération », et `ACTIONS`)
- Test : `tests/functions/tc-393-demandes-agent-oxygen.test.js`

**Interfaces :**
- Consumes : tout ce que produit la Task 1 ; `STORE_NETWORKS`, depuis `../config/storeProfile.js`.
- Produces : les actions `demander`, `etatDemande` et `annuler` de `traiterDemandeOxygen`, et un helper interne `liaisonDuCompte(db, corps, oxygen) → { liaisonId, liaison } | { refus: 'liaison_inconnue' }`, qui reprend le contrôle de `lireActivite`.
  - **Entrées** : la base commune est `{ action, distributeurId, compteOxygen, liaison }`.
    - `demander` ajoute `boutiqueId, sens, reseau, montant, saisieLe, cle` ;
    - `etatDemande` et `annuler` ajoutent `boutiqueId, demandeId`.
  - **Sorties** : `{ ok:true, demande }`, ou `{ ok:false, raison }`.

**Ordre de `demander`.** La spec, §5.2, fixe l'ordre des contrôles :
1. 400 sur une forme invalide ;
2. `montant_invalide`, puis `reseau_invalide` ;
3. dans la transaction :
   - le rejeu de la même `cle` : même compte, on rend la demande ; autre compte, 400 ;
   - `liaison_fermee` ;
   - `boutique_indisponible` ;
   - `reseau_invalide` si la fiche n'a pas le code du réseau ;
   - sinon, l'écriture.

Le document écrit porte `agent: { nom, prenom, code: codeReseauDeFiche(fiche, reseau) }`, `boutiqueNom: store.name`, `saisieLe: Timestamp.fromMillis(saisieLe)` et `creeLe: Timestamp.fromMillis(maintenant())`. Ses champs `reponduLe`, `reponduPar` et `operationId` valent `null`.

- [ ] **Step 1 : écrire les tests qui échouent (TC-393, première partie)**

Le cadre se copie depuis TC-377 : `deps()` avec l'horloge `maintenant`, `OXYGEN = { actif: true, distributeurId: 'c2egf', nom: 'C2EGF' }`, et la base vidée par `fetch DELETE` comme TC-351.

Le jeu de départ :
- `liaisonsOxygen/L1` vaut `{ compteOxygen: 'ox-1', distributeurId: 'c2egf', clientId: 'c1', finLe: null }` ;
- `globalClients/c1` vaut `{ nom: 'KABORE', prenom: 'Awa', orange: '70123456' }` ;
- `stores/b1` vaut `{ active: true, name: 'Boutique 1' }`.

La base de la requête est `{ action: 'demander', distributeurId: 'c2egf', compteOxygen: 'ox-1', liaison: 'L1', boutiqueId: 'b1', sens: 'depot', reseau: 'Orange', montant: 5000, saisieLe: T0, cle: 'k-1' }`.

```
[TC-393-01] demander écrit clients/b1/demandesAgent/k-1 en_attente, avec agent { nom, prenom, code:'70123456' } ; réponse 200 { ok:true, demande } (forme de demandeRendue, creeLe = T0)
[TC-393-02] la même cle renvoyée rend la même demande, et il n'y a toujours qu'un document
[TC-393-03] la même cle venue d'un autre compte → 400
[TC-393-04] deux demandes en attente du même agent (cles k-1 et k-2) sont acceptées toutes les deux : aucune limite
[TC-393-05] montant 0, 12.5 et '5000' → { ok:false, raison:'montant_invalide' } ; reseau 'Moov' → 'reseau_invalide'
[TC-393-06] sens 'credit', cle 'a/b' ou saisieLe -1 → 400
[TC-393-07] liaison avec finLe → 'liaison_fermee' ; liaison d'un autre compte → 'liaison_inconnue'
[TC-393-08] boutique inactive ou absente → 'boutique_indisponible'
[TC-393-09] fiche sans orange → 'reseau_invalide', et rien n'est écrit
[TC-393-10] oxygen.actif false → 403
[TC-393-11] etatDemande rend l'état ; demande d'un autre compte ou absente → 'demande_inconnue'
[TC-393-12] annuler passe en_attente à annulee_agent, avec reponduLe = maintenant ; sur une demande déjà validée, rend son état réel sans rien écrire
[TC-393-13] annuler et etatDemande marchent sur une liaison FERMÉE du même compte
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-393-demandes-agent-oxygen.test.js"`
Expected : FAIL, avec « Action inconnue » (400).

- [ ] **Step 3 : écrire les trois actions dans `pointEntreeOxygen.js` et les ajouter à `ACTIONS`**

- [ ] **Step 4 : relancer**

Run : la même commande.
Expected : PASS de TC-393-01 à TC-393-13. TC-377 reste vert : `npx vitest … tests/functions/tc-377-liaison-oxygen.test.js`, lancé de la même façon.

- [ ] **Step 5 : commit** — `feat: point d'entree Oxygen, demander, etatDemande et annuler`

---

### Task 3 : `listerBoutiques` et `lireDemandes`

**Files :**
- Modify : `functions/src/oxygen/pointEntreeOxygen.js`
- Test : `tests/functions/tc-393-demandes-agent-oxygen.test.js` (deuxième partie)

**Interfaces :**
- `listerBoutiques { ..., avecToutes?: boolean }` rend `{ ok:true, servies: [{ id, nom, derniereLe }], reseaux: STORE_NETWORKS, boutiques?: [{ id, nom }] }`.
- `lireDemandes { ..., enAttente?: boolean }` rend `{ ok:true, demandes: [demandeRendue…] }`, la plus récente d'abord (`creeLe`).
- Les requêtes exactes :
  - `collectionGroup('history').where('clientId','==',clientId).orderBy('createdAt','desc').limit(50)` ;
  - `db.getAll(...stores)` ;
  - `collection('stores').where('active','==',true).orderBy('name')` ;
  - `collectionGroup(COLLECTION_DEMANDES).where('compteOxygen','==',c).where('etat','==','en_attente').limit(LIMITE_DEMANDES)` ;
  - `….where('compteOxygen','==',c).where('reponduLe','>=', Timestamp.fromMillis(maintenant() - RETENUE_DEMANDES_MS)).orderBy('reponduLe','desc').limit(LIMITE_DEMANDES)`.
- Une liaison fermée a deux effets :
  - `listerBoutiques` répond `liaison_fermee` ;
  - `lireDemandes` l'accepte.

- [ ] **Step 1 : écrire les tests qui échouent**

```
[TC-393-14] servies : boutiques distinctes de l'historique de c1, avec derniereLe = la plus récente ; une boutique désactivée en est retirée ; nom = stores.name
[TC-393-15] sans avecToutes, pas de clé boutiques ; avec avecToutes, les boutiques actives triées par nom ; reseaux vaut ['Orange']
[TC-393-16] listerBoutiques sur une liaison fermée → 'liaison_fermee'
[TC-393-17] lireDemandes rend les en attente et les fermées depuis moins de 7 jours ; une fermée il y a 8 jours n'y est pas ; celles d'un autre compte non plus
[TC-393-18] lireDemandes { enAttente: true } ne rend que les en attente
[TC-393-19] lireDemandes marche sur une liaison fermée du même compte
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : la commande de la Task 2.
Expected : FAIL sur TC-393-14 à TC-393-19.

- [ ] **Step 3 : écrire les deux actions et les ajouter à `ACTIONS`**

- [ ] **Step 4 : relancer**

Expected : TC-393 en entier PASS (19), et TC-377 PASS.

- [ ] **Step 5 : commit** — `feat: point d'entree Oxygen, listerBoutiques et lireDemandes`

---

### Task 4 : `acceptAgentRequest` et `rejectAgentRequest`

**Files :**
- Modify :
  - `functions/src/storeTransactions/storeTransactionCommand.js` : la liste blanche du payload gagne `'demandeId', 'statut'`, et les deux actions viennent après la lecture des soldes ;
  - `functions/src/errors.js` : `DEMANDE_CLOSE: 'failed-precondition'`.
- Test : `tests/functions/tc-394-reponse-demande-agent.test.js`

**Interfaces :**
- Consumes : de la Task 1, `COLLECTION_DEMANDES`, `ETATS_DEMANDE`, `TYPE_DU_SENS`, `codeReseauDeFiche` et `clientDeFiche`.
- Produces :
  - `acceptAgentRequest { demandeId, statut }` rend `{ accepted:true, operationId, statut }`, ou au rejeu `{ accepted:true, operationId, idempotent:true }` ;
  - `rejectAgentRequest { demandeId }` rend `{ rejected:true }`, ou au rejeu `{ rejected:true, idempotent:true }`.
  - Les codes d'erreur sont `STORE_TRANSACTION_NOT_FOUND`, `DEMANDE_CLOSE`, `IDEMPOTENCY_CONFLICT`, `STORE_TRANSACTION_INVALID` et `INSUFFICIENT_STORE_BALANCE`.
- L'opération se construit par `cleanTransaction({ client: clientDeFiche(...), clientId, type: TYPE_DU_SENS[sens], reseau, code, montant, statut })`.
  - Son impact passe par `applyInitialTransactionImpact`.
  - `directValidation` et `splitLiquiditeSiRetraitDirect` s'appliquent comme dans `add`.
  - Sa datation est `{ date: dateFr(), createdAt: now }`. On ignore `ageMs` et `commandeId`.
- Si la fiche est absente, l'erreur est `STORE_TRANSACTION_NOT_FOUND` (« Fiche de l'agent introuvable. »). Si elle n'a pas de code, l'erreur est `STORE_TRANSACTION_INVALID` (« La fiche de cet agent n'a pas de code Orange. »).

- [ ] **Step 1 : écrire les tests qui échouent (TC-394)**

Le cadre vient de TC-351. Les soldes de départ sont `{ stock: 100000, liquidite: 50000 }`. Une demande `d1` en attente dans `clients/STORE/demandesAgent` porte `clientId: 'c1'`, `sens: 'depot'`, `montant: 30000` et `reseau: 'Orange'`. La fiche `globalClients/c1` porte `orange: '70123456'`.

```
[TC-394-01] Valider (statut 'Validée') → history/d1 { type:'Dépôt', montant:30000, code:'70123456', clientId:'c1', directValidation:true } ; demande validee, operationId 'd1', reponduPar UID ; soldes { stock: 70000, liquidite: 80000 } ; une ligne auditLogs { action:'acceptAgentRequest', demandeId:'d1' }
[TC-394-02] Non terminée → drafts/d1 statut 'Non Terminées' ; stock 70000, liquidite 50000 ; demande validee
[TC-394-03] le même accept rejoué → { accepted:true, operationId:'d1', idempotent:true } ; une seule opération ; soldes inchangés depuis le premier appel
[TC-394-04] la date de l'opération est l'heure serveur : createdAt est un Timestamp, ≥ début du test ; saisieLe de la demande (veille) ignoré ; ageMs dans le payload ignoré
[TC-394-05] demande annulee_agent → rejects { code:'DEMANDE_CLOSE', message:"L'agent a annulé cette demande." } ; aucune opération ; soldes intacts
[TC-394-06] retrait de 90000 validé avec liquidite 50000 → rejects { code:'INSUFFICIENT_STORE_BALANCE' } ; la demande reste en_attente ; soldes intacts
[TC-394-07] demande absente → STORE_TRANSACTION_NOT_FOUND ; statut 'Annulée' → STORE_TRANSACTION_INVALID
[TC-394-08] fiche sans orange → STORE_TRANSACTION_INVALID ; la demande reste en_attente
[TC-394-09] Rejeter → rejetee, reponduLe, reponduPar ; audit écrit ; soldes intacts ; rejoué → idempotent:true
[TC-394-10] Rejeter une demande validee → DEMANDE_CLOSE ; accepter une rejetee → DEMANDE_CLOSE « Cette demande a déjà été rejetée. »
[TC-394-11] une demande d'une AUTRE boutique (clients/autre/demandesAgent/d1) est introuvable pour cette caissière
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-394-reponse-demande-agent.test.js"`
Expected : FAIL, avec « Champ non autorisé » ou « Commande inconnue ».

- [ ] **Step 3 : écrire les deux actions et le code d'erreur**

- [ ] **Step 4 : relancer, puis toute la suite des functions**

Run : la même commande, puis `npm run test:functions`.
Expected : TC-394 11/11 PASS, et la suite des functions verte (642 tests et plus).

- [ ] **Step 5 : commit** — `feat: la caisse accepte ou rejette une demande d'agent`

---

### Task 5 : la règle Firestore, puis la forme exacte envoyée à Oxygen

**Files :**
- Modify : `firestore.rules`, dans `match /clients/{storeId}`
- Test : `tests/firestore/demandesAgent.rules.test.js` (TC-395)

- [ ] **Step 1 : écrire les tests qui échouent.** Le cadre vient de `liaisonsOxygen.rules.test.js`, avec deux boutiques comme l'exige AGENTS.md.

```
[TC-395-01] un membre de b1 lit clients/b1/demandesAgent/x, et fait la requête etat == 'en_attente'
[TC-395-02] un membre de b2 ne lit pas clients/b1/demandesAgent/x
[TC-395-03] personne n'écrit, pas même un membre de b1 : création, mise à jour et suppression refusées
[TC-395-04] un visiteur non connecté ne lit rien
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.firestore.config.js tests/firestore/demandesAgent.rules.test.js"`
Expected : FAIL sur TC-395-01, à cause du refus par défaut.

- [ ] **Step 3 : écrire la règle** — `match /demandesAgent/{demandeId} { allow read: if isStoreMember(storeId); allow create, update, delete: if false; }`

- [ ] **Step 4 : relancer, puis `npm run test:firestore`**

Expected : TC-395 4/4 PASS, et la suite des règles verte (452 tests et plus).

- [ ] **Step 5 : commit** — `feat: regle Firestore des demandes d'agent`

- [ ] **Step 6 : envoyer la forme exacte à la session Oxygen** (`ListAgents`, puis `SendMessage`). Le message contient :
  - les entrées et les sorties des 5 actions ;
  - un exemple JSON fictif par action ;
  - les raisons de refus.

  Il ne contient ni clé, ni jeton, ni vrai identifiant.

---

### Task 6 : l'aide de la caisse, ses fonctions pures et son service

**Files :**
- Create :
  - `src/utils/demandesAgent.js` ;
  - `src/services/demandesAgentService.js`.
- Test : `tests/unit/tc-396-demandes-agent-caisse.test.js`

**Interfaces :**
- Produces, dans `src/utils/demandesAgent.js` :
  - `ligneDeDemande(id, donnees) → { id, estDemandeAgent: true, sens, client: { nom, prenom }, code, type, reseau, montant, createdAt: Date|null }`. `type` vaut « Dépôt » ou « Retrait » selon le sens. `createdAt` vient de `creeLe` : `toDate()` sur un Timestamp, une Date ou des ms.
  - `trierDemandes(lignes) → lignes`, la plus ancienne d'abord.
  - `dejaSaisie(ligne, operations) → { id, instantMs } | null`. On garde la première opération dont :
    - le `clientId` est le même ;
    - le type normalisé est le même ;
    - le `montant` est le même ;
    - `instantDeDepart(op) ≥ instantDeDepart(ligne)` ;
    - `op.id !== ligne.id` ;
    - le statut n'est ni « Supprimée » ni « Annulée », et l'envoi n'est pas `REFUSEE`.

    `instantDeDepart` vient de `src/utils/attente.js`.
- Produces, dans `src/services/demandesAgentService.js` :
  - `accepterDemandeAgent(demandeId, statut) → Promise<object>`, soit `runStoreTransactionCommand({ action: 'acceptAgentRequest', demandeId, statut })` ;
  - `rejeterDemandeAgent(demandeId) → Promise<object>`.

  Les erreurs remontent telles que `callableError` les fait (avec `.code` et `.message`).

- [ ] **Step 1 : écrire les tests qui échouent**

```
[TC-396-01] ligneDeDemande : sens depot → type 'Dépôt' ; agent → client ; agent.code → code ; creeLe Timestamp-like { toDate } → Date
[TC-396-02] trierDemandes met la plus ancienne en premier
[TC-396-03] dejaSaisie trouve un Retrait du même clientId et du même montant saisi après la demande
[TC-396-04] dejaSaisie ignore une opération plus ancienne que la demande, un autre montant, un autre type, une ligne 'Supprimée', un envoi REFUSEE
[TC-396-05] accepterDemandeAgent('d1','Validée') appelle la commande avec { action:'acceptAgentRequest', demandeId:'d1', statut:'Validée' } ; rejeterDemandeAgent('d1') avec { action:'rejectAgentRequest', demandeId:'d1' } (mock de storeTransactionCommandService.js)
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run --config vitest.config.js tests/unit/tc-396-demandes-agent-caisse.test.js`
Expected : FAIL, avec un module introuvable.

- [ ] **Step 3 : écrire les deux modules**

- [ ] **Step 4 : relancer**

Expected : 5/5 PASS.

- [ ] **Step 5 : commit** — `feat: lecture et gestes des demandes d'agent cote caisse`

---

### Task 7 : le hook, la ligne violette et le tableau

**Files :**
- Create :
  - `src/hooks/useDemandesAgent.js` ;
  - `src/components/transactions/LigneDemandeAgent.jsx`.
- Modify :
  - `src/components/transactions/TransactionTable.jsx` : le minuteur, l'état vide, les lignes en tête, les gestes et le toast ;
  - `src/index.css` : les trois jetons `agent`.
- Test : `tests/components/tc-397-demandes-agent-tableau.test.jsx`

**Interfaces :**
- `useDemandesAgent() → { demandes: LigneDemande[] }`.
  - Il s'abonne par `firestoreService.subscribeToCollection('demandesAgent', observer, { where: [{ field: 'etat', operator: '==', value: 'en_attente' }], limitCount: 200 })`, seulement si trois conditions sont réunies :
    - `LIAISON_OXYGEN_ACTIVE` est vrai ;
    - `activeStore?.id === userProfile?.storeId`, lus dans `AuthContext` ;
    - `useEnLigne()` est vrai.
  - Il convertit par `ligneDeDemande` et trie par `trierDemandes`.
  - Une erreur d'écoute est seulement journalisée (`logger`) et rend `[]`. Hors ligne, il rend `[]`.
- `LigneDemandeAgent({ demande, maintenant, dejaSaisieMs, enCours, onRepondre })` rend un `<tr data-testid="demande-agent-{id}">`.
  - La ligne a le fond `bg-agent-soft` et la bordure `border-agent-line`.
  - La colonne Type montre le sens dans sa couleur, puis une icône `Smartphone` de lucide et « Demande de l'agent » en `text-agent`.
  - Les boutons sont « Non terminée », « Valider » (plein, `bg-brand-500 text-white`) et « Rejeter » (texte `text-danger`). Tous trois sont `disabled={enCours}` ; le bouton touché porte « … ».
  - `onRepondre(demande, geste)` reçoit `geste` parmi `'nonTerminee' | 'valider' | 'rejeter'`.
- `TransactionTable` :
  - les demandes s'affichent **avant** `lignesAffichees`, quel que soit le filtre ;
  - elles ne comptent ni dans `totauxEnAttente` ni dans `lignesCachees` ;
  - l'état vide n'apparaît que s'il n'y a ni non terminée ni demande ;
  - le minuteur tourne aussi quand il n'y a que des demandes ;
  - les gestes se traduisent ainsi :
    - `valider` → `accepterDemandeAgent(id, 'Validée')` ;
    - `nonTerminee` → `accepterDemandeAgent(id, 'Non Terminées')` ;
    - `rejeter` → `rejeterDemandeAgent(id)` ;
  - un échec passe par `setRollbackToast({ show: true, message: error.message, type: 'rollback' })`, effacé après 4 s, comme `handleEnvoiSiege` ;
  - `dejaSaisieMs` = `dejaSaisie(demande, [...pendingTransactions, ...completedTransactions])?.instantMs`. L'heure s'affiche en `toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })`.

- [ ] **Step 1 : écrire les tests qui échouent (TC-397)**

On mocke `useDemandesAgent` par un getter, comme `REMB_SIEGE_ACTIF` dans TC-391, et `demandesAgentService.js` par `vi.fn`. Les autres mocks se copient depuis TC-391.

Le hook est éprouvé dans un `describe` à part, par `renderHook`. On y mocke :
- `firestoreService.subscribeToCollection` ;
- `useEnLigne` ;
- `liaisonOxygenService.js` (`LIAISON_OXYGEN_ACTIVE`) ;
- `AuthContext`.

```
[TC-397-01] une demande de dépôt s'affiche en tête, avec « Demande de l'agent », le nom, le code et le montant ; nombre-tout-non-terminees ne la compte pas
[TC-397-02] sous le filtre Retraits, la demande de dépôt reste visible ; « N autres opérations cachées » ne la compte pas
[TC-397-03] Valider → accepterDemandeAgent('d1','Validée') ; Non terminée → ('d1','Non Terminées') ; Rejeter → rejeterDemandeAgent('d1')
[TC-397-04] pendant l'appel, les trois boutons de la ligne sont désactivés
[TC-397-05] seulement des demandes, aucune non terminée : pas d'état vide, la ligne est là
[TC-397-06] une opération du même agent, du même type et du même montant saisie après → « Déjà saisi à HH:MM ? »
[TC-397-07] l'échec du service (message « Solde insuffisant… ») s'affiche dans le toast, et la ligne reste
[TC-397-08] hook : flag faux → aucun abonnement ; flag vrai, en ligne, boutique prête → un abonnement avec etat == en_attente et limitCount 200
[TC-397-09] hook : hors ligne → demandes [] et aucun abonnement
[TC-397-10] hook : erreur permission-denied de l'écoute → demandes [], rien d'autre ne casse
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run --config vitest.config.js tests/components/tc-397-demandes-agent-tableau.test.jsx`
Expected : FAIL, avec un module introuvable.

- [ ] **Step 3 : écrire le hook, la ligne, l'intégration au tableau et les jetons**

- [ ] **Step 4 : relancer, puis TC-391 et TC-388**

Run : la même commande, puis `npx vitest run --config vitest.config.js tests/components/tc-391-filtre-non-terminees.test.jsx tests/components/tc-388*`
Expected : TC-397 10/10 PASS, et TC-391 et TC-388 restent verts. S'ils échouent faute de mock `useDemandesAgent`, on ajoute ce mock en rendant `[]` : c'est un Ruling à noter au journal de bord.

- [ ] **Step 5 : commit** — `feat: les demandes d'agent dans les non terminees, en violet`

---

### Task 8 : l'aide, le bilan et l'essai réel

**Files :**
- Modify :
  - `src/content/aideFiches.js` : une étape dans la fiche 7 ;
  - `audit/BILAN.md` : une ligne pour le lot.
- Test : `tests/unit/tc-225-aide-fiches.test.js`, avec [TC-225-RS4].

- [ ] **Step 1 : écrire le test qui échoue**

`[TC-225-RS4]` : une étape de la fiche 7 contient `Demande de l'agent`, `{{Valider}}`, `{{Non terminée}}` et `{{Rejeter}}`.

- [ ] **Step 2 : lancer le test** — `npx vitest run --config vitest.config.js tests/unit/tc-225-aide-fiches.test.js`. Expected : FAIL.

- [ ] **Step 3 : ajouter l'étape**, au mot près de la spec §5.5 : `'Une ligne violette **Demande de l'agent** vient de l'app Oxygen : {{Valider}}, {{Non terminée}} ou {{Rejeter}}.'`. Ajouter aussi la ligne du bilan.

- [ ] **Step 4 : relancer**, puis `npm run quality:check`. Expected : tout vert, build et lint compris.

- [ ] **Step 5 : faire l'essai réel**, comme le veut la règle 5 d'AGENTS.md (« rendu regardé »).
  1. Lancer `npm run emulateurs` puis `npm run emulateurs:seed` (`demo-c2egf-local`), et un Vite sur le port 5199.
  2. Écrire deux demandes avec un script admin rangé dans le scratchpad, jamais commité, qui pointe sur l'émulateur. Les demandes portent sur une fiche réelle du seed qui a un code Orange : un dépôt et un retrait.
  3. Avec Playwright, se connecter en `boutique1@c2egf.test`. Faire une capture à 1440 px et une à 390 px.
  4. Valider le dépôt : la ligne passe dans l'historique et les soldes bougent.
  5. Mettre le retrait en Non terminée : il redevient une ligne ordinaire.
  6. Rejeter une troisième demande : elle disparaît.
  7. Arrêter **ses propres** processus (vérifier la ligne de commande et l'heure de démarrage). Ne jamais toucher à ceux de `Desktop\swi`.

- [ ] **Step 6 : commit** — `docs: aide et bilan, demandes d'agent`
