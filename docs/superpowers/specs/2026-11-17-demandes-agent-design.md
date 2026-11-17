# Demandes d'agent, côté CRM — conception

Date : 2026-11-17. Branche : `feat/demandes-agent`, partie de `feat/espace-patron` (10f79e1).
Contrat : `C:\dev\oxygen\docs\contrats\demande-operation.md`, version 4. Son §8 fait foi.

## 1. Intention

L'agent lance un dépôt ou un retrait depuis l'app Oxygen et l'adresse à une boutique. La caissière le valide ou le rejette dans son CRM. Le reçu papier disparaît.

Ce qu'a voulu l'utilisateur, avec ses mots : « les mêmes transactions qu'elles ont l'habitude de faire, mais qui viennent des agents ». Les demandes arrivent donc **dans le tableau « Non Terminées »**, sans bandeau à part. Chaque ligne de demande se reconnaît du premier coup d'œil (maquette B, choisie le 2026-11-17).

## 2. Buts, non-buts, anti-buts

**Buts**
- Le point d'entrée privé expose 5 actions : `listerBoutiques`, `demander`, `annuler`, `lireDemandes` et `etatDemande`.
- `storeTransactionCommand` reçoit deux actions : `acceptAgentRequest` et `rejectAgentRequest`.
- Une règle Firestore et des index sont ajoutés.
- Les lignes de demande apparaissent dans le tableau, avec trois gestes : **Non terminée**, **Valider** et **Rejeter**.

**Non-buts**
- Pas de notification poussée.
- Aucune expiration.
- Pas de motif de rejet.
- Pas de réglage « cette boutique accepte les demandes » : toute boutique active accepte.
- On ne peut pas demander un remboursement au siège.
- Rien ne change dans `lireActivite`.

**Anti-buts** (ce qui serait un échec même si tout marche)
- Une demande compte dans le Total caisse, dans les cases ou dans les soldes avant d'être acceptée.
- Une demande que l'agent a annulée peut encore être validée.
- La même demande crée deux opérations.
- La file d'envoi hors ligne valide une demande plus tard, sans personne devant l'écran.
- Un refus « solde insuffisant » ferme la demande.

## 3. Contraintes

- AGENTS.md s'applique :
  - aucun déploiement ni push sans demande de l'utilisateur ;
  - les tests tournent sur les émulateurs `demo-*` ;
  - les commits sont en français ASCII ;
  - « Terminé = vérifié », avec une capture pour l'interface.
- `functions/` n'importe rien de `src/`.
- Le quota gratuit Firebase reste visé (docs/rester-dans-le-quota-gratuit.md). Aucune lecture sans borne.
- Le point d'entrée garde ses formes de réponse :
  - un refus métier arrive en 200 sous la forme `{ ok:false, raison }` ;
  - une demande mal formée est refusée en 400 ;
  - un distributeur dont la liaison est fermée par le profil reçoit 403.
- Valider et Rejeter **exigent le réseau**. Ces gestes ne passent pas par la file d'envoi.

## 4. Approches

Toutes ont été tranchées par l'utilisateur et par la relecture du contrat (§8) le 2026-11-16. Elles sont rappelées ici pour mémoire.

| Question | Retenu | Écarté, et pourquoi |
|---|---|---|
| Où vit une demande | Une collection à part, `clients/{boutique}/demandesAgent`. Le tableau lit deux sources. | Un brouillon (`drafts`) : il compterait dans les cases, le Total caisse et `lireActivite` avant toute réponse. |
| Comment valider | Une action nouvelle, `acceptAgentRequest`, qui écrit l'opération sous `id = demandeId` dans la même transaction que la demande. | L'action `add` : elle ne garde pas la trace, ne touche pas la demande et n'empêche pas de valider une demande annulée. |
| Où la caissière la voit | Dans le tableau des non terminées. | Un bandeau au-dessus, refusé par l'utilisateur. |
| Comment rafraîchir chez l'agent | `etatDemande`, une seule lecture, appelée toutes les 10 s pendant 5 min au plus. | `lireDemandes` répété : une requête de groupe à chaque appel. |
| Combien de demandes en attente | **Sans limite**, décidé par l'utilisateur le 2026-11-17. La règle 11 du contrat tombe, avec la raison `demande_en_cours` et le verrou. | Une seule par agent, avec un verrou par fiche : c'était la proposition du contrat, refusée. |

## 5. Conception

### 5.1 Données

`clients/{boutiqueId}/demandesAgent/{cle}`. La clé d'idempotence envoyée par Oxygen, un UUID v4, **est** l'identifiant du document.

