# Remboursement au siège en bleu ciel — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La ligne « Remb. siège » se repère en bleu ciel. Une case bleu ciel dit ce qui part au siège. Le Total caisse ne compte plus cet argent.

**Architecture:** Les sommes en attente (`src/utils/caisse.js`) gagnent une part « siège », que `totalCaisse` retranche. La barre des soldes et l'assistant la passent. Deux jetons de couleur `siege` remplacent le marine partout où la teinte « Remb. siège » apparaît, et le tableau gagne sa troisième case.

**Tech Stack:** React 19, Tailwind v4 (`@theme` dans `src/index.css`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-remb-siege-bleu-ciel-design.md`

## Global Constraints

- Les jetons : `--color-siege: #0270b0`, `--color-siege-soft: #e0f2fe`.
- La formule : T = stock + liquidité + dépôts en attente − retraits en attente − reste à envoyer au siège.
- Le libellé de la case est `Remb. siège`.
- Front seul : aucun fichier sous `functions/`.
- Les messages de commit sont en français ASCII et se terminent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Les commandes git sont préfixées par `rtk`.

## Review Focus

1. Une ligne déjà envoyée en partie (100 000 reçus, 30 000 envoyés) compte pour 70 000, pas 100 000 → TC-224-11.
2. Une ligne refusée par le serveur ne compte pas, et une ligne livrée deux fois compte une fois → TC-224-12.
3. Une ligne sans `resteAuSiege` (forme inattendue) compte `montant − envoyeAuSiege`, jamais 0. Un zéro gonflerait le total → TC-224-13.
4. Le Total caisse ne bouge pas à la réception d'un remboursement : stock + M et reste M s'annulent → TC-224-14.
5. La barre des soldes passe bien la part siège. Un oubli du câblage laisserait les tests purs verts → test de composant sur `total-caisse` (Tâche 1, Step 1c).

---

### Task 1: Le Total caisse retire l'argent du siège

**Files:**
- Modify : `src/utils/caisse.js` (`sommesEnAttente`, `totalCaisse` et leurs commentaires)
- Modify : `src/components/network/NetworkCardsDrawer.jsx:51-56`
- Modify : `src/lib/ia/caisse.js` (`lireLaCaisse`, description de `DECLARATION_CAISSE`)
- Modify : `src/lib/ia/prompt.js:145-167` (une puce sur le remboursement au siège)
- Test : `tests/unit/tc-224-total-caisse.test.js`, `tests/unit/tc-314-ia-caisse-et-reserves.test.js`, et le test de composant du total (TC-101 si son harnais accepte des non terminées, sinon NetworkCardsDrawer directement)

**Interfaces:**
- Produces :
  - `sommesEnAttente(transactions) → { depots, retraits, nbDepots, nbRetraits, siege, nbSiege }` ;
  - `totalCaisse({ stock, liquidite, depots, retraits, siege })`, avec `siege` à 0 par défaut ;
  - `lireLaCaisse(...)` renvoie en plus `remboursements_siege_non_envoyes: { nombre, montant }`.

- [ ] **Step 1a : tests rouges, TC-224.** Ligne type :

  ```js
  { id, type: 'Remb. siège', statut: 'Non Terminées', montant, envoyeAuSiege, resteAuSiege }
  ```

  - `[TC-224-10]` une ligne de 100 000 non envoyée, avec un dépôt et un retrait → `siege: 100000, nbSiege: 1`, et `depots`/`retraits` inchangés.
  - `[TC-224-11]` reçue 100 000, envoyée 30 000, reste 70 000 → `siege: 70000`.
  - `[TC-224-12]` la même ligne deux fois → compte une fois. Une ligne `envoi: { etat: REFUSEE }` → 0.
  - `[TC-224-13]` sans `resteAuSiege`, `montant: 100000, envoyeAuSiege: 40000` → `siege: 60000`.
  - `[TC-224-14]` `totalCaisse({ stock: 1100000, liquidite: 500000, siege: 100000 })` vaut `totalCaisse({ stock: 1000000, liquidite: 500000 })`, soit 1 500 000.
- [ ] **Step 1b : test rouge, TC-314 `[CR-13]`.** `lireLaCaisse` avec une ligne Remb. siège de reste 70 000 :
  - `remboursements_siege_non_envoyes` vaut `{ nombre: 1, montant: 70000 }` ;
  - `total_caisse` est diminué de 70 000.

  CR-10 reste vert si l'on étend son `toEqual` de `remboursements_siege_non_envoyes: { nombre: 0, montant: 0 }`. C'est une extension délibérée, à noter au commit.
- [ ] **Step 1c : test rouge, composant.** La barre affiche un `total-caisse` diminué du reste d'une ligne Remb. siège non terminée.
- [ ] **Step 2 :** lancer `npx vitest run tests/unit/tc-224-total-caisse.test.js tests/unit/tc-314-ia-caisse-et-reserves.test.js` et le fichier du composant. Attendu : FAIL sur les nouveaux cas.
- [ ] **Step 3 : implémenter.**
  - Reste d'une ligne : `resteAuSiege` s'il est numérique, sinon `max(0, montant − envoyeAuSiege)`. Le type est reconnu par `estRembSiege` (`src/utils/rembSiege.js`).
  - `NetworkCardsDrawer` et `lireLaCaisse` passent `siege`.
  - `prompt.js` : une puce dit qu'un remboursement au siège non terminé fait entrer l'argent de l'agent, qui appartient au siège, et que le total caisse le retire jusqu'à son envoi.
- [ ] **Step 4 :** relancer. Attendu : PASS, ainsi que `tests/unit/tc-389-remb-siege-lecteurs.test.js`.
- [ ] **Step 5 : commit** `fix: le total caisse ne compte plus l argent qui part au siege`.

### Task 2: Le bleu ciel et la case du tableau

**Files:**
- Modify : `src/index.css` (les deux jetons après `outflow`, et leur contraste dans l'en-tête : siege 5,32:1)
- Modify : `tests/unit/tc-324-jetons-de-couleur.test.js` (`'siege'` dans `FAMILLES_C2EGF`)
- Modify : `src/utils/constants.js:81-86` (`text-siege`, `bg-siege-soft`)
- Modify : `src/components/clients/LigneHistorique.jsx:72` (`text-siege`)
- Modify : `src/components/transactions/TransactionForm.jsx:541` (`border-siege bg-siege-soft`)
- Modify : `src/components/transactions/TransactionTable.jsx` (la case après celle des retraits, si `REMB_SIEGE_ACTIF`)
- Test : `tests/components/tc-388-remb-siege-tableau.test.jsx`, `tests/components/tc-260-ligne-historique.test.jsx`, `tests/components/tc-387-remb-siege-formulaire.test.jsx`

**Interfaces:**
- Consumes : `sommesEnAttente(...).siege` et `.nbSiege` (Tâche 1).
- Produces : les classes `text-siege`, `bg-siege-soft`, `border-siege`, et les testid `case-siege-non-terminees`, `nombre-siege-non-terminees` et `total-siege-non-terminees`.

- [ ] **Step 1 : tests rouges.**
  - `[TC-388-12]` avec la ligne A (reste 150 000) et la ligne B (reste 200 000) : `nombre-siege-non-terminees` vaut 2, `total-siege-non-terminees` contient `Remb. siège` et 350 000.
  - `[TC-388-13]` la cellule du type de A porte `text-siege`.
  - `[TC-260-RS3]` le type d'une ligne Remb. siège porte `text-siege`.
  - `[TC-387-RS]` la nature « Remb. siège » choisie porte `border-siege`.
- [ ] **Step 2 :** lancer les trois fichiers et `tests/unit/tc-324-jetons-de-couleur.test.js`. Attendu : FAIL sur les nouveaux cas.
- [ ] **Step 3 : implémenter.**
  - La case reprend exactement le dessin de celle des retraits, avec `text-siege`, `border-siege/30` et `bg-siege-soft`.
  - Le commentaire « Deux totaux » devient « Trois totaux » et dit ce que compte la troisième : le reste à envoyer.
- [ ] **Step 4 :** relancer. Attendu : PASS.
- [ ] **Step 5 : commit** `feat: le remboursement au siege en bleu ciel, avec sa case au-dessus des non terminees`.

### Task 3: Vérifier et rendre compte

- [ ] `npm run quality:check:full`. Attendu : tout vert, code 0.
- [ ] Essai sur les émulateurs (`npm run emulateurs` et le front en mode développement) : saisir un remboursement de 100 000 en Non Terminées, puis vérifier :
  - le Total caisse est inchangé ;
  - la case vaut 1 / 100 000 ;
  - une tranche de 30 000 donne une case à 70 000, avec un total toujours inchangé ;
  - capture d'écran.
- [ ] Une ligne dans `audit/BILAN.md`, section du remboursement au siège. Commit `docs: bilan, bleu ciel et total caisse`.
