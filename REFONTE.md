# Refonte C2EGF BURKINA — bilan

**Branche** `feat/design-lot1-boutique` · 16 commits · 56 fichiers · +3 613 / −1 236
**Arrêté au** 27 août 2026
**Périmètre en cours** : le design. Le modèle de données et le fonctionnement
métier ne sont pas touchés — aucun champ Firestore ajouté, renommé ou supprimé,
aucune modification des flux de transaction, du calcul des soldes, des rôles ou
des permissions.

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
consommateur final n'a rien de tout cela. Ce sont des comptes professionnels
récurrents, avec un territoire et un propriétaire de relation.

Conséquence directe sur l'écran d'accueil : la question n'est pas « combien de
clients aujourd'hui » mais **« mon réseau est-il actif, et puis-je
l'approvisionner ? »**.

---

## 2. Ce qui est fait

### Lot 0 — Le filet de sécurité

L'espace boutique n'avait **aucun test de rendu**. Sept fichiers de
caractérisation posés avant de déplacer quoi que ce soit :

| Fichier | Couvre | Tests |
|---|---|---|
| tc-100 | Toast — 4 types, auto-fermeture | 13 |
| tc-101 | Shell — wordmark, repères, navigation, soldes | 12 |
| tc-102 | ClientsTable + TableRow + Pagination | 13 |
| tc-103 | TransactionTable — colonnes, menu d'actions | 11 |
| tc-104 | TransactionForm — validations, états `disabled` | 13 |
| tc-105 | reseauStats — les statistiques, fonction par fonction | 42 |
| tc-106 | Tableau de bord — rendu des quatre bandes | 21 |

Règle d'assertion tenue : **jamais par classe CSS**, toujours par rôle, nom
accessible ou texte français. Sinon on recréait le problème qu'on éliminait.

### Lot 1 — Le socle de jetons

`src/index.css` faisait 12 lignes et ne contenait aucun jeton. Il porte
maintenant quatre familles qui ne se mélangent pas :

- `brand-*` — le chrome : navigation, bouton primaire, lien, focus
- `canvas / surface / line / ink / ink-muted` — la structure et le texte
- `inflow / outflow / warn / danger / pending / success` — le sens, et lui seul
- `net-orange` — l'identité de l'opérateur, **réservée aux données**

La distinction qui porte tout le travail : **`inflow`/`outflow` ne veut pas dire
« bien / mal »**. L'application confondait les deux — 191 `red-*` mélangeaient
« échec » et « sortie d'argent ». Un retrait n'est pas une erreur.

Contrastes calculés, pas estimés — tous ≥ AA texte normal :
`brand-500` 11,78:1 · `brand-400` 6,36:1 · `ink` 15,55:1 · `ink-muted` 5,63:1 ·
`inflow` 5,35:1 · `outflow` 8,14:1 · `warn` 5,93:1 · `danger` 7,87:1.

`net-orange` ne sert jamais de chrome ni de texte : `#FF6B35` sur blanc plafonne
à **2,84:1**, sous le 4,5:1 exigé pour du texte et même sous le 3:1 des
composants d'interface.

### Lot 2 — Les gris, sans toucher un composant

**871 utilitaires gris retintés avec 11 lignes de CSS.** La rampe `--color-gray-*`
de Tailwind est redéfinie vers la teinte du marine (214°) au lieu d'être doublée
d'une rampe de plus. Zéro `.jsx` modifié.

Contrainte tenue : aucun niveau ne perd en contraste. Le 500 passe de 4,84:1 à
5,03:1, le 600 de 7,56 à 7,81, le 700 de 10,30 à 10,64.

**Le coup non joué, volontairement** : le même geste sur `--color-green-*` aurait
retinté 306 occurrences d'un trait — badges de succès compris, qui seraient
devenus marine. C'était détruire le sens pour gagner du temps.

### Lot 3 à 6 — Constantes, thèmes, icônes

- 4 fichiers de constantes retokenisés, propagés vers une vingtaine de fichiers
  de rendu non touchés.