```
distributeurId, compteOxygen, liaisonId, clientId
agent: { nom, prenom, code }      copie de la fiche au moment de la demande, pour l'écran
boutiqueId, boutiqueNom
sens: 'depot' | 'retrait'
reseau, montant                    entier > 0
saisieLe                           heure du téléphone, pour l'affichage seulement
etat: 'en_attente' | 'validee' | 'rejetee' | 'annulee_agent'
creeLe                             heure serveur
reponduLe                          heure de la fermeture, quelle qu'elle soit ; null tant qu'elle est en attente
reponduPar                         uid de la caissière ; null pour une annulation
operationId                        = id de la demande une fois validée, sinon null
```

`agent.code` est le code réseau de la fiche (`fiche.orange`). C'est celui que porte le champ `code` d'une opération saisie au formulaire (`preparerTransaction`).

Un agent peut avoir autant de demandes en attente qu'il veut, dans une ou plusieurs boutiques. Il n'y a aucun verrou.

L'objet `demande` rendu à Oxygen, partout :
`{ id, boutiqueId, boutiqueNom, sens, reseau, montant, etat, creeLe, reponduLe, operationId }`. Les dates sont en millisecondes, et `null` quand elles manquent.

### 5.2 Le point d'entrée privé (`pointEntreeOxygen.js`)

Toutes les actions reçoivent `{ action, distributeurId, compteOxygen, liaison }`. Les clés sont filtrées par liste blanche, comme `lireActivite`.

Contrôles communs :
- si le distributeur est éteint par le profil, la réponse est 403 ;
- la liaison doit exister et appartenir à ce compte et à ce distributeur ; sinon la réponse est `liaison_inconnue`.

Une liaison **fermée** a deux effets :
- `listerBoutiques` et `demander` la refusent, avec la raison `liaison_fermee` ;
- `annuler`, `lireDemandes` et `etatDemande` l'acceptent : l'agent garde la main sur ses propres demandes. Ces trois actions ne touchent qu'aux demandes dont le `compteOxygen` est le sien.

**`listerBoutiques`** prend `{ ..., avecToutes?: boolean }` et rend `{ ok:true, servies, reseaux, boutiques? }`.
- `servies` vaut `[{ id, nom, derniereLe }]`. On lit `collectionGroup('history')` sur le `clientId` de la liaison, de la plus récente à la plus ancienne, avec une limite de 50 lignes ; l'index existe déjà. On en garde les boutiques distinctes, avec la date de la plus récente opération de chacune. Un `getAll` de ces boutiques retire les inactives et donne leur nom actuel.
- `reseaux` vaut `STORE_NETWORKS`, soit `["Orange"]`.
- `boutiques` vaut `[{ id, nom }]` : les boutiques actives, triées par nom. Elles ne sont lues que si `avecToutes` est vrai ; Oxygen les garde 24 h.

**`demander`** prend `{ ..., boutiqueId, sens, reseau, montant, saisieLe, cle }`.
- La demande est refusée en 400 si l'un des champs est mal formé :
  - `boutiqueId` ou `cle` ne suit pas le format `[A-Za-z0-9_-]{1,160}` ;
  - `sens` n'est pas `depot` ou `retrait` ;
  - `saisieLe` n'est pas un instant.
- Avant la transaction, deux refus métier :
  - `montant_invalide` si le montant n'est pas un entier sûr strictement positif ;
  - `reseau_invalide` si le réseau n'est pas dans `STORE_NETWORKS`.
- La transaction se déroule dans cet ordre :
  1. **Le document `cle` existe déjà.** Si c'est le même compte, c'est un rejeu : on rend `{ ok:true, demande }`, quel que soit son état. Si c'est un autre compte, la réponse est 400.
  2. **La liaison est fermée** : refus `liaison_fermee`.
  3. **La boutique** est absente ou inactive : refus `boutique_indisponible`.
  4. **La fiche** `globalClients/{clientId}` n'a pas de code pour ce réseau : refus `reseau_invalide`. Sans ce code, la caissière ne pourrait jamais valider la demande.
  5. Sinon, on écrit la demande `en_attente`. La réponse est `{ ok:true, demande }`. Une autre demande en attente du même agent n'empêche rien.

**`annuler`** prend `{ ..., boutiqueId, demandeId }`.
- Une demande absente, ou qui appartient à un autre compte, donne le refus `demande_inconnue`.
- Une demande en attente passe à `annulee_agent`, avec `reponduLe`.
- Dans tous les cas, la réponse est `{ ok:true, demande }`, avec l'état réel de la demande.

