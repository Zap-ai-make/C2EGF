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
listClientHistory({ clientId, curseur? }) →
  { success, enCours[], lignes[], totaux, curseurSuivant, encore }
```

**Autorisation**, dans cet ordre :

1. `validateAuthUid(request.auth?.uid)` ;
2. `validateInputPayload(request.data, ['clientId', 'curseur'])` — liste blanche ;
3. `clientId` : chaîne non vide, sans espace de bord, ≤ 128 caractères ;
4. `curseur` : absent, ou `{ createdAt: number, chemin: string }` validé de la
   même façon — un curseur mal formé est refusé, jamais ignoré en silence ;
5. `readValidatedProfile(db, uid, validateStoreProfile)` — profil actif, et
   `role !== 'dealer'`.

**Deux sources, deux régimes**, et c'est la clé du découpage :

```js
// Les NON TERMINÉES : petites par nature, chargées en entier, une seule fois.
db.collectionGroup('drafts').where('clientId', '==', clientId)

// L'HISTORIQUE : paginé, du plus récent au plus ancien.
db.collectionGroup('history')
  .where('clientId', '==', clientId)
  .orderBy('createdAt', 'desc')
  .orderBy('__name__', 'desc')
  .startAfter(curseur.createdAt, curseur.chemin)   // si curseur
  .limit(PAGE)                                      // 50
```

> ⚠ **LES NON TERMINÉES NE SE PAGINENT PAS, ET NE S'INTERCALENT PAS NON PLUS.**
> Ce sont des opérations EN COURS : il y en a peu, et elle sont ce qu'on vient
> voir en premier. Les mêler à la liste chronologique paginée produirait un
> défaut visible — une non terminée vieille de trois mois s'afficherait dès la
> première page, puis se ferait dépasser par des lignes plus récentes à chaque
> « charger plus ». Elles ont donc leur bloc, épinglé en haut.

> ⚠ **`__name__` EN SECOND CRITÈRE DE TRI, SANS QUOI LA PAGINATION PERD DES
> LIGNES.** Deux opérations peuvent partager la même seconde — c'est courant en
> caisse. Un curseur posé sur le seul `createdAt` sauterait les ex æquo ou les
> rendrait deux fois. Firestore ajoute `__name__` dans la direction du dernier
> `orderBy`, donc l'index composite ci-dessous couvre déjà cette requête : le
> critère est gratuit, son absence coûterait des lignes perdues sans message.

> ⚠ **Le curseur est une PAIRE DE VALEURS, pas un `DocumentSnapshot`.** Un
> snapshot ne traverse pas la frontière du callable. On renvoie
> `{ createdAt: ms, chemin: doc.ref.path }`, et le serveur le reconstruit.

> ⚠ **La boutique vient du CHEMIN, pas du champ.** `doc.ref.parent.parent.id`
> fait foi ; `storeName` recopié dans le document peut dater d'un renommage. Le
> nom est résolu depuis `stores`, avec repli sur le champ recopié puis sur l'id.

> ⚠ **`stores` est relu à chaque page, et non transmis par l'appelant.** Une
> dizaine de documents par page coûte moins qu'un paramètre que le navigateur
> pourrait falsifier pour renommer une boutique à l'écran.

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

**Totaux** — et ils posent une question que la pagination rend aiguë :

> ⚠ **LES TOTAUX PORTENT SUR TOUT L'HISTORIQUE, PAS SUR LA PAGE CHARGÉE.** Un
> « 437 opérations » qui grandit à chaque « charger plus » ne veut rien dire, et
> pire : il se lit comme un total alors qu'il n'en est pas un. Le serveur les
> calcule donc avec une requête d'agrégation (`count()`, disponible côté Admin
> SDK) sur l'ENSEMBLE des lignes du client, indépendamment de la page. Ils sont
> renvoyés tels quels à chaque appel, et le panneau n'y touche pas.
>
> Si l'agrégation s'avérait indisponible sur ce projet, le repli est de ne PAS
> afficher de totaux plutôt que d'en afficher de faux.



```
operations        nombre d'opérations enregistrées pour cet agent
nonDatees         celles qui ne portent pas de date et ne peuvent donc pas être listées
resteAEncaisser   dépôts non terminés : ce que l'agent doit encore APPORTER
resteAPayer       retraits non terminés : ce que la boutique doit encore REMETTRE
nbEnAttente       nombre de non terminées
parBoutique       [{ storeId, storeName, operations }]
```

> ⚠ **CE SONT DES COMPTES, PAS DES SOMMES, ET C'EST UNE DÉCISION PRISE APRÈS
> MESURE** (2026-10-13, relecture de la Cloud Function). Cette spec portait
> « 12 300 000 déposés · 8 100 000 retirés ». Ces deux nombres ne peuvent pas
> être rendus exacts à bon compte : `cancelHistory` pose `statut: 'Annulée'` et
> `trashHistory` pose `statut: 'Supprimée'`, tous deux APRÈS avoir rendu l'argent
> aux soldes — mais le `montant` reste sur le document. Les sommer ferait dire au
> panneau qu'un agent a déposé une somme qui n'existe plus.
>
> Les exclure demanderait de soustraire des agrégats filtrés sur le statut ET sur
> le type, donc un index composite de plus et **deux énumérations** — celle des
> accents du type, celle des statuts d'annulation — dont chacune sous-estimerait
> en silence ce qu'elle ne connaît pas. On préfère ne rien afficher.
>
> Ce qui reste est exact et sans index supplémentaire : les COMPTES, qui disent
> combien d'opérations existent et où l'agent travaille — une ligne annulée est
> bien une opération qui a eu lieu —, et les deux montants d'attente, qui sont
> les seuls chiffres financiers du panneau et viennent des non terminées, lues en
> entier. Si les sommes générales se révèlent nécessaires, elles coûtent un index
> et une soustraction : c'est un lot séparé, pas un oubli.

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

Une fonction, `chargerHistoriqueClient(clientId, curseur)`, qui appelle le
callable et rend `{ enCours, lignes, totaux, curseurSuivant, encore }`. Mêmes
conventions d'erreur que `dealerService.js`.

Le cumul des pages vit dans un hook, `useHistoriqueClient(clientId)`, qui garde
la liste déjà lue, le curseur courant et l'état « encore ». Deux règles :

> ⚠ **Dédupliquer par identifiant à chaque page.** Une ligne écrite pendant la
> lecture peut décaler la pagination et faire revenir un document déjà affiché.
> `mergeHistoryPages` fait déjà exactement ça pour l'historique de la boutique.

> ⚠ **Un changement de client remet tout à zéro.** Sans cela, ouvrir le panneau
> d'un second agent lui empilerait les pages du premier.

### 4. `src/components/clients/HistoriqueClientPanel.jsx` — le panneau

Ouvert par la nouvelle colonne, fermé par `Échap` et par le fond.

```
OUEDRAOGO SALIF                                    [x]
Code 0123456 · N° 01234567 · POUYTENGA

