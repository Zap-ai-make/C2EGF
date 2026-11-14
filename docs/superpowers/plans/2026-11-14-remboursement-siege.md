# Remboursement au siège — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** la caissière enregistre, au nom de l'agent, l'argent qu'il rapporte pour le siège (troisième nature « Remb. siège » du formulaire) et l'envoi de cet argent au siège (bouton « Envoyer au siège » sur la ligne en attente), avec des soldes qui suivent sa caisse réelle.

**Architecture :** une famille d'opérations à part, sur le modèle du ravitaillement : quatre actions nouvelles dans `storeTransactionCommand`, une arithmétique pure d'une réserve à la fois (`applyReplenishmentImpact` / `applyReplenishmentReturnImpact`), des lignes en attente dans `drafts` (déjà écouté), une opération de file `remb_siege`. Le moteur des dépôts et retraits ne change pas ; ses commandes apprennent seulement à refuser une ligne « Remb. siège ».

**Tech Stack :** React 19, Vite 8, Vitest 5, Firebase 13 / firebase-admin 14, Cloud Functions gen2 (Node 22), émulateurs `demo-akayis-test`.

**Spec :** [docs/superpowers/specs/2026-11-14-remboursement-siege-design.md](../specs/2026-11-14-remboursement-siege-design.md)

## Global Constraints

- Branche `feat/remboursement-siege`, créée depuis `feat/espace-patron`. **Jamais de push** sans demande explicite (un push de `feat/espace-patron` part en production).
- Préfixer toute commande git par `rtk`. Messages de commit en français ASCII, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ne jamais lire `.env`, `.env.development.local`, `.env.vercel`. Émulateurs `demo-*` uniquement. Ne jamais déployer.
- Ne jamais commiter : `audit/*.mjs|json|png`, `METHODE-REFONTE-DESIGN.md`, `vercel-env.ps1`, `.vitest/`.
- Le type s'écrit **`'Remb. siège'`**, une seule chaîne partout (données, libellé, tests).
- Champs propres : `balanceType` (`'stock' | 'liquidite'`), `envoyeAuSiege`, `resteAuSiege`, `envoisSiege` (≤ 50). **Jamais** `remainingAmount`, `paidAmount` ni aucun champ de `SETTLEMENT_FIELDS` sur ces lignes.
- `'Remb. siège'` n'entre **pas** dans `transactions.types` du profil ni dans `STORE_TRANSACTION_TYPES`.
- Réseau d'une ligne : `STORE_NETWORKS[0]` au serveur, `NETWORK_OPTIONS[0]` au navigateur ; jamais pris de la charge utile.
- Libellés exacts : nature « Remb. siège » ; réserves « Stock » / « Espèce » (`libelleVase`) ; bouton « Envoyer au siège » ; raison « Stock insuffisant : utilisez Non Terminées. » ; refus générique « Une ligne « Remb. siège » se traite par ses propres boutons. »
- Toute refus serveur est un `DealerRequestError` (code en majuscules), jamais un `Error` nu : la file prend un `Error` nu pour une panne et le renvoie toutes les 30 s, en bloquant les opérations suivantes.
- Commandes de test :
  - unitaires : `npx vitest run --config vitest.config.js <fichier>`
  - composants : idem, fichiers sous `tests/components`
  - functions : `firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js <fichier>"`

## Review Focus

1. **Une application pas encore rechargée** (PWA en cache) voit une ligne « Remb. siège » et propose « Modifier » ou « Annuler » génériques : le serveur doit répondre par un refus **définitif** (`STORE_TRANSACTION_INVALID`), sans toucher aux soldes. Aujourd'hui `deleteDraft`/`trashDraft`/`trashHistory` lèvent un `Error` nu, qui bloquerait la file. → Tâche 5, tests `[TC-381-G*]` (code exact).
2. **Le front déployé avant les functions** : `addSiegeRepayment` est inconnu, la saisie est refusée. La caissière doit voir le refus **sur sa ligne**, avec la raison. → Tâche 7, test `[TC-386-6]`.
3. **Double clic** sur « Valider » ou « Confirmer l'envoi » : une seule opération. → Tâche 9 `[TC-387-8]`, Tâche 10 `[TC-388-5]`.
4. **Deux tranches hors ligne** : le plafond de la seconde lit le reste **après** la première. → Tâche 7, `[TC-386-3]`.
5. **Modifier une ligne « Remb. siège »** ne doit pas permettre d'en changer la nature (Dépôt, Retrait), ni l'inverse. → Tâche 9, `[TC-387-7]`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `config/clients/_pilot.js`, `config/clients/c2egf-burkina.js` | drapeau `siegeRepayment.enabled` |
| `scripts/lib/generateStoreProfile.mjs` → `functions/src/config/storeProfile.js` (généré) | `SIEGE_REPAYMENT_ENABLED` |
| `functions/src/storeTransactions/rembSiege.js` (nouveau) | constantes et arithmétique pure, serveur |
| `functions/src/storeTransactions/storeTransactionCommand.js` | les quatre actions, les gardes des brouillons |
| `functions/src/settlements/addTransactionPayment.js`, `addTransactionRefund.js` | gardes |
| `src/utils/rembSiege.js` (nouveau) | constantes, évaluation du formulaire, préparation, plafond d'envoi, effets provisoires — navigateur |
| `src/services/fileEnvoi.js`, `src/services/envois.js`, `src/utils/envoisEnAttente.js` | opération de file `remb_siege` |
| `src/context/transactions.jsx` | `ajouterRembSiege`, `envoyerAuSiege`, `modifierRembSiege`, routage de `trashTransaction` |
| `src/components/transactions/TransactionForm.jsx` | nature, « Reçu en », envoi |
| `src/utils/helpers.js`, `src/components/transactions/TransactionTable.jsx` | actions et ligne en attente |
| `src/components/historique/HistoriqueTable.jsx`, `src/utils/constants.js` | ligne validée, libellé, teinte |
| `src/services/chiffreAffairesService.js`, `functions/src/dealerMetrics/listOutstandingDrafts.js`, `functions/src/clients/historiqueClient.js`, `functions/src/oxygen/pointEntreeOxygen.js` | lecteurs |