**`lireDemandes`** prend `{ ..., enAttente?: boolean }` et rend `{ ok:true, demandes }`. Il fait deux requêtes sur `collectionGroup('demandesAgent')` :
- les demandes de ce compte en attente, limite 200 ;
- celles fermées depuis moins de 7 jours (`reponduLe` ≥ maintenant − 7 j), limite 200. Cette seconde requête est sautée quand `enAttente` est vrai.

L'option `enAttente` a été demandée par Oxygen le 2026-11-17. L'Accueil de l'agent montre une carte par demande en attente. Il appelle `lireDemandes { enAttente: true }` toutes les 10 s, pendant 5 min au plus, tant qu'au moins une demande est en attente. Chaque tour coûte la liaison plus max(1, n) lectures. Une demande qui sort de la liste reçoit un seul `etatDemande`, pour connaître son état final.

Les deux résultats sont fusionnés sans doublon, la plus récente demande d'abord (`creeLe`).

Ces limites bornent la lecture, comme le veut le quota. Ce ne sont pas des limites métier : elles sont très au-dessus de l'usage réel.

**`etatDemande`** prend `{ ..., boutiqueId, demandeId }` et rend `{ ok:true, demande }`. Si la demande est absente ou appartient à un autre compte, le refus est `demande_inconnue`. L'action coûte 2 lectures : la liaison et la demande.

Les dates s'écrivent avec `Timestamp.fromMillis(maintenant())`, l'horloge injectée comme dans `relier`.

### 5.3 `storeTransactionCommand`

La liste blanche reçoit `demandeId` et `statut`. Les deux actions sont des refus métier avec un code en majuscules. Le code `DEMANDE_CLOSE` doit être ajouté à `errors.js`, en `failed-precondition`.

**`acceptAgentRequest { demandeId, statut }`** accepte un `statut` parmi « Non Terminées » et « Validée ».

Ce qu'elle lit :
1. La demande, dans `clients/{storeId}/demandesAgent/{demandeId}`. La boutique est celle du profil de la caissière.
2. La fiche `globalClients/{clientId}`.
3. Le document cible, dans `drafts` ou `history`.

Ce qu'elle refuse, et comment :

| Situation | Réponse |
|---|---|
| Demande absente | `STORE_TRANSACTION_NOT_FOUND` |
| Déjà validée | Rejeu : `{ accepted:true, operationId, idempotent:true }` |
| Annulée par l'agent | `DEMANDE_CLOSE` : « L'agent a annulé cette demande. » |
| Rejetée | `DEMANDE_CLOSE` : « Cette demande a déjà été rejetée. » |
| Fiche absente, ou sans code réseau | Refus |
| Document cible déjà présent | `IDEMPOTENCY_CONFLICT` |

Ce qu'elle écrit : l'opération, construite comme le fait `add`.
- `cleanTransaction` reçoit :
  - `client` : `{ id, nom, prenom, orange, codeAgent, numeroAgent }` pris sur la fiche, seulement les clés présentes ;
  - `clientId`, `type` (« Dépôt » ou « Retrait »), `reseau`, `code` (= `fiche.orange`), `montant` et `statut`.
- L'impact sur les soldes passe par `applyInitialTransactionImpact`, qui lève `INSUFFICIENT_STORE_BALANCE`. Toute la transaction est alors annulée et **la demande reste en attente**.
- `directValidation` et `liquiditySplit` s'appliquent comme dans `add`.
- La datation est `{ date: dateFr(), createdAt: now }`, l'heure de validation. On n'utilise jamais `ageMs` ni `commandeId`.
- L'opération est écrite sous l'id `demandeId`.

Dans la même transaction :
- la demande passe à `validee`, avec `reponduLe`, `reponduPar` et `operationId` ;
- les soldes sont mis à jour ;
- le journal d'audit reçoit une ligne `{ action, transactionId, demandeId, … }`.

Elle rend `{ accepted:true, operationId, statut }`.

**`rejectAgentRequest { demandeId }`** lit la demande.

| Situation | Réponse |
|---|---|
| Demande absente | `STORE_TRANSACTION_NOT_FOUND` |
| Déjà rejetée | Rejeu |
| Validée ou annulée par l'agent | `DEMANDE_CLOSE` |
| En attente | Passe à `rejetee`, avec `reponduLe` et `reponduPar` ; une ligne d'audit est écrite |

Elle rend `{ rejected:true }`.

### 5.4 Règles et index

