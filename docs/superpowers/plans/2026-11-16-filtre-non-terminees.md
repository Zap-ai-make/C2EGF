# Filtre des non terminées par nature — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les cases au-dessus des non terminées deviennent des boutons qui filtrent le tableau par nature. « Tout » vient en premier et est choisi par défaut.

**Architecture:**
- Une fonction pure `natureEnAttente` (`src/utils/caisse.js`) dit la nature d'une ligne. Les sommes des cases et le filtre la partagent.
- `TransactionTable` filtre ses lignes avant `regrouperParClientEtType`. Les cases continuent de compter toutes les lignes.

**Tech Stack:** React 19, Tailwind v4, Vitest et Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-filtre-non-terminees-design.md`

## Global Constraints

- L'ordre des boutons est `Tout`, `Dépôts`, `Retraits`, `Remb. siège`. `Remb. siège` n'apparaît que si `REMB_SIEGE_ACTIF` est vrai.
- « Tout » est choisi par défaut.
- Le groupe a pour nom accessible `Filtrer par nature`. Chaque bouton porte `aria-pressed`.
- On garde les identifiants de test existants : `case-*`, `nombre-*` et `total-*-non-terminees`. Ils sont lus par TC-223, TC-238 et TC-388.
- Le changement est front seul : aucun fichier sous `functions/`.
- Les messages de commit sont en ASCII français et finissent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Les commandes git passent par `rtk`.

## Review Focus

1. Une ligne refusée par le serveur est visible dans sa nature filtrée, puisqu'elle reste à retirer, mais elle ne compte pas dans les cases → `[TC-391-8]`.
2. Deux dépôts du même client restent regroupés sous le filtre « Dépôts » → `[TC-391-9]`.
3. La dernière ligne de la nature choisie disparaît : le tableau repasse à « Tout » au lieu de rester vide → `[TC-391-6]`.
4. Avec le drapeau du profil éteint, il n'y a que trois boutons → `[TC-391-10]`.
5. Une case à 0 ne se clique pas, mais « Tout » se clique toujours → `[TC-391-5]`.

---

### Task 1: Une seule lecture de la nature d'une ligne

**Files:**
- Modify : `src/utils/caisse.js` (exporter `natureEnAttente`, et l'employer dans `sommesEnAttente`)
- Test : `tests/unit/tc-224-total-caisse.test.js`

**Interfaces:**
- Produces : `natureEnAttente(transaction) → 'depot' | 'retrait' | 'siege' | null`.

- [ ] **Step 1 : test rouge `[TC-224-15]`.**
  - `'Dépôt'`, `'Depot'` et `'DEPOT'` donnent `'depot'`.
  - `'retrait'` donne `'retrait'`.
  - `'Remb. siège'` donne `'siege'`.
  - `'Ravitaillement'` donne `null`, de même que `null` et `{}`.
- [ ] **Step 2 :** `npx vitest run tests/unit/tc-224-total-caisse.test.js`. Attendu : FAIL, car `natureEnAttente` n'est pas exportée.
- [ ] **Step 3 :** implémenter avec `normaliser` et `estRembSiege`, puis réécrire la boucle de `sommesEnAttente` sur `natureEnAttente`, sans changer une somme.
- [ ] **Step 4 :** relancer TC-224, TC-389 et TC-390. Attendu : PASS. Les cas existants TC-224-1 à 14 sont le filet du remaniement.
- [ ] **Step 5 : commit** `refactor: une seule lecture de la nature d une non terminee`.

### Task 2: Les cases filtrent le tableau

**Files:**
- Modify : `src/components/transactions/TransactionTable.jsx` (les cases ; `rangees` construites sur les lignes filtrées)
- Test, nouveau : `tests/components/tc-391-filtre-non-terminees.test.jsx`. Les mocks sont ceux de `tc-388`, drapeau compris.

**Interfaces:**
- Consumes : `natureEnAttente` (Tâche 1), `sommesEnAttente(...).nbDepots/nbRetraits/nbSiege`.
- Produces : les boutons `filtre-tout`, puis `case-depots-…`, `case-retraits-…` et `case-siege-non-terminees`, qui deviennent des `<button>`. Le compte de « Tout » porte l'identifiant `nombre-tout-non-terminees`.

**Fixtures :**
- D1 : dépôt, client KABORE ;
- R1 : retrait, client SANOU ;
- S1 et S2 : Remb. siège, clients OUEDRAOGO et ZONGO.

Toutes en `Non Terminées`. Les noms des clients servent à lire les lignes affichées.

- [ ] **Step 1 : tests rouges.**
  - `[TC-391-1]` les boutons du groupe `Filtrer par nature` sont, dans l'ordre, Tout, Dépôts, Retraits et Remb. siège. « Tout » porte `aria-pressed="true"`, et les 4 clients s'affichent.
  - `[TC-391-2]` un clic sur Retraits ne laisse que SANOU. Retraits passe à `aria-pressed="true"` et Tout à `false`. `nombre-depots-non-terminees` vaut toujours 1.
  - `[TC-391-3]` un nouveau clic sur Retraits ramène les 4 clients, avec Tout enfoncé.
  - `[TC-391-4]` Remb. siège, puis Tout, ramène les 4 clients.
  - `[TC-391-5]` sans dépôt dans les données, la case Dépôts est `disabled`. Tout ne l'est pas.
  - `[TC-391-6]` avec Retraits choisi, un nouveau rendu sans R1 enfonce Tout et affiche les 3 clients restants.
  - `[TC-391-7]` `nombre-tout-non-terminees` vaut 4. La case Tout ne contient pas de montant (`/\d{3}\s?\d{3}/` absent).
  - `[TC-391-8]` un dépôt refusé (`envoi: { etat: REFUSEE }`, client TRAORE) s'affiche avec le filtre Dépôts. `nombre-depots` vaut 1 : la ligne refusée n'est pas comptée.
  - `[TC-391-9]` deux dépôts de KABORE, filtre Dépôts : la ligne de groupe `× 2` est présente.
  - `[TC-391-10]` avec le drapeau éteint, il reste trois boutons : Tout, Dépôts et Retraits.
- [ ] **Step 2 :** `npx vitest run tests/components/tc-391-filtre-non-terminees.test.jsx`. Attendu : FAIL, puisque les cases ne sont pas encore des boutons.
- [ ] **Step 3 : implémenter.**
  - L'état `filtre` part de `'tout'`.
  - Le filtre effectif est dérivé : une nature choisie dont le compte vaut 0 vaut `'tout'`. Un effet remet `filtre` à `'tout'` dans ce cas, pour qu'il ne se rallume pas en silence plus tard.
  - Recliquer la nature choisie revient à `'tout'`.
  - Choisie, une case prend `ring-2` dans sa teinte. Les autres prennent `opacity-60`.
  - « Tout » a la teinte neutre `ink` / `line` / `surface`, et pas de montant.
  - Une case à 0 est `disabled`. L'état vide « Aucune transaction en attente » se décide toujours sur la liste complète.
- [ ] **Step 4 :** relancer TC-391, puis TC-388, TC-223 et TC-238, qui lisent les identifiants des cases. Attendu : PASS.
- [ ] **Step 5 : commit** `feat: les cases au-dessus des non terminees filtrent le tableau par nature`.

### Task 3: Vérifier et rendre compte

- [ ] Lancer `npm run quality:check:full`. Attendu : vert.
- [ ] Essai sur émulateurs, sur un front lancé à part sur le port 5199 : un dépôt, un retrait et un remboursement en Non Terminées. Cliquer chaque case et vérifier les lignes, puis prendre deux captures, à 1440 px et 390 px. Arrêter ensuite ses processus, y compris les enfants Windows (vérifier par la ligne de commande), sans toucher aux émulateurs d'un autre dossier.
- [ ] Ajouter une ligne dans `audit/BILAN.md`, section du remboursement au siège, et une étape dans la fiche d'aide 8 (`src/content/aideFiches.js`) : « Touche une case pour ne voir que cette nature ; {{Tout}} remet toute la liste. » TC-225 exige que `{{Tout}}` existe à l'écran. Commit `docs: bilan et aide, filtre des non terminees`.