---

### Task 1 : Caractérisation des gestes génériques sur une ligne « Remb. siège »

AGENTS.md : « Jamais modifier une règle métier sans test de caractérisation qui fige le comportement d'avant. » Ce fichier fige ce que font AUJOURD'HUI les commandes que la tâche 5 va garder ; la tâche 5 en retournera les assertions, et le diff montrera le changement.

**Files :**
- Create : `tests/functions/tc-381-remb-siege-gestes-generiques.test.js`

**Interfaces :**
- Consumes : `storeTransactionCommandHandler`, `addTransactionPaymentHandler` (même montage que `tc-227` et `tc-357` : utilisateur `store_admin`, boutique active, soldes `Orange: { stock: 500_000, liquidite: 300_000 }`).
- Produces : les helpers du fichier, `poserBrouillonRembSiege()` et `poserLigneRembSiegeValidee()`, réutilisés par la tâche 5.

- [ ] **Step 1 : écrire les tests.** Documents posés directement par l'Admin SDK :
  - brouillon `drafts/rs-1` : `{ type: 'Remb. siège', balanceType: 'liquidite', montant: 100_000, envoyeAuSiege: 0, resteAuSiege: 100_000, envoisSiege: [], reseau: 'Orange', statut: 'Non Terminées', clientId: 'agent-1', storeId }`
  - ligne `history/rs-2` : la même, `statut: 'Validée'`, `directValidation: true`, `envoyeAuSiege: 100_000`, `resteAuSiege: 0`.

  | Test | Appel | Constat figé |
  |---|---|---|
  | `[TC-381-C1]` | `add` avec `transaction.type = 'Remb. siège'` | rejet, `code === 'STORE_TRANSACTION_INVALID'`, soldes inchangés |
  | `[TC-381-C2]` | `updateDraft rs-1 { montant: 90_000 }` | rejet `STORE_TRANSACTION_INVALID` |
  | `[TC-381-C3]` | `deleteDraft rs-1` | rejet, message `'Type de transaction non reconnu.'`, `code` indéfini |
  | `[TC-381-C4]` | `trashDraft rs-1` | idem C3 |
  | `[TC-381-C5]` | `validateDraft rs-1` sans `direct` ni méthode | **résout** `{ validated: true }`, soldes inchangés, ligne d'historique `statut: 'Validée'` |
  | `[TC-381-C6]` | `addTransactionPayment rs-1 Orange Money 10_000` | **résout**, stock `+10_000` |
  | `[TC-381-C7]` | `trashHistory rs-2` | rejet `'Type de transaction non reconnu.'`, `code` indéfini |
  | `[TC-381-C8]` | `cancelHistory rs-2` | idem C7 |

  Si un constat observé diffère de ce tableau, figer **l'observé**, et le signaler dans le compte rendu de la tâche.

- [ ] **Step 2 : lancer.** `firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-381-remb-siege-gestes-generiques.test.js"` → 8 PASS.
- [ ] **Step 3 : lancer toute la suite functions** (`npm run test:functions`) et noter le total : c'est la ligne de base.
- [ ] **Step 4 : commit** `test: caracteriser les gestes generiques sur une ligne Remb. siege`.

---

### Task 2 : Le drapeau de profil

**Files :**
- Modify : `config/clients/_pilot.js` (un bloc nommé et commenté, après `replenishment`), `config/clients/c2egf-burkina.js`, `scripts/lib/generateStoreProfile.mjs`
- Regenerate : `functions/src/config/storeProfile.js`
- Create : `tests/unit/tc-382-remb-siege-profil.test.js`

**Interfaces :**
- Produces : `profile.siegeRepayment.enabled: boolean` ; `export const SIEGE_REPAYMENT_ENABLED` dans `functions/src/config/storeProfile.js`.

