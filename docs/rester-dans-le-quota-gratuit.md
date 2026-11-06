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

**Lancé le 2026-11-06, en trois temps.**

| Temps | Code | Geste humain |
|---|---|---|
| 1 | `CALLABLE.region` vaut `['europe-west1', 'us-central1']` : les 26 callables servent les deux régions (TC-036 [WRA-08]) | déployer par groupes de huit au plus (`docs/deployer-les-functions.md` §5) : le 2026-11-06, le déploiement d'un coup a buté sur le quota de ~20 vCPU par région |
| 2 | le front appelle `us-central1` (`src/config/firebase.js`) ; les tests de bout en bout aussi | demander le push, **après** le temps 1 |
| 3 | une semaine après le push, `CALLABLE.region` revient à `'us-central1'` seul | redéployer, et accepter la suppression des functions d'`europe-west1` |

- **Pourquoi deux régions d'abord.** Une application pas encore rechargée appelle
  `europe-west1`, et un poste resté hors ligne peut garder l'ancienne version
  plusieurs jours. Couper tout de suite ferait échouer ses gestes en ligne. La file
  d'envoi, elle, ne perdrait rien : elle retente.
- **Le temps du passage ne coûte rien de plus.** Sans instance minimale, une function
  qu'on n'appelle pas ne se paie pas. Seules les images de build doublent, d'où C5.
- **Le quota vCPU de `us-central1`.** 26 callables × 3 instances font 78 vCPU, plus 6
  pour l'annuaire. C'est loin des ~230 qu'europe-west1 a supportés avant son mur
  (`functions/src/index.js`, commentaire de `CALLABLE`).
- **La latence.** Entre l'Afrique de l'Ouest et l'Iowa, il faut compter ~100 ms de plus
  par appel. Depuis le lot H, la caissière n'attend plus le serveur. Un geste en ligne
  (demande au dealer, collaboration) y gagne encore : il économise quatre à cinq
  traversées de l'Atlantique.
- **La politique de sécurité du front** autorise `https://*.cloudfunctions.net`
  (`vercel.json`) : rien à changer.
- **Un écran contournait la configuration commune.** `StoreAdminClosures.jsx` créait sa
  propre instance, `getFunctions(undefined, 'europe-west1')`. Au temps 3, confirmer ou
  rejeter une clôture aurait échoué. Sur les émulateurs, cette instance n'était même pas
  branchée sur l'émulateur. L'écran passe maintenant par `functions` de
  `src/config/firebase.js` (TC-365). Plus aucun appel ne contourne cette instance.

**Vérifié** sur les émulateurs, qui servent les deux régions :
- TC-036 [WRA-08] : les 26 callables déclarent les deux régions ;
- tests de bout en bout (TC-037, TC-045, TC-061) par `us-central1` : 40 cas ;
- l'essai navigateur du lot H, rejoué : 26 contrôles sur 26, et les 9 appels de
  `storeTransactionCommand` passent tous par `us-central1`.

Non vérifiable avant le déploiement : la création réelle des 26 services en
`us-central1`, et le temps facturé par appel. À relever dans la console une semaine
après (Cloud Run, temps de requête), avant et après.

### C2. Grouper les lectures d'une transaction

