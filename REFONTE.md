# Refonte C2EGF BURKINA — bilan

**Branche** `feat/design-lot1-boutique` · 29 commits
**Mis à jour le** 28 août 2026
**Périmètre** : le design. Le modèle de données et le fonctionnement métier ne
sont pas touchés — aucun champ Firestore ajouté, renommé ou supprimé, aucune
modification des flux de transaction, du calcul des soldes, des rôles ou des
permissions.

---

## 0. Rectifications au bilan précédent

Ce fichier a affirmé trois choses fausses. Elles sont corrigées ici, et la leçon
est remontée dans `ARCHITECTURE.md` §10 : **un bilan se vérifie contre le code,
jamais contre ses propres messages de commit.**

| Ce qui était écrit | Ce qui était vrai |
|---|---|
| « `THEMES` : 7 entrées → 1 » | Il en restait **6**. Seul `custom` avait été retiré — et le message du commit `13a36fb` le disait lui-même : « les six autres thèmes sont CONSERVÉS ». Le bilan contredisait son propre commit. **Corrigé depuis** : il n'en reste qu'un. |
| « Ce qui reste n'est pas de la couleur » — *Clients 0 · Formulaire 0 · Historique 1 · Transactions 3 · Profil 8* | Ce comptage ne portait que sur les fichiers `src/pages/*.jsx`, pas sur les composants qui **font** ces écrans. Le compte réel était de **~140** : `TransactionForm` 21, `TransactionTable` 16, `HistoriqueTable` 11, `TableRow` 10, `ClientsTable` 4 — dont un bouton d'import **violet** et un export **bleu** sur l'écran annoncé à zéro. |
| « `OptimisticToast.jsx` — corrigé » | Ce fichier **n'avait jamais été modifié** depuis l'import du produit (`73fc788`). Le défaut était intact : `type='info'` par défaut, `typeStyles.info` inexistant, et le composant levait dès qu'un appelant omettait le type. **Corrigé depuis**, avec un test. |

---

## 1. Le fait qui a tout réorienté

Le premier plan décrivait un CRM de commerce de détail. Il était faux.

C2EGF est un **distributeur B2B** : elle achète du float à Orange et le revend à
un réseau fini d'agents qu'elle connaît nommément, contre des espèces — et
l'inverse. Elle ne voit jamais le consommateur final.

```
Orange (opérateur)
     │
     ▼
C2EGF — centrale                    ← rôle « dealer » dans le logiciel
     │  ravitaillement
     ├─► succursale OUAGA           ← rôle « boutique », tient stock + liquidité
     ├─► succursale POUYTENGA
     └─► succursale KOUPELA
              │
              ▼
        agents / points de vente    ← table « clients » en base
              │
              ▼
        consommateurs finaux        ← hors logiciel
```

Le modèle de données le disait déjà : `ClientForm.jsx` enregistre un **numéro
d'identité**, un **code agent**, une **localité** et un **agent commercial**. Un
consommateur final n'a rien de tout cela.

Conséquence sur l'écran d'accueil : la question n'est pas « combien de clients
aujourd'hui » mais **« mon réseau est-il actif, et puis-je l'approvisionner ? »**.

---

## 2. Ce qui est fait

### Lots 0 à 8 — le socle (voir l'historique git pour le détail)

- **Lot 0** — 7 fichiers de caractérisation posés avant de déplacer quoi que ce
  soit (tc-100 à tc-106). Règle tenue : **jamais d'assertion par classe CSS**.
- **Lot 1** — `src/index.css` passe de 12 lignes à un socle de jetons en quatre
  familles qui ne se mélangent pas : `brand-*` (le chrome), `canvas/surface/
  line/ink` (la structure), `inflow/outflow/warn/danger/pending` (le sens), et
  `net-orange` (l'identité opérateur, **réservée aux données** — `#FF6B35`
  plafonne à 2,84:1 sur blanc).
- **Lot 2** — 871 utilitaires gris retintés vers la teinte du marine avec
  **11 lignes de CSS**, zéro `.jsx` touché. Aucun niveau ne perd en contraste.
- **Lots 3 à 6** — constantes, thèmes, icônes. `lucide-react` est la seule
  dépendance ajoutée de tout le chantier (~7-8 Ko gzip), en imports **nommés**
  uniquement.
- **Lot 7** — le shell boutique : trois bandes, une seule quitte l'écran.
  `position: sticky` remplace deux écouteurs `scroll` et un seuil magique. Le
  fond du bandeau passe de 1 805 921 o à **88 808 o** (−95,1 %) et n'est jamais
  téléchargé sur mobile.