- [ ] **Step 1 : tests.** `[TC-382-1]` `resolveProfile('_pilot').siegeRepayment.enabled === false` ; `[TC-382-2]` `resolveProfile('c2egf_burkina').siegeRepayment.enabled === true` ; `[TC-382-3]` `generateStoreProfileFile(resolveProfile('c2egf_burkina'))` contient `export const SIEGE_REPAYMENT_ENABLED = true` et `_pilot` `= false` ; `[TC-382-4]` un profil avec `siegeRepayment.enabled: 'oui'` fait lever `generateStoreProfileFile` (même contrôle que `cashier.canEditBalances`).
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter.** `_pilot.js` : `siegeRepayment: Object.freeze({ enabled: false })` avec un commentaire (le siège donne du stock à crédit la nuit ; la boutique encaisse le remboursement et l'envoie ; voir la spec). `c2egf-burkina.js` : `enabled: true`. Générateur : lire `profile?.siegeRepayment?.enabled ?? false`, lever si non booléen, émettre la constante avec une ligne de documentation dans l'en-tête généré.
- [ ] **Step 4 : régénérer** `node scripts/generate-functions-config.mjs --client c2egf_burkina`, puis `npm run check:generated` → OK ; `[TC-382-*]` et `tests/unit/tc-110-collaborations-profile-config.test.js` → PASS.
- [ ] **Step 5 : commit** `feat: drapeau de profil du remboursement au siege`.

---

### Task 3 : L'arithmétique du serveur

**Files :**
- Create : `functions/src/storeTransactions/rembSiege.js`, `tests/unit/tc-383-remb-siege-impacts-serveur.test.js`

**Interfaces :**
- Consumes : `applyReplenishmentImpact(balances, network, field, amount)` et `applyReplenishmentReturnImpact(...)` de `../settlements/financialUtils.js`.
- Produces :
  ```js
  export const TYPE_REMB_SIEGE = 'Remb. siège'
  export const MESSAGE_GESTE_GENERIQUE = 'Une ligne « Remb. siège » se traite par ses propres boutons.'
  export const ENVOIS_MAX = 50
  export function estRembSiege(doc)                                   // → boolean, doc?.type === TYPE_REMB_SIEGE
  export function impactSaisie(balances, network, { statut, balanceType, montant })        // → balances
  export function impactEnvoi(balances, network, montant)                                  // → balances
  export function impactAnnulation(balances, network, { balanceType, montant, envoyeAuSiege }) // → balances
  export function impactModification(balances, network, avant, apres)                      // → balances
  ```

- [ ] **Step 1 : tests** (soldes de départ `Orange: { stock, liquidite }` donnés dans chaque test) :
  - `[TC-383-1]` saisie en attente, Stock, 100 000 → stock +100 000, espèce inchangée.
  - `[TC-383-2]` saisie en attente, Espèce, 100 000 → espèce +100 000, stock inchangé.
  - `[TC-383-3]` saisie validée, Stock, 100 000, **stock à 0** → `{ stock: 0 }`, aucune levée.
  - `[TC-383-4]` saisie validée, Espèce, 100 000, stock 300 000 → stock 200 000, espèce +100 000.
  - `[TC-383-5]` saisie validée, Espèce, 100 000, stock 50 000 → lève, `code === 'INSUFFICIENT_STORE_BALANCE'`.
  - `[TC-383-6]` envoi 60 000, stock 50 000 → lève `INSUFFICIENT_STORE_BALANCE`.
  - `[TC-383-7]` annulation `{ liquidite, 100 000, envoye 60 000 }` → stock +60 000, espèce −100 000.
  - `[TC-383-8]` annulation `{ stock, 100 000, envoye 0 }` → stock −100 000 (la jambe +0 est sautée, pas de levée « montant invalide »).
  - `[TC-383-9]` annulation `{ stock, 100 000, envoye 100 000 }` avec stock à 0 → stock 0 (le + passe avant le −).
  - `[TC-383-10]` modification `{ stock, 100 000 }` → `{ liquidite, 80 000 }` → stock −100 000, espèce +80 000.
  - `[TC-383-11]` `estRembSiege({ type: 'Remb. siège' })` vrai ; `{ type: 'Dépôt' }` faux ; `null` faux.
- [ ] **Step 2 : lancer** → FAIL (module absent).
- [ ] **Step 3 : implémenter.** `statut` accepte les deux graphies de `PENDING`/`VALIDATED` de `storeTransactionCommand.js`. Ordre des jambes : saisie validée `+balanceType` puis `−stock` ; annulation `+stock envoyé` (si > 0) puis `−balanceType montant` ; modification `+après` puis `−avant`. Un commentaire d'en-tête dit pourquoi l'ordre compte (le + d'abord : seul le net peut refuser).
- [ ] **Step 4 : lancer** → 11 PASS.
- [ ] **Step 5 : commit** `feat: arithmetique du remboursement au siege, cote serveur`.

---

### Task 4 : Les quatre actions du serveur

**Files :**
- Modify : `functions/src/storeTransactions/storeTransactionCommand.js` (blocs après `trashReplenishmentReturn`, avant `fail('… Commande inconnue.')`)
- Create : `tests/functions/tc-384-remb-siege-commandes.test.js`

**Interfaces :**
- Consumes : Task 3 ; `SIEGE_REPAYMENT_ENABLED` (Task 2) ; helpers locaux `cleanId`, `cleanAmount`, `fail`, `empilerModification`, `datation`, `recu`, `faitLe`, `commandeId`.
- Produces (charges utiles du callable `storeTransactionCommand`) :
  - `{ action: 'addSiegeRepayment', transaction: { client?, clientId, code?, montant, balanceType, statut } }` → `{ id }`
  - `{ action: 'sendToSiege', draftId, amount }` → `{ sent: true, resteAuSiege, historyId? }`
  - `{ action: 'updateSiegeRepayment', draftId, updates: { montant?, balanceType?, client?, clientId?, code? } }` → `{ id }`
  - `{ action: 'trashSiegeRepayment', draftId }` ou `{ action: 'trashSiegeRepayment', historyId }` → `{ trashed: true, historyId }`
  - Chacune accepte `commandeId` et `ageMs`, et répond `{ …, idempotent: true }` au second passage.

- [ ] **Step 1 : tests.** Même montage que `tc-227` (`STOCK_INITIAL = 500_000`, `LIQUIDITE_INITIALE = 300_000`, helper `poserSoldes`).

  *Saisie*
  - `[TC-384-1]` cas 1 : stock posé à 0, Stock, Validée, 100 000 → résout ; soldes `{ 0, 300 000 }` ; `history/{id}` porte `type 'Remb. siège'`, `statut 'Validée'`, `directValidation true`, `envoyeAuSiege 100 000`, `resteAuSiege 0`, `clientId`.
  - `[TC-384-2]` cas 2 : Espèce, Validée, 100 000 → `{ 400 000, 400 000 }`.
  - `[TC-384-3]` cas 2b : stock posé à 50 000, Espèce, Validée → rejet `INSUFFICIENT_STORE_BALANCE`, soldes et collections inchangés.
  - `[TC-384-4]` Espèce, Non Terminées, 100 000 → `drafts/{id}` avec `envoyeAuSiege 0`, `resteAuSiege 100 000`, `envoisSiege []` ; espèce +100 000, stock inchangé ; **aucun** champ de `SETTLEMENT_FIELDS` sur le document.
  - `[TC-384-5]` `balanceType` absent ou `'banque'` → rejet `STORE_TRANSACTION_INVALID`.
  - `[TC-384-6]` le réseau envoyé dans la charge est ignoré : la ligne porte `'Orange'`.
  - `[TC-384-7]` rejouée avec le même `commandeId` → `idempotent: true`, soldes comptés une fois.

  *Envoi*
  - `[TC-384-8]` cas 3 : saisie Espèce Non Terminées 100 000, envoi 60 000, envoi 40 000 → stock −60 000 puis −40 000 ; après le second, `drafts/{id}` n'existe plus et `history/{id}` (même id) porte `statut 'Validée'`, `envoyeAuSiege 100 000`, `resteAuSiege 0`, deux entrées `envoisSiege` aux montants 60 000 et 40 000.
  - `[TC-384-9]` cas 4 : Stock Non Terminées 100 000, envoi 100 000 → stock +100 000 puis −100 000.
  - `[TC-384-10]` envoi supérieur au reste → rejet `STORE_TRANSACTION_INVALID`, message contenant le reste.
  - `[TC-384-11]` envoi au-delà du stock → rejet `INSUFFICIENT_STORE_BALANCE`.
  - `[TC-384-12]` envoi sur un brouillon Dépôt → rejet `STORE_TRANSACTION_INVALID`.
  - `[TC-384-13]` envoi rejoué (même `commandeId`), y compris celui qui a soldé la ligne → `idempotent: true`, stock débité une fois.
  - `[TC-384-14]` envoi final quand `history/{draftId}` porte déjà une autre ligne → rejet `IDEMPOTENCY_CONFLICT`.

  *Modification*
  - `[TC-384-15]` Stock 100 000 → Espèce 80 000 → stock −100 000, espèce +80 000 ; `resteAuSiege 80 000` ; `modifications` a une entrée `{ avant: 100 000, apres: 80 000 }`.
  - `[TC-384-16]` après un envoi → rejet `SETTLED_DRAFT_IMMUTABLE`.

  *Annulation*
  - `[TC-384-17]` cas A : Espèce Non Terminées 100 000, envoi 60 000, annulation → stock +60 000, espèce −100 000 ; le brouillon est parti ; une ligne `history` `statut 'Supprimée'`, `origin 'draft'`.
  - `[TC-384-18]` annulation d'une ligne validée (cas 2) → soldes de départ ; `statut 'Supprimée'`, `origin 'history'`.
  - `[TC-384-19]` espèce dépensée entre-temps (liquidité posée à 0) → rejet `INSUFFICIENT_STORE_BALANCE`, rien n'a bougé.
  - `[TC-384-20]` annulation rejouée → `idempotent: true`.

  *Drapeau*
  - `[TC-384-21]` avec `SIEGE_REPAYMENT_ENABLED` faux (`vi.mock('../../functions/src/config/storeProfile.js', …)` en gardant les autres exports), chacune des quatre actions est refusée `STORE_TRANSACTION_INVALID`.
- [ ] **Step 2 : lancer** → FAIL (« Commande inconnue. »).
- [ ] **Step 3 : implémenter.** `cleanRembSiege(input)` à côté de `cleanTransaction` : même nettoyage du client, de `clientId`, de `code` et du montant ; `balanceType ∈ {'stock','liquidite'}` (message « Reçu en : Stock ou Espèce. ») ; `statut` ramené à `'Non Terminées'` ou `'Validée'`. Le drapeau se contrôle avant tout calcul. Chaque action lit tout avant d'écrire ; vérifie `commandeId` **avant** l'impact ; écrit une entrée `auditLogs` avec soldes avant/après. `sendToSiege` empile `{ id: commandeId ?? <id généré>, montant, at: faitLe ?? new Date(), by: uid, byName }` dans `envoisSiege` (`slice(-ENVOIS_MAX)`), et à reste nul déplace la ligne vers `history/{draftId}`, comme `addTransactionPayment`. `updateSiegeRepayment` reconnaît son rejeu par `derniereCommande`, comme `updateDraft`. `trashSiegeRepayment` suit `trashDraft` (brouillon → corbeille dans `history`) et `trashHistory` (ligne validée → `statut 'Supprimée'`).
- [ ] **Step 4 : lancer** `tc-384` → 21 PASS, puis `npm run test:functions` → ligne de base + 21, aucun échec.
- [ ] **Step 5 : commit** `feat: commandes du remboursement au siege`.

---

### Task 5 : Les gardes des gestes génériques

**Files :**
- Modify : `functions/src/storeTransactions/storeTransactionCommand.js` (`updateDraft`, `deleteDraft`, `validateDraft`, `trashDraft`, `UNCANCELLABLE_TYPES`), `functions/src/settlements/addTransactionPayment.js`, `functions/src/settlements/addTransactionRefund.js`
- Modify : `tests/functions/tc-381-remb-siege-gestes-generiques.test.js`

**Interfaces :**
- Consumes : `estRembSiege`, `MESSAGE_GESTE_GENERIQUE`, `TYPE_REMB_SIEGE` (Task 3).

- [ ] **Step 1 : retourner les tests.** C1 inchangé. C2 à C8 deviennent `[TC-381-G2]` … `[TC-381-G8]` : chacun rejette avec `code === 'STORE_TRANSACTION_INVALID'`, les soldes et les deux documents sont inchangés. Message exact : `MESSAGE_GESTE_GENERIQUE` pour G2 à G6 ; pour G7 et G8, `« Remb. siège »` figure dans le message. Ajouter `[TC-381-G9]` : `addTransactionRefund` sur `rs-1` → rejet `STORE_TRANSACTION_INVALID`.
- [ ] **Step 2 : lancer** → FAIL sur G2 à G9.
- [ ] **Step 3 : implémenter.** Dans les quatre commandes de brouillon, juste après la lecture du document (et après la reconnaissance d'un rejeu pour `validateDraft`) : `if (estRembSiege(doc)) fail('STORE_TRANSACTION_INVALID', MESSAGE_GESTE_GENERIQUE)`. Ajouter `TYPE_REMB_SIEGE` à `UNCANCELLABLE_TYPES` (couvre `cancelHistory`, `trashHistory`, `reopenHistory`, `correctHistory`). Dans les deux callables de règlement, après `const draft = draftSnap.data()` : `throw new DealerRequestError('STORE_TRANSACTION_INVALID', MESSAGE_GESTE_GENERIQUE)`.
- [ ] **Step 4 : lancer** `tc-381` → PASS, puis `npm run test:functions` → aucun échec.
- [ ] **Step 5 : commit** `fix: les gestes generiques refusent une ligne Remb. siege`.

---

### Task 6 : Les règles du navigateur

**Files :**
- Create : `src/utils/rembSiege.js`, `tests/unit/tc-385-remb-siege-preparation.test.js`
- Modify : `src/utils/preparationTransaction.js` (exporter `aUnCompteSur`, sans changer son corps)

**Interfaces :**
- Consumes : `activeProfile`, `parseFcfaAmount`, `formatCurrency`, `adjustBalanceValue` (`src/utils/financialImpact.js`), `libelleVase` et `montantRetourPropose` (`src/utils/ravitaillement.js`), `preparerTransaction`, `aUnCompteSur`, `reseauxDisponibles`.
- Produces :
  ```js
  export const TYPE_REMB_SIEGE = 'Remb. siège'
  export const REMB_SIEGE_ACTIF                    // activeProfile.siegeRepayment?.enabled === true
  export const RAISON_STOCK_INSUFFISANT = 'Stock insuffisant : utilisez Non Terminées.'
  export function estRembSiege(ligne)              // → boolean
  export function evaluerRembSiege({ client, ambigus, montant, reseau, balanceType, stock })
    // → même forme qu'evaluerTransaction : { isFormValid, stockValidation, networkValidation, actionStates }
  export function preparerRembSiege({ client, reseau, montant, balanceType, statut })
    // → { ok: true, transaction, details } | { ok: false, raison }
    //   transaction = { client, clientId, code, montant, balanceType, statut }
    //   details     = celui de preparerTransaction + { recuEn: libelleVase(balanceType) }
  export function verifierEnvoiSiege({ ligne, montant, stock })
    // → { ok: true, valeur } | { ok: false, motif: 'montant'|'reste'|'stock', raison }
  export function effetRembSiegeSurLesSoldes(soldes, reseau, commande, avant)
    // commande.action ∈ addSiegeRepayment|sendToSiege|updateSiegeRepayment|trashSiegeRepayment
    // avant = { montant, balanceType, envoyeAuSiege } (null pour une saisie) → soldes
  ```

- [ ] **Step 1 : tests.**
  - `[TC-385-1]` `evaluerRembSiege` sans `balanceType` → `isFormValid` faux, raison « Choisissez Stock ou Espèce. ».
  - `[TC-385-2]` Stock, montant 100 000, `stock: 0` → `canValidate` vrai et `canMarkAsNonTermine` vrai.
  - `[TC-385-3]` Espèce, 100 000, `stock: 50_000` → `canValidate` faux, `validateReason === RAISON_STOCK_INSUFFISANT` ; `canMarkAsNonTermine` vrai.
  - `[TC-385-4]` client sans code Orange → même message réseau qu'`evaluerTransaction`.
  - `[TC-385-5]` `preparerRembSiege` → `transaction` exactement `{ client, clientId, code, montant: 100000, balanceType: 'liquidite', statut: 'Non Terminées' }` (ni `type` ni `reseau` : le serveur les pose) et `details.recuEn === 'Espèce'`.
  - `[TC-385-6]` `verifierEnvoiSiege` : `{ resteAuSiege: 100 000 }`, 120 000 → `motif 'reste'` ; stock 50 000, 60 000 → `motif 'stock'`, raison avec « 50 000 » ; `'abc'` → `motif 'montant'` ; 50 000 → `ok`, `valeur: 50000`.
  - `[TC-385-7]` `effetRembSiegeSurLesSoldes` reproduit `[TC-383-1]`, `-4`, `-7`, `-10` côté navigateur (mêmes nombres).
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter** sur le modèle de `ravitaillement.js` (fonctions pures, aucune écriture). Le pré-remplissage de l'envoi est `montantRetourPropose({ reste: ligne.resteAuSiege, disponible: stock })` : pas de fonction nouvelle.
- [ ] **Step 4 : lancer** `tc-385` et `tests/unit/tc-305-preparation-operations.test.js` → PASS.
- [ ] **Step 5 : commit** `feat: regles du remboursement au siege cote navigateur`.

---

### Task 7 : La file d'envoi et le contexte

**Files :**
- Modify : `src/services/fileEnvoi.js` (`export const REMB_SIEGE = 'remb_siege'`, et une ligne dans l'en-tête), `src/services/envois.js` (`executerEnvoi`), `src/utils/envoisEnAttente.js` (`EFFETS_SUR_LES_LIGNES`, `VISIBLES_REFUSEES`, `effetSurLesSoldes`), `src/context/transactions.jsx`
- Create : `tests/unit/tc-386-remb-siege-file.test.js`

**Interfaces :**
- Consumes : Task 6 ; `runStoreTransactionCommand` (`src/services/storeTransactionCommandService.js`).
- Produces :
  - opération de file `{ type: REMB_SIEGE, charge: { commande, reseau, avant? } }`. `commande` est la charge d'une des quatre actions de la Task 4. `executerEnvoi` l'envoie telle quelle : `runStoreTransactionCommand({ ...charge.commande, commandeId: id, ageMs })`.
  - dans `useTransactions()` :
    - `ajouterRembSiege(transaction)` → `{ statut }`
    - `envoyerAuSiege(draftId, montant)` → `{ statut }`
    - `modifierRembSiege(draftId, updates)` → `{ statut }`
  - `trashTransaction(id)` route une ligne « Remb. siège » (en attente ou validée) vers `trashSiegeRepayment`. Identifiant d'opération : `remb_siege-annulation-${id}`.
  - Sans file (`parLaFile` faux), chacune appelle `runStoreTransactionCommand` directement, comme `envoyerMouvement`.

- [ ] **Step 1 : tests** (`appliquerFile` / `soldesProvisoires`, sur le modèle de `tests/unit/tc-360-gestes-en-attente.test.js`) :
  - `[TC-386-1]` saisie Espèce Non Terminées en attente → une non terminée d'id `op.id`, `type 'Remb. siège'`, `resteAuSiege` = montant ; espèce provisoire +montant.
  - `[TC-386-2]` saisie Validée Stock en attente → une ligne d'historique ; soldes provisoires inchangés.
  - `[TC-386-3]` saisie (100 000) puis deux envois en attente (60 000, 40 000) → après le premier, la ligne affiche `resteAuSiege 40 000` et `verifierEnvoiSiege` refuse 50 000 avec `motif 'reste'` ; après le second, la ligne est dans l'historique sous son id.
  - `[TC-386-4]` annulation en attente d'une ligne serveur (100 000 Espèce, envoyé 60 000) → soldes provisoires stock +60 000, espèce −100 000 ; la ligne apparaît `statut 'Supprimée'`.
  - `[TC-386-5]` modification en attente → `montant`, `balanceType` et `resteAuSiege` à jour sur la ligne.
  - `[TC-386-6]` saisie **refusée** (`etat: REFUSEE`, `erreur.message: 'Commande inconnue.'`) → la ligne reste visible avec `envoi.etat === REFUSEE` et son message ; soldes provisoires inchangés.
  - `[TC-386-7]` `executerEnvoi` d'une opération `REMB_SIEGE` appelle `runStoreTransactionCommand` (mocké) avec `{ ...commande, commandeId: op.id, ageMs }`.
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter.** Les effets sur les lignes et sur les soldes se règlent sur `charge.commande.action`, et les soldes passent par `effetRembSiegeSurLesSoldes`. Une ligne déjà rendue par le serveur sous l'id de l'opération l'emporte, comme pour `SAISIE`. Le contexte construit `avant` depuis la ligne affichée : `{ montant, balanceType, envoyeAuSiege }`.
- [ ] **Step 4 : lancer** `tc-386`, `tc-360`, `tc-354` → PASS.
- [ ] **Step 5 : commit** `feat: le remboursement au siege passe par la file d envoi`.

---

### Task 8 : Les lecteurs côté serveur et le chiffre d'affaires

**Files :**
- Modify : `functions/src/dealerMetrics/listOutstandingDrafts.js` (`aggregateOutstandingDrafts`), `functions/src/clients/historiqueClient.js` (`ligneDeDocument`), `functions/src/oxygen/pointEntreeOxygen.js` (`enLigne` dans `lireActivite`), `src/services/chiffreAffairesService.js`
- Modify : `tests/unit/tc-213-outstanding-drafts-handler.test.js`, `tests/unit/tc-255-historique-client-pur.test.js`, `tests/functions/tc-377-liaison-oxygen.test.js`, `tests/functions/tc-273-ca-forme-de-requete.test.js`
- Create : `tests/unit/tc-389-remb-siege-lecteurs.test.js` (`argentDehors`, `sommesEnAttente`)

**Interfaces :**
- Consumes : `estRembSiege` (Task 3 côté functions, Task 6 côté navigateur).

- [ ] **Step 1 : tests.**
  - `[TC-213-RS]` un brouillon « Remb. siège » de 100 000 → ni dans `depots`, ni dans `retraits`, ni dans `illisibles`.
  - `[TC-255-RS]` `ligneDeDocument` d'un brouillon « Remb. siège » → ligne rendue (pas `null`), `reste === 0`.
  - `[TC-377-RS]` l'activité Oxygen d'un agent qui a un brouillon et une ligne validée « Remb. siège » ne contient ni l'un ni l'autre ; ses dépôts restent.
  - `[TC-273-RS]` jeu : 350 000 d'activité cliente + un « Remb. siège » validé de 200 000 + un « Remb. siège » supprimé de 50 000 → chiffre d'affaires 350 000.
  - `[TC-389-1]` `argentDehors` sur un dépôt en attente de 100 000 et un « Remb. siège » en attente de 70 000 → dehors 100 000.
  - `[TC-389-2]` `sommesEnAttente` sur les mêmes lignes → `depots 100 000`, `nbDepots 1`, `retraits 0`.
  - `[TC-389-3]` l'assistant : `rtk grep "isDepositType|isWithdrawalType|\.type ===|plierType" src/lib/ia`. Pour chaque endroit qui classe des lignes par type, un test qui lui passe un « Remb. siège » en attente et vérifie qu'il ne compte ni comme dépôt ni comme retrait. Si aucun endroit ne classe par type, le noter dans le compte rendu de la tâche, sans test.
- [ ] **Step 2 : lancer** → FAIL sur `TC-213-RS`, `TC-255-RS`, `TC-377-RS`, `TC-273-RS`. Les deux `TC-389` passent déjà : ce sont des verrous.
- [ ] **Step 3 : implémenter.**
  - `aggregateOutstandingDrafts` : `continue` sur `estRembSiege(draft)` avant le comptage des illisibles.
  - `ligneDeDocument` : `reste: estRembSiege(donnees) ? 0 : montantRestant(donnees)`.
  - Oxygen : `enLigne` rend `null` pour `estRembSiege(donnees)`.
  - Chiffre d'affaires : `const TYPES_HORS_CA = Object.freeze([...TYPES_DEALER, 'Remb. siège'])`, utilisé partout où l'ensemble A de l'inclusion-exclusion lit `TYPES_DEALER` ; mettre le commentaire d'en-tête à jour (A n'est plus « les trois types dealer »).
- [ ] **Step 4 : lancer** les fichiers touchés, puis `npm run test:unit` et `npm run test:functions` → PASS.
- [ ] **Step 5 : commit** `feat: les lecteurs ignorent ou montrent le remboursement au siege`.

---

### Task 9 : Le formulaire

**Files :**
- Modify : `src/components/transactions/TransactionForm.jsx`
- Create : `tests/components/tc-387-remb-siege-formulaire.test.jsx`

**Interfaces :**
- Consumes : Task 6 (`REMB_SIEGE_ACTIF`, `TYPE_REMB_SIEGE`, `evaluerRembSiege`, `preparerRembSiege`), Task 7 (`ajouterRembSiege`, `modifierRembSiege`), `VASES` et `libelleVase` (`ravitaillement.js`), `getStock` (`useSimpleNetworkData`).

- [ ] **Step 1 : tests.** Montage de `tc-104` ; `vi.mock('../../src/utils/rembSiege.js', async (orig) => ({ ...(await orig()), REMB_SIEGE_ACTIF: true }))`.
  - `[TC-387-1]` trois natures, dans l'ordre : Dépôt, Retrait, « Remb. siège ». Avec `REMB_SIEGE_ACTIF: false`, deux seulement.
  - `[TC-387-2]` « Reçu en » (Stock, Espèce) n'apparaît qu'avec « Remb. siège », sans choix coché.
  - `[TC-387-3]` agent, 100 000, « Remb. siège », Stock, `getStock → 0` → « Valider » actif ; confirmation (la fenêtre affiche « Reçu en : Stock ») → `ajouterRembSiege` appelé une fois avec `{ …, balanceType: 'stock', statut: 'Validée' }` ; `addTransaction` jamais appelé.
  - `[TC-387-4]` Espèce, 100 000, stock 50 000 → « Valider » grisé, le bandeau montre « Stock insuffisant : utilisez Non Terminées. » ; « Non Terminées » actif.
  - `[TC-387-5]` « Non Terminées » Espèce → `ajouterRembSiege` avec `statut: 'Non Terminées'`.
  - `[TC-387-6]` après l'enregistrement, nature et « Reçu en » sont vidés, comme les autres champs.
  - `[TC-387-7]` en modification d'une ligne « Remb. siège » (`editingTransaction` à `envoyeAuSiege: 0`), Dépôt et Retrait sont désactivés, « Reçu en » est pré-coché, et « Sauvegarder » appelle `modifierRembSiege(id, updates)` (jamais `updateTransaction`). En modification d'un dépôt, « Remb. siège » est désactivé.
  - `[TC-387-8]` deux clics sur « Confirmer » dans le même tick → un seul appel à `ajouterRembSiege`.
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter.** `balanceType` dans l'état du formulaire, remis à `''` avec les autres champs. Quand la nature est « Remb. siège », la validation vient de `evaluerRembSiege` (avec `stock = getStock(network)`) et la préparation de `preparerRembSiege`. La fenêtre de confirmation ajoute « Reçu en ». L'indicateur « Stock disponible » apparaît aussi pour « Remb. siège » coché Espèce. Le verrou de double clic est un `useRef` synchrone, comme `FormulaireRetour`.
- [ ] **Step 4 : lancer** `tc-387`, `tc-104`, `tc-127` → PASS.
- [ ] **Step 5 : commit** `feat: la nature Remb. siege dans le formulaire de transaction`.

---

### Task 10 : La ligne en attente et « Envoyer au siège »

**Files :**
- Modify : `src/utils/helpers.js` (`getAvailableActions`, styles de type), `src/utils/constants.js` (style de `'Remb. siège'`), `src/context/transactions.jsx` (`getActionButtons`), `src/components/transactions/TransactionTable.jsx`
- Create : `tests/components/tc-388-remb-siege-tableau.test.jsx`

**Interfaces :**
- Consumes : Task 6 (`verifierEnvoiSiege`, `estRembSiege`), Task 7 (`envoyerAuSiege`, `trashTransaction`), `montantRetourPropose`, `getStock`.
- Produces : `getAvailableActions('Remb. siège')` → `{ modifier: true, payerPar: false, rembourser: false, encaisser: false, envoyerSiege: true }`.

- [ ] **Step 1 : tests.** Montage de `tc-103`, lignes en attente :
  - A : « Remb. siège », Espèce, 200 000, `envoyeAuSiege 50 000`, `resteAuSiege 150 000` ;
  - B : « Remb. siège », Stock, 100 000, rien envoyé.

  Puis :
  - `[TC-388-1]` A montre « Remb. siège », « Reçu en Espèce », « Envoyé : 50 000 » et « Reste : 150 000 » ; ni « Encaisser », ni « Payer par », ni « Rembourser ».
  - `[TC-388-2]` A n'a pas « Modifier » (une tranche est partie) mais garde « Annuler » ; B a « Modifier », « Envoyer au siège » et « Annuler ».
  - `[TC-388-3]` « Envoyer au siège » sur A avec `getStock → 400 000` ouvre le menu **sans choix de méthode**, montant pré-rempli 150 000 ; avec stock 90 000, pré-rempli 90 000.
  - `[TC-388-4]` montant 200 000 sur A → refus affiché, raison de `verifierEnvoiSiege` (`motif 'reste'`) ; 60 000 → `envoyerAuSiege('A', 60000)`.
  - `[TC-388-5]` deux clics sur la confirmation dans le même tick → un seul appel.
  - `[TC-388-6]` « Annuler » sur A, puis confirmation → `trashTransaction('A')`.
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter.**
  - `getActionButtons` : sur une ligne « Remb. siège » avec `envoyeAuSiege > 0`, `modifier: false` ; « Annuler » reste.
  - `handleActionClick('envoyerSiege')` ouvre le menu existant directement à l'étape du montant, avec un libellé « Envoyer au siège » ; la confirmation passe par `verifierEnvoiSiege`, puis `envoyerAuSiege`.
  - Teinte de « Remb. siège » : un jeton existant de `DESIGN.md` (pas `inflow`/`outflow`, réservés à l'entrée et à la sortie d'un client).
- [ ] **Step 4 : lancer** `tc-388`, `tc-103` → PASS.
- [ ] **Step 5 : commit** `feat: envoyer au siege depuis la ligne en attente`.

---

### Task 11 : La ligne validée dans l'historique

**Files :**
- Modify : `src/components/historique/HistoriqueTable.jsx` (`raisonNonModifiable`, libellé et signe du montant)
- Modify : `tests/components/tc-388-remb-siege-tableau.test.jsx`

**Interfaces :**
- Consumes : `estRembSiege`, `trashTransaction` (déjà routé, Task 7).

- [ ] **Step 1 : tests.**
  - `[TC-388-7]` une ligne « Remb. siège » validée montre son type et « Reçu en » ; « Modifier » est désactivé, avec le titre « Un remboursement au siège ne se modifie pas : annulez-le puis ressaisissez-le. ».
  - `[TC-388-8]` « Annuler » puis confirmation → `trashTransaction(id)`.
  - `[TC-388-9]` une ligne `'Supprimée'` montre « Annuler » désactivé, comme les autres.
- [ ] **Step 2 : lancer** → FAIL.
- [ ] **Step 3 : implémenter** dans `raisonNonModifiable` et dans le rendu de la ligne.
- [ ] **Step 4 : lancer** `tc-388` et les tests de `HistoriqueTable` existants (`grep -l HistoriqueTable tests/components`) → PASS.
- [ ] **Step 5 : commit** `feat: le remboursement au siege valide dans l historique`.

---

### Task 12 : Vérification d'ensemble et passation

**Files :**
- Modify : `audit/BILAN.md` (une entrée), et rien d'autre.

- [ ] **Step 1 : `npm run quality:check`** → tout vert (generated, secrets, audit, lint, unit, components, build).
- [ ] **Step 2 : `npm run quality:check:emulators`** → tout vert. Comparer le total functions à la ligne de base de la Task 1.
- [ ] **Step 3 : essai réel sur les émulateurs.** `npm run emulateurs` puis `npm run dev`, sur une boutique C2EGF de démonstration. Dérouler les cas 1, 2, 2b, 3, 4 et A de la spec, et vérifier les cartes Stock et Espèce après chaque geste. Capture du formulaire et de la ligne en attente, à 390 px et à 1440 px. Refaire le cas 3 avec le réseau coupé dans DevTools, puis le rétablir.
- [ ] **Step 4 : la liste des functions à déployer.** `rtk git diff --name-only feat/espace-patron...HEAD -- functions/src | node "C:\Users\X1CARB~1\AppData\Local\Temp\claude\c--Users-X1-Carbon-Desktop-c2egf-log\a78f47d1-f702-483c-8d3d-5a38310b05df\scratchpad\fonctions-touchees.mjs"`. Attendues au moins : `storeTransactionCommand`, `addTransactionPayment`, `addTransactionRefund`, `listOutstandingDrafts`, la callable de l'historique client, le point d'entrée Oxygen.
- [ ] **Step 5 : BILAN.** Une entrée : ce qui est livré, les décisions de la spec (§ « Les décisions prises par moi »), la liste des functions, et **l'ordre de déploiement : functions d'abord, puis le front** (procédure : `docs/deployer-les-functions.md`, geste humain).
- [ ] **Step 6 : commit** `docs: bilan du remboursement au siege`. Pas de push.