`readActor` ([functions/src/storeTransactions/storeTransactionCommand.js:180](../functions/src/storeTransactions/storeTransactionCommand.js#L180))
enchaîne deux `t.get`, suivis d'un troisième pour les soldes. Un seul
`t.getAll(profil, boutique, soldes[, non terminée])` fait un seul aller-retour.
Les lectures facturées restent les mêmes, mais le temps facturé baisse. À regarder
de la même façon dans les autres handlers.

**Écarté le 2026-11-06, au profit de C1.** À côté de la base, un aller-retour dure
quelques millisecondes : en économiser deux par appel ne se verrait pas sur la
facture, et réécrirait les lectures de chaque handler pour rien.

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
images d'Artifact Registry, qui offre 0,5 Go gratuits. Une commande par région, à
lancer par un humain (vérifiée par `--help` sur la CLI 15.13) :

```powershell
firebase use production
firebase functions:artifacts:setpolicy --location europe-west1 --days 1
firebase functions:artifacts:setpolicy --location us-central1 --days 1
```
 Le bucket des sources
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
| 5 | C1 — région — **temps 1 et 2 prêts le 2026-11-06, à déployer puis pousser** ; C2 écarté (sans gain après C1) | temps facturé ÷ 3 à 5 | moyen : migration de région |
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
| G0 | Démarrage hors ligne : ne plus attendre `lastLogin`, demander le stockage persistant (`navigator.storage.persist()`), avertir avant une déconnexion — **fait le 2026-11-06** | l'application s'ouvre sans réseau |
| G1 | Historique du jour courant, le reste sur demande de date — **fait le 2026-11-06** | ~101 lectures par ouverture à froid |
| G2 | Annuaire gardé sur l'appareil, relu par différence — **fait le 2026-11-06**, sans changement côté serveur | 65 lectures et ~5 Mo → 1 lecture + tranches modifiées |
| G3 | File d'envoi pour les quatre opérations — **en production le 2026-11-06** | la saisie sans réseau |
| G4 | Le ravitaillement, son retour, la modification, l'annulation, et la date réelle — **en production le 2026-11-06** | toute la caisse sans réseau |
| H | D'abord sur l'appareil : le formulaire n'attend plus le réseau, l'écran ne clignote pas, le fond de l'en-tête reste hors ligne — **fait le 2026-11-06, front seul** | plus d'attente de 8 s par opération |

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

### G1 — fait le 2026-11-06 : l'historique s'en tient à la journée en cours

**À l'ouverture**, quatre écoutes, toutes bornées :
- la journée (`createdAt` dans le jour) ;
- les validées depuis ce matin (`validatedAt`) ;
- les **supprimées depuis ce matin** (`deletedAt`, nouvelle) ;
- les ravitaillements encore dus.

Plus les non terminées, comme avant. La fenêtre des 100 dernières lignes
(A3a), `getHistoryPage` et les trois boutons « Charger … précédent(e)s » sont
retirés.

L'écoute des supprimées est ce qui garde la corbeille juste. Une ligne saisie la
semaine dernière et supprimée ce matin garde son `createdAt` d'alors : l'écoute
de la journée ne la verrait pas. Le serveur pose `deletedAt` à chaque mise à la
corbeille. Ce filtre sur un seul champ passe par l'index automatique, sans
déploiement.

**Les jours passés** sont relus à la demande, par `chargerPeriode` du contexte,
avec une seule lecture (`getHistoryBetween`) :
- Les dates se choisissent sur les onglets Transactions clients (filtre et
  navigation par jour), Ravitaillement et Corbeille.
- « Du » seul garde son sens de « à partir de », « Au » seul celui de
  « jusqu'à » (TC-116), bornés tous deux à 31 jours. Au-delà, la période est
  refusée (`src/utils/periodeHistorique.js`).
- La journée en cours n'est jamais relue : son écoute la tient déjà, donc la
  lecture s'arrête à ce matin minuit.
- La même période redemandée ne se relit pas. Une réponse arrivée après un
  retour au jour est ignorée.
- « Aujourd'hui » oublie la période.
- Une phrase sous les filtres dit ce qui est chargé : sans elle, un historique
  d'une journée se lirait comme des données perdues.

**Tests :**
- TC-347 : le contexte, 15 cas, dont les trois garanties reprises de TC-344 (la
  journée de plus de cent lignes, la validée tardive, la dette ancienne).
- TC-348 : la règle des dates.
- TC-349 : les onglets Ravitaillement et Corbeille.
- TC-116 : mis à jour.
- Les fiches d'aide suivent (TC-225).
- Retirés, leur objet n'existant plus : TC-321, TC-322, TC-344 et TC-345
  (fenêtre, pagination, boutons « Charger »), et `jourDeSaisie`.

**Vérifié dans l'application**, sur les émulateurs, avec 3 lignes aujourd'hui et
140 avant :
- à l'ouverture, la navigation par jour ne montre que « 06/11/2026 — 3 » et les
  quatre écoutes bornées ;
- « Du 04/11 au 05/11 » fait une seule lecture et ajoute exactement 48 + 35
  lignes ;
- « Aujourd'hui » revient à 3 ;
- aucune erreur dans la console.

Gain : la fenêtre (101 lectures à froid) disparaît, et l'ouverture ne coûte plus
que les lignes du jour.

**Limites acceptées :**
- Les expéditeurs proposés dans le formulaire de ravitaillement ne viennent plus
  que de la journée et des livraisons dues.
- Les estimations d'activité du profil ne comptent plus que la journée.

### G2 — fait le 2026-11-06 : l'annuaire reste sur l'appareil

**Aucun changement côté serveur.** Le plan prévoyait un numéro de version par
tranche dans `_etat`, donc un déploiement de functions. C'est inutile : chaque
tranche porte déjà `majLe`, posé par le déclencheur et par la reconstruction.
Une requête « `majLe` plus récent que le plus récent de la copie » rend
exactement les tranches modifiées depuis. Le filtre porte sur un seul champ :
il passe par l'index automatique, sans index à déployer.

**Le chemin :**
- **Première ouverture sur un appareil** : l'annuaire entier est écouté, comme
  au lot A1 (65 lectures, ~5 Mo). Sa première réponse du serveur est enregistrée
  dans une base IndexedDB à part, `c2egf-annuaire-<projet>`
  (`src/services/copieAnnuaire.js`).
- **Ouvertures suivantes** : la copie s'affiche tout de suite, réseau ou pas.
  Une seule écoute demande ensuite les tranches modifiées depuis : 1 lecture si
  rien n'a changé, 1 de plus par tranche modifiée.
- **Dans la journée**, une fiche ajoutée ou corrigée ailleurs arrive par cette
  écoute, comme avant. Au-delà de 8 tranches modifiées, l'écoute se rouvre à
  partir de la plus récente : une reprise après 30 minutes coûte donc au plus 8
  lectures.
- **`_etat` n'est lu qu'au premier chargement.** Le repli sur `globalClients`
  reste, pour un annuaire incomplet ou une lecture refusée.

L'orchestration est dans `ecouterAnnuaireGarde` (`src/services/annuaireClients.js`).
Elle rend le même `{ complet, clients }` qu'avant : `ecouterAvecRepli` et les
écrans n'ont pas changé.

**Ce qui garde la copie juste :**
- Seules les réponses du serveur l'enregistrent ou la font avancer. Le cache de
  Firestore peut mêler des tranches d'époques différentes (TC-350 [AG-02,
  AG-08]).
- Une tranche n'est jamais remplacée par une plus ancienne, même par un second
  onglet (AG-07).
- La copie n'est lue que complète : sa marque est posée dans la même
  transaction que les 64 tranches.
- Les dates (`createdAt`) redeviennent des `Timestamp` à la relecture. Sans
  cela, le tri par date d'ajout changerait (CA-01).
- Une base par projet : les émulateurs et la production ne se mêlent pas.
- Une copie illisible, ou impossible à enregistrer, ramène au chargement
  complet, jamais à une liste vide (AG-11, AG-12).

**Seulement là où Firestore garde son cache** (`persistanceHorsLigne`, exporté
par `src/config/firebase.js`) :
- en production, avec `VITE_FIRESTORE_OFFLINE_PERSISTENCE=true`, déjà présent
  dans les variables Vercel ;
