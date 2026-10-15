# L'espace du patron — un portail, des accès différents

```
Statut     : à faire
Périmètre  : MVP
Dépend de  : l'historique client (2026-10-13), livré
```

---

## Objectif

Le patron ouvre l'application sur son téléphone, cherche un agent par son code,
son numéro ou son nom, et voit en combien de temps cet agent ramène l'argent du
réseau. Il peut envoyer la fiche par WhatsApp, et consulter l'état des 84
boutiques — stock, espèces, crédit, retraits — avec le chiffre d'affaires du
réseau.

---

## Le problème

Les clients appellent le patron pour se plaindre, et ils ont souvent tort. Il n'a
aujourd'hui aucun moyen de vérifier : il raccroche sans savoir, ou il rappelle un
gérant qui regarde pour lui.

L'espace `/admin` existe pourtant depuis longtemps, avec neuf écrans. Aucun ne
répond à sa question. Et celui qui s'en approche le plus est cassé à l'échelle de
la base.

**Le défaut décisif.** `listAllClients` ([adminService.js:332](../../../src/services/adminService.js#L332))
charge **une page de 25 fiches**, puis filtre **en mémoire** sur ces 25 :

```js
const snap = await getDocs(query(collection(db, 'globalClients'), ...constraints))
let clients = docs.map(d => ({ id: d.id, ...d.data() }))
if (search.trim()) {
  clients = clients.filter(c => c.nom?.toLowerCase().includes(q) || …)
}
```

Sur 15 699 fiches, chercher un code agent revient à le chercher dans les 25
premières par date de création. La réponse est « Aucun agent » presque toujours.
Le geste central du patron ne marche pas — pas « marche mal » : ne marche pas.

C'est aussi ce qui tranche la question « nouveau projet ou pas ». Le problème n'a
jamais été l'absence d'un espace. C'était le contenu de celui qui existe.

---

## Pourquoi pas un nouveau projet

Tout le socle est là, et vérifié :

| | |
|---|---|
| Le rôle | `system_manager` existe ([firestore.rules:67](../../../firestore.rules#L67)) |
| L'espace | `/admin` et son garde de rôle ([App.jsx:141](../../../src/App.jsx#L141)) |
| Les droits de lecture globale | `globalClients`, `stores`, `networkBalances`, `history`, `drafts` — tous ouverts à `isSystemManager()` |
| L'installation sur le téléphone | l'application **est déjà** une PWA installable |
| L'historique inter-boutiques | livré le 2026-10-13, et sa callable autorise **déjà** `system_manager` ([listClientHistory.js:82](../../../functions/src/clients/listClientHistory.js#L82)) |

Un second projet branché sur le même backend ajouterait une deuxième
authentification, un deuxième déploiement, un deuxième jeu de dépendances à
maintenir et un deuxième périmètre à sécuriser — pour servir les mêmes documents
que ce dépôt lit déjà. Le gain serait nul et le coût permanent.

**Donc : le même portail, une porte d'entrée unique, des accès différents.**

---

## Ce que le patron voit, et les neuf écrans qui partent

Trois destinations, dont une accessible depuis la première.

| Écran | Chemin | Contenu |
|---|---|---|
| **Clients** | `/admin` | le tableau existant, 11 colonnes, colonne Historique comprise |
| **Historique client** | `/admin/clients/:clientId/historique` | la fiche, les totaux, les opérations toutes boutiques, l'envoi WhatsApp |
| **Boutiques** | `/admin/boutiques` | les 84 boutiques × 4 soldes, et le chiffre d'affaires du réseau |

Et ce qui disparaît :

| Écran actuel | Sort |
|---|---|
| `AdminDashboard` — Vue générale | supprimé, remplacé par le tableau |
| `AdminStores` — Boutiques | supprimé, remplacé par l'écran Boutiques |
| `AdminUsers` — Utilisateurs | supprimé |
| `AdminDealer`, `AdminDealerInventory` | supprimés |
| `AdminReports` — Rapports | supprimé |
| `AdminHistory` — Historique consolidé | supprimé, remplacé par l'historique **par client** |
| `AdminProfile` — Profil | supprimé, le nom et la déconnexion vivent dans le shell |
| `AdminClients` — Clients | **remplacé** par le tableau réutilisé |

**⚠ Vérifié avant de proposer la suppression : rien d'exploitable n'est perdu.**
`adminService.js` expose 17 fonctions, toutes `list*` / `get*` / `normalize*`.
Aucun `addDoc`, `setDoc`, `updateDoc`, `deleteDoc` ni `httpsCallable` dans tout
l'espace admin. Ces écrans ne créent ni boutique ni compte — l'ouverture d'une
boutique et la création d'un utilisateur passent par d'autres chemins. Supprimer
l'espace ne retire donc **aucune capacité**, seulement des vues.

Les anciennes adresses redirigent vers `/admin` au lieu de tomber en 404 : un
signet ou un raccourci PWA doit toujours mener quelque part. C'est le
raisonnement déjà écrit dans [App.jsx:109-115](../../../src/App.jsx#L109-L115)
pour le tableau de bord boutique.

**Le rôle garde son nom technique `system_manager`.** Le renommer en « patron »
obligerait à toucher les règles, les documents utilisateurs existants et les
tests qui les tiennent — pour un mot que personne ne voit à l'écran.

---

## Architecture

### 1. Le shell — `src/layouts/AdminLayout.jsx`

La barre latérale de 240 px et ses trois sections (`Principal`, `Supervision`,
`Administration`) existent pour naviguer entre neuf destinations. Avec deux, elle
n'a plus d'objet — et sur un téléphone elle coûte un bouton hamburger, un
overlay et un geste avant d'atteindre quoi que ce soit.

Elle est remplacée par **deux onglets en pied d'écran**, le motif que le pouce
atteint sans déplacer la main. `ADMIN_NAV_ITEMS`
([navigation.js:84](../../../src/constants/navigation.js#L84)) passe de neuf
entrées à deux.

### 2. Le tableau — réutilisation de `ClientsTable`

Le tableau du gérant est repris tel quel : `TABLE_HEADERS`
([constants/index.js:39](../../../src/constants/index.js#L39)), `ClientsTable`,
`TableRow`, et la colonne `historique` ajoutée le 2026-10-13. Le patron voit la
même chose que ses gérants, pour toute la base.

**Aucune répartition par boutique, et c'est structurel.** Un code agent désigne
un commerce, pas une relation avec une boutique — c'est précisément le
raisonnement de `_refuserDoublonAgent`
([firestore.js:890](../../../src/services/firestore.js#L890)), qui refuse un code
déjà pris **dans toute la base**. Partitionner la liste par boutique
contredirait le modèle de données.

**Deux ajustements pour le téléphone**, et deux seulement :

- la colonne **Nom** est figée (`position: sticky; left: 0`). En faisant défiler
  onze colonnes vers la droite, sans elle, les chiffres n'appartiennent plus à
  personne ;
- l'en-tête du tableau est figé en haut de sa zone de défilement.

La recherche est `chercherClients`
([rechercheClients.js](../../../src/utils/rechercheClients.js)), déjà écrit, déjà
testé (`tc-252`) : accents pliés, tous les mots exigés dans n'importe quel ordre,
numéros comparés en chiffres seuls, et classement — identifiant exact d'abord.
**Aucune ligne de recherche n'est écrite pour cet écran.**

### 3. `subscribeToAllClients()` — le chemin global, nommé

`subscribeToClients` ([firestore.js:975](../../../src/services/firestore.js#L975))
appelle `requireActiveStore()`, qui lève *« Boutique active introuvable. Veuillez
vous reconnecter. »* ([firestore.js:141](../../../src/services/firestore.js#L141)).
Le patron n'a pas de `storeId` : l'abonnement échouerait chez lui.

**Le garde-fou n'est pas assoupli, un second chemin est écrit.** Assouplir
`requireActiveStore` serait une ligne, mais ce contrôle est ce qui empêche les
gérants de lire la base d'une autre boutique. Le desserrer pour le confort
d'un seul utilisateur retirerait silencieusement une protection qui sert à tous les
autres — et le jour où ça fuite, personne ne se souviendra que c'était pour le
patron.

`subscribeToAllClients()` est donc une fonction distincte, qui :

- exige le rôle `system_manager` et refuse tout autre rôle ;
- s'abonne à `globalClients` sans filtre de boutique ;
- ne touche pas au chemin du gérant, qui garde son `requireActiveStore()`.

Une relecture voit immédiatement lequel des deux chemins elle regarde.

### 4. La page historique — `listClientHistory`, inchangée

La callable existe, autorise `system_manager`, et renvoie déjà la date avec
l'heure, le code agent de règlement et les durées. **Rien à faire côté serveur.**

Le panneau `HistoriqueClientPanel` devient une **page** routée. Un panneau se
ferme d'un geste accidentel et ne se partage pas ; une page a une adresse, un
bouton retour, et survit à une rotation d'écran.

**La moyenne des durées** est le seul calcul nouveau de cet écran.
`dureeDe(transaction)` ([attente.js:147](../../../src/utils/attente.js#L147))
rend déjà `validatedAt − createdAt` par opération — le chronomètre des non
terminées arrêté au règlement. La moyenne s'en déduit.

> **⚠ La moyenne ne porte pas sur toutes les opérations, et l'écran doit le
> dire.** `dureeDe` rend `null` dans deux cas, et aucun n'est un échec : une
> opération validée d'un seul geste au formulaire n'a jamais attendu (pas de
> `validatedAt`), et une durée nulle signale une création-validation dans la même
> écriture serveur. La moyenne porte donc sur les opérations qui ont réellement
> patienté. Afficher « paie en 9 j » sous un compteur de 24 opérations dont 6
> seulement sont mesurées ferait lire une statistique là où il y en a une autre :
> l'écran annonce **sur combien d'opérations** la moyenne est calculée.

### 5. L'envoi WhatsApp

Un lien `https://wa.me/?text=<fiche encodée>`. Aucun serveur, aucune dépendance,
aucune donnée qui sort ailleurs que dans l'application que le patron choisit.

Le texte est en **texte simple**, sans mise en forme à interpréter : nom, code
agent, numéro, localité, boutique, situation, délai moyen, et les quatre
dernières opérations. Il se lit tel quel sur n'importe quel téléphone.

**Le numéro du destinataire n'est pas pré-rempli** : `wa.me` sans numéro ouvre le
sélecteur de contacts, et le patron choisit. Pré-remplir le numéro du client
supposerait qu'on envoie toujours la fiche à l'intéressé — ce qui n'est pas le
cas quand il s'agit de la montrer à un gérant.

> **⚠ Ce bouton fait sortir la fiche d'un client de l'application.** Il est
> volontaire et demandé, mais il mérite d'être nommé : à partir de ce geste, la
> donnée vit dans une conversation WhatsApp que le CRM ne contrôle plus.

### 6. L'écran Boutiques — quatre soldes, tous déjà calculés

Par boutique : **stock**, **espèces**, **crédit · argent dehors**, **retrait ·
clients non payés**.

Les deux derniers sont exactement la distinction qu'`argentDehors.js` écrit déjà,
dans ces termes :

> *Dépôt non terminé — la boutique a envoyé l'e-float au client, mais n'a pas
> encore encaissé son argent. Le client lui DOIT ce montant. Retrait non
> terminé — le client a envoyé son e-float à la boutique, mais n'est pas repassé
> chercher son argent. La boutique lui DOIT ce montant.*

Deux sources, toutes deux existantes :

- **stock et espèces** — `listNetworkCaisses()`
  ([dealerService.js:209](../../../src/services/dealerService.js#L209)) : deux
  requêtes pour tout le réseau, quel que soit le nombre de boutiques. Les règles
  l'autorisent déjà au patron ([firestore.rules:538](../../../firestore.rules#L538)) ;
- **crédit et retrait** — la callable `listOutstandingDrafts`, qui agrège
  côté serveur et ne renvoie que les montants par boutique.

> **⚠ 84 boutiques, pas neuf — et j'avais dessiné cet écran pour neuf.**
> Le réseau réel en compte **84** : `specs/ROADMAP.md` l'énonce en tête, et les
> commentaires de `listNetworkCaisses` comptent « 84 fiches + 84 documents de
> soldes ». Une liste de 84 cartes sur un téléphone ne se consulte pas sans tri
> ni filtre.

`caissesReseau.js` les a déjà — et c'est précisément pourquoi ils existent :
`TRIS` et `trierCaisses` (défaut `nom-asc`), `filtrerCaisses`, et
`construireEchelle` / `largeurBarre`, qui posent les 84 caisses sur une échelle
commune. L'écran Boutiques les réutilise : **aucun tri, aucun filtre, aucune
échelle n'est réécrit.** La recherche de boutique porte sur le nom.

**La seule modification serveur de ce chantier** est son garde de rôle, qui dit
aujourd'hui :

```js
if (profile.role !== 'dealer') {
  throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée au dealer.')
}
```

Il devient une liste de rôles autorisés incluant `system_manager`. **Et il
continue de refuser `store_admin`, `member` et un appel non authentifié** — un
test le tient dans les deux sens.

> **⚠ Pourquoi la callable, alors que les règles autorisent le patron à lire
> `drafts` en collection-group ([firestore.rules:563](../../../firestore.rules#L563)).**
> Parce qu'une lecture directe ferait descendre tous les brouillons non soldés
> du réseau sur un téléphone pour n'en afficher que 84 sommes. La callable
> agrège et renvoie les montants. Le code pur `agregerArgentDehors` est de toute
> façon le même des deux côtés.

### 7. Le chiffre d'affaires — journalier par défaut, sélecteur de mois

Le jour est le défaut : c'est la question du matin, et c'est la requête la moins
chère. Un sélecteur permet de choisir un mois.

Une **requête d'agrégation** sur le groupe de collections `history` :

```js
getAggregateFromServer(
  query(collectionGroup(db, 'history'),
        where('createdAt', '>=', debut),
        where('createdAt', '<', fin)),
  { total: sum('montant') },
)
```

- **Les règles l'autorisent déjà** : `match /{path=**}/history/{docId} { allow
  read: if isSystemManager(); }` ([firestore.rules:557](../../../firestore.rules#L557)).
- **L'index existe déjà** : la surcharge de champ `history.createdAt` couvre
  `COLLECTION_GROUP` en ascendant **et** descendant.
- **Aucune Cloud Function.** Une agrégation est facturée environ une lecture par
  millier de documents parcourus, pas une par document.

**« Aujourd'hui » désigne la journée d'exploitation, pas la journée UTC.**
`getBusinessDayBounds(dateKey)` ([businessDate.js:88](../../../src/utils/businessDate.js#L88))
rend les bornes d'un jour dans le fuseau du profil client — pour C2EGF,
`Africa/Ouagadougou`. Les deux coïncident aujourd'hui, le Burkina étant à UTC+0 ;
le profil porte néanmoins le fuseau pour qu'une autre instance du produit
n'hérite pas d'un découpage faux. Le mois se borne par la même fonction. Sans
cette précision, deux implémentations également défendables donneraient deux
chiffres d'affaires différents.

**L'index qui manque.** Exclure les opérations annulées demande un filtre sur
`statut`, donc un index composite `statut` + `createdAt` au périmètre
`COLLECTION_GROUP`. `compteCommeVolume`
([reseauStats.js:57](../../../src/utils/reseauStats.js#L57)) dit déjà ce qui
compte : ni annulée, ni en attente de règlement.

> **⚠ Une erreur que j'ai commise en concevant, et qui est corrigée ici.**
> J'avais annoncé le chiffre d'affaires comme le morceau le plus lourd du
> chantier, en ayant vérifié qu'aucune des 26 Cloud Functions ne somme quoi que
> ce soit — ce qui était vrai — mais sans avoir regardé les index ni les
> agrégations. C'est le morceau le plus léger des trois ajouts.

---

## L'arbitrage assumé

**Le téléphone du patron contient toute la base clients hors-ligne.**

L'abonnement à `globalClients` plus la persistance active
(`persistentLocalCache` + `persistentMultipleTabManager`,
[firebase.js:76](../../../src/config/firebase.js#L76)) déposent 15 699 noms,
numéros et codes agent dans le stockage de l'appareil. Perdu ou volé, le fichier
part avec.

> **⚠ La persistance est conditionnelle, et ce chantier en dépend.**
> `firebase.js` ne l'active que si `runtime.production` **et**
> `VITE_FIRESTORE_OFFLINE_PERSISTENCE === 'true'`. Vérifié : le drapeau vaut
> `true` dans `.env.vercel` et dans `.vercel/.env.production.local`, et il est
> compilé à `"true"` dans le bundle livré. Mais si quelqu'un le passe à `false`,
> la recherche du patron cesse de fonctionner hors-ligne et chaque ouverture
> retélécharge la base. Ce drapeau est donc une dépendance de cet espace, pas
> un réglage de confort.

C'est déjà vrai des appareils des gérants, donc ce n'est pas un recul. Mais
un patron se déplace davantage, et ce fait doit être écrit plutôt que découvert.

**Ce qu'on achète en échange** : une recherche instantanée, qui marche sans
réseau. Au téléphone avec un client qui s'énerve, la latence compte plus que la
bande passante, et le hors-ligne n'est pas un confort.

**Le chemin de repli, si cet arbitrage est refusé plus tard** : une callable de
recherche côté serveur. Les charges utiles deviennent minuscules, rien ne reste
sur l'appareil, mais chaque recherche exige le réseau et la logique de classement
doit être réécrite — `functions/` ne peut rien importer de `src/`.

---

## Ce que ça ne fait pas

- **Aucune écriture.** Le patron ne modifie, ne crée et ne supprime rien. Son
  espace est en lecture, comme l'espace admin l'était déjà.
- **Pas de filtre par boutique** sur les clients. Les fiches sont communes.
- **Pas de chiffre d'affaires par boutique** — le total réseau seulement.
- **Pas de réécriture de `listClientHistory`.** Elle convient telle quelle.
- **Pas d'App Check**, toujours pas implémenté dans le produit. Le signaler reste
  une recommandation de l'audit du 2026-10-14, hors de ce chantier.
- **Pas de correction du trou d'`updateClient`** (anti-doublon absent côté
  modification), connu et documenté ailleurs.

---

## Risques

| Risque | Ce qu'on en fait |
|---|---|
| **La première synchronisation.** ~470 octets par fiche × 15 699 → **3 à 4 Mo transférés**, **10 à 20 Mo résidents**. ⚠ C'est un **calcul à partir de la liste des champs, pas une mesure.** | Mesurable en lisant 50 fiches en production et en extrapolant — 50 lectures. À faire avant l'implémentation si le chiffre doit être tenu. |
| **L'index de statut manquant** ferait échouer la requête de CA, ou la rendrait fausse si on retire le filtre. | L'index part **avant** le code, comme pour l'historique client. |
| **Supprimer neuf écrans routés** est une décision client, pas un nettoyage. | Validé explicitement : « Personne n'en a besoin — on enlève ». Git garde les fichiers. |
| **La moyenne des durées** peut porter sur très peu d'opérations. | L'écran annonce l'effectif. Un test l'exige. |
| **Le bouton WhatsApp** fait sortir la fiche du CRM. | Demandé, et nommé comme tel dans cette spec. |

---

## Vérification

Ce qui est déjà tenu et ne doit pas régresser : `tc-252` (recherche), `tc-209`
(argent dehors), `tc-261` (panneau historique), `tc-102` (tableau clients).

Ce qui est à écrire :

- `subscribeToAllClients` **refuse** `store_admin`, `member`, `dealer` et un
  appel non authentifié ; et `subscribeToClients` **conserve** son
  `requireActiveStore()` — un test qui échoue si quelqu'un l'assouplit ;
- la moyenne des durées ignore les opérations sans `validatedAt`, et **publie
  l'effectif** sur lequel elle porte ;
- `listOutstandingDrafts` accepte `system_manager` **et refuse toujours** les
  trois autres rôles et l'appel anonyme ;
- le chiffre d'affaires **exclut** les opérations annulées ;
- les quatre états de panne : CA indisponible affiche « Chiffre indisponible »
  et **jamais `0`** (un zéro se lit comme une journée sans activité) ; une caisse
  illisible fait dire à la somme qu'elle est incomplète ; crédit/retrait en échec
  affichent « — » sans effacer les soldes ; la recherche hors-ligne fonctionne et
  l'écran dit de quand datent les données ;
- l'écran Boutiques reste consultable à **84 lignes** : le tri par défaut
  s'applique, le filtre par nom réduit la liste, et rien ne déborde à 390 px ;

- la colonne Nom reste figée au défilement horizontal, à 390 px ;
- les neuf anciennes adresses redirigent vers `/admin` et ne rendent pas de 404.

---

## Découpage en lots

| Lot | Contenu | Dépend de |
|---|---|---|
| **L1** | Le shell : deux onglets, suppression des neuf écrans et de leurs routes, redirections | aucune |
| **L2** | Le tableau : `subscribeToAllClients`, réutilisation de `ClientsTable`, colonne figée | L1 |
| **L3** | La page historique : panneau → page routée, moyenne des durées avec son effectif | L2 |
| **L4** | L'envoi WhatsApp | L3 |
| **L5** | L'écran Boutiques : quatre soldes, élargissement du rôle de `listOutstandingDrafts` | L1 |
| **L6** | Le chiffre d'affaires : index de statut, agrégation, journalier et sélecteur de mois | L5 |

L1 d'abord parce que tout le reste vit dans le shell. L5 et L6 sont indépendants
de L2–L4 et peuvent être menés en parallèle.

---

## Déploiement

**Un déploiement est une décision humaine, exécutée par un humain** (AGENTS.md).
Rien ici n'est lancé par un agent.

L'ordre, et il compte :

```bash
# 1. L'index de statut D'ABORD : sans lui, la requête de CA échoue.
#    Attendre « Enabled » dans la console avant l'étape 2.
firebase deploy --only firestore:indexes

# 2. La callable, pour son garde de rôle élargi.
firebase deploy --only "functions:listOutstandingDrafts"

# 3. L'application, qui seule rend les écrans visibles.
#    (Vercel, depuis la branche)
```

Les règles ne bougent pas : chaque lecture dont cet espace a besoin est déjà
autorisée à `isSystemManager()`. **Aucune permission n'est élargie côté
Firestore.**
