# Refonte C2EGF BURKINA — bilan

**Branche** `feat/design-lot1-boutique` · 25 commits
**Mis à jour le** 27 août 2026
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

### Défauts réels trouvés et corrigés dans ce lot

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

Il ne montait que le tableau de bord ; il monte désormais aussi la liste des
clients et l'historique, dans leurs deux états. **C'est ce qui a rendu visibles
la teinte de ligne, le statut toujours vert et le débordement mobile** — aucun
des trois n'apparaissait dans les tests.

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
| Couleurs décoratives — `components/{transactions,historique,dashboard,network}` | **0** |
| Couleurs décoratives — `src/components/*.jsx` (racine) | **0** |

---

## 4. Ce qui reste

### A. L'espace boutique — deux écrans oubliés du découpage

**À traiter en premier.** La navigation boutique compte **sept** entrées ; le
plan du lot 9 n'en couvrait que cinq. « Demandes Dealer » (`/dealer-requests`)
est une destination de la boutique, et ses deux écrans vivent dans
`src/pages/store/` — rangés au bilan précédent avec les back-offices.

| Fichier | Couleurs décoratives |
|---|---|
| `src/pages/store/` (3 écrans) | 80 |
| `ui/DealerRequestStatusBadge.jsx` | 6 |
| `ui/RejectionRemarkButton.jsx` | 10 |

### B. L'authentification

`authStyles.js` porte 28 occurrences, et son `THEME_VARIANTS.secondary` est
**violet** — consommé **cinq fois** dans `SignUpForm.jsx`. Le formulaire
d'inscription est violet pendant que celui de connexion est marine, sur le même
écran, à un clic d'intervalle. Les 7 fichiers `auth/` totalisent 22 occurrences
de plus.

### C. Les back-offices admin et dealer

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

### D. Deux composants sans consommateur

- **`ui/WorkspaceTopbar.jsx`** — aucun import nulle part. Il porte encore le
  wordmark en `text-green-900`, dernier vert AKAYIS.
- **Le toast de rollback de `TransactionTable`** — `rollbackToast.show` n'est
  **jamais** passé à `true`. Le retour après annulation d'une opération
  optimiste est muet. Le composant est désormais sûr (il ne lève plus) ; décider
  *quand* un rollback doit parler est une spécification de comportement, pas une
  décision de design. Signalé, non inventé.

### E. `networkConfig.js` — 42 couleurs pour 5 réseaux que ce client n'a pas

Le fichier décrit six réseaux en arc-en-ciel (Orange, Moov, Telecel, Coris,
Sank, Liquidité). Le profil C2EGF n'en active **qu'un**. Ces couleurs sont des
données d'identité d'opérateur, pas du chrome — leur sort se décide avec le
sujet « multi-réseau », pas dans un lot de restyle.

### F. Architecture

- `subscribeToClients` et `subscribeToHistory` lisent des **collections
  entières sans `limit` ni `orderBy`**.
- `useAllTransactions` est appelé **4 fois** et `useTodayTransactions` **3
  fois**, chacun recalculant son mémo indépendamment.

### G. Sécurité

- `cashier.canEditBalances: false` du profil n'est **lu nulle part**.
  L'affordance est gardée sur `userProfile?.role === 'dealer'` dans
  `NetworkCard.jsx`. Le garde-fou est effectif par un autre chemin, mais le
  drapeau ne fait rien — ce qui est pire qu'un drapeau absent.
- `npm audit` : `@grpc/grpc-js` (haute) et `protobufjs` (modérée), toutes deux
  **préexistantes** et transitives via Firebase.

### H. Fin de campagne

Règle ESLint `no-restricted-syntax` par famille de couleur, pour que
l'arc-en-ciel ne revienne pas. À poser **après** les lots A, B et C — pas avant,
sinon elle bloque le travail qu'elle doit protéger.

---

## 5. Ce qui attend une décision

1. **L'ordre des lots restants** : les deux écrans oubliés de la boutique (A),
   l'authentification (B), ou les back-offices (C) ?
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
npm run capture                          # capture le banc d'essai à 1440
node scripts/qa-visuelle.mjs c.png 390    # et à 390
npm run dev                              # puis regarder le rendu réel
```

**La règle qui protège les 2 082 tests** : chaque commit est **soit** un restyle
pur, **soit** un changement déclaré — jamais les deux. Dans un commit de
restyle, la seule chose autorisée à changer est la valeur d'une chaîne
`className`. Après les tests, on lit le diff : toute ligne modifiée qui n'est pas
un `className` sort du commit, ou le commit change de nature et le dit.