- `firestore.rules`, dans `match /clients/{storeId}`, reçoit le bloc `match /demandesAgent/{demandeId} { allow read: if isStoreMember(storeId); allow create, update, delete: if false; }`.
- `firestore.indexes.json` reçoit deux index `COLLECTION_GROUP` sur `demandesAgent` :
  - `compteOxygen ASC, etat ASC` ;
  - `compteOxygen ASC, reponduLe DESC`.
- L'écoute de la caisse est une égalité sur une collection : elle n'a besoin d'aucun index.

### 5.5 L'écran de la caisse, variante B

- **Activation** : derrière `LIAISON_OXYGEN_ACTIVE`, le drapeau du profil qui montre déjà la liaison.
- **Écoute** :
  - une seule par session de caisse, sur `clients/{boutique}/demandesAgent` avec `etat == 'en_attente'`, limite 200 (une borne de lecture, pas une limite métier) ;
  - un refus de la règle (déploiement pas encore fait) se tait : la caisse n'affiche simplement aucune demande.
- **Hors ligne** (`useEnLigne()` faux) : les demandes ne s'affichent pas, conformément au contrat §4.2.
- **Place** :
  - les lignes de demande viennent en tête du tableau, la plus ancienne d'abord, parce qu'un agent attend ;
  - elles restent visibles **quel que soit le filtre** et ne sont jamais regroupées ;
  - les cases ne les comptent pas, ni « N autres opérations cachées » ;
  - s'il n'y a que des demandes, elles remplacent l'état vide.
- **Aspect** (maquette B) :
  - toute la ligne prend le fond `agent-soft` (#f1edfb), avec un filet #d9cff3 ;
  - la colonne Type montre le sens dans sa couleur habituelle, puis, dessous, un téléphone et « Demande de l'agent » en `agent` (#5b3ba8) ;
  - la pastille d'attente et la date se lisent sur `creeLe`, le nom sur `agent`, et le code est `agent.code` ;
  - les nouveaux jetons `--color-agent` et `--color-agent-soft` vont dans `src/index.css`. Les contrastes mesurés : 6,9 pour #5b3ba8 sur #f1edfb, au moins 4,6 pour les couleurs de sens sur ce fond.
- **Gestes** :
  - les trois boutons sont **Non terminée** (contour), **Valider** (plein, `brand-500`) et **Rejeter** (contour, texte `danger`) ;
  - ils appellent `runStoreTransactionCommand` sans passer par la file ;
  - pendant l'appel, les trois boutons se grisent et le bouton touché porte « … » ;
  - un échec s'affiche dans un toast, avec le message du serveur. Sans réseau, le message est « Cette opération demande une connexion internet. » ;
  - en cas de succès, rien n'est à faire : l'écoute retire la ligne, et une « Non terminée » réapparaît comme ligne ordinaire par l'écoute des brouillons ;
  - Rejeter ne demande aucune confirmation (règle 10).
- **Montant** : une fois passée en « Non terminée », l'opération se modifie comme les autres, montant compris. C'est le choix par défaut proposé à l'utilisateur le 2026-11-17, qu'il n'a pas contesté.
- **Double saisie** :
  - sous le montant, « Déjà saisi à HH:MM ? » s'affiche en `warn` quand une opération du même `clientId`, du même type et du même montant a été créée depuis `creeLe` ;
  - on la cherche dans les non terminées et dans l'historique du jour, en excluant les lignes supprimées ;
  - c'est une fonction pure, testée seule.
- **Aide** : la fiche 7 (« Lire la liste des opérations qui attendent ») gagne une étape, « Une ligne violette **Demande de l'agent** vient de l'app Oxygen : {{Valider}}, {{Non terminée}} ou {{Rejeter}}. ».

## 6. Ce qui est laissé au constructeur

- Où placer l'écoute : un hook `useDemandesAgent`, lu par le tableau, plutôt qu'un ajout au contexte des transactions.
- Le découpage de `pointEntreeOxygen.js`, par exemple un module `demandes.js` à côté, s'il dépasse une taille lisible.
- La forme exacte des messages d'erreur, en dehors de ceux fixés ci-dessus.
- Le code et les tests de règles suivent les modèles existants :
  - TC-377 pour le point d'entrée ;
  - TC-210 et TC-351 pour la commande ;
  - les tests de règles Firestore ;
  - TC-391 pour le tableau.

## 7. Déploiement — décision de l'utilisateur, plus tard

Dans l'ordre :
1. Les règles et les index Firestore.
2. Les functions `storeTransactionCommand` et `pointEntreeOxygen`.
3. Le front, par un push de `feat/espace-patron`.

Ensuite, envoyer à la session Oxygen la forme exacte des 5 actions, avec des exemples fictifs, sans clé ni jeton.