437 opérations enregistrées
OUAGA 312 · BOBO 98 · KOUPELA 27

┌ EN COURS ─────────────────────────────────────────┐
│ 13/10  09:05  Retrait   100 000   OUAGA · Awa     │
│        reste 40 000 — en attente depuis 6 h       │
│ 09/10  11:20  Dépôt      80 000   BOBO · Salif    │
│        reste 80 000 — en attente depuis 4 j       │
│ À ENCAISSER 80 000 · À PAYER 40 000               │
└───────────────────────────────────────────────────┘

13/10  14:32   Dépôt      250 000   Validée           OUAGA · Awa
12/10  17:48   Dépôt       75 000   Encaissé Orange   BOBO · Salif
11/10  10:12   Dépôt      500 000   Supprimée         OUAGA · Awa
                       … 50 de plus sur 437 …
                        [ Charger plus ]
```

**Le bloc « EN COURS » est épinglé** : chargé en entier dès le premier appel,
jamais paginé, toujours en haut. C'est la réponse à « où en est son
remboursement ? », et elle ne doit pas dépendre du nombre de pages chargées.

**La liste chronologique est virtualisée et paginée.** `useWindowedRows`
(`src/hooks/useWindowedRows.js`) fenêtre déjà des lignes à hauteur fixe sans
dépendance, et `LoadMoreButton` existe. Un agent à 437 opérations doit pouvoir
être lu en entier : on charge par pages de 50, et on peut aller jusqu'au bout.

> ⚠ **LE RÉCAPITULATIF PAR BOUTIQUE EST UNE LIGNE, PAS UN TABLEAU.** Il répond à
> « qui travaille avec cet agent » d'un coup d'œil. Un second tableau au-dessus
> du premier doublerait la lecture pour une information que la colonne boutique
> porte déjà ligne à ligne.

Cinq états, et aucun ne doit ressembler à un autre :

- **chargement** — `SkeletonList`, le panneau est déjà ouvert avec l'identité ;
- **vide** — « Aucune opération pour cet agent », qui n'est pas une erreur ;
- **erreur** — `ErrorState` avec un bouton Réessayer ;
- **page suivante en cours** — le bouton seul passe à « Chargement… », la liste
  déjà lue ne bouge pas et ne clignote pas ;
- **tout chargé** — le bouton disparaît, remplacé par « 437 opérations, c'est
  tout ». Une liste qui s'arrête sans le dire laisse croire qu'il en manque.

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
- **Aucun filtre ni export.** L'historique se lit en entier, dans l'ordre. Un
  filtre par date ou par boutique est une fonctionnalité séparée, à ajouter si
  le besoin se présente.

## Risques

| Risque | Conséquence | Réponse |
|---|---|---|
| Index non déployés | la fonction échoue à chaque ouverture | les déployer AVANT la fonction ; le plan l'impose |
| Agent très actif | lecture illimitée à l'ouverture | pages de 50 : l'ouverture lit 50 lignes + les non terminées, le reste à la demande |
| Deux opérations à la même seconde | pagination qui saute ou répète des lignes | `__name__` en second critère de tri et dans le curseur |
| Curseur forgé par l'appelant | lecture hors périmètre | le curseur ne porte qu'une position dans un tri ; le filtre `clientId` est réimposé à chaque page, côté serveur |
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