- `dashboardTheme.js` : 6 palettes arc-en-ciel → **5 rôles sémantiques**.
- `THEMES` : 7 entrées → 1. Purge de l'API morte (`changeTheme`,
  `setCustomThemeColor`, `currentTheme`, `themes` — zéro consommateur) et du
  thème `custom`, **non implémentable par construction** : il fabriquait
  `` `bg-[${couleur}]` `` à l'exécution, chaîne que l'extracteur Tailwind ne peut
  par nature jamais lire.
- `tableHeader.split(' ')[1]` — de la chirurgie de chaîne pour récupérer une
  couleur de bordure — remplacé par une clé `tableBorder` explicite, sortie
  identique.
- `lucide-react` : seule dépendance ajoutée de tout le chantier, ~7-8 Ko gzip
  face aux 1,2 Mo de `firebase` + `xlsx` + `recharts`. Imports nommés
  uniquement — jamais `import * as icons`, jamais `<Icon name={…}/>` : les deux
  forcent Rollup à conserver le barrel de ~1 400 icônes.

### Lot 7 — Le shell boutique

Trois bandes, et une seule quitte l'écran :

| bande | hauteur | comportement |
|---|---|---|
| Bandeau de marque | 154 px (bureau) / 105 px (mobile) | **défile et sort** |
| Navigation | ~46 px | collante |
| Soldes | ~92 px | collants |

Le collage était fait à la main : **deux écouteurs `scroll` indépendants**
comparant `window.scrollY` au seuil 200 codé en dur de part et d'autre, plus une
mesure de hauteur par `document.querySelector('nav')` prise une fois au montage
et jamais recalculée. La barre passait en `fixed`, quittait le flux, et la barre
des soldes disparaissait dessous. Remplacé par `position: sticky` : zéro
écouteur, zéro mesure, zéro seuil magique.

Contrainte structurelle à ne pas casser : l'élément collant **ne peut pas** être
imbriqué dans le bandeau, sinon son bloc conteneur serait le bandeau et il se
décollerait dès que celui-ci sort de l'écran. Les deux sont frères.

**Le fond d'écran** : retiré, puis remis après votre remarque — mais à trois
conditions.

| | avant | après |
|---|---|---|
| format | PNG (sans perte, pour une photo) | JPEG |
| dimensions | 1280 × 800 | **1920** × 480 |
| poids | 1 805 921 o | **88 808 o** (−95,1 %) |
| mobile | téléchargé | **jamais téléchargé** |
| précache PWA | inclus | exclu |

Le ré-encodage passe par le chromium déjà installé pour la QA visuelle
(`canvas.toDataURL`) — aucun encodeur ajouté au projet. Le PNG d'origine reste
récupérable : `git show 73fc788:public/bg-noir.png`.

Le mobile ne télécharge rien parce que l'image est déclarée dans une règle
`@media (min-width: 768px)` : un navigateur ne charge pas l'image d'une règle qui
ne s'applique pas. Vérifié à la capture — à 1440 px la requête part, à 390 px
elle ne part pas.

### Lot 8 — Le tableau de bord

Réécrit autour de ce qu'un distributeur regarde. Le constat de départ :

