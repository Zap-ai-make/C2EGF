# Rester dans le quota gratuit de Firebase

> Analyse du 2026-11-03, faite **en lecture seule** à partir de l'analyse de coûts
> d'octobre 2026 rendue par Gemini Cloud Assist, confrontée au code. Aucun
> correctif n'est appliqué ici : ce document découpe le travail en lots.
>
> **Objectif fixé par le client : ne rien payer au-delà du quota gratuit.**

---

## 0. Le budget, en une ligne

**50 000 lectures par jour pour toute la flotte, soit ~600 par boutique et par jour**
(84 boutiques, `specs/ROADMAP.md`).

| Poste | Gratuit | Octobre 2026 (Cloud Assist) |
|---|---|---|
| Lectures Firestore | 50 000 / jour | 8,7 M, soit ~281 000 / jour : **5,6 × le quota** — 4,41 $ |
| Écritures | 20 000 / jour | non chiffré |
| Suppressions | 20 000 / jour | non chiffré |
| Stockage | 1 Gio | à relever (console) |
| Sortie réseau | 10 Gio / mois | à relever |
| Cloud Run (functions) | 180 000 vCPU-s · 360 000 Gio-s · 2 M requêtes / mois, par compte de facturation | 1,06 $ de CPU (`storeTransactionCommand` 0,63 $, `addTransactionPayment` 0,44 $) |
| Vertex AI / Agent Platform | **aucun** | 0,14 $ |

Trois faits qui cadrent tout le reste :

- **Le quota gratuit ne vaut que pour la base `(default)`.** Une base nommée paie
  dès la première lecture. Ne jamais en créer une sur `c2egf-b0b5a`, même pour un
  essai.
- **Le tarif réel est celui du multi-région.** (8,7 M − 31 × 50 000) × 0,06 $ /
  100 000 ≈ 4,29 $, pour 4,41 $ facturés : la base est en `nam5`, deux fois le
  prix régional. Ça ne change rien une fois sous le quota.
- **Le compteur journalier repart à minuit, heure du Pacifique** — 7 h ou 8 h du
  matin à Ouagadougou selon la saison.

Un seul chargement complet de la base clients coûte **15 679 lectures : le budget
journalier de 26 boutiques.**

---

## 1. Ce que Cloud Assist a dit, et ce qui ne s'applique pas ici

Cloud Assist n'a pas lu le code. Plusieurs de ses conseils sont faux en général ou
contre-productifs sur ce projet. **Ne pas les appliquer tels quels.**

| Conseil | Ce qui est vrai | Verdict |
|---|---|---|
| « Préférez `get()` à `onSnapshot()` » | La persistance hors ligne est active en prod (`.env.vercel`, `VITE_FIRESTORE_OFFLINE_PERSISTENCE=true`). Un `getDocs` en ligne repart au serveur et facture **chaque** document, à chaque fois. Une écoute rouverte en moins de 30 min ne facture que ce qui a changé. | **Inversé ici.** Le problème n'est pas l'écoute, c'est la **taille** du résultat écouté. |
| « Chaque index composite renchérit chaque écriture » | Une écriture est facturée **une fois par document**, quels que soient les index. Les index coûtent du stockage et de la latence. | Faux. Supprimer les index composites ne rapporte rien de mesurable (§B3). |
| « TTL : suppressions gratuites » | Les suppressions TTL sont facturées comme des suppressions, **et exclues** du quota gratuit de 20 000 / jour. | Faux — et la piste d'audit financière interdit de toute façon d'effacer (`AGENTS.md`). |
| « Cache CDN via `Cache-Control` » | Nos functions sont des callables : POST authentifiés, réponse propre à l'utilisateur. | Inapplicable. |
| « Memorystore Redis », « `min-instances: 1` » | Coûts fixes mensuels. | Contraire à l'objectif. |
| « Migrer la base en `europe-west1` » | L'emplacement est immuable. Il faudrait une base nommée (sans quota gratuit) ou supprimer et recréer `(default)` avec export/import et interruption. | À écarter. Rapprocher les **functions** de la base (§C1). |
| « Custom claims pour les règles » | Déjà chiffré : la taxe des règles pèse 4 à 6 % (`docs/ia/COUT-LECTURES.md`). | Pas prioritaire. |
| « App Check contre les bots » | Les règles exigent déjà un profil (`hasProfile()`), l'auto-inscription est fermée. reCAPTCHA Enterprise est gratuit jusqu'à **10 000 évaluations / mois**, payant au-delà. | Peut **ajouter** un coût. Laisser App Check à l'assistant (§F). |
| « Un routeur unique : −90 % de stockage d'images » | Le stockage des images se règle par une politique de nettoyage (§C5). | Mauvais argument. Le vrai gain d'un regroupement : démarrages à froid et quota vCPU (§C4). |

Ce qu'il a eu raison de signaler : les émulateurs, la pagination, les boucles de
lectures, le décalage de région (avec le mauvais remède) et le CPU surdimensionné
(avec une réserve, §C3).

---

## Partie A — Les lectures Firestore (l'essentiel du gain)

### A1. La base clients entière, écoutée par chaque boutique — **la cause principale**

