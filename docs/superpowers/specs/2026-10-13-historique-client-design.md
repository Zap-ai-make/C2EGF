# L'historique d'un agent, toutes boutiques confondues

> Spec validée le 2026-10-13. Ajoute au tableau des clients une colonne
> « Historique » qui ouvre, dans un panneau latéral, toutes les opérations d'un
> agent — y compris celles traitées par les autres boutiques.

## Le problème

Un agent est un commerce, pas une relation avec une boutique : son code est
unique dans toute la base, et plusieurs boutiques C2EGF peuvent le servir. Mais
rien, dans le logiciel, ne permet de voir ce qu'un agent a fait. Pour répondre à
« combien nous doit-il ? » ou « où en est son remboursement ? », il faut
parcourir l'historique de la boutique à la main, et il n'existe aucun moyen de
savoir qu'il a aussi déposé ailleurs.

**Ce qu'on veut** : d'un clic depuis la liste des clients, tout ce que cet agent
a fait — dépôts, retraits, non terminées en cours, ce qui reste dû, la boutique
qui a traité, la date et l'heure.

## Ce qui rend ça serveur, et pas client

`firestore.rules` ferme l'historique d'une boutique aux autres :

```
match /history/{historyId} {
  allow read: if isStoreMember(storeId) || isSystemManager();
}
match /{path=**}/history/{docId} {
  allow read: if isSystemManager();
}
```

Aucune requête navigateur ne peut donc lire l'historique d'une autre boutique, et
ce n'est pas une limitation à contourner : c'est la séparation commerciale entre
boutiques. Il faut une **Cloud Function** qui lit avec l'Admin SDK et ne rend que
ce qu'on a décidé de rendre. Le dépôt a déjà ce motif exact :
`listOutstandingDrafts` agrège les brouillons de toutes les boutiques pour le
dealer, sans jamais lui livrer une identité client.

## L'arbitrage assumé

**Toute caissière de toute boutique verra les montants que les autres boutiques
ont traités avec cet agent.** C'est la décision prise le 2026-10-13, en
connaissance de cause : montrer à Ouaga ce que l'agent a déposé à Bobo, c'est
montrer à Ouaga une part du chiffre d'affaires de Bobo sur ce commerce.

Ce qui l'emporte : les boutiques sont des consœurs du même réseau, elles se
ravitaillent entre elles (`storeCollaborations`, `internalDebts`), et ne pas
voir qu'un agent doit déjà 200 000 ailleurs est un risque financier plus concret
que la confidentialité du chiffre entre consœurs.

**Le dealer en est exclu explicitement.** Les règles lui donnent aujourd'hui un
agrégat sans aucune identité client ; cette fonction rend des noms et des
montants nominatifs. Son rôle est refusé, et un test le vérifie.

---

## Architecture

### 1. `functions/src/clients/listClientHistory.js` — la Cloud Function

```
listClientHistory({ clientId }) → { success, lignes[], totaux, tronque, limite }
```

**Autorisation**, dans cet ordre :

1. `validateAuthUid(request.auth?.uid)` ;
2. `validateInputPayload(request.data, ['clientId'])` — liste blanche stricte ;
3. `clientId` : chaîne non vide, sans espace de bord, ≤ 128 caractères ;
4. `readValidatedProfile(db, uid, validateStoreProfile)` — profil actif, et
   `role !== 'dealer'`.

**Lectures**, en parallèle :

```js
db.collectionGroup('history')
  .where('clientId', '==', clientId)
  .orderBy('createdAt', 'desc')
  .limit(LIMITE)                     // 200
db.collectionGroup('drafts').where('clientId', '==', clientId).limit(LIMITE)
db.collection('stores').get()
```

> ⚠ **La boutique vient du CHEMIN, pas du champ.** `doc.ref.parent.parent.id`
> fait foi ; `storeName` recopié dans le document peut dater d'un renommage. Le
> nom est résolu depuis `stores`, avec repli sur le champ recopié puis sur l'id.

> ⚠ **Les brouillons ne sont pas triés côté Firestore.** Un `orderBy` sur un
> second champ coûterait un index composite de plus pour trier une poignée de
> lignes. Ils sont réunis aux autres et classés en mémoire.

