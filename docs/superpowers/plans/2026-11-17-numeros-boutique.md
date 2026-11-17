# Numéros de la boutique (flotte et dealer) : plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**But** : la boutique saisit, depuis son Profil, son numéro flotte et son numéro dealer Orange. Le point d'entrée Oxygen les rend dans les formes convenues au §9 du contrat.

**Architecture** :
- un module pur, `functions/src/boutiques/numeros.js`, valide et relit les numéros ;
- une action `updateStoreNumbers`, sur la callable existante `storeTransactionCommand`, écrit la fiche `stores/{id}` et le journal ;
- `pointEntreeOxygen` ajoute `flotte` à `listerBoutiques`, et `dealer` à la demande de retrait rendue par `demander` ;
- côté front, une carte « Numéros de la boutique » dans Profil, visible du seul compte boutique.

**Pile technique** : React 19, Vite, Tailwind v4, Vitest avec Testing Library, Firebase functions gen2, émulateur `demo-akayis-test`.

**Spec** : `docs/superpowers/specs/2026-11-17-numeros-boutique-design.md`

## Contraintes globales

- Le numéro est valide s'il passe `/^\d{8}$/` après retrait des espaces. Une valeur absente fait omettre la clé, jamais `null` ni `''` dans ce qui part vers Oxygen.
- Les réseaux sont ceux de `STORE_NETWORKS` (`['Orange']`). Une autre clé de `dealer` est refusée.
- Seul le rôle `store_admin` écrit, sur sa propre boutique. `member` est refusé.
- `dealer` n'est rendu QUE dans `demander`, QUE pour `sens === 'retrait'`. Il est lu sur la fiche au moment de la réponse et jamais recopié dans la demande.
- Les règles Firestore ne changent pas : `stores` reste `update: false`.
- Pas de nouvelle function exportée.
- Les textes sont en français, avec l'apostrophe typographique (’) comme dans les messages serveur existants.
- Les commits sont en français ASCII et finissent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Toutes les commandes git passent par `rtk`.

## Points de vigilance de la relecture

1. Une fiche modifiée à la main dans la console (espaces, 9 chiffres) ne doit jamais partir vers Oxygen : les lecteurs ignorent toute valeur invalide (TC-398-03, TC-393-21).
2. Un `dealer` rangé sous un autre réseau (`Moov`) n'est pas rendu pour une demande Orange (TC-398-03).
3. Un rejeu de `demander` après un changement de numéro dealer rend le numéro du moment, pas l'ancien (TC-393-22).
4. Rien à changer : pas d'écriture, pas de ligne au journal, réponse `inchange: true` (TC-399-04).
5. Lecture impossible à l'ouverture de la carte : un message, jamais des champs vides qu'on enregistrerait par-dessus les vrais numéros (TC-400-04).

---

### Task 1: le module des numéros (pur)

**Fichiers** :
- Créer : `functions/src/boutiques/numeros.js`
- Test : `tests/unit/tc-398-numeros-boutique.test.js`

**Interfaces** :
- Produit :
  - `normaliserNumero(valeur: unknown) → string`, qui retire les espaces ;
  - `numerosSaisis(donnee: { flotte?, dealer? }, reseaux: string[]) → { ok: true, flotte: string|null, dealer: { [reseau]: string|null } } | { ok: false, message: string }`. Une chaîne vide (après normalisation) donne `null`, qui veut dire « effacer » ;
  - `flotteDe(store) → string|undefined` ;
  - `dealerDe(store, reseau) → string|undefined`. Ces deux lecteurs ne rendent qu'une valeur conforme à `/^\d{8}$/`.

- [ ] **Étape 1 : les tests**
  - TC-398-01 : `normaliserNumero(' 70 12 34 56 ')` → `'70123456'`, et `normaliserNumero(undefined)` → `''`.
  - TC-398-02 : `numerosSaisis({ flotte: '70 12 34 56', dealer: { Orange: '' } }, ['Orange'])` → `{ ok: true, flotte: '70123456', dealer: { Orange: null } }`.
  - TC-398-02b : les refus, chacun avec un message exact :
    - `flotte: '7012345'` → `'Numéro flotte : 8 chiffres.'` ;
    - `dealer: { Orange: '7012345a' }` → `'Numéro dealer Orange : 8 chiffres.'` ;
    - `dealer: { Moov: '70123456' }` → `'Réseau inconnu : Moov.'` ;
    - `dealer: 'x'` et `flotte: 5` → `'Numéros invalides.'`.
  - TC-398-03 : `flotteDe({ flotte: '70123456' })` → `'70123456'`. `flotteDe({ flotte: '70 12 34 56' })`, `flotteDe({ flotte: '701234567' })` et `flotteDe({})` → `undefined`. `dealerDe({ dealer: { Orange: '76543210', Moov: '70000000' } }, 'Orange')` → `'76543210'`. `dealerDe(…, 'Moov')` sur une fiche sans Moov, et `dealerDe({ dealer: { Orange: 'abc' } }, 'Orange')` → `undefined`.