**Où.** `subscribeToClients` ([src/services/firestore.js:975](../src/services/firestore.js#L975))
ouvre un `onSnapshot` **sans filtre ni limite** sur `globalClients`. Il est monté
par [src/context/ClientsContext.jsx:92](../src/context/ClientsContext.jsx#L92) à
chaque session boutique.

**Ce que ça coûte.** 15 679 lectures au premier chargement sur un appareil, **puis
à chaque reconnexion après plus de 30 minutes** : téléphone en veille, réseau
mobile coupé, PWA rouverte le lendemain. La documentation est explicite : la
reprise est alors facturée comme une requête neuve. Un seul appareil réveillé
trois fois dans la journée consomme le quota de toute la flotte.

**Remède recommandé : un annuaire en tranches.**

- Une collection `annuaireClients/{tranche}` d'environ **64 documents**, ~245
  entrées chacun, ~22 Ko.
- Chaque entrée ne porte que ce que lisent la recherche et la liste : id, `nom`,
  `prenom`, `codeAgent`, `numeroAgent`, `orange`, téléphone — à confirmer par
  l'inventaire ci-dessous.
- La tranche d'un client est fixée par un hachage de son id : elle ne bouge
  jamais.
- **Chaque tranche tient dans UN champ texte, exempté d'index.** Un tableau de
  ~245 objets × 7 champs serait indexé champ par champ, et la limite est de
  40 000 entrées d'index par document. Un texte se lit en entier, ne s'indexe pas,
  et ne bute sur aucune limite.
- La fiche complète se lit par `getDoc` à l'ouverture : **1 lecture**.

**Pourquoi 64 tranches, et pas un seul gros document.** Un document de ~1,4 Mo
serait renvoyé **en entier** à chaque appareil connecté, à chaque modification de
fiche : 84 appareils × 1,4 Mo × 50 modifications par jour ≈ 6 Go par jour, au-delà
des 10 Gio gratuits **par mois**. Le compromis se règle sur deux curseurs :

- le **nombre** de tranches = le coût en lectures d'un chargement complet ;
- la **taille** d'une tranche = le volume renvoyé par modification.

À 64 × 22 Ko, la même charge fait ~3 Go par mois.

| | Aujourd'hui | Avec l'annuaire |
|---|---:|---:|
| Chargement complet | 15 679 lectures | 64 lectures |
| Une fiche modifiée, par appareil connecté | 1 lecture, ~1 Ko | 1 lecture, ~22 Ko |
| Données mobiles d'un chargement | la base entière, tous champs | ~1,4 Mo |

**Entretien.** Un déclencheur `onDocumentWritten('globalClients/{clientId}')`
réécrit la tranche concernée dans une transaction : 1 lecture + 1 écriture par
fiche modifiée. Pour une base `nam5`, **Eventarc impose `us-central1`** à ce
déclencheur — c'est une raison de plus pour §C1.

**Prérequis et risques.**

1. **Inventorier les champs** que lisent les huit consommateurs de
   `ClientsContext` avant de figer le contenu d'une entrée :
   `components/assistant/PanneauAssistant.jsx`, `components/ClientForm.jsx`,
   `components/dashboard/Commerciaux.jsx`, `hooks/useClients.js`,
   `pages/Clients.jsx`, `pages/Dashboard.jsx`, `pages/Formulaire.jsx`,
   `pages/Transactions.jsx`.
2. **Changement de comportement à caractériser** : une fiche créée n'apparaît dans
   l'annuaire qu'après le passage du déclencheur, soit une ou deux secondes. L'écran
   qui la crée la reçoit déjà en retour (`addClient` rend la fiche) ; les autres
   boutiques la verront avec ce délai.
3. **Règles** : `match /annuaireClients/{tranche} { allow read: if hasProfile(); allow write: if false; }`.
   L'exposition est exactement celle de `globalClients` aujourd'hui, ni plus ni
   moins.
4. **Construction initiale** : 15 679 lectures et 64 écritures, une seule fois, sur
   la **production**. `scripts/lib/adminApp.mjs` est verrouillé sur `demo-*` et doit
   le rester. Le premier remplissage est donc une **décision humaine**, à préparer
   et à faire lancer par le client.
5. Tester à deux boutiques au moins (`AGENTS.md`).

**Côté serveur — fait le 2026-11-04 (A1a), en ligne et rempli le 2026-11-06.**
Règles, index et les deux functions sont déployés. Les functions avaient échoué
au premier essai, comme attendu pour une première région, et sont passées à la
relance (`docs/deployer-les-functions.md` §3). Le premier remplissage a répondu
`{"fiches":15750,"tranches":64}`.

- `functions/src/clients/annuaireClients.js` contient le découpage en tranches,
  le contenu d'une entrée, le déclencheur `majAnnuaireClients` et la
  reconstruction `reconstruireAnnuaireClients`. Les deux tournent en
  `us-central1`.
- Ce qui a changé par rapport au plan ci-dessus :
  - **Pas de transaction dans le déclencheur.** Il relit la fiche, puis remplace
    l'entrée `entrees.<id>` d'un seul `set` avec `mergeFields` : 1 lecture et 1
    écriture, quel que soit l'ordre d'arrivée des événements.
  - **Une entrée porte 17 champs**, vides compris : tous ceux du formulaire, de
    l'export, du tri et du code agent. TC-340 lit ces champs dans le code source
    et échoue si l'un manque.
  - **Le document `_etat` est écrit en dernier** par la reconstruction. Le
    navigateur ne lira l'annuaire que lorsqu'il dit `complet` : avant, il garde
    l'écoute actuelle de `globalClients`.
  - **La reconstruction est une route HTTP privée** (`invoker: 'private'`),
    appelable seulement par un compte IAM du projet. Aucun écran n'y donne accès,
    et aucun script du dépôt ne vise la production.
- Les règles ouvrent la lecture exactement comme pour `globalClients` et
  interdisent toute écriture depuis le navigateur. Le champ `entrees` est
  exempté d'index dans `firestore.indexes.json`.
- Tests : TC-340 (module pur), TC-341 (handlers sur émulateur), TC-342 (règles, à
  deux boutiques), TC-036 [WRA-08, 10, 11].

**Déploiement — décision et exécution humaines, dans cet ordre :**

```powershell
firebase use production
firebase deploy --only "firestore:rules,firestore:indexes"
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase deploy --only "functions:majAnnuaireClients,functions:reconstruireAnnuaireClients"
```

Puis, **un soir où personne ne saisit**, dans Cloud Shell :

```bash
curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://us-central1-c2egf-b0b5a.cloudfunctions.net/reconstruireAnnuaireClients
```

> **Cloud Shell, et non le PowerShell du poste.** Cloud Shell est le terminal
> du navigateur, ouvert depuis la console Google Cloud (icône `>_` en haut à
> droite, ou `https://console.cloud.google.com/?project=c2egf-b0b5a&cloudshell=true`).
> Il est en bash, déjà connecté au compte, et `gcloud` y est installé. Dans
> PowerShell, la commande échoue de trois façons à la fois : `gcloud` n'est pas
> installé sur le poste, `curl` y est un alias d'`Invoke-WebRequest` qui
> refuse `-H "…"`, et la barre oblique inverse n'y continue pas la ligne.

La réponse attendue est `{"fiches":15679,"tranches":64}` (au nombre de fiches
près). Un `404` veut dire que la function n'est pas déployée : il faut relancer
le déploiement. Un `403` veut dire que le compte de Cloud Shell n'a pas le droit
d'appeler la function. Le remplissage coûte ~15 700 lectures, une seule fois. Tant que le front
(lot A1b) n'est pas déployé, l'application n'en lit rien : ce déploiement est
sans effet visible.

**Côté navigateur — fait le 2026-11-04 (A1b), pas encore déployé.**

- `subscribeToClients` (boutiques) et `subscribeToAllClients` (patron) gardent
  leur nom et leur contrat : des fiches `{ id, ...champs }`, les erreurs vers
  `onError`. Les écrans n'ont pas changé. Seule la source change
  (`src/services/annuaireClients.js`) :
  - **l'annuaire**, dès que `_etat` dit `complet` ;
  - **sinon**, ou si sa lecture est refusée (règles pas encore déployées),
    **l'écoute de `globalClients`** en repli. Celle-ci se ferme dès que
    l'annuaire devient complet.
- **Le déploiement est donc sans danger dans n'importe quel ordre.** L'ordre
  économe reste : règles, functions, remplissage, puis front (Vercel). Un front
  déployé trop tôt fonctionne, mais lit `globalClients` en repli, et paie donc
  comme aujourd'hui.
- Le jeu d'essai des émulateurs remplit l'annuaire par la même route que la
  production : le développement passe par le même chemin.
- Vérifié sur les émulateurs :
  - une boutique et le patron voient leurs fiches par l'annuaire seul ;
  - une fiche ajoutée par une autre boutique apparaît d'elle-même ;
  - un `_etat` retiré fait basculer sur le repli sans perdre une ligne.
- Tests : TC-343 (bascule), TC-265 (12 à 15 pour l'annuaire ; 02 à 04
  réécrits pour le chemin de repli).
- **Reste à mesurer après déploiement :** les lectures quotidiennes dans la
  console, avant et après.

**Déployer le front : par GitHub, pas par le CLI.**

D'habitude, le front part par GitHub. Un push de `feat/espace-patron` déclenche
un build Vercel en **Preview**. Le même commit passe ensuite en **Production**,
quelques minutes plus tard : c'est ce que montrent les déploiements enregistrés
sur le dépôt depuis octobre 2026. Ce build part du dépôt et ne voit donc pas le
`.env`, qui n'est pas commité. Sans `VITE_FIREBASE_RUNTIME_MODE`, un build Vite
se met de lui-même en mode production.

Le CLI (`vercel --prod` depuis ce poste) est l'exception, et il a un piège : le
`.env` y vise les émulateurs depuis le lot E1.

Le CLI Vercel n'exclut pas `.env` de ce qu'il envoie. Sa liste par défaut
n'écarte que `.env.local` et `.env.*.local`, et il ignore `.gitignore`. Le build
distant lit donc le `.env` du poste, qui vise les émulateurs depuis le lot E1.
Les variables du projet Vercel l'emportent sur ce fichier, mais
`.env.vercel` ne définit ni `VITE_FIREBASE_RUNTIME_MODE` ni
`VITE_USE_FIREBASE_EMULATORS`. Ces deux-là viendraient donc du `.env`.

Le bundle porterait alors `development`, `true` et `c2egf-b0b5a`.
`src/config/firebaseRuntime.js` refuse ce mélange au démarrage (« Le projet
Firebase doit commencer par demo- hors production. »), d'où une page blanche dans
toutes les boutiques. Constaté le 2026-11-06 par deux builds locaux, sans rien
publier.

Si l'on doit passer par le CLI, le remède est de fixer ces valeurs au build :

```powershell
npx vercel --prod `
  --build-env VITE_FIREBASE_RUNTIME_MODE=production `
  --build-env VITE_USE_FIREBASE_EMULATORS=false `
  --build-env VITE_FIREBASE_PROJECT_ID=c2egf-b0b5a
```

Le CLI publie l'arbre de travail tel qu'il est sur le disque, et non un commit :
vérifier `git status` avant de publier.

**Alternatives, si l'annuaire est refusé :**

- **Recherche côté serveur.** Préfixe sur un nom normalisé, égalité sur les codes,
  `limit(20)` : ~20 lectures par recherche. Meilleur si l'on cherche peu ; pire
  dès ~30 recherches par boutique et par jour. Exige d'ajouter un champ normalisé
  à 15 679 fiches.
- **Synchronisation par différence.** `where('updatedAt', '>', dernierSync)` sur un
  cache local. Très économe, mais exige un `updatedAt` serveur partout et des
  suppressions logiques, sinon une fiche supprimée ne disparaît jamais.
- **Décision métier.** Ne lister que les clients de la boutique, et chercher les
  autres par code exact. Le produit a fait le choix inverse (une fiche est commune
  au réseau) : ce n'est pas à trancher côté développement.

### A2. Les écrans du patron

Branche `feat/espace-patron` — **à coordonner avec la fenêtre qui y travaille.**

- **Fait le 2026-11-04.**
  [src/pages/admin/PatronHistoriqueClient.jsx](../src/pages/admin/PatronHistoriqueClient.jsx)
  s'abonnait aux **15 679 fiches pour en trouver une seule**. Il écoute
  désormais le seul document, par `firestoreService.subscribeToClient` : **1
  lecture** à l'ouverture, plus une par modification.
  - Une écoute plutôt qu'un `getDoc` : l'ancien abonnement suivait en direct une
    fiche corrigée ou supprimée par une boutique, et un `getDoc` l'aurait figée.
  - Tests : TC-265-07 à 11 pour le service, TC-269-17 à 19 pour la page.
  - Vérifié sur les émulateurs : seule la fiche est écoutée, une correction faite
    pendant la consultation s'affiche, et une adresse inconnue répond
    « introuvable ».
- [src/pages/admin/PatronClients.jsx:61](../src/pages/admin/PatronClients.jsx#L61)
  rouvre `subscribeToAllClients` à chaque visite. Il passera par l'annuaire de §A1.

### A3. L'historique, lu deux fois à chaque ouverture

- [src/context/transactions.jsx:200](../src/context/transactions.jsx#L200)
  appelle `getHistoryPage()` : 101 lectures, toujours au serveur.
- [src/context/transactions.jsx:215](../src/context/transactions.jsx#L215) ouvre
  ensuite une écoute sur **les mêmes 100 dernières lignes**.
- Trois autres écoutes se chevauchent avec elles : la journée, les validées
  depuis ce matin, les ravitaillements dus. **Chaque écoute facture ses propres
  documents** : une ligne présente dans deux écoutes est payée deux fois.

**Remède :**

- la première page est le résultat de l'écoute, pas un `getDocs` de plus ;
- la fenêtre vivante passe de 100 à ~25 lignes, la taille d'un écran ;
- le temps réel reste réservé à la journée, aux non terminées et aux soldes ;
- l'historique ancien se charge par `getDocs` au défilement.

Gain : ~150 lectures par ouverture. Règle métier touchée (indicateurs du jour,
dette de ravitaillement, validations tardives) : **test de caractérisation
d'abord**, ces trois écoutes existent chacune pour un bug documenté dans
`historyService.js`.

**Découpé en deux lots, parce qu'un seul des deux change l'écran.**

**A3a — fait le 2026-11-06 : la première page sans `getDocs`.** L'ouverture
n'appelle plus `getHistoryPage`. Une seule écoute,
`subscribeToHistoryWindow` (`historyService.js`), sert les cent dernières
lignes en forme de page : `{ transactions, lastDoc, hasMore, fromCache }`.

- Son premier résultat **confirmé par le serveur** fige l'archive, le curseur de
  « plus » et `historyHasMore`, comme le faisait le `getDocs`. Ce n'est jamais un
  résultat venu du cache, qui peut être en retard (TC-344 [CH-08], TC-345
  [UL-02]).
- Cette confirmation n'arrive qu'avec `includeMetadataChanges`. Vérifié sur
  l'émulateur avec le vrai SDK : quand le cache disait déjà la même chose qu'au
  serveur, une écoute sans l'option ne reçoit jamais `fromCache: false`.
- Pas de délai d'abandon de trente secondes : le `getDocs` remplacé attendait
  le réseau aussi longtemps qu'il le fallait.
- `loading` retombe à la première réponse de la fenêtre, cache compris.
- Une erreur de la fenêtre passe par `onError`, comme les autres écoutes. Elle
  ne coupe plus les trois écoutes de complément, que l'échec du `getDocs`
  empêchait d'ouvrir (TC-345 [UL-04]).
- **L'écran ne change pas.** TC-344 décrit ce qui s'affiche avec un faux
  historique qui parle les deux langues (`tests/fixtures/fauxHistorique.js`) :
  ses huit cas passent sur l'ancien contexte comme sur le nouveau.
- Dans l'application, sur les émulateurs, avec 143 lignes : à l'ouverture, une
  seule requête de première page (101) au lieu de deux (101 + 100) ; « Charger
  les transactions précédentes » envoie une requête avec curseur, puis
  disparaît quand tout est là ; aucune erreur dans la console.

Gain : **101 lectures à chaque ouverture**. Une ouverture à chaud (écoute reprise
dans les 30 minutes) passe de 101 lectures à zéro, une ouverture à froid
d'environ 201 à 101.

**A3b — à décider : la fenêtre de 100 à ~25 lignes.** Encore ~75 lectures par
ouverture à froid. Mais l'écran change : avant le premier « plus », on ne voit
plus que la journée et les ~25 dernières lignes. La Corbeille et l'onglet
Ravitaillement, qui lisent la fenêtre, remontent moins loin. Chaque « plus »
coûte 101 lectures, donc une boutique qui remonte souvent dans son historique
pourrait y perdre. C'est une décision de l'utilisateur, pas un lot technique.

### A4. Le dealer

- `listAllActiveStores` ([src/services/dealerService.js:159](../src/services/dealerService.js#L159)) :
  84 lectures à chaque ouverture du formulaire.
- `listNetworkCaisses` ([src/services/dealerService.js:209](../src/services/dealerService.js#L209)) :
  84 + 84 lectures à chaque ouverture de l'écran des boutiques.
- Les deux sont des `getDocs`, donc au serveur à chaque fois. La liste des
  boutiques ne change presque jamais : lire d'abord le cache
  (`getDocsFromCache`), ou passer par une écoute que la persistance reprendra.

### A5. Les petits postes, acceptables en l'état

- Les badges (`snap.size`) coûtent au moins 1 lecture même sans résultat.
- La taxe des règles est de 1 à 2 lectures par requête.
- Les 12 agrégations de `chiffreAffaires` coûtent une poignée de lectures.

### Ce que ça donne

| Ouverture d'une session boutique | Lectures |
|---|---:|
| Aujourd'hui | ~16 000 |
| Après A1 + A3 | ~170 |

Avec ~600 lectures par boutique et par jour, cela laisse trois ouvertures « à
froid » quotidiennes par boutique.

---

## Partie B — Écritures et stockage

### B1. Le budget d'écritures, à surveiller

- Une opération `add` de `storeTransactionCommand` coûte **3 écritures** : la ligne,
  les soldes et le journal d'audit.
- Une validation coûte 3 écritures et 1 suppression.
- À pleine adoption (84 boutiques × ~60 opérations par jour), cela fait ~17 600
  écritures par jour, **tout près des 20 000**.
- Ne pas toucher au journal d'audit pour gagner de la marge. Le fusionner dans la
  ligne d'historique serait une décision d'audit, pas de développement.

### B2. Les exemptions d'index par champ — gain réel, risque faible

Firestore indexe automatiquement **chaque champ, y compris l'intérieur des
objets**. Les entrées d'index comptent dans le stockage facturé. Les cibles :

- `auditLogs` : les objets `beforeBalances`, `afterBalances`, `before` et `after`.
  Écrits par les functions, **jamais interrogés** (vérifié dans `src/` et
  `functions/src/` le 2026-11-03). La collection grossit sans fin.
- Le champ texte de l'annuaire (§A1).

Le mécanisme : `fieldOverrides` avec `"indexes": []` dans `firestore.indexes.json`.
**N'exempter jamais un champ filtré ou trié** : `createdAt`, `storeId`, `status`…
Relever d'abord le stockage réel dans la console, pour savoir si l'enjeu est déjà
présent.

### B3. Les index composites

Il y en a une trentaine dans `firestore.indexes.json`. Ne retirer que ceux dont la
requête a disparu du code. C'est de l'hygiène, sans effet mesurable sur la
facture.

### B4. Deux interdits

Pas de TTL (§1). Pas de base nommée (§0).

---

## Partie C — Cloud Functions / Cloud Run

> **D'abord, vérifier que le dépassement existe.** Les 1,06 $ sont-ils nets du
> quota gratuit ? Dans Facturation > Rapports, grouper par SKU et comparer la
> consommation « CPU Allocation Time » aux 180 000 vCPU-s gratuits. À pleine
> adoption, `storeTransactionCommand` seul approche ~150 000 appels par mois : le
> quota CPU est menacé même s'il ne l'est pas encore.

### C1. Mettre les functions à côté de la base

- Les functions sont en `europe-west1`
  ([functions/src/index.js:90](../functions/src/index.js#L90)) ; la base est en
  `nam5` (us-central1 + us-central2).
- Chaque appel traverse l'Atlantique plusieurs fois **en série**. Exemple :
  `storeTransactionCommand` lit le profil, puis la boutique, puis les soldes,
  puis éventuellement la non terminée, puis valide la transaction, soit 4 à 5
  allers-retours.
- Cloud Run facture ce temps d'attente à 1 vCPU.

En `us-central1`, ces allers-retours durent quelques millisecondes. Le trajet
navigateur → function s'allonge d'environ 100 ms, mais le navigateur parle **déjà**
directement à `nam5` pour tout le reste. C'est aussi la région qu'impose le
déclencheur de §A1.

À changer :

- la région dans `CALLABLE` ([functions/src/index.js:90](../functions/src/index.js#L90)) ;
- la région côté client, `getFunctions(app, 'europe-west1')`
  ([src/config/firebase.js:91](../src/config/firebase.js#L91)).

Ordre :

1. déployer les nouvelles functions à côté des anciennes ;
2. basculer le front ;
3. supprimer les anciennes.

Le quota vCPU de `us-central1` est neuf : le piège décrit dans
`docs/deployer-les-functions.md` peut s'y reproduire. **Déploiement : décision
et exécution humaines.**

### C2. Grouper les lectures d'une transaction

`readActor` ([functions/src/storeTransactions/storeTransactionCommand.js:180](../functions/src/storeTransactions/storeTransactionCommand.js#L180))
enchaîne deux `t.get`, suivis d'un troisième pour les soldes. Un seul
`t.getAll(profil, boutique, soldes[, non terminée])` fait un seul aller-retour.
Les lectures facturées restent les mêmes, mais le temps facturé baisse. À regarder
de la même façon dans les autres handlers.

### C3. Réduire le CPU alloué — à mesurer avant d'adopter

- firebase-functions v2 alloue **1 vCPU par défaut**, même à 256 Mio.
- `cpu: 'gcf_gen1'` ramène à ~1/6 de vCPU : environ **six fois moins** de vCPU-s.
- **Mais en dessous de 1 vCPU, la concurrence est forcée à 1.** Avec
  `maxInstances: 3`, un quatrième appel simultané est refusé — sur une opération
  financière.
- Il faut donc relever `maxInstances` (10 à 20 sur les functions chaudes). 20 ×
  0,17 vCPU font ~3,4 vCPU : le mur de quota disparaît du même coup.
- **Contrepartie** : le démarrage à froid s'allonge, parce que le chargement de
  `firebase-admin` est lié au CPU.
- Essayer d'abord sur une function sans enjeu financier. TC-036 [WRA-08/09]
  vérifie les options communes : le test suit le changement.

### C4. Les démarrages à froid

- Garder `minInstances` à 0 : une instance minimale se paie en permanence.
- Les démarrages à froid sont facturés, et 25 functions peu appelées démarrent
  presque toujours à froid.
- À moyen terme, on peut les regrouper en 4 ou 5 callables par domaine, avec un
  champ `action`, comme le fait déjà `storeTransactionCommand`. On gagne moins de
  démarrages à froid, un déploiement plus court et une réservation de quota plus
  petite.
- C'est une refonte : un lot à part, sans changement métier dans le même lot.

### C5. Les images de build

`firebase functions:artifacts:setpolicy` (CLI 14 ou plus) supprime les anciennes
images d'Artifact Registry, qui offre 0,5 Go gratuits. Le bucket des sources
(`gcf-v2-sources-…-europe-west1`) est hors de la zone gratuite de Cloud Storage
(réservée à trois régions américaines), mais il pèse quelques Mo.

---

## Partie D — L'assistant IA

Vertex / Agent Platform n'a **aucun quota gratuit**. Trois garde-fous sont déjà en
place dans [src/lib/ia/assistant.js](../src/lib/ia/assistant.js#L76) : 4 096
jetons de sortie au plus, réflexion basse, 5 tours d'outils au plus.

- **D1. Le prompt empêche le cache implicite.**
  - Gemini facture moins cher un début de prompt identique d'un appel à l'autre.
  - Or [src/lib/ia/prompt.js:60](../src/lib/ia/prompt.js#L60) place le nom, la
    boutique et la date **dès la quatrième ligne**, et `${ou}` revient plus loin
    dans le texte.
  - Le début diffère donc pour chaque personne et chaque jour : rien ne se met en
    cache.
  - Remède : tout le texte fixe d'abord, les variables dans un bloc final
    « CONTEXTE ».
  - **Ce fichier est en cours de modification dans une autre fenêtre** : à
    coordonner.
- **D2. Un plafond de questions par boutique et par jour.** C'est le seul moyen de
  borner cette ligne de la facture.
- **D3. Atteindre 0 $** suppose l'une de ces deux voies :
  - désactiver l'assistant par le profil client ;
  - passer au quota gratuit de l'API Gemini Developer. Sur ce quota, Google peut
    se servir des échanges pour améliorer ses produits. Avec des données
    financières de clients, **la décision revient à C2EGF**.

---

## Partie E — Méthode de développement

- **E1. Développer sur les émulateurs — fait le 2026-11-04.**
  - Le `.env` local était branché sur la production depuis le 2026-10-02 : chaque
    rechargement de `npm run dev` sur un compte boutique pouvait coûter 15 679
    lectures réelles. Il vise désormais `demo-c2egf-local`.
  - `npm run emulateurs` démarre auth, firestore et functions, puis pose le jeu
    d'essai (`scripts/seedEmulateurs.mjs`) : un patron, le dealer, deux
    boutiques avec soldes, 12 clients. Comptes `*@c2egf.test`, mot de passe
    `essai-local`. Ensuite `npm run dev` dans un autre terminal.
  - **Rien n'est sauvé à l'arrêt.** L'export des émulateurs échoue tant que Vite
    surveille le dépôt (EPERM au renommage, détail dans
    `scripts/emulateursDev.mjs`). Le jeu d'essai est reposé à chaque démarrage.
  - Vérifié : les quatre comptes se connectent et arrivent sur leur espace, sans
    erreur console. Tout trafic non local étant bloqué pendant l'essai, aucune
    requête ne peut atteindre la production.
  - Revenir à la production reste possible, en remettant les trois valeurs
    rappelées en tête du `.env`. C'est une décision humaine, et les lectures
    sont alors facturées.
- **E2. Le visualiseur de données de la console Firebase facture chaque document
  affiché.** Ne jamais y parcourir `globalClients`.
- **E3. Les scripts sur la production.**
  - Pour compter, utiliser une agrégation `count()` (1 lecture par tranche de
    1 000 entrées d'index) plutôt que lire les documents.
  - `select()` ne réduit pas les lectures facturées, seulement le volume.
  - *Query Explain* avec `analyze` rend le coût réel d'une requête : le lire
    avant de livrer une requête nouvelle.
- **E4. Un compteur de lectures en développement.**
  - Envelopper `onSnapshot` et `getDocs` pour journaliser, par écoute : les
    documents reçus, `metadata.fromCache` et `docChanges().length`.
  - En déduire le coût de chaque écran, et lui fixer un budget (par exemple moins
    de 150 lectures à froid).
  - C'est aussi le seul moyen de mesurer ce que ce document estime.
- **E5. Une règle de revue.**
  - Toute requête nouvelle déclare sa borne : une `limit`, ou une borne documentée
    comme « 84 boutiques ».
  - Aucune écoute sur un ensemble de plus de ~200 documents.

---

## Partie F — Garde-fous de facture

- **Alerte de budget GCP à 1 $**, seuils à 25, 50 et 100 %. Elle est gratuite,
  mais elle **prévient sans plafonner**.
- Un coup d'œil quotidien à Console Firebase > Firestore > Utilisation.
- **Pas de coupure automatique de la facturation.** Les functions exigent le plan
  Blaze : couper la facturation arrêterait une application qui porte de l'argent.
- **App Check reste sur l'assistant.** L'étendre à Firestore ou aux callables
  consommerait des évaluations reCAPTCHA, gratuites jusqu'à 10 000 par mois. À
  mesurer avant toute extension.

---

## Ordre recommandé

Un lot à la fois. Chaque lot suit la méthode d'`AGENTS.md` : test de
caractérisation avant la correction, puis lint, tests et build. Les déploiements
sont une décision humaine.

| # | Lot | Gain | Risque |
|---|---|---|---|
| 1 | E1 — retour aux émulateurs — **fait le 2026-11-04** | immédiat | nul |
| 2 | A2 — une seule fiche écoutée dans `PatronHistoriqueClient` — **fait le 2026-11-04** | 15 678 lectures par visite | faible |
| 3 | A1 — annuaire en tranches — **serveur en ligne et rempli le 2026-11-06, front à déployer** | ~98 % des lectures | moyen : déclencheur, règles, premier remplissage |
| 4 | A3 — historique — **A3a fait le 2026-11-06** (première page sans `getDocs`) ; A3b (fenêtre à ~25) à décider | 101 lectures par ouverture (A3a) ; ~75 de plus à froid (A3b) | moyen : trois bugs déjà corrigés à ne pas rouvrir |
| 5 | C1 + C2 — région et `getAll` | temps facturé ÷ 3 à 5 | moyen : migration de région |
| 6 | C3 — CPU | vCPU-s ÷ ~6 | à mesurer : démarrage à froid, concurrence |
| 7 | D1 — ordre du prompt | jetons d'entrée | faible |
| 8 | B2, C5, A4 | stockage, images, dealer | faible |

---

## Partie G — Hors connexion et jour courant (décisions du 2026-11-06)

L'utilisateur fixe deux buts. Le premier : **l'application doit fonctionner sans
connexion internet**, y compris au démarrage. Le second : **ne lire que ce qui
sert**, c'est-à-dire la journée en cours. A3b (fenêtre à ~25 lignes) est
abandonné, remplacé par G1.

### Ce qui marche sans réseau aujourd'hui

- **L'ouverture de l'application** : elle est installée (PWA) et sa coquille est
  en cache.
- **La session** : `browserLocalPersistence` la garde sur le disque, et elle
  survit à l'extinction de la machine.
- **La lecture** de ce qui a déjà été chargé : persistance Firestore en
  production.
- **Aucune saisie.** Toutes les opérations de caisse passent par la callable
  `storeTransactionCommand`, même la saisie d'une non terminée, parce que le
  serveur modifie les soldes dès la saisie (`applyInitialTransactionImpact`).
- **Le démarrage hors ligne reste bloqué sur l'écran de chargement.**
  `AuthContext` attend l'écriture de `lastLogin` avant de baisser `loading`, et
  une écriture Firestore hors ligne ne se termine qu'au retour du réseau.
  Vérifié sur l'émulateur avec le vrai SDK : le profil se lit depuis le cache en
  5 ms, mais l'écriture attend encore au bout de 8 s.

### Décisions

1. **Historique** : à l'ouverture, seulement les non terminées, la journée en
   cours, les validées du jour et **les ravitaillements encore dus, même
   anciens**. Les jours précédents ne sont lus que sur choix d'une date ou d'une
   période.
2. **Clients : l'annuaire est gardé sur l'appareil**, dans un stockage local
   propre à l'application. On ne s'appuie ni sur le cache interne de Firestore,
   plafonné à 40 Mo et nettoyé automatiquement, ni sur une écoute, qui
   retélécharge tout au-delà de 30 minutes. À l'ouverture, 1 lecture demande ce
   qui a changé, puis seules les tranches modifiées sont relues. La copie n'a pas
   de date d'expiration : elle reste jusqu'à son remplacement.
3. **Hors connexion, une file d'envoi** pour quatre opérations : la saisie d'une
   non terminée, la validation ou l'encaissement, le règlement par tranche et
   l'ajout d'un client. Chaque opération porte un identifiant unique, que le
   serveur ne rejoue jamais deux fois. **Un refus après coup est accepté**, par
   exemple quand le stock a été épuisé entre-temps : la ligne apparaît alors
   « refusée ».
4. **Première connexion** : elle exige internet une fois par appareil et par
   compte, puisque Google vérifie le mot de passe. Ensuite, on ne se déconnecte
   pas le soir, et la session reste.

### Lots, dans cet ordre

| # | Lot | Ce qu'il apporte |
|---|---|---|
| G0 | Démarrage hors ligne : ne plus attendre `lastLogin`, demander le stockage persistant (`navigator.storage.persist()`), avertir avant une déconnexion | l'application s'ouvre sans réseau |
| G1 | Historique du jour courant, le reste sur demande de date | ~101 lectures par ouverture à froid |
| G2 | Annuaire gardé sur l'appareil, relu par version | 64 lectures et ~5 Mo → 1 lecture + tranches modifiées |
| G3 | File d'envoi pour les quatre opérations | la saisie sans réseau |

### G0 — fait le 2026-11-06 : l'application s'ouvre sans réseau

- `AuthContext` n'attend plus l'écriture de `lastLogin`. Elle part au retour du
  réseau, et son échec ne coupe plus l'accès : c'est une trace, pas un contrôle
  (TC-346 [HL-01, HL-02]).
- `src/config/stockagePersistant.js` demande au navigateur de ne pas vider le
  stockage dès que la persistance est active (TC-346 [HL-03 à HL-06]).
- La confirmation de déconnexion avertit qu'une reconnexion exige internet
  (TC-346 [HL-07]).
- `VITE_FIRESTORE_PERSISTANCE_EMULATEURS=true` active la persistance sur les
  émulateurs. C'est la seule façon d'essayer le hors-ligne sur ce poste, et elle
  est à réserver à un navigateur neuf.
- **Vérifié dans un vrai navigateur.** Le build est servi avec son service
  worker et la persistance active sur les émulateurs. Après connexion, on coupe
  le réseau puis on recharge :
  - le nouveau code s'ouvre en 1 s, soldes et non terminées compris ;
  - l'ancien code reste sur « Chargement… » au bout de 30 s.

Reste, sans bloquer :
- `ensureNetworkBalances`, une transaction, échoue hors ligne et le note dans la
  console ;
- le bandeau « Hors ligne » se fie à `navigator.onLine`, qui reste vrai sur un
  wifi sans internet. G3 aura besoin d'un signal plus sûr.

**Essai sur une vraie machine, après déploiement du front (décision humaine) :**
1. Avec internet, ouvrir https://c2egf.vercel.app, l'installer (icône
   « Installer » de la barre d'adresse) et se connecter avec un compte boutique.
2. Attendre que la page Transactions affiche les soldes, puis ouvrir Clients et
   Historique une fois.
3. Couper le wifi (ou débrancher le câble), puis éteindre la machine.
4. Rallumer sans réseau et ouvrir l'application installée.
5. Attendu : la page Transactions s'ouvre, avec les soldes de la veille et le
   bandeau « Hors ligne ». Une saisie échouera encore : c'est le lot G3.

---

## Ce qui n'a pas pu être vérifié

Ces points demandent un accès à la console, que cette analyse n'avait pas.

- **La répartition réelle des lectures par collection.** Le compteur de §E4 y
  répondra.
- Le nombre de boutiques actives par jour. Les ~281 000 lectures quotidiennes
  correspondent à une vingtaine de chargements complets, donc à une flotte encore
  peu active : **à 84 boutiques actives, la facture actuelle serait de plusieurs
  dizaines de dollars par mois.**
- Le stockage occupé, la taille des non terminées, la sortie réseau.
- Si les 1,06 $ de Cloud Run sont bruts ou nets du quota gratuit.

---

## Sources

- [Facturation Cloud Firestore — écoutes et règle des 30 minutes](https://firebase.google.com/docs/firestore/pricing)
- [Quotas et limites Firestore — quota gratuit réservé à `(default)`, 40 000 entrées d'index, 1 Mio](https://cloud.google.com/firestore/quotas)
- [Tarifs Firestore](https://cloud.google.com/firestore/pricing)
- [TTL — suppressions facturées](https://docs.cloud.google.com/firestore/docs/ttl)
- [Tarifs Cloud Run — quota gratuit, temps facturable](https://cloud.google.com/run/pricing)
- [firebase-functions v2 — `cpu`, `gcf_gen1`, concurrence](https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.alerts.firebasealertoptions)
- [Déclencheurs Firestore 2ᵉ génération — `nam5` → `us-central1`](https://cloud.google.com/functions/docs/calling/cloud-firestore)
- [Emplacements Firestore — composition de `nam5`](https://docs.cloud.google.com/firestore/docs/locations)
- [Gérer les functions — `artifacts:setpolicy`](https://firebase.google.com/docs/functions/manage-functions)
- [App Check — reCAPTCHA Enterprise, 10 000 évaluations gratuites](https://firebase.google.com/docs/app-check)
