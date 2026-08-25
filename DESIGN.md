# DESIGN.md — Contrat d'interface

---

## 0. Comment lire ce fichier

Ce n'est pas une checklist à cocher mécaniquement, ni une liste d'outils à tous utiliser. Ce sont des principes et des non-négociables.

- Les non-négociables (accessibilité, tous les états, pas d'emoji brut, hygiène technique) s'appliquent toujours.
- Les principes de goût s'appliquent avec jugement : si une règle ne sert pas ce projet, tu déroges — mais tu dis explicitement pourquoi. Une règle appliquée bêtement peut nuire autant que son absence.
- La qualité prime sur tout le reste — le coût, le nombre de tokens, la rapidité de génération ne sont jamais des excuses pour livrer quelque chose de générique. On préfère un écran de moins, fait parfaitement, qu'un écran de plus, bâclé.
- La règle n'est jamais « ajouter plus ». Un design minimal exécuté avec précision bat un design chargé. Faire correspondre la complexité à la vision, pas au temps disponible.

---

## 1. Le principe directeur : ne pas « puer l'IA »

Une interface sent l'IA quand elle est assemblée à partir de réflexes par défaut plutôt que de choix faits pour ce sujet précis. Avant tout, on identifie et on évite ces réflexes.

**Les trois patterns génériques à fuir** (ils reviennent quel que soit le sujet, c'est ça le problème) :

- Fond crème chaud (~`#F4F1EA`) + serif à fort contraste + accent terracotta/argile (~`#D97757`). C'est joli, mais c'est devenu le tell n°1.
- Fond quasi-noir + un seul accent acide (vert acid, vermillon).
- Layout « journal » : filets fins, border-radius zéro, colonnes denses.

Chacun est légitime si le brief le demande. Aucun n'est un choix par défaut acceptable quand l'axe est libre.

**Les tics d'IA à bannir** (sauf si le sujet les justifie vraiment) :

- Hero « gros chiffre + petit label + 3 stats + accent en dégradé ». C'est la réponse-type. Ne l'utilise que si c'est réellement la meilleure.
- Dégradés violet/indigo génériques, blobs flous en arrière-plan, glassmorphism appliqué partout par défaut.
- Tout centré, partout. Les marqueurs numérotés 01 / 02 / 03 quand le contenu n'est pas une séquence.
- Copy marketing creuse : « Supercharge your workflow », « Unlock the power of… », « Seamlessly… », « Elevate your… ».
- Icônes-emojis en puces, fusées, étincelles, cases à cocher vertes décoratives.
- Illustrations stock interchangeables, ombres portées molles et omniprésentes.

Si, en travaillant, tu te diriges vers l'un de ces réflexes : arrête-toi, et trouve un choix ancré dans le sujet.

---

## 2. Avant de coder : définir la direction (obligatoire)

On ne code jamais une UI « au fil de l'eau ». On établit d'abord une direction, courte, ancrée dans le sujet réel. Si le brief ne fixe pas ces points, tu les fixes toi-même et tu les énonces avant de commencer.

Remplis ce bloc au démarrage d'un projet (il devient la référence de tous les écrans) :

```
SUJET      : Quoi exactement, pour qui, et quel est le job unique de la page ?
PALETTE    : 4 à 6 valeurs hex nommées (fond, surface, texte, accent, bordure…).
             Dérivée du monde du sujet, pas d'un défaut.
TYPO       : 2 à 3 rôles — un display avec du caractère (utilisé avec retenue),
             un body complémentaire, une face utilitaire pour data/légendes si besoin.
             Pas les familles qu'on prendrait pour n'importe quel autre projet.
LAYOUT     : le concept d'agencement en une phrase (+ un wireframe ASCII pour comparer).
SIGNATURE  : l'élément unique dont on se souviendra, qui incarne le sujet.
```

Puis relis cette direction contre le brief : si une partie ressemble à ce que tu produirais pour n'importe quel projet du même type, révise-la et dis ce que tu as changé et pourquoi. On n'écrit le code qu'une fois la direction confirmée comme spécifique — et ensuite chaque couleur, chaque taille de police dérive de ce bloc.

Fais ce travail dans ta réflexion ; ne montre au client que quand tu as confiance que ça va lui plaire.

---

## 3. Commencer par le job, pas par les pixels

Avant de choisir un composant ou une couleur : qui agit, ce qu'il cherche à accomplir, sur quel objet, et ce que le système va changer. On définit le résultat voulu avant de produire la sortie. Les décisions se justifient par le comportement du produit et le besoin réel, pas par le goût seul. La tâche principale de l'utilisateur et l'action principale doivent être immédiatement lisibles à l'écran.

---

## 4. Typographie

La typo porte la personnalité de la page — ce n'est pas un véhicule neutre pour le texte.

- Associe display et body délibérément. Échelle de tailles claire, poids et interlettrage intentionnels.
- Fais du traitement typographique un élément mémorable du design.
- Détails qui séparent le pro de l'amateur : guillemets typographiques courbes (« … », " … ") jamais droits ; chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour tout ce qui s'aligne ou se compare ; caractère … plutôt que trois points ; pas de veuves/orphelines, rag et coupures propres.
- Le corps de texte reste lisible : longueur de ligne mesurée, interligne confortable, contraste suffisant.

---

## 5. Couleur

- Palette de 4 à 6 valeurs nommées, dérivée du sujet. Un accent, utilisé avec parcimonie, porte l'attention là où elle doit aller.
- Contraste conforme WCAG AA au minimum (texte normal 4.5:1, grand texte 3:1). Ça n'est pas optionnel.
- Ne jamais transmettre une information par la couleur seule : double toujours d'un texte, d'une icône ou d'un motif.
- Dark mode traité comme un vrai mode (pas une inversion brutale) : surfaces, élévation et contraste repensés.

---

## 6. Layout, espacement, structure

- La structure encode du sens. Les dispositifs structurels — numéros, eyebrows, filets, labels — doivent dire quelque chose de vrai sur le contenu, pas le décorer. Un 01/02/03 n'est légitime que si l'ordre porte une information (vrai process, timeline).
- Échelle d'espacement cohérente (pas de valeurs magiques au hasard). Le rythme vertical et l'alignement se sentent.
- Hiérarchie claire : on sait où regarder en premier, deuxième, troisième.
- Résilient au contenu réel : la mise en page tient avec du contenu court, moyen, et très long. Formats de dates/nombres/devises adaptés à la locale.

---

## 7. Composants : réutiliser plutôt que réécrire

- Réutilise les composants et conventions déjà présents dans le projet avant d'en écrire de nouveaux. On ne réécrit pas du CSS à zéro quand un bloc existe.
- Socle par défaut recommandé (optionnel, si le projet n'a pas déjà le sien) : shadcn/ui + Tailwind, composants accessibles et non-stylés qu'on habille selon la direction. On peut piocher des références dans des bibliothèques comme 21st.dev, mais on les adapte à la direction du projet — jamais un copier-coller qui ramène une autre identité.
- Un composant fait une seule chose et la fait bien. Pas de double emploi caché.

---

## 8. Icônes et imagerie

- **Jamais d'emoji brut dans l'UI** (ni en puce, ni en pictogramme, ni en décoration). C'est le tic le plus visible de l'IA.
- Icônes : SVG propres, jeu cohérent (type lucide), taille et graisse alignées sur la typo. Sur des surfaces plates et épurées.
- Toute icône porteuse de sens a un équivalent textuel (label ou nom accessible). Les icônes purement décoratives sont masquées de l'arbre d'accessibilité.
- Imagerie choisie, pas « stock générique ». Si le sujet a ses propres matériaux, artefacts, vocabulaire visuel — c'est là qu'on puise.

---

## 9. Motion

- Le mouvement sert le sujet, il ne le décore pas. Une séquence orchestrée (chargement, révélation au scroll, micro-interaction au survol) lande mieux que des effets dispersés.
- Parfois moins, c'est plus : l'excès d'animation est justement ce qui fait « généré par IA ».
- `prefers-reduced-motion` respecté, toujours. Une animation ne doit jamais bloquer ni gêner l'usage.

---

## 10. Tous les états sont dessinés (non négociable)

Un écran n'est pas terminé tant que tous ses états ne sont pas conçus, pas seulement le cas idéal : vide · en cours de chargement · clairsemé · dense · erreur · permission refusée · désactivé · optimiste · périmé · destructif · variantes responsives.

L'état vide est une invitation à agir, pas un trou. L'erreur explique ce qui s'est passé et comment le corriger.

---

## 11. Accessibilité (non négociable)

- Focus clavier toujours visible ; tous les parcours réalisables au clavier ; pièges de focus gérés dans les overlays/modales.
- Noms accessibles corrects (`aria-label`), décor masqué (`aria-hidden`), vérifiés dans l'arbre d'accessibilité. Les boutons icône-seule ont un nom.
- Cibles tactiles suffisantes, ordre de tabulation logique, ancrage des titres (`scroll-margin-top`).
- Contraste conforme (cf. §5). L'accessibilité fait partie du « joli » : ce n'est pas une contrainte à part, c'est le socle de qualité.

---

## 12. Le texte fait partie du design

Les mots existent pour rendre l'interface plus facile à comprendre, donc à utiliser. Même intention que pour l'espacement et la couleur.

- Écris du point de vue de l'utilisateur : on nomme ce que la personne contrôle et reconnaît, jamais la plomberie technique (« notifications », pas « config webhook »).
- Voix active, sentence case, pas de remplissage. Un bouton dit exactement ce qui se passe : « Enregistrer les modifications », pas « Soumettre ».
- Un mot d'action garde le même nom dans tout le flux : le bouton « Publier » produit un toast « Publié ».
- Les erreurs ne s'excusent pas et ne sont jamais vagues. Les écrans vides invitent à l'action.
- Être précis vaut toujours mieux qu'être malin. Chaque élément fait un seul job.

---

## 13. Hygiène technique

- Attention à la spécificité des sélecteurs CSS : facile de générer des classes qui s'annulent (sélecteur de type `.section` vs d'élément `.cta`), typiquement sur les paddings/marges entre sections. Structure la cascade proprement.
- Tokens (couleurs, espacements, rayons) plutôt que valeurs en dur répétées.
- Responsive jusqu'au mobile, réellement testé.
- Pas de dépendance lourde ajoutée pour un besoin qu'un composant existant ou une feature native couvre déjà.

---

## 14. Auto-critique avant de livrer

On critique son propre travail pendant la construction, pas seulement à la fin.

- Dépense ta hardiesse à un seul endroit : que la signature soit la chose mémorable, et que tout le reste soit calme et discipliné. Coupe toute décoration qui ne sert pas le brief.
- Le conseil de Chanel : avant de sortir, regarde-toi dans le miroir et retire un accessoire. Un élément en moins, presque toujours.
- Si l'environnement le permet, prends une capture d'écran et regarde le rendu réel — une image vaut mille tokens.
- Ne pas prendre de risque est aussi un risque. La direction générique « safe » est précisément ce qu'on veut éviter.

**Passage obligatoire avant de considérer un écran fini :**

- [ ] La direction est spécifique au sujet (pas un des trois patterns du §1) ?
- [ ] Aucun emoji brut ; icônes SVG cohérentes ?
- [ ] Tous les états dessinés (§10) ?
- [ ] Focus visible, contraste AA, noms accessibles (§11) ?
- [ ] Composants réutilisés, pas de CSS réécrit inutilement (§7) ?
- [ ] Le copy aide à naviguer, voix active, zéro formule creuse (§12) ?
- [ ] Une chose à retirer ? Retire-la.

---

## 15. Outillage et sources d'inspiration

Rien ici n'est obligatoire. On installe une brique seulement si le projet en a besoin, et on visite les références pour s'inspirer, pas pour copier.

### À installer si nécessaire (socle sain)

Si le projet ne possède pas déjà son propre socle, ceux-ci sont les valeurs par défaut recommandées. Sinon, on respecte l'existant.

- **Tailwind** — système d'espacement/couleur cohérent. Selon le framework, sinon `npm install -D tailwindcss`.
- **shadcn/ui** — composants accessibles et non-stylés qu'on habille selon la direction : `npx shadcn@latest init` puis `npx shadcn@latest add button dialog …`
- **lucide** — jeu d'icônes SVG cohérent (remplace tout emoji) : `npm install lucide-react`.
- **Playwright** (QA visuelle) — pour la boucle code → capture → corrige : `npm init playwright@latest`.

### Bibliothèques à visiter pour s'inspirer

Avant de dessiner un écran, l'agent peut parcourir ces galeries pour nourrir la direction du §2 : voir comment un problème proche a été résolu, repérer un traitement typographique, une mise en page, un motif d'interaction. Le but est de relever le niveau, pas de récupérer une identité toute faite.

- **21st.dev** — large catalogue de composants React/Tailwind ; accessible en MCP pour chercher des références sans quitter l'éditeur (`npx @21st-dev/cli@latest init --client claude` — remplacer par `codex`, `cursor`, `windsurf`…).
- **Aceternity UI** — composants animés « premium », utiles comme banque d'idées pour un moment fort (à doser).
- **Open Design** — 151 design systems de marques réelles (Linear, Vercel, Stripe…) et génération d'artefacts, piloté par ce `DESIGN.md` comme contrat : `od mcp install claude` (ou l'app desktop locale).
- Toute galerie de qualité (ex. sites primés, systèmes de design publics) est un bon terrain, à condition d'en tirer un principe, pas un calque.

### La règle de réutilisation

- **S'inspirer** — comprendre pourquoi une référence fonctionne, puis l'appliquer au sujet.
- **Réutiliser ce qui sert l'objectif** — un composant ou un bloc peut être repris s'il correspond réellement au besoin et à la direction du projet ; on l'adapte alors aux tokens, à la palette et à la typo définis au §2. Jamais un copier-coller qui ramène l'identité d'un autre produit.
- **Ne pas forcer** — si aucune référence ne colle, on ne plaque rien. Un composant sur-mesure, sobre et juste, vaut mieux qu'un bloc importé qui jure avec le reste. En cas de doute, on suit la direction du projet, pas la bibliothèque.