- [ ] **Étape 2** : `npx vitest run --config vitest.config.js tests/unit/tc-398-numeros-boutique.test.js`. Attendu : échec, module introuvable.
- [ ] **Étape 3** : écrire le module.
- [ ] **Étape 4** : relancer le même test. Attendu : 4/4 au vert.
- [ ] **Étape 5** : commit `feat: le module des numeros de la boutique (flotte, dealer)`.

### Task 2: l'action `updateStoreNumbers`

**Fichiers** :
- Modifier : `functions/src/storeTransactions/storeTransactionCommand.js`. Ajouter `'flotte', 'dealer'` à la liste blanche de `validateInputPayload`, et le nouveau bloc avant `fail('STORE_TRANSACTION_INVALID', 'Commande inconnue.')`.
- Test : `tests/functions/tc-399-numeros-boutique-commande.test.js`, avec les mêmes amorces que TC-394.

**Interfaces** :
- Consomme : `numerosSaisis` et `flotteDe`/`dealerDe` (tâche 1), `readActor`, `store`.
- Produit :
  - la commande `{ action: 'updateStoreNumbers', flotte: string, dealer: { Orange: string } }` ;
  - sa réponse `{ numeros: { flotte?: string, dealer: { Orange?: string } }, inchange?: true }`.

- [ ] **Étape 1 : les tests** (fiche `stores/S` active, profil `store_admin` sur S)
  - TC-399-01 : `{ flotte: '70 12 34 56', dealer: { Orange: '76543210' } }`.
    - `stores/S` porte alors `flotte: '70123456'` et `dealer: { Orange: '76543210' }` ;
    - la réponse vaut `{ numeros: { flotte: '70123456', dealer: { Orange: '76543210' } } }` ;
    - une ligne `auditLogs` porte `{ action: 'updateStoreNumbers', uid, avant: { dealer: {} }, apres: { flotte: '70123456', dealer: { Orange: '76543210' } } }`.
  - TC-399-02 : vider la flotte (`flotte: ''`) efface le champ (`flotte` absent du document) et garde le dealer. Le journal porte l'avant et l'après.
  - TC-399-03 : les refus.
    - Un profil `member` → `ROLE_FORBIDDEN`, message `'Seul le compte boutique modifie ses numéros.'`.
    - `flotte: '123'` → `STORE_TRANSACTION_INVALID`, message `'Numéro flotte : 8 chiffres.'`.
    - `dealer: { Moov: … }` → refus.
    - Dans chaque cas, la fiche ne bouge pas et aucune ligne n'est ajoutée au journal.
  - TC-399-04 : renvoyer les mêmes valeurs rend `{ numeros, inchange: true }`, sans écriture ni ligne au journal.
- [ ] **Étape 2** : `npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-399-numeros-boutique-commande.test.js"`. Attendu : échec, « Commande inconnue. ».
- [ ] **Étape 3 : écrire l'action.**
  - Refuser si `profile.role !== 'store_admin'`.
  - Calculer `avant` depuis `store` par `flotteDe` et `dealerDe`.
  - Construire `apres` depuis `numerosSaisis`.
  - Si `avant` et `apres` sont égaux (`JSON.stringify` sur des objets construits dans le même ordre), rendre `inchange`.
  - Sinon, `t.update(stores/S)` avec `FieldValue.delete()` pour chaque `null`, en `flotte` et en `'dealer.Orange'`. Puis une ligne au journal.
  - Un commentaire en tête de bloc renvoie au risque accepté par l'utilisateur.
- [ ] **Étape 4** : relancer TC-399, puis TC-394, qui partage le gestionnaire. Attendu : tout au vert.
- [ ] **Étape 5** : commit `feat: la boutique enregistre ses numeros flotte et dealer`.

### Task 3: le point d'entrée Oxygen

**Fichiers** :
- Modifier : `functions/src/oxygen/pointEntreeOxygen.js`, dans `listerBoutiques` et `demander`.
- Test : ajouts à `tests/functions/tc-393-demandes-agent-oxygen.test.js`.

**Interfaces** : consomme `flotteDe` et `dealerDe` (tâche 1).

- [ ] **Étape 1 : les tests**
  - TC-393-20 : `stores/b1` porte `flotte: '70111111'`, `stores/b3` n'en a pas.
    - `servies` et `boutiques` rendent `{ id: 'b1', nom: 'Boutique 1', derniereLe…, flotte: '70111111' }` ;
    - b3 n'a pas de clé `flotte` ;
    - aucune boutique n'a de clé `dealer`.
  - TC-393-21 : `stores/b1` porte `dealer: { Orange: '76111111' }`.
    - Un retrait rend `demande.dealer === '76111111'` ;
    - un dépôt n'a pas de clé `dealer` ;
    - avec `dealer: { Orange: '76 11 11 11' }`, aucune clé `dealer` ;
    - le document `demandesAgent` n'a jamais de champ `dealer`.
  - TC-393-22 : premier retrait, puis la fiche passe à `'76222222'`. Le rejeu de la même clé rend `'76222222'`.
  - Les tests existants TC-393-01, -02 et -14 restent inchangés et passent : b1 n'a pas de numéro dans le `beforeEach`.