- sur les émulateurs, avec `VITE_FIRESTORE_PERSISTANCE_EMULATEURS=true`.

Ailleurs, le chemin est le même, sans copie : sur des émulateurs repartis vides,
une copie de la veille pourrait se croire plus récente que les données.

**Gain, par appareil et par démarrage :** 65 lectures et ~5 Mo deviennent 1
lecture, plus ~80 Ko par tranche modifiée depuis la veille. La machine est
éteinte chaque soir : chaque matin était un chargement complet.

**Tests :**
- TC-350 : 18 cas, sur le chemin, la cohérence, les pannes et la relecture des
  dates.
- TC-265 [12 à 17].
- Six mutations volontaires du code, toutes attrapées.

**Vérifié dans un vrai navigateur.** Le build est servi avec son service
worker, et la persistance est active sur les émulateurs :
- **Première ouverture** : l'annuaire entier, puis l'écoute des changements. La
  copie tient les 64 tranches et sa marque.
- **Rechargement** : seule l'écoute des changements part. La liste entière
  s'affiche en moins d'une seconde, dans le même ordre, et `globalClients` n'est
  pas écouté.
- **Modifications faites ailleurs** : une fiche ajoutée et une fiche renommée
  arrivent d'elles-mêmes, et restent après un rechargement.
- **Réseau coupé, puis rechargement** : la liste entière, renommage compris, en
  0,5 s.
- **Console** : aucune erreur avant la coupure. Après, seule celle
  d'`ensureNetworkBalances`, déjà notée en G0.

**Déploiement :** le front seul, par push GitHub puis promotion (décision
humaine). Aucune function, aucune règle, aucun index.

**Limites acceptées :**
- La copie reste sur l'appareil après une déconnexion, comme le cache de
  Firestore. Ce sont les mêmes fiches, déjà lisibles par tout compte connecté.
- Une copie existante ne verrait pas des tranches supprimées à la main. Seule
  la reconstruction, qui réécrit les 64 tranches, est prévue.

### G3 — la saisie sans réseau : le plan, en trois sous-lots

Les quatre opérations retenues sont :
- la saisie d'une non terminée, ou d'une validée d'un geste ;
- la validation ou l'encaissement d'une non terminée ;
- le règlement par tranche ;
- l'ajout d'un client.

Aujourd'hui, toutes attendent la réponse du serveur, qui ne vient pas hors
ligne : le formulaire reste figé.

| # | Sous-lot | Ce qu'il apporte |
|---|---|---|
| G3a | Serveur : la saisie et la validation reconnues à leur `commandeId` — **fait le 2026-11-06, à déployer** | une opération renvoyée ne s'applique jamais deux fois |
| G3b | La file d'envoi, sur l'appareil — **fait le 2026-11-06, à déployer** | les quatre opérations s'enregistrent sans réseau et partent au retour |
| G3c | L'affichage : lignes en attente, soldes provisoires, refus — **fait le 2026-11-06, à déployer** | la caissière voit ce qui attend, et peut valider ou régler une non terminée saisie hors ligne |

**G3b, la file d'envoi :**
- **Une base IndexedDB par compte**, `c2egf-envois-<projet>-<uid>`. Chaque
  opération y porte son `commandeId`, tiré sur l'appareil, et sa charge utile.
  Son état est « en attente » ou « refusée ».
- **Les quatre opérations passent toutes par la file, réseau ou pas.** Le
  formulaire attend la première réponse quelques secondes :
  - si elle arrive, rien ne change pour la caissière (succès, ou refus affiché
    avec les champs gardés) ;
  - sinon, « Connexion absente ou lente : gardée sur cet appareil », et les
    champs se vident.
- **Un seul envoi à la fois, dans l'ordre.** Un seul onglet envoie (Web
  Locks). L'envoi part à chaque ajout, au retour de la connexion à Firestore et
  toutes les 30 s tant qu'une opération attend.
- **Un refus porte un code métier** (`INSUFFICIENT_STORE_BALANCE`…) : il
  devient définitif. Tout le reste (réseau, erreur interne) se retente. Une
  validation qui ne trouve plus sa non terminée est refusée.
- **Le client ajouté** reçoit son identifiant sur l'appareil. Renvoyé, il est
  reconnu s'il existe déjà. Hors ligne, le doublon de code agent se cherche dans
  la copie locale de l'annuaire (lot G2).

**G3c, l'affichage :**
- Une non terminée en attente apparaît dans la liste avec « en attente
  d'envoi ». Elle peut être validée ou réglée, et ces opérations partent après
  elle. Elle ne peut être ni modifiée ni supprimée avant son envoi.
- Une validation en attente retire la ligne des non terminées et la montre
  dans l'historique du jour, « en attente ».
- **Les soldes affichés deviennent provisoires** : ceux du serveur, plus
  l'effet des opérations en attente, calculé par les mêmes fonctions que le
  serveur. Ils portent une marque « provisoire ».
- Un panneau « Envois » liste les opérations en attente et les refusées, avec
  leur raison. Une refusée se retire d'un geste.
- La déconnexion est refusée tant qu'une opération attend. L'opération reste
  rattachée à son compte, qui ne l'enverrait plus une fois déconnecté ; et se
  reconnecter exige justement le réseau qui manque.

**Ordre de déploiement : les functions de G3a d'abord, le front ensuite.** Le
front envoie toujours un `commandeId`, qu'un serveur ancien refuse comme « champ
non autorisé ». Dans l'ordre inverse, rien n'est perdu : ce refus ne compte pas
comme définitif, et les saisies attendent dans la file le déploiement des
functions (TC-352 [FE-16]). Mais d'ici là, aucune saisie ne part : les caissières
verraient « Connexion absente ou lente ».