| Widget | Ce qu'il valait |
|---|---|
| « Répartition par réseau » | Camembert **à une seule part**. Comptait en réalité les agents dont le code agent est rempli, et divisait par le total : une part de 360° affichait « 62,4 % », et `NaN %` sur liste vide. |
| « Top agents » | Classait `client.agentCommercial` — donc les **commerciaux**, pas les agents. Et en nombre d'enrôlements, aveugle à ce que ces comptes produisent. |
| « Fidèles clients (aujourd'hui) » | Notion de détail. Sur un réseau où les actifs passent **4 à 5 fois par jour**, « qui est venu » est du bruit ; **qui n'est pas venu** est le signal. |
| « Évolution du CA » | Additionnait les montants transités. Pour un distributeur, le revenu c'est la marge sur le float. Devient **« Volume traité »**. |

Ce qu'il montre maintenant, en quatre bandes :

```
1. LA BALANCE   puis-je approvisionner l'agent suivant ?
2. LE RÉSEAU    couverture · décrochages · concentration
3. LES FLUX     comment l'argent a circulé, et dans quel sens
4. LE FICHIER   croissance du portefeuille et derniers enrôlements
```

**Pourquoi « la balance » n'est pas une métaphore décorative.** Vérifié dans
`financialImpact.js` : un dépôt fait `stock -= montant` puis
`liquidite += montant` ; un retrait l'inverse. Avec un réseau unique, Stock et
Liquidité sont des **vases communicants exacts** — leur somme ne bouge que sur
ravitaillement de la centrale. C2EGF tient un marché de float pour son réseau, et
son risque d'exploitation c'est d'être à sec d'un côté quand un agent se présente
de l'autre. C'est le seul axe qui reste signifiant quand « quel réseau ? » n'a
plus de sens.

Décisions de gestion prises avec vous : **seuil de décrochage à 15 jours pour
tous les agents** (réglable à l'écran : 7 / 15 / 30 / 45), vocabulaire
« **agents** », mesure en « **volume traité** ».

Une distinction est écrite en tête de `reseauStats.js` parce qu'elle commande
tous les chiffres : **ACTIVITÉ** (l'agent est venu — toute opération non annulée)
n'est pas **VOLUME** (de l'argent a bougé — exclut aussi les opérations non
terminées).

### La boucle de QA visuelle

`npm run capture` monte un serveur Vite éphémère sur un banc d'essai garni de
données plausibles — 187 agents, ~3 600 opérations sur 30 jours à la cadence
réelle de 4-5 passages/jour — prend une capture pleine page et rapporte les
erreurs console. Le banc (`preview.html`, `src/preview.jsx`) est **absent du
build**, vérifié à chaque fois.

Elle a immédiatement servi : **le graphe de flux ne dessinait aucune barre**. Le
DOM montrait pourtant 28 rectangles peints, `opacity: 1`, hauteurs 52 à 92 px. La
cause : Playwright redimensionne la fenêtre pour une capture pleine page,
`ResponsiveContainer` re-mesure, et recharts **relance son animation**. Ce
n'était pas qu'un artefact de capture — ce tableau de bord est abonné au flux
Firestore, donc chaque instantané reçu rejouait l'animation en production,
pendant qu'on lit l'écran.

### Fichiers supprimés

Tous avec la procédure AGENTS.md appliquée — absence d'import statique et
dynamique prouvée, vérification scripts et config, vérification d'usage métier,
restaurabilité depuis `73fc788`.

`src/styles/themes.css` · `tailwind.config.js` · `NetworkChart.jsx` ·
`LoyaltyChart.jsx` · `CAChart.jsx` · `TransactionsTodayChart.jsx` ·
`InfoCards.jsx` · `shared/ChartLegend.jsx` · `shared/ChartTooltip.jsx` ·
`Charts/AgentsChart.jsx` · `public/bg-noir.png`

### Corrections de défauts réels rencontrées en chemin

- **`OptimisticToast.jsx`** — `type='info'` était la valeur par défaut mais
  `typeStyles.info` n'existait pas : le composant levait dès qu'on l'utilisait
  sans type explicite.
- **`Toast.jsx`** — le type (succès / erreur / avertissement) était porté
  **uniquement par la couleur et le glyphe**, et le bouton `✕` n'avait aucun nom
  accessible.
- **`StatusBadge.jsx`** — `${cls}${customCls}` sans espace. Latent aujourd'hui
  (une des deux chaînes est toujours vide), piège armé pour la suite.
- **`FluxChart`** — l'animation rejouée à chaque instantané Firestore.

---

## 3. Les chiffres vérifiés

| | |
|---|---|
| Tests | **2 062** au vert — 1 978 unitaires (67 fichiers) + 84 composants (7 fichiers) |
| Lint | propre |
| Build | passant |
| Précache PWA | 13 entrées, 2 055 KiB |
| Banc d'essai dans `dist/` | absent |
| Couleurs décoratives dans le tableau de bord | aucune |
| Valeurs de couleur arbitraires (`bg-[#…]`) dans `src/` | aucune |

---

## 4. Ce qui reste

### A. Design — l'espace boutique (la suite du lot en cours)

Les **couleurs** de ces écrans sont en grande partie déjà propres : la
retokenisation des constantes s'est propagée toute seule.

| Écran | Couleurs décoratives restantes |
|---|---|
| Clients | 0 |
| Formulaire | 0 |
| Historique | 1 |
| Transactions | 3 |
| Profil | 8 |

**Ce qui reste n'est donc pas de la couleur, c'est du dessin** : densité,
hiérarchie, et surtout les états. Il y a du travail réel — **40 fichiers portent
un état vide, et 9 seulement passent par le composant partagé `EmptyState`**. Les
chargements suivent quatre systèmes différents, dont un spinner plein écran
dupliqué mot pour mot entre `App.jsx` et `RoleGuard.jsx`.

### B. Design — l'authentification

| Fichier | Occurrences |
|---|---|
| `authStyles.js` | 28 |
| `SignInForm.jsx` | 6 |
| `SignUpForm.jsx` | 6 |
| les 5 autres fichiers `auth/` | 11 au total |

Le défaut à corriger : `THEME_VARIANTS.secondary` d'`authStyles.js` est
**violet**, et il est bien consommé — **cinq fois** dans `SignUpForm.jsx`. Le
formulaire d'inscription est violet pendant que celui de connexion est marine,
sur le même écran, à un clic d'intervalle.

### C. Design — lot 2 : admin et dealer

| Zone | Écrans | Couleurs décoratives |
|---|---|---|
| `src/pages/admin/` | 11 | 121 |
| `src/pages/dealer/` | 8 | 85 |
| `src/pages/store/` | 3 | 80 |
| `src/layouts/` | 2 | 18 |
| `src/components/` (hors boutique traitée) | — | 287 |

### D. Mobile

**Trouvé, non corrigé** : à 390 px, le tableau de bord déborde horizontalement —
634 px de contenu pour 390 de fenêtre. Le plan met le bureau en premier et le
mobile en second rang, donc je ne l'ai pas ouvert. À arbitrer : avant ou après
les écrans restants.

### E. Lot 3 — architecture

Repéré au passage, pas traité :

- `subscribeToClients` et `subscribeToHistory` lisent des **collections entières
  sans `limit` ni `orderBy`**.
- `useAllTransactions` est appelé **4 fois** et `useTodayTransactions` **3 fois**,
  chacun recalculant son mémo indépendamment.

### F. Lot 4 — sécurité

- `cashier.canEditBalances: false` du profil n'est **lu nulle part**.
  L'affordance d'édition est gardée sur `userProfile?.role === 'dealer'` dans
  `NetworkCard.jsx`. Le garde-fou est effectif par un autre chemin, mais le
  drapeau du profil ne fait rien — ce qui est pire qu'un drapeau absent, parce
  qu'on croit qu'il protège.
- `npm audit` : `@grpc/grpc-js` (haute) et `protobufjs` (modérée). Les deux sont
  **préexistantes** et transitives via Firebase.

### G. Fin de campagne

- Règle ESLint `no-restricted-syntax` par famille de couleur, pour que
  l'arc-en-ciel ne revienne pas.
- Leçons dans `ARCHITECTURE.md` §10, dont la règle d'import nommé de lucide.

---

## 5. Ce qui attend une décision de votre part

1. **`branding.theme` devient un champ mort.** Avec un seul thème,
   `config/clients/<id>.js` déclare un axe de variation qui ne varie plus —
   alors qu'AGENTS.md en fait un axe de personnalisation client. Le garder « au
   cas où » ou le retirer est une décision de produit, pas d'implémentation.

2. **Le mobile : avant ou après les écrans restants ?** (point D)

3. **La réponse « Autre » que vous aviez saisie** sur les priorités du tableau de
   bord ne m'est jamais parvenue. Si elle contenait autre chose que ce qui a été
   livré, elle est encore à traiter.

4. **Les approfondissements du tableau de bord** — Pareto complet, heures de
   pointe, décrochages par commercial — sont prévus comme sections dépliables de
   la page existante, pas comme un nouvel écran « Réseau ». Choix par défaut
   retenu ; si vous préférez un écran dédié, c'est une ligne dans le routeur.

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
npm run capture        # capture le banc d'essai visuel
npm run dev            # puis regarder le rendu réel
```

**La règle qui protège les 2 062 tests** : chaque lot est **soit** un restyle
pur, **soit** un changement déclaré — jamais les deux. Dans un lot de restyle, la
seule chose autorisée à changer est la valeur d'une chaîne `className`. Après les
tests, on lit le diff : toute ligne modifiée qui n'est pas un `className` sort du
lot.