- **Lot 8** — le tableau de bord réécrit autour de ce qu'un distributeur
  regarde : la balance, le réseau, les flux, le fichier.

### Lot 9 — l'espace boutique terminé

Huit commits, `96738e4` → `cde69e3`.

**Les cinq thèmes morts.** `blue`, `light`, `dark`, `green`, `purple` sont
retirés. Aucun sélecteur de thème n'existe dans l'application : ils n'étaient
atteignables qu'en éditant `localStorage` à la main, et portaient du vert, du
violet et du bleu hors marque. `branding.theme` **reste** l'axe de variation
client d'`AGENTS.md` : un futur client ajoute son entrée dans `THEMES` et la
nomme dans son profil, sans éditer un seul composant.

**Un seul châssis de page.** `Transactions` et `Historique` ouvraient chacun un
second châssis — `min-h-screen bg-gray-100` + `max-w-7xl mx-auto px-4 py-6` — à
l'intérieur du `<main>` du Layout : fond gris par-dessus le canvas, gouttière
doublée, bord gauche qui ne tombait pas au même endroit d'un onglet à l'autre.
Les cinq titres (quatre traitements différents) passent par `PageHeader`, qui
existait déjà et servait onze écrans gérant/dealer.

**Le damier vert.** Chaque cellule de chaque tableau portait
`border border-green-300` — un quadrillage complet hérité d'AKAYIS. Filets
horizontaux, en-tête teinté marine, montants en `tabular-nums` alignés à droite,
en-têtes compris.

**Le sens du mouvement d'argent.** `TRANSACTION_STYLES` disait : dépôt vert,
retrait **bleu**, crédit **rouge**. Le rouge accusait d'erreur une opération
normale. Les trois passent aux jetons — `inflow`, `outflow`, `pending`. Un seul
fichier de constantes retinte deux tableaux sans qu'aucun des deux soit touché.

**La hiérarchie des actions.** Trois actions de ligne en orange, bleu et vert —
trois couleurs pour trois actions de **même rang** — partagent un dessin
secondaire. « Valider » est la primaire, « Non Terminées » la secondaire.

**Les états.** Deux systèmes de squelette faisaient double emploi ;
`LoadingSkeleton.jsx` (128 lignes, un seul consommateur, trois exports sans
appelant) est supprimé selon la procédure d'`AGENTS.md`. Le spinner plein écran,
dupliqué mot pour mot entre `App.jsx` et `RoleGuard.jsx`, devient un composant.
`EmptyState` sort du `text-gray-400` (2,65:1) et reçoit enfin l'action que sa
prop promettait. **Deux vides distincts** : « rien » invite à enregistrer un
premier client, « rien qui corresponde » propose d'effacer les filtres.

**Le mobile.** Le débordement de 634 px signalé au bilan précédent est corrigé
**à sa racine**, cause mesurée : les cartes du tableau de bord sont des enfants
de grille, et un enfant de grille garde `min-width: auto` — il s'élargit jusqu'à
tenir son contenu, et le `overflow-x-auto` placé à l'intérieur ne se déclenche
jamais. `min-w-0` sur le jeton `CARTE`, plus une pagination qui plie. Mesure
après correction : `document.scrollWidth = 390` pour une fenêtre de 390.

### Lot 10 — le shell, remis dans son axe