### G3a — fait le 2026-11-06 : le serveur reconnaît une opération renvoyée

`storeTransactionCommand` accepte un `commandeId` facultatif :
- **`add`** : il devient l'identifiant de la non terminée (ou de la ligne
  d'historique pour une validée d'un geste). Renvoyée, la saisie trouve son
  document et répond `{ id, idempotent: true }` sans rien réécrire.
  - ⚠ La garde passe **avant** le calcul de l'impact. Une saisie déjà
    appliquée a pu vider le stock qu'elle demandait : recalculée, elle serait
    refusée pour solde insuffisant, et la file la croirait perdue (TC-351
    [IDEM-03]).
- **`validateDraft`** : il devient l'identifiant de la ligne d'historique.
  Renvoyée, la validation trouve cette ligne et répond
  `{ validated: true, historyId, idempotent: true }`. Si la non terminée
  existe encore, l'identifiant appartient à une autre ligne :
  `IDEMPOTENCY_CONFLICT`, sans rien écraser (IDEM-06).
- **Sans `commandeId`, rien ne change** : TC-351 [CAR-01 à 05] le
  caractérisent, et CAR-03 fige le trou que G3a ferme (la même saisie envoyée
  deux fois s'appliquait deux fois).
- **Coût** : une lecture de plus par opération envoyée avec un `commandeId`,
  et aucune trace à part. Le document créé porte l'identifiant : rien à
  effacer un jour, et rien à stocker en plus.
- Le règlement par tranche avait déjà sa garde (`idempotencyKey`,
  `addTransactionPayment`).

**Tests :**
- TC-351 : 13 cas sur émulateur, dont deux envois simultanés de la même
  saisie, qui n'en font qu'une.
- Trois mutations des gardes, toutes attrapées.
- Toute la suite des functions passe.

**Déploiement — décision et exécution humaines :**

```powershell
firebase use production
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase deploy --only "functions:storeTransactionCommand"
```

Sans effet visible tant que le front n'envoie pas de `commandeId` : le front
d'aujourd'hui n'en envoie aucun.

### G3b — fait le 2026-11-06 : la file d'envoi

**Ce que la caissière voit :**
- **Avec réseau, rien ne change.** Succès, ou refus affiché avec les champs
  gardés.
- **Sans réseau**, le formulaire rend la main au lieu de rester figé. Un
  message dit que l'opération est gardée sur l'appareil et partira dès le
  retour de la connexion.

**Ce qui passe par la file** (`src/services/fileEnvoi.js`) :
- la saisie, non terminée ou validée d'un geste ;
- le règlement, par tranche ou en entier ;
- le remboursement ;
- l'ajout d'un client, depuis le formulaire de transaction comme depuis
  l'onglet Clients.

En pratique, la validation et l'encaissement d'une non terminée passent par le
règlement : `validateDraft` ne sert qu'à la correction d'une ligne rouverte,
qui reste en ligne.

**Le chemin d'une opération :**
1. Elle est écrite dans IndexedDB (`c2egf-envois-<projet>-<uid>`,
   `stockageEnvois.js`) **avant** d'être envoyée (TC-352 [FE-01]).
2. Elle part aussitôt. ~~Le formulaire attend sa réponse 8 s au plus~~ : depuis le
   lot H, il se ferme dès l'écriture, et l'envoi part derrière.
3. ~~Un refus arrivé pendant cette attente retire l'opération de la file~~ : depuis
   le lot H, tout refus arrive après coup, sur la ligne et dans la liste des envois
   (FE-03).
4. Tant qu'elle n'est pas acceptée, l'opération reste et repart seule :
   - au retour du réseau (événement `online`) ;
   - toutes les 30 s ;
   - à l'ouverture suivante de l'application, même après l'extinction de la
     machine (FE-08).
5. Les opérations partent une à la fois, dans l'ordre de saisie. Une panne
   arrête l'envoi des suivantes et leur rend la main tout de suite (FE-07). Un
   refus arrivé plus tard reste visible avec sa raison, et les suivantes
   partent quand même (FE-06).

**Ce qui est un refus :** un code métier en majuscules, dans `code` ou dans
`details.code`. Le service de règlement laisse le code dans `details` : le lire
seulement dans `code` aurait fait renvoyer un règlement refusé sans fin
(FE-13). Les pannes de réseau et les erreurs internes se retentent.

Deux réponses en majuscules ne sont **pas** des refus, et se retentent aussi :
- **`UNAUTHENTICATED`.** Le SDK envoie la requête sans jeton quand il n'a pas pu
  le rafraîchir (`getAuthToken` avale l'erreur). La machine est éteinte la nuit,
  donc le jeton est expiré au matin : sur un réseau instable, une opération
  aurait été perdue alors que la session est bonne (FE-15).
- **« champs non autorisés ».** Un serveur antérieur à G3a n'a rien appliqué, et
  l'opération attend son déploiement (FE-16).

**De quoi être reconnue au renvoi :**

| Opération | Ce qui la fait reconnaître |
|---|---|
| Saisie | son `commandeId` (G3a) |
| Règlement, remboursement | la clé du geste (`idempotencyKey`), qui sert aussi d'identifiant dans la file : le même geste confirmé deux fois n'y entre qu'une fois (FE-14) |
| Client | son identifiant, tiré sur l'appareil (`nouvelIdClient`). `enregistrerClientEnvoye` relit d'abord la fiche au serveur, puis refait le contrôle de doublon sur l'état du serveur |

- **Hors ligne, le doublon de code agent** se cherche dans la copie de
  l'annuaire, avec la règle même du serveur (`trouverFicheAgent`), avant
  d'entrer dans la file (TC-353 [OF-05]).
- **Le refus de doublon** porte désormais le code `CLIENT_DOUBLON` : sans lui,
  la file l'aurait pris pour une panne.
- **Un seul onglet envoie** (Web Locks, `verrouillerEnvois`). Chaque envoi
  relit la file, donc les opérations d'un autre onglet partent aussi.
- **Sans fournisseur de file** (tests, aperçu), les contextes reprennent l'appel
  direct d'avant, à l'identique (OF-06). Les modules lus par ces contextes
  (`envoisContexte.js`, `fileEnvoi.js`) ne chargent pas Firebase.

**Tests :**
- TC-352 : 17 cas sur la file elle-même.
- TC-353 : 13 cas sur le passage des opérations par la file, sur ce que chacune
  devient au serveur et sur leur place dans les listes.

### G3c — fait le 2026-11-06 : la caissière voit ce qui attend

**À l'écran** (`src/utils/envoisEnAttente.js`, fonctions pures) :
- **Une saisie en attente** apparaît dans les non terminées, ou dans l'historique
  du jour pour une validée d'un geste, avec « En attente d'envoi ». Elle porte déjà
  l'identifiant que le serveur lui donnera (le `commandeId`). Une fois reçue, la
  ligne du serveur la remplace (TC-354 [EE-10]).
- **Elle se règle**, et le règlement part après elle. **Elle ne se modifie ni ne
  s'annule** : le serveur ne la connaît pas encore.
- **Un règlement en attente** se lit sous le montant et fait déjà baisser le reste
  dû. Sans cela, le plafond laisserait encaisser deux fois le même reste
  (EE-11). Réglée en entier, la ligne ne propose plus aucun geste.
- **Les soldes deviennent provisoires** : ceux du serveur, plus l'effet de ce qui
  attend, calculé par les fonctions du navigateur qui suivent celles du serveur.
  La bande affiche « Soldes provisoires ». Ce sont eux que le formulaire contrôle :
  sans cela, une caissière hors ligne pourrait vendre trois fois le même stock.
- **Le total de la caisse** reste juste. Une saisie refusée n'y compte pas (EE-13).
- **Une fiche client en attente** est dans la liste et compte pour le contrôle de
  doublon. La marque `enAttente` ne part pas avec la transaction : le serveur
  recopie le client dans la ligne, et l'historique la porterait pour toujours
  (OF-13).
- **Le bandeau du bas** compte ce qui attend, **même quand le navigateur se croit
  en ligne**. C'est le signal plus sûr que `navigator.onLine` annoncé en G0.
- **Le panneau « Voir »** (`EnvoisListe.jsx`) liste tout, avec la raison des refus.
  Il n'est pas un doublon des lignes : une fiche refusée n'a aucune ligne où
  apparaître, et un règlement refusé peut viser une ligne partie entre-temps
  (TC-355 [EC-10]).
- **La déconnexion** est refusée tant qu'une opération attend.
- **Hors de la file**, un geste sans réseau dit « Cette opération demande une
  connexion internet » au lieu de « internal [0] » (TC-356).
- **L'aide** a sa fiche 27, « Travailler sans internet ».

**Vérifié dans un vrai navigateur**, sur le build avec service worker et
persistance, émulateurs neufs (boutique à 500 000 de stock, 300 000 d'espèces) :

| Étape | Résultat |
|---|---|
| Saisie avec réseau | comme avant, file vide aussitôt |
| Coupure, saisie d'une non terminée | message, ligne « En attente d'envoi », « Soldes provisoires », pas de bouton Annuler |
| Rechargement sans réseau | l'opération et la ligne sont toujours là |
| Encaissement de cette ligne | gardé, reste dû à zéro, plus aucun geste |
| Fiche client neuve et validée sur elle | gardées ; visibles dans Clients et Historique, Modifier et Annuler bloqués |
| Retour du réseau | tout part : stock 465 000, espèces 325 000, soit exactement le calcul attendu ; une seule ligne, une seule fiche |
| **Réponse perdue** (le serveur applique, le navigateur ne reçoit rien) | gardée, puis renvoyée : le stock ne baisse qu'une fois, une seule ligne |
| **Refus après coup** (le stock a fondu pendant la coupure) | « Refusée » et sa raison, soldes intacts, « Retirer » l'enlève |
| **Fiche refusée** (même code agent créé ailleurs pendant la coupure) | visible dans le panneau avec sa raison, rien d'écrit au serveur |

Ce scénario a trouvé trois défauts que les tests isolés ne voyaient pas :
- le message « Pas de réseau » restait affiché une fois le réseau revenu ;
- il était faux pour un serveur lent : sur émulateurs neufs, la première saisie a
  demandé 7,6 s, juste sous les 8 s d'attente du formulaire. Au-delà, le message
  s'affiche alors que le réseau est là, d'où « Connexion absente ou lente ».
  L'opération part quand même, une seule fois ;
- le « [400] » que le SDK ajoute au message s'affichait sur la ligne refusée.

**Tests :** TC-354 (13 cas), TC-355 (11 cas), TC-356 (2 cas). Sur G3b et G3c, 18
mutations des gardes : 16 attrapées du premier coup, et les 2 autres après avoir
renforcé FE-14 et EE-10. Les toasts d'erreur en ligne gardent ce « [400] » : c'est
le comportement d'avant, hors de ce lot.

**Limites :**
- **Restaient en ligne** : modifier ou annuler une opération, le ravitaillement et son
  retour. C'est levé par G4. Les collaborations et les demandes au dealer y restent.
- **Modifier une fiche client sans réseau** n'a pas été retenu. Essayé : le formulaire
  reste sur « Enregistrement… », l'écriture arrive au retour du réseau, et il se
  referme alors. Rien n'est perdu, mais la caissière attend.
- **Une opération que le serveur rejette sans code métier**, par un défaut du
  serveur, est retentée sans fin et bloque celles qui la suivent, ainsi que la
  déconnexion. Le panneau la montre « En attente d'envoi » ; la cause reste à
  corriger côté serveur.
- **Une ligne groupée** de l'historique (« Voir les 2 ») ne montre l'état d'envoi
  qu'une fois dépliée.
- **Le jeu d'essai** écrit ses clients sans `orange`, que toute vraie fiche porte :
  le formulaire refuse de les prendre pour une transaction sur les émulateurs. Le
  scénario pose ce champ lui-même.

**Déploiement — décision et exécution humaines, dans cet ordre :**

1. Les functions (commande en G3a).
2. Le front : push de la branche, puis promotion de la Preview.

**Essai sur une vraie machine, après déploiement :**
1. Avec internet, ouvrir l'application installée, attendre les soldes, puis ouvrir
   Clients une fois : la copie de l'annuaire se fait à cette ouverture.
2. Couper le wifi et enregistrer un dépôt en « Non Terminées ».
3. Attendu : le message, la ligne « En attente d'envoi », « Soldes provisoires ».
4. Éteindre la machine, la rallumer sans réseau, rouvrir : la ligne est toujours là.
5. L'encaisser en Cash, puis remettre le wifi.
6. Attendu : en moins d'une minute, le bandeau disparaît, la ligne passe dans
   l'historique, et les soldes sont ceux du calcul. Vérifier dans la console Firebase
   qu'il n'y a qu'une seule ligne.

### G4 — fait le 2026-11-06 : toute la caisse sans réseau

Demande de l'utilisateur, avant tout déploiement : **sans stock, aucune opération n'est
possible, donc le ravitaillement doit passer sans réseau, ainsi que l'annulation et la
modification.** Le retour au dealer suit, puisqu'il vit dans le même panneau.

| # | Sous-lot | Ce qu'il apporte |
|---|---|---|
| G4a | Serveur : chaque geste reconnu s'il revient, la correction d'un seul geste, la date réelle | un renvoi ne double rien, et un refus laisse tout en l'état |
| G4b | Les gestes passent par la file d'envoi | ils s'enregistrent sans réseau et partent au retour |
| G4c | L'écran : la file rejouée dans l'ordre, sur les lignes et sur les soldes | la caissière voit le résultat de ses gestes avant leur départ |

**Comment chaque geste est reconnu s'il revient :**

| Geste | Commande | Ce qui le reconnaît |
|---|---|---|
| Ravitaillement | `replenish` | la ligne `history/{commandeId}` existe |
| Retour | `returnReplenishment` | la ligne `history/{commandeId}` existe, testée **avant** les plafonds : sinon, renvoyé après avoir soldé la livraison, il se croirait refusé |
| Modifier une non terminée | `updateDraft` | la marque `derniereCommande` du brouillon. La file n'envoie une modification qu'après la précédente : seule la dernière peut revenir |
| Corriger une validée | `correctHistory` | la ligne `history/{commandeId}` existe, testée avant l'impact |
| Annuler une non terminée | `trashDraft` | la ligne de corbeille `history/{commandeId}` existe |
| Annuler une validée | `trashHistory` | la ligne est déjà « Supprimée » ou « Annulée » : le but est atteint, y compris si un autre poste l'a fait |
| Annuler un retour | `trashReplenishmentReturn` | `deletedAt` déjà posé |

Sans `commandeId`, tout reste comme avant : TC-357 [CAR-01] à [CAR-07] le figent.

**Trois changements de fond :**

1. **Corriger une validée ne passe plus par trois appels.** `reopenHistory` bougeait les
   soldes dès le clic, ce qui est impossible sans réseau, et laissait la ligne dans les
   non terminées si le formulaire se fermait. `correctHistory` fait tout dans une
   transaction : un refus laisse tout en l'état, et le formulaire s'ouvre sans rien
   changer. **Ce comportement change aussi avec internet.** `reopenHistory` reste au
   serveur, pour les applications pas encore rechargées.

   La référence est l'ancien enchaînement : TC-358 corrige huit sortes de lignes, de
   trois façons chacune, par les deux routes, dans deux boutiques. Soldes et ligne
   d'arrivée doivent être identiques.
2. **L'encaissement complet garde son numéro.** La ligne d'historique prend
   l'identifiant de la non terminée (`addTransactionPayment`). Sans cela, une annulation
   ou une correction faite sans réseau ne pourrait pas viser cette ligne.

   **Corrigé le jour même, après le premier déploiement :** ce numéro, le navigateur l'a
   choisi à la saisie, et `add` ne le cherche que parmi les non terminées. Une saisie
   sous le numéro d'une ligne d'historique existante, puis encaissée en entier,
   écrasait cette ligne. L'encaissement refuse maintenant (`IDEMPOTENCY_CONFLICT`),
   et TC-357 [IDEM-14] le vérifie. Il ne fallait pas de garde dans `add` : elle aurait
   coûté une lecture à chaque saisie, ~5 000 par jour pour la flotte.
3. **Une opération partie en retard garde le jour où elle a eu lieu.** Décision de
   l'utilisateur, contre la date d'envoi. La file envoie l'**âge** de l'opération, pas
   une date, et le serveur la situe sur sa propre horloge (`instantDeLaCaisse`). Une
   machine à l'heure fausse donne donc le bon jour, tant que son heure n'a pas changé
   entre la saisie et l'envoi. L'âge compte entre 1 minute et 7 jours ; hors de ces
   bornes, c'est la date du serveur. La ligne garde aussi son heure de réception
   (`recuLe`). Conséquence attendue : une saisie de lundi soir, partie mardi matin,
   n'apparaît pas dans la journée de mardi. On la retrouve en choisissant lundi.

   **Le revers, accepté :** une caissière qui avance l'horloge de la machine entre la
   saisie et l'envoi peut dater une opération jusqu'à 7 jours en arrière. Les soldes
   bougent quand même à l'arrivée. Chaque geste laisse aussi une entrée `auditLogs` à
   l'heure du serveur, et la ligne garde `recuLe`. Rien ne le signale encore au patron
   à l'écran.

**Deux défauts anciens, trouvés par l'essai dans le navigateur :**

- **Modifier une ligne quand le stock est à sec était refusé.** Le formulaire comparait
  le nouveau montant au stock restant, sans compter ce que la ligne avait déjà pris :
  un dépôt de 30 000 qui avait vidé le stock ne pouvait pas passer à 25 000. Corrigé
  (`stockDejaPris`, TC-362).
- **Les messages du ravitaillement ne s'affichaient jamais, ni ses refus.** Le formulaire
  appelait `showToast` sans jamais afficher le résultat, et celui de transaction se
  fermait en emportant le sien après une modification. Les tests simulaient `useToast` :
  ils ne pouvaient pas le voir. Les messages vivent maintenant dans le panneau et dans
  la page (TC-363, avec le vrai `useToast`).

**Ce que voit la caissière sans réseau :**
- ses gestes s'appliquent aussitôt à l'écran, avec « En attente d'envoi » et « Soldes
  provisoires » ;
- un encaissement complet fait passer la ligne dans l'historique, où elle se corrige et
  s'annule comme une autre ;
- une annulation envoie la ligne à la corbeille, une correction remonte la ligne en tête ;
- un refus après coup : la ligne reprend ses valeurs, et l'opération se lit avec sa raison
  dans la liste des envois (« Voir »), où elle se retire.

**Vérifié dans un navigateur** (build avec service worker et persistance, émulateurs,
`VITE_FIRESTORE_PERSISTANCE_EMULATEURS=true`), en partant de 30 000 de stock et 0 d'espèces :

| Étape | Résultat |
|---|---|
| Avec réseau : ouvrir puis fermer la correction d'une validée | soldes et ligne intacts, aucune non terminée |
| Avec réseau : corriger 30 000 en 25 000 alors que le stock est à 0 | 5 000 / 25 000, une seule ligne |
| Sans réseau : saisir 20 000 avec 5 000 de stock | refusé par le formulaire |
| Ravitailler de 100 000 | 105 000 / 25 000, ligne « En attente d'envoi », total à rendre 100 000 |
| Recharger la page | tout est encore là |
| Saisir 20 000, modifier à 15 000 | 90 000 / 25 000 |
| Saisir 5 000, annuler | 90 000 / 25 000, ligne à la corbeille |
| Encaisser 15 000 en Cash | 90 000 / 40 000, ligne passée dans l'historique |
| La corriger à 12 000 | 93 000 / 37 000 |
| Annuler la validée de 25 000 | 118 000 / 12 000 |
| Rendre 30 000 en stock | 88 000 / 12 000, reste à rendre 70 000 |
| Rendre 10 000 en espèces, puis annuler ce retour | 88 000 / 12 000, reste à rendre 70 000 |
| **Le réseau revient** | **le serveur affiche 88 000 / 12 000 : exactement le calcul de l'écran.** Une seule ligne par opération, aucune non terminée, marque locale absente |
| Réponse perdue sur un ravitaillement | crédité une fois, une seule ligne |
| Réponse perdue sur une annulation | stock rendu une fois, pas de faux refus |
| Correction que le stock ne couvre plus | « Refusée : Stock insuffisant », ligne et stock intacts, retrait possible |
| Saisie vieille de 26 heures | datée de la veille, heure de réception gardée |

Console : aucune erreur, hors le bruit connu du hors-ligne et le refus attendu (400).

**Tests :** TC-357 (23 cas), TC-358 (37), TC-359 (18), TC-360 (33), TC-361 (25), TC-362 (10),
TC-363 (4). 23 mutations du serveur, toutes attrapées. 30 de l'application : 28 du premier coup,
et les 2 autres après avoir renforcé TC-360 [GA-19] et TC-361 [GF-04].

**Limites :**
- **Restent en ligne** : les collaborations, les demandes au dealer. Une fiche client se
  modifie toujours en attendant le réseau (voir G3c).
- ~~**Une correction ou une annulation sur une ligne d'un jour relu**, faite sans réseau :
  une fois partie, la ligne d'origine reste affichée jusqu'à ce qu'on relise ces dates.~~
  Levée par le lot H : la file prévient l'écran quand une opération est acceptée.
- **Une saisie refusée entraîne ce qui la vise** : sa modification et son annulation sont
  refusées aussi (« introuvable »). Chacune se retire de la liste des envois.
- **Sur une ligne déjà appliquée dont la réponse est perdue**, les soldes provisoires la
  comptent deux fois jusqu'au renvoi, qui part au plus tard 30 s après. Sans effet au serveur.
- **Non vérifié** : une vraie machine, la production, plusieurs onglets ouverts.

**Déploiement — décision et exécution humaines, dans cet ordre :**

1. Les functions, **avant** le push, puisqu'un push passe en production quelques minutes
   plus tard. Dans PowerShell :
   ```powershell
   firebase use production
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
   firebase deploy --only "functions:storeTransactionCommand,functions:addTransactionPayment"
   ```
2. Le front : push de la branche.

Dans l'autre ordre, rien ne se perd : un serveur ancien refuse `commandeId` et `ageMs` comme
champs non autorisés, et la file retente. Mais aucun geste ne part d'ici là.

**Essai sur une vraie machine, après déploiement** (s'ajoute à celui de G3c) :
1. Couper le wifi, recevoir un ravitaillement. Attendu : le message, « Soldes provisoires »,
   le stock monte.
2. Saisir un dépôt, le modifier, en saisir un autre et l'annuler.
3. Encaisser le premier, puis corriger son montant depuis l'Historique.
4. Éteindre la machine, la rallumer le lendemain sans réseau, puis remettre le wifi.
5. Attendu : en moins d'une minute, le bandeau disparaît et les soldes sont ceux de l'écran.
   Dans l'Historique, choisir la veille : les opérations y sont, datées de la veille.

### H — fait le 2026-11-06 : d'abord sur l'appareil

Retour de l'utilisateur après son essai sans internet : « impeccable », trois choses à
reprendre.

| Constat | Cause | Correction |
|---|---|---|
| Les opérations sont lentes, le client attend | le formulaire attendait la réponse du serveur jusqu'à 8 s (`ATTENTE_FORMULAIRE_MS`). Wifi coupé net, l'échec arrive vite ; box allumée sans internet, `navigator.onLine` reste vrai et chaque opération coûtait les 8 s | `soumettre` rend la main dès l'écriture sur l'appareil ; l'envoi part derrière |
| Le long message n'est pas utile | « Connexion absente ou lente : … gardée sur cet appareil … » après chaque geste | le message court habituel, avec ou sans réseau ; le bandeau du bas dit ce qui attend |
| Le fond de l'en-tête disparaît hors ligne | `bandeau-reseau.jpg` exclu du precache en août, pour les téléphones | precaché (89 Ko, une fois) |

**Ce qui change aussi avec internet :** un refus du serveur n'apparaît plus dans le
formulaire ouvert. Il arrive après coup, comme hors ligne : la ligne passe « Refusée » avec
la raison, le bandeau le signale, la caissière ressaisit. C'est rare : le formulaire vérifie
déjà le stock et les doublons de clients.

**Sans clignoter.** Avec internet, une opération part dans la seconde : la montrer
« en attente » ferait clignoter le bandeau, « Soldes provisoires » et la mention de la
ligne à chaque geste. `attenteASignaler` (`fileEnvoi.js`) ne les allume que hors ligne,
après un échec, ou passé `SIGNAL_APRES_MS` (5 s) : sur un wifi sans internet, c'est l'âge
de l'opération qui le dit. Les soldes, eux, comptent l'opération tout de suite. La liste
complète `enAttente` ne change pas : la déconnexion s'y fie.

**Ce que l'écran faisait à la réponse, il le fait au départ.** Annuler ou corriger une
ligne d'une période relue demande de corriger cette période à la main, puisque rien ne
l'écoute. C'était fait à la réponse reçue pendant l'attente. La file prévient maintenant
quand une opération est acceptée (`apresEnvoi`). Cela lève la limite de G4 : la ligne
corrigée remplace l'origine (TC-361 [GF-20]). Et une annulation refusée ne marque plus la
ligne relue comme supprimée ([GF-21]).

**Vérifié dans un navigateur** (build avec service worker et persistance, émulateurs) :

| Situation | Résultat |
|---|---|
| Avec internet : saisir un dépôt | formulaire libéré en 260 ms ; en 3 s, ni bandeau, ni « Soldes provisoires », ni « En attente d'envoi » ; la saisie est au serveur |
| Wifi sans internet (le serveur ne répond pas, le navigateur se croit en ligne) | formulaire libéré en 261 ms, contre 8 s avant ; le stock compte la saisie aussitôt ; rien à 2 s, le bandeau, « Soldes provisoires » et la mention passé 5 s |
| Le stock a fondu au serveur pendant ce temps, puis le serveur répond | « 1 opération refusée », la ligne dit « Refusée : Stock insuffisant… », rien d'écrit au serveur, « Retirer » l'enlève |
| Hors ligne complet : ravitailler de 100 000, saisir 3 000 | 78 ms et 264 ms ; « Ravitaillement enregistré », « Transaction sauvée en attente », plus aucun « Connexion absente » ; bandeau immédiat, soldes provisoires 102 000 |
| Recharger hors ligne | le fond de l'en-tête est servi par le service worker (HTTP 200) |
| Le réseau revient | le serveur arrive à 102 000, la file se vide ; le bandeau s'éteint sans se rallumer |

Console : aucune erreur, hors le bruit connu du hors-ligne (le même filtre qu'en G4).

Cet essai a trouvé un défaut que les tests isolés ne voyaient pas. Quand la première
opération partait, la suivante était jugée avec une heure figée au dernier réveil du
minuteur. Elle paraissait fraîche, et le bandeau s'éteignait un instant avant de revenir.
L'heure est maintenant relue avec la liste, dans le même rendu (`EnvoisContext.jsx`).

**Tests :** TC-352 réécrit sur le nouveau contrat, avec [FE-18] et [FE-19] ; TC-361
[GF-20] à [GF-22] ; TC-364 (6 cas) ; TC-353, TC-355 et TC-363 adaptés.
16 mutations, toutes attrapées.

**Déploiement :** front seul, aucune function. Un push suffit.

**Essai sur une vraie machine, après le push :**
1. Box allumée, internet coupé (câble de la box débranché) : chaque opération se ferme
   aussitôt ; le bandeau n'arrive qu'après 5 s.
2. Wifi coupé, page rechargée : le fond de l'en-tête reste.
3. Avec internet : aucun bandeau ni « Soldes provisoires » entre deux opérations.

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