**Deux index à créer** — sans eux la requête échoue à la première exécution.
Firestore ne crée les index de groupe de collections qu'explicitement, et seul
`history.createdAt` l'est aujourd'hui :

```json
{
  "collectionGroup": "history",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "clientId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```
et un `fieldOverride` donnant à `drafts.clientId` la portée `COLLECTION_GROUP`.

### 2. `functions/src/clients/historiqueClient.js` — la fonction pure

Toute la décision vit ici, sans Firestore, comme `aggregateOutstandingDrafts` :

```js
construireHistoriqueClient({ history = [], drafts = [], stores = [] })
  → { lignes, totaux }
```

C'est elle que les tests unitaires éprouvent cas par cas.

**Une ligne rendue :**

| Champ | Source | Rôle |
|---|---|---|
| `id`, `source` | `'history'` \| `'draft'` | une non terminée n'est pas une opération close |
| `storeId`, `storeName` | chemin + `stores` | la boutique qui a traité |
| `type` | `Dépôt` \| `Retrait` | |
| `montant` | `montant` | |
| `statut` | `Validée`, `Non Terminées`, `Encaissé par Orange`… | tel qu'écrit |
| `reseau`, `code` | | le compte réseau utilisé |
| `date` | `date` (texte FR) | ce que la boutique a vu |
| `createdAt`, `validatedAt` | ms | pour classer |
| `remainingAmount`, `paidAmount`, `refundedAmount`, `settlementStatus` | | le délai de remboursement |
| `operatorName` | | qui a saisi |
| `deletedAt` | ms ou null | une ligne à la corbeille |

**Ce qui est écarté**, et pourquoi :

- `STORE_MOVEMENT_TYPES` (`Ravitaillement`, `Clôture`) — ce sont des mouvements
  de la boutique, pas des opérations de l'agent. Les laisser les afficherait
  sous son nom avec un code vide.
- Rien d'autre. **Les lignes supprimées restent**, barrées et marquées : un
  historique qui tait ce qui a été annulé ment par omission, et c'est
  précisément ce qu'on vient consulter en cas de litige.

**Classement** : décroissant sur `instantDerniereAction` — le plus récent de
`createdAt` et `validatedAt`, la règle posée le même jour pour l'historique
(`src/context/transactions.jsx`). Ce qui vient d'être traité est en haut.

**Totaux** :

```
operations        nombre de lignes non supprimées
totalDepots       somme des montants des dépôts non supprimés
totalRetraits     idem retraits
resteAEncaisser   dépôts non terminés : ce que l'agent doit encore APPORTER
resteAPayer       retraits non terminés : ce que la boutique doit encore REMETTRE
nbEnAttente       nombre de non terminées
parBoutique       [{ storeId, storeName, operations, depots, retraits }]
```

> ⚠ **DEUX RESTES, PAS UN.** « Ce qui reste dû » ne veut rien dire tant qu'on ne
> dit pas dans quel sens : un dépôt non terminé est de l'argent que l'agent doit
> apporter, un retrait non terminé est de l'argent que la boutique lui doit. Les
> additionner donnerait un nombre qui ne correspond à aucune dette réelle.
> `sommesEnAttente` (`src/utils/caisse.js`) fait déjà exactement cette
> distinction pour le bandeau de caisse, et la fonction pure reprend sa
> normalisation — « Dépôt » et « Depot » coexistent en base.

> ⚠ **LE RESTE, PAS LE MONTANT D'ORIGINE.** Une non terminée partiellement
> réglée a déjà vu ses tranches passer dans les soldes. `montantRestant` fait
> cette lecture partout ailleurs ; deux lectures du même argent finiraient par
> donner deux chiffres.

> ⚠ **Une ligne supprimée ne compte dans aucun total.** Son montant a été rendu
> aux soldes : l'additionner ferait dire au panneau que l'agent a déposé une
> somme qui n'existe plus.

### 3. `src/services/clientHistoryService.js` — l'appel

Une fonction, `chargerHistoriqueClient(clientId)`, qui appelle le callable et
rend `{ lignes, totaux, tronque }`. Mêmes conventions d'erreur que
`dealerService.js`.

### 4. `src/components/clients/HistoriqueClientPanel.jsx` — le panneau