- [ ] **Étape 2** : lancer TC-393 sur l'émulateur, avec la même commande qu'à la tâche 2. Attendu : 20 à 22 en échec.
- [ ] **Étape 3 : modifier le point d'entrée.**
  - Ajouter la clé `flotte` seulement si `flotteDe` rend une valeur.
  - Dans `demander`, pour un retrait :
    - nouvelle demande : `dealerDe(boutique.data(), corps.reseau)` ;
    - rejeu : `t.get(stores/{boutiqueId})`, puis `dealerDe` sur le réseau de la demande existante.
  - Ajouter `dealer` à la `demande` rendue, jamais à `donnees`.
- [ ] **Étape 4** : relancer TC-393. Attendu : 22/22 au vert.
- [ ] **Étape 5** : commit `feat: le point d'entree Oxygen rend le numero flotte et, au retrait, le numero dealer`.

### Task 4: la carte du Profil

**Fichiers** :
- Créer : `src/services/numerosBoutiqueService.js` et `src/components/profil/NumerosBoutique.jsx`.
- Modifier : `src/pages/Profil.jsx`. La carte vient après « Informations du compte », seulement si `userProfile?.role === AUTH_ROLES.STORE_ADMIN && activeStore?.id`.
- Test : `tests/components/tc-400-numeros-boutique-profil.test.jsx`.

**Interfaces** :
- Produit :
  - `lireNumerosBoutique(storeId) → Promise<{ flotte: string, dealerOrange: string }>`, qui lit `getDoc(doc(db, 'stores', storeId))` et rend `''` pour un numéro absent ;
  - `enregistrerNumerosBoutique({ flotte, dealerOrange }) → Promise`, qui passe par `runStoreTransactionCommand({ action: 'updateStoreNumbers', flotte, dealer: { Orange: dealerOrange } })`, jamais par la file d'envoi ;
  - `<NumerosBoutique storeId={string} />`.
- Libellés exacts :
  - titre : « Numéros de la boutique » ;
  - champs : « Numéro flotte (pour appeler la boutique) » et « Numéro dealer Orange (reçoit la monnaie des agents) » ;
  - note : « L’app Oxygen les montre aux agents. Vide = rien n’est montré. » ;
  - bouton : « Enregistrer » ;
  - succès : « Enregistré. » ;
  - échec de lecture : « Numéros illisibles pour l’instant. Réessayez avec une connexion. »

- [ ] **Étape 1 : les tests** (service mocké, `useEnLigne` mocké)
  - TC-400-01 : les deux champs montrent les valeurs lues. « Enregistrer » reste désactivé tant que rien ne change.
  - TC-400-02 : taper `70 99 88 77` dans la flotte, puis cliquer. Le service est appelé avec `{ flotte: '70 99 88 77', dealerOrange: '76543210' }`, et « Enregistré. » s'affiche. Un refus du serveur affiche son message.
  - TC-400-03 : hors ligne, « Enregistrer » est désactivé, même après un changement.
  - TC-400-04 : si la lecture échoue, le message d'échec s'affiche, sans aucun champ ni bouton.
  - TC-400-05 : Profil montre la carte pour `store_admin`, et pas pour `system_manager`.
- [ ] **Étape 2** : `npx vitest run --config vitest.config.js tests/components/tc-400-numeros-boutique-profil.test.jsx`. Attendu : échec.
- [ ] **Étape 3** : écrire le service, la carte et le branchement.
  - Champs `inputMode="numeric"`, mêmes classes que les cartes du Profil.
  - Le bouton passe à « … » pendant l'envoi.
  - Après un succès, les valeurs normalisées rendues par le serveur deviennent la nouvelle référence.
- [ ] **Étape 4** : relancer TC-400, puis les tests du Profil (TC-355, TC-027, TC-028, TC-346). Attendu : au vert. Ajouter un mock du service si un test monte le Profil sans Firestore.
- [ ] **Étape 5** : commit `feat: la carte des numeros de la boutique dans le Profil`.

### Task 5: vérifier, documenter, prévenir

- [ ] Suites complètes : `test:unit`, `test:components`, `test:functions`, puis `lint`, `build` et `check:generated`.
- [ ] Essai réel sur les émulateurs `demo-c2egf-local` :
  - saisir les numéros dans le Profil de boutique1, avec une capture à 1440 et à 390 ;
  - vérifier la fiche et le journal ;
  - appeler `listerBoutiques` et `demander` (retrait, puis dépôt) par le vrai point d'entrée.
- [ ] Ajouter une entrée à `audit/BILAN.md`, avec l'ordre de mise en service de la spec. Commit `docs: bilan, numeros de la boutique`.
- [ ] Prévenir Oxygen (`SendMessage`) : les formes exactes rendues, et le fait que rien n'est déployé.
- [ ] Relecture finale du diff entier, puis la fin de branche.