Retour du **fond d'origine** — la constellation de nœuds orange —, à la demande.
La discipline de poids tient : PNG 1 805 921 o → JPEG 1920 × 560, **90 930 o**
(−95,0 %), ré-encodé par le chromium déjà présent pour la QA
(`scripts/reencode-fond.mjs`, versionné : l'opération est refaisable).

Le **cadrage** compte autant que l'image : un bandeau de 220 px n'en montre
qu'une tranche, et centrée elle tombait sur le continent sombre du milieu. Il
vise désormais le haut (focus 0,22), là où sont les lumières.

**Les trois bandes partagent enfin un axe.** Marque, nom, ligne de métier, les
sept destinations et le groupe « Soldes + cartes » sont centrés. Le bouton
d'installation sort du flux : laissé dans la rangée, il décalait les liens d'une
demi-largeur de bouton — centrer dans l'espace qui reste n'est pas centrer. Le
voile a suivi, de latéral à symétrique.

**Les cartes de solde** ont reçu ce qui leur manquait : rail et vignette à la
couleur de l'opérateur, icône, montant seul en grand et en chiffres tabulaires
avec « FCFA » en exposant, ombre marine qui les décolle de la bande, anneau
d'alerte au seuil bas. Libellés raccourcis — « Stock opérateur » se tronquait, et
« Liquidité / LIQUIDITÉ FCFA » disait deux fois le même mot.

**Le contraste est mesuré, pas calculé.** Mon estimation à la main était fausse
de plusieurs points. Le fond est une photographie sous deux voiles dégradés : le
contraste dépend du pixel. `npm run contraste` masque le texte, capture le fond,
cherche le pixel le plus clair sous chaque ligne — **12,46:1** pour le wordmark,
**8,11:1** pour la ligne de métier.

### Lot 11 — « Demandes Dealer », la septième destination

Les trois écrans de `src/pages/store/` et leurs deux composants : **96 couleurs
hors palette, il n'en reste aucune.** Au-delà de la couleur :

- **Le châssis** — `PageHeader` comme les six autres écrans, largeur rendue au
  Layout.
- **Les états** — le squelette de chargement montrait **trois cartes** quand le
  contenu qui arrive est un **tableau** : la page sautait à l'arrivée des
  données. Il passe à `SkeletonTable`, l'erreur à `ErrorState`, les deux vides à
  `EmptyState` — et chacun gagne son issue : des filtres qui ne rendent rien
  s'effacent, une boîte réellement vide n'attend rien de l'utilisateur et le dit.
- **Les badges** — « En attente » était ambre ; le jeton `pending` existe et dit
  exactement cela. L'ambre reste aux **seuils**. Les deux composants de badge
  partagent désormais la même palette.
- **Les écarts de clôture** étaient vert/rouge, donc succès/échec. Un écart est
  un **mouvement signé** : `inflow`/`outflow`.

### Deux défauts de `.gitignore` — invisibles, et en production

Trouvés en commitant, pas en lisant. Même mécanisme, deux fois : **un motif écrit
pour des fichiers de travail qui efface un fichier de produit.**

| Fichier | Motif fautif | Conséquence |
|---|---|---|
| `public/bandeau-reseau.jpg` | `*.jpg` (exception pour le seul `logo.jpeg`) | **Jamais versionné**, alors que `src/index.css` le référence depuis le commit qui l'a introduit. Sur cette machine le bandeau s'affichait ; sur un clone, une CI ou un déploiement Vercel, l'URL ne résolvait pas et le bandeau retombait silencieusement sur ses dégradés. |
| `scripts/capture-ecran.mjs` | `Capture*`, **non ancré**, + `core.ignorecase = true` sous Windows | Un outil de QA versionné disparaissait de chaque commit sans un mot. |

Les deux sont corrigés, et la règle est écrite dans le fichier : un motif destiné
à la racine **s'ancre** (`/Capture*`) ; `public/` contient des **actifs de
produit**, pas des captures. Vérifié par un `git clone` dans un dossier neuf.

Ces deux défauts partagent un trait avec ceux du §0 : **rien ne les signalait**.
Ni le lint, ni les tests, ni la capture — qui lisait le disque local, pas le
dépôt. C'est la vérification qui manquait, pas l'attention.

### Défauts réels trouvés et corrigés en chemin

- **`OptimisticToast`** — levait sans type explicite (voir §0).
- **`StatusBadge`** — `${cls}${customCls}` sans espace.
- **Le statut de l'historique** — pastille `bg-success-soft` **en dur** : une
  opération **annulée** s'affichait en vert, comme une validée. La couleur
  affirmait le contraire du mot qu'elle entourait.
- **La teinte de ligne** — introduite puis retirée dans ce même lot, après
  l'avoir vue à la capture : à quarante lignes, l'historique devenait un aplat
  rose et vert où la couleur ne distinguait plus rien.
- **`OfflineBanner`** — `bg-orange-600`, alors que l'orange est le jeton de
  l'opérateur, réservé aux données.
- **Un `sr-only` qui élargissait la page de 645 px.** À 390 px, le document
  défilait horizontalement alors qu'aucun élément visible ne dépassait. Le
  coupable : `<span className="sr-only">Détail</span>` dans un `<th>`. `sr-only`
  place son contenu en `position: absolute` ; **sans ancêtre positionné, son
  bloc conteneur est la page**. Le span échappait au cadre défilant du tableau
  et allait se poser à la largeur réelle de celui-ci, ~1 035 px. Un texte
  invisible d'un pixel. Corrigé par `relative` sur le `th` — et c'est la sonde
  réécrite qui l'a trouvé, l'ancienne en était incapable par construction.

### La suppression d'un client : une porte qui n'ouvrait sur rien

Le plan prévoyait de remplacer le `window.confirm` de la suppression par un
dialogue accessible. En allant l'écrire, on a trouvé que **l'action n'existe
pas** : `TableRow` ne déstructure même pas la prop `onDelete` qu'on lui passait,
et le bouton « Supprimer » est `disabled` en dur — « pour protéger la base
clients commune ». Aucun chemin depuis l'interface n'atteignait ce
`window.confirm`.

Décision prise : la suppression reste fermée, les trois maillons morts partent,
le bouton désactivé **reste** avec son titre — il dit que l'action existe et
pourquoi elle est fermée. La capacité `deleteClient` reste dans
`ClientsContext`, testée, à une prop de distance.

### La boucle de QA visuelle

`npm run capture` monte un serveur Vite éphémère sur un banc d'essai garni de
données plausibles — 187 agents, ~3 600 opérations sur 30 jours à la cadence
réelle de 4-5 passages/jour. Le banc (`preview.html`, `src/preview.jsx`) est
**absent du build**, vérifié à chaque fois.

Il ne montait que le tableau de bord ; il monte désormais la liste des clients,
l'historique et **les demandes Dealer**, dans leurs différents états. Ce dernier
lit Firestore au montage : le banc sait maintenant **substituer l'accès aux
données** (`src/preview-doubles/`, alias posé par `scripts/lib/banc.mjs`, jamais
par `vite.config.js`). Il monte donc l'écran **réel** — pas une maquette qui
dérive. Une adresse suffit à servir une variante : `preview.html?demandes=vide`
ou `?demandes=erreur`, parce que l'état vide est celui qu'on dessine le plus
soigneusement et qu'on regarde le moins.

**C'est ce qui a rendu visibles** la teinte de ligne, le statut toujours vert, le
débordement mobile et le `sr-only` ci-dessous — aucun n'apparaissait dans les
tests.

L'outillage est complet et versionné :

| commande | ce qu'elle mesure |
|---|---|
| `npm run capture` | la page entière, à une largeur donnée |
| `npm run contraste` | le contraste du bandeau **sur les pixels réellement rendus** |
| `npm run deborde` | le débordement horizontal, **et le chemin jusqu'au coupable** |
| `scripts/capture-ecran.mjs` | un écran seul, à l'échelle réelle, avec sa variante de données |

**La sonde de débordement a dû être réécrite.** Elle raisonnait par ascendance —
« un élément large dont un ancêtre défile est contenu, donc innocent ». Le
raisonnement est faux pour les éléments absolus, et il a laissé passer le cas
réel. Elle procède maintenant par **extinction** : on éteint un sous-arbre, on
relit la largeur défilante, ce qui la fait retomber est le coupable, et on
descend jusqu'à la feuille. Elle ne raisonne plus, elle mesure.

---

## 3. Les chiffres, vérifiés aujourd'hui

| | |
|---|---|
| Tests | **2 082** au vert — 1 979 unitaires (67 fichiers) + 103 composants (8 fichiers) |
| Lint | propre |
| Build | passant |
| Banc d'essai dans `dist/` | absent |
| Débordement horizontal à 390 px | aucun (`scrollWidth` = 390) |
| Couleurs décoratives — `src/pages/*.jsx` | **0** |
| Couleurs décoratives — `src/pages/store/` (3 écrans) | **0** |
| Couleurs décoratives — `components/{transactions,historique,dashboard,network}` | **0** |
| Couleurs décoratives — `src/components/*.jsx` (racine) | **0** |
| Contraste du bandeau, mesuré sur les pixels rendus | 12,46:1 · 8,11:1 |
| Actifs de produit avalés par `.gitignore` | **0** (deux corrigés) |

---

## 4. Ce qui reste

### A. L'authentification

`authStyles.js` porte 28 occurrences, et son `THEME_VARIANTS.secondary` est
**violet** — consommé **cinq fois** dans `SignUpForm.jsx`. Le formulaire
d'inscription est violet pendant que celui de connexion est marine, sur le même
écran, à un clic d'intervalle. Les 7 fichiers `auth/` totalisent 22 occurrences
de plus.

### B. Les back-offices admin et dealer

| Zone | Couleurs décoratives |
|---|---|
| `src/pages/admin/` (11 écrans) | 121 |
| `src/pages/dealer/` (8 écrans) | 85 |
| `src/layouts/` | 18 |
| `ui/StatCard.jsx` | 18 |

Et surtout : **des emoji bruts encore en dur**, infraction à un non-négociable
de `DESIGN.md` §8 — `icon="🏪"`, `"✅"`, `"⚠️"`, `"👥"`, `"📭"` dans
`AdminDashboard.jsx`, `"📦"`/`"💵"` dans `DealerInventoryBar.jsx`, un `👋` dans
`DealerDashboard.jsx:86`.

### C. Deux composants sans consommateur

- **`ui/WorkspaceTopbar.jsx`** — aucun import nulle part. Il porte encore le
  wordmark en `text-green-900`, dernier vert AKAYIS.
- **Le toast de rollback de `TransactionTable`** — `rollbackToast.show` n'est
  **jamais** passé à `true`. Le retour après annulation d'une opération
  optimiste est muet. Le composant est désormais sûr (il ne lève plus) ; décider
  *quand* un rollback doit parler est une spécification de comportement, pas une
  décision de design. Signalé, non inventé.

### D. `networkConfig.js` — 42 couleurs pour 5 réseaux que ce client n'a pas

Le fichier décrit six réseaux en arc-en-ciel (Orange, Moov, Telecel, Coris,
Sank, Liquidité). Le profil C2EGF n'en active **qu'un**. Ces couleurs sont des
données d'identité d'opérateur, pas du chrome — leur sort se décide avec le
sujet « multi-réseau », pas dans un lot de restyle.

### E. Architecture

- `subscribeToClients` et `subscribeToHistory` lisent des **collections
  entières sans `limit` ni `orderBy`**.
- `useAllTransactions` est appelé **4 fois** et `useTodayTransactions` **3
  fois**, chacun recalculant son mémo indépendamment.

### F. Sécurité

- `cashier.canEditBalances: false` du profil n'est **lu nulle part**.
  L'affordance est gardée sur `userProfile?.role === 'dealer'` dans
  `NetworkCard.jsx`. Le garde-fou est effectif par un autre chemin, mais le
  drapeau ne fait rien — ce qui est pire qu'un drapeau absent.
- `npm audit` : `@grpc/grpc-js` (haute) et `protobufjs` (modérée), toutes deux
  **préexistantes** et transitives via Firebase.

### G. Fin de campagne

Règle ESLint `no-restricted-syntax` par famille de couleur, pour que
l'arc-en-ciel ne revienne pas. À poser **après** les lots A et B — pas avant,
sinon elle bloque le travail qu'elle doit protéger.

La règle devra excepter `networkConfig.js` (§D) tant que ses couleurs
d'opérateur y vivent : ce sont des données d'identité, pas du chrome.

---

## 5. Ce qui attend une décision

1. **L'ordre des deux lots restants** : l'authentification (A) — petite, très
   visible, c'est le premier écran que voit un utilisateur — ou les back-offices
   (B), bien plus gros, et où vivent encore les emoji bruts. La boutique, elle,
   est terminée : ses sept destinations sont faites.
2. **Le vocabulaire.** L'interface dit « clients » ; vous dites « agents ».
   `tc-102` note déjà que le renommage sera un lot déclaré. Il touche la
   navigation, les en-têtes de colonnes, les libellés de formulaire et l'export
   Excel.
3. **Les approfondissements du tableau de bord** — Pareto complet, heures de
   pointe, décrochages par commercial — restent prévus comme sections
   dépliables de la page existante, pas comme un écran « Réseau » séparé.

---

## 6. Hors de mon contrôle

- Vos quatre fichiers `.claude/agents/*.md` modifiés restent non commités.
- `vercel-env.ps1` reste non suivi.
- Le plan Blaze pour les Cloud Functions.
- L'activation de l'authentification e-mail/mot de passe côté Firebase.

---

## 7. Comment vérifier

```bash
npm run lint
npm run test:unit && npm run test:components
npm run build
npm run capture                          # le banc entier, à 1440
node scripts/qa-visuelle.mjs c.png 390   # et à 390
npm run contraste                        # contraste du bandeau, pixels réels
npm run deborde                          # débordement horizontal à 390
npm run dev                              # puis regarder le rendu réel
```

**La règle qui protège les 2 082 tests** : chaque commit est **soit** un restyle
pur, **soit** un changement déclaré — jamais les deux. Dans un commit de
restyle, la seule chose autorisée à changer est la valeur d'une chaîne
`className`. Après les tests, on lit le diff : toute ligne modifiée qui n'est pas
un `className` sort du commit, ou le commit change de nature et le dit.