Ouvert par la nouvelle colonne, fermé par `Échap` et par le fond.

```
OUEDRAOGO SALIF                                    [x]
Code 0123456 · N° 01234567 · POUYTENGA

47 opérations · 12 300 000 déposés · 8 100 000 retirés
EN ATTENTE : 40 000 à encaisser · 100 000 à payer   (2 opérations)

13/10  14:32   Dépôt      250 000   Validée           OUAGA · Awa
13/10  09:05   Retrait    100 000   NON TERMINÉE      OUAGA · Awa
               reste 40 000 — en attente depuis 6 h
12/10  17:48   Dépôt       75 000   Encaissé Orange   BOBO · Salif
11/10  10:12   Dépôt      500 000   Supprimée         OUAGA · Awa
```

Quatre états, et aucun ne doit ressembler à un autre :

- **chargement** — `SkeletonList`, le panneau est déjà ouvert avec l'identité ;
- **vide** — « Aucune opération pour cet agent », qui n'est pas une erreur ;
- **erreur** — `ErrorState` avec un bouton Réessayer ;
- **tronqué** — « 200 opérations les plus récentes sur 437 » en pied de liste.

Le sens du mouvement reprend le code couleur existant (entrant / sortant) de
`src/utils/constants.js` ; rien de nouveau n'est inventé.

### 5. La colonne

`CLIENT_TABLE_COLUMNS` reçoit `{ key: 'historique', label: 'Historique' }` avant
`Actions`, et `TableRow` une cellule portant le bouton. Le tableau passe de dix
à onze colonnes ; il défile déjà horizontalement.

---

## Ce que ça ne fait pas

- **Aucune écriture.** La fonction est en lecture seule, de bout en bout.
- **Aucun temps réel.** Le panneau charge à l'ouverture. Un `onSnapshot` sur un
  groupe de collections multi-boutiques coûterait une écoute permanente par
  client consulté, pour une donnée qu'on lit une fois.
- **Aucune pagination.** Au-delà de 200 lignes, le panneau le dit. Charger la
  suite est une fonctionnalité séparée, à ajouter si le besoin se présente.
- **Aucun filtre ni export.** Même raison.

## Risques

| Risque | Conséquence | Réponse |
|---|---|---|
| Index non déployés | la fonction échoue à chaque ouverture | les déployer AVANT la fonction ; le plan l'impose |
| Agent très actif | lecture de 200 documents par ouverture | `limit(200)` borne le coût ; le total est annoncé |
| `clientId` d'une fiche fusionnée | historique amputé | le script de fusion a repointé `clientId` (`fusionnerClients.mjs:438`) — vérifié |
| Client « manuel » (non enregistré) | `clientId` en `manual-…`, aucune fiche | la colonne n'existe que dans la liste des clients, donc le cas ne se présente pas |
| Dealer appelant la fonction | identités clients exposées | rôle refusé, test dédié |

## Vérification

- **Unitaire** (`construireHistoriqueClient`) : écart des deux sources, exclusion
  des mouvements de boutique, lignes supprimées visibles mais hors totaux, reste
  dû, classement sur la dernière action, nom de boutique résolu depuis `stores`,
  repli quand la boutique a disparu.
- **Fonctions, sur émulateur** : refus sans authentification, refus d'un profil
  inactif, refus du dealer, payload hors liste blanche refusé, et un agent dont
  l'historique est réparti sur deux boutiques revenant en une seule liste.
- **Composant** : les quatre états, et une non terminée affichant son reste dû.

## Déploiement

Dans cet ordre, chacun étant une décision humaine (`AGENTS.md`) :

```powershell
firebase use production
# 1. Les index D'ABORD : sans eux, la fonction échoue à chaque ouverture.
firebase deploy --only firestore:indexes

# 2. La fonction. Un index en cours de construction fait échouer la requête
#    jusqu'à ce qu'il soit prêt : attendre « Enabled » dans la console.
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase deploy --only "functions:listClientHistory"

# 3. L'application, qui seule rend le bouton visible.
git push origin codex/fix-historique-firebase-date
```

> Les guillemets autour de `--only` ne sont pas facultatifs dès qu'il y a une
> virgule : voir `docs/deployer-les-functions.md`.
