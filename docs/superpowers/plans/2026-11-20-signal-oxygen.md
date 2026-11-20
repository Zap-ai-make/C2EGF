# Le signal à Oxygen : plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**But** : quand la caissière valide ou rejette une demande d'agent, `storeTransactionCommand` prévient Oxygen d'un signal sans contenu (contrat v9 §10).

**Architecture** : un module `functions/src/oxygen/signal.js` prend un jeton d'identité au serveur de métadonnées et envoie le signal ; le handler l'attend après la transaction, sans jamais échouer à cause de lui.

**Pile technique** : Firebase functions gen2, Node 22 (`fetch`, `AbortSignal.timeout`), Vitest, émulateur `demo-akayis-test`.

**Spec** : `docs/superpowers/specs/2026-11-20-signal-oxygen-design.md`

## Contraintes globales

- URL : `https://flwbscqezuhmshjnrakr.supabase.co/functions/v1/liaison`, qui est aussi l'audience du jeton, à l'identique.
- Corps : exactement `{"action":"signal","demande":"<id>"}`.
- Délai : 3 000 ms en tout, jeton compris. Aucun nouvel essai.
- Aucune dépendance ajoutée à `functions/package.json`. Pas de nouvelle function exportée.
- Rien ne part sur un projet `demo-*`.
- Le jeton n'apparaît jamais dans le journal.
- Les commits sont en français ASCII et finissent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Toutes les commandes git passent par `rtk`.

## Points de vigilance de la relecture

1. Un signal qui lève, ou qui dépasse son délai, ne change rien à la réponse de la caissière (TC-394-19).
2. Le rejeu du même geste ne renvoie pas de signal (TC-394-18).
3. Une validation refusée (solde insuffisant) ne signale rien (TC-394-18).
4. Le serveur de métadonnées qui répond une erreur : pas d'envoi avec un jeton vide (TC-401-02).
5. Le signal part après l'écriture : la demande est déjà fermée quand il part (TC-394-16 et 17).

---

### Task 1: le module du signal

**Fichiers** :
- Créer : `functions/src/oxygen/signal.js`
- Test : `tests/unit/tc-401-signal-oxygen.test.js`

**Interfaces** :
- Produit : `URL_SIGNAL`, `DELAI_SIGNAL_MS = 3000`, `signalerDemandeFermee(demandeId: string, { fetch?, projet?, delaiMs? }?) : Promise<void>`. Elle ne rend rien quand tout va bien, ne fait rien sur un projet `demo-*`, et lève une `Error` dont `statut` porte le code HTTP quand une réponse n'est pas 2xx.

- [ ] **Step 1 : les tests rouges**, avec un `fetch` injecté :
  - `[TC-401-01]` : premier appel au serveur de métadonnées, `…/instance/service-accounts/default/identity?format=full&audience=<URL_SIGNAL encodée>`, avec l'en-tête `Metadata-Flavor: Google`, puis un `POST` à `URL_SIGNAL` : en-têtes `Authorization: Bearer <jeton>` et `Content-Type: application/json`, corps exactement `{"action":"signal","demande":"d1"}`. Deux appels en tout.
  - `[TC-401-02]` : une réponse 401 lève une erreur avec `statut: 401`. Une erreur du serveur de métadonnées (500) lève aussi, sans aucun `POST`.
  - `[TC-401-03]` : un `fetch` qui ne répond jamais lève une fois `delaiMs` passé (50 ms dans le test) ; les deux appels reçoivent un `signal`.
  - `[TC-401-04]` : sur `projet: 'demo-akayis-test'`, aucun appel.
- [ ] **Step 2** : `npx vitest run --config vitest.config.js tests/unit/tc-401-signal-oxygen.test.js`. Attendu : échec, le module n'existe pas.
- [ ] **Step 3** : écrire le module. Le projet vient par défaut de `process.env.GCLOUD_PROJECT`.
- [ ] **Step 4** : la même commande. Attendu : 4 tests verts.
- [ ] **Step 5** : commit `feat: le module du signal a Oxygen (contrat v9 par. 10)`.

### Task 2: le handler signale la demande fermée

**Fichiers** :
- Modifier : `functions/src/storeTransactions/storeTransactionCommand.js`, signature du handler et fin du handler.
- Test : `tests/functions/tc-394-reponse-demande-agent.test.js`

**Interfaces** :
- Consomme : `signalerDemandeFermee` (Task 1).
- Produit : `storeTransactionCommandHandler(request, { db, FieldValue, logWriter, signalerOxygen = signalerDemandeFermee })`.

- [ ] **Step 1 : les tests rouges**, avec un `signalerOxygen` injecté qui note l'appel et relit la demande à ce moment-là :
  - `[TC-394-16]` : Valider appelle `signalerOxygen('d1')` une fois ; à cet instant la demande est déjà `validee`.
  - `[TC-394-17]` : Rejeter appelle `signalerOxygen('d1')` une fois ; la demande est déjà `rejetee`.
  - `[TC-394-18]` : le rejeu de la même acceptation ou du même rejet ne rappelle pas `signalerOxygen`. Un solde insuffisant ne l'appelle pas.
  - `[TC-394-19]` : un `signalerOxygen` qui lève une erreur `statut: 400` : la réponse reste `{ accepted: true, … }`, la demande est validée, et le journal reçoit une ligne `{ severity: 'WARNING', event: 'OXYGEN_SIGNAL_ECHEC', demandeId: 'd1', statut: 400 }`.
- [ ] **Step 2** : `npm run test:functions -- tests/functions/tc-394-reponse-demande-agent.test.js`. Attendu : TC-394-16 à 19 rouges, les autres verts.
- [ ] **Step 3** : après le `logWriter` de succès, si l'action est `acceptAgentRequest` ou `rejectAgentRequest` et que `result.idempotent` n'est pas vrai, attendre `signalerOxygen(demandeId)` dans un `try` ; l'erreur va au journal, avec `statut` ou, à défaut, le nom de l'erreur.
- [ ] **Step 4** : la même commande, puis `npm run test:functions` en entier et `npm run lint`. Attendu : tout vert.
- [ ] **Step 5** : commit `feat: storeTransactionCommand signale a Oxygen la demande fermee`, avec la spec et le plan.
