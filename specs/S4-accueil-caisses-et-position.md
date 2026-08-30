# S4 — L'accueil : les caisses et la position

```
Statut     : terminée
Périmètre  : MVP
Dépend de  : S2, S3
```

---

## Objectif

L'écran d'accueil du dealer répond à ses deux questions du matin : **combien de mon
argent est dehors**, et **quelle boutique est courte**. Les 84 caisses sont lisibles
d'un regard, sur une échelle commune, avec leurs montants exacts — de quoi décider
qui envoie quoi à qui.

---

## Critères d'acceptation

**La position**

- [x] « Mon argent dehors » est affiché comme **un seul montant** — pas de découpage
      stock / liquidité, qui n'a pas de sens puisque l'un devient l'autre au
      comptoir de la boutique.
- [x] Le détail envoyé / revenu est lisible, et le montant en transit (envoyé, pas
      encore confirmé) est distinct du montant dehors.
- [x] La somme des caisses est affichée à côté, et **le rapprochement des deux est
      montré** : concordant, ou l'écart chiffré et nommé.
- [x] Tant que les compteurs de S2 n'ont pas rattrapé l'historique, l'écran
      **le dit** au lieu d'afficher un écart trompeur.

**Les caisses**

- [x] Pour chaque boutique : stock **et** liquidité, en montants exacts, en chiffres
      tabulaires, sur une **échelle commune** à toute la liste.
- [x] Le seuil bas (S2) traverse la liste comme un filet vertical partagé. Une
      caisse en dessous est signalée **par un mot**, jamais par la seule couleur.
- [x] L'échelle a un plafond annoncé ; une caisse qui le dépasse porte un cran
      visible et **son montant reste exact**.
- [x] La liste se trie par stock et par liquidité, croissant et décroissant, et
      le tri courant est annoncé.
- [x] La recherche par nom de boutique fonctionne sur l'ensemble des 84, pas sur la
      page affichée.
- [x] Les quatre `StatCard` à emoji disparaissent. Les comptes encore utiles
      passent en sous-titre de page.
- [x] Un seul `h1`, par `PageHeader`, comme les autres écrans.

**Les états** (`DESIGN.md` §10)

- [x] Chargement : un squelette qui a **la forme de la liste**, seuil compris — la
      page ne saute pas à l'arrivée des données.
- [x] Vide : aucune boutique active — dit ce qui manque et ce qui marche quand même.
- [x] Erreur **partielle** : N caisses sur 84 illisibles — les autres restent
      affichées, et la somme refuse de se rapprocher tant qu'elle est incomplète.
      Un total faux qui s'annonce juste est pire que pas de total.
- [x] Clairsemé : une seule boutique — l'échelle relative est alors trompeuse, et
      l'écran le dit.
- [x] Dense : 84 lignes, vérifié au banc d'essai, pas à trois lignes de démonstration.

**Le socle**

- [x] Contraste AA mesuré, focus visible, noms accessibles complets : les barres
      sont masquées de l'arbre d'accessibilité, et le nom accessible de chaque ligne
      porte le sens entier (« Pouytenga : stock 180 000 FCFA, sous le seuil ;
      liquidité 2 940 000 FCFA »).
- [x] Zéro emoji, zéro couleur hors palette.
- [x] Aucun débordement horizontal à 390 px.

---

## Hors périmètre

- La coordination des transferts **entre** boutiques : décision 3, chantier séparé.
- Toute action déclenchée depuis une ligne autre que « ravitailler cette
  boutique » — le reste vit sur l'écran de détail.

---

## Notes techniques

Le banc d'essai (`preview.html`, `src/preview.jsx`) doit être **garni de 84
boutiques**, avec des caisses réalistes et au moins une au-dessus du plafond
d'échelle. Un écran vérifié à trois lignes ne prouve rien de ce que cette spec
promet. Ajouter les variantes d'adresse comme pour les demandes dealer
(`?caisses=vide`, `?caisses=erreur-partielle`, `?caisses=clairseme`).

Le tri et la recherche se font **côté client**, sur les 84 lignes déjà ramenées par
la requête unique de S2 : aucune requête supplémentaire, aucune pagination Firestore
à inventer.

Ne pas réintroduire `StatCard` : sa carte « gros chiffre + petit label + pastille
d'icône » est exactement le réflexe que `DESIGN.md` §1 range parmi les tics. Elle
reste en place pour l'espace admin, hors de ce chantier.

---

## Ce qui a été fait

| Où | Quoi |
|---|---|
| `src/utils/caissesReseau.js` | l'échelle commune, le tri, la recherche — **pur** |
| `src/utils/positionDealer.js` | le rapprochement et ses **trois refus** — **pur** |
| `src/services/storeTransferService.js` | `subscribeRetoursEnAttente` — le transit, en nombre ET en montant |
| `src/components/dealer/CaissesReseau.jsx` | l'instrument : 84 lignes, échelle commune, filet de seuil |
| `src/components/dealer/PositionDealer.jsx` | les deux colonnes et le bandeau de rapprochement |
| `src/pages/dealer/DealerDashboard.jsx` | **réécrit** — les 4 `StatCard` et la table des demandes sont parties |
| `src/index.css` | `.piste-seuil` et `.piste-cran` — deux motifs, deux raisons mesurées |
| `src/preview-doubles/` | variantes `caisses=` et `position=`, combinables |
| `tests/unit/tc-202`, `tc-203`, `tc-204` | 43 tests neufs sur l'arithmétique et le service |
| `tests/unit/tc-200` | bloc A réécrit : les défauts figés sont tenus **à l'envers** |

Vérifié : **2 255 unitaires (78 fichiers)** · 297 composants (18) · **285 functions
sous émulateur (11)** · lint propre · build passant · banc absent de `dist/` ·
`scrollWidth` = 390 à 390 px, variantes garnie **et** partielle.

---

## Ce que la capture a trouvé, et que rien d'autre n'aurait vu

Trois défauts. Aucun n'était visible dans un test, un lint ou une relecture.

**1. Le filet du seuil dérivait de 4,7 px sur les 84 lignes.** La colonne des
montants était dimensionnée à son contenu ; « 50 000 FCFA bas » et
« 3 079 774 FCFA » n'ayant pas la même largeur, la piste qui les précède se
réajustait à chaque ligne. Un trait de 1 px qui bouge de 5 px n'est pas un filet
continu : c'est **quatre-vingt-quatre tirets**, et c'est toute la promesse de
cette liste qui tombe avec lui. Mesuré à la sonde, corrigé par une largeur fixe
(`w-32 sm:w-40`), re-mesuré : **amplitude 0,00 px**, à 1440 comme à 390.

**2. Le filet était INVISIBLE sur les barres de liquidité.** `ink-muted` sur
`brand-400` mesure **1,03:1**. Il disparaissait donc sur toutes les lignes dont
la liquidité dépasse le seuil — c'est-à-dire justement celles qu'on voulait
écarter d'un coup d'œil. Le filet porte désormais **son propre contraste** :
3 px, cœur sombre entre deux liserés de surface, 17:1 quel que soit le fond.
C'est la même leçon qu'en S3, d'un cran plus loin : un jeton n'est pas neutre au
fond sur lequel on le pose, et ici il y a **trois** fonds.

**3. « 3 caisses n'aont pas pu être lues ».** Une pluralisation assemblée
morceau par morceau, sur un avertissement qui parle d'argent manquant. La même
faute dormait dans le bandeau des caisses illisibles (« 3 caisses illisibles :
son solde… Elle reste… »). Les deux phrases basculent maintenant **en entier**,
accord du verbe compris.

---

## Une mesure qui ne passe pas, et qui est assumée

La barre de stock est en `net-orange` sur une piste `brand-100` : **2,23:1**,
sous le 3:1 de WCAG 1.4.11. Aucune couleur de piste ne corrige ce chiffre —
`#FF6B35` plafonne à **2,84:1 même sur du blanc**, et `index.css` le dit déjà.

C'est précisément pour cela que le jeton n'a droit qu'aux pastilles et aux
**séries de graphique**, jamais au texte ni au chrome. Ici l'encodage est
redondant de bout en bout : le montant exact est écrit à côté de chaque barre,
la colonne s'intitule « Stock Orange », et le seuil bas est doublé du mot
« bas ». Rien de ce que la barre dit n'est dit **uniquement** par elle.

L'alternative serait de sortir le stock de l'identité opérateur, ou d'ajouter
un orange assombri à la palette. Les deux sont des décisions de palette, pas
des choix d'écran : elles sortent de ce lot et se prennent avec le client.

---

## Deux écarts par rapport au plan, assumés

**Pas d'action « ravitailler cette boutique » sur la ligne.** Elle était
autorisée par le périmètre, pas exigée par un critère — et la livrer
aujourd'hui aurait été livrer quelque chose de cassé : `NewDealerRequest`
appelle `listActiveStores()` **une fois**, sans pagination. Son menu ne propose
donc que **20 boutiques sur 84**, et un `?storeId=` visant l'une des 64 autres
est silencieusement effacé par sa garde d'existence. C'est un défaut
fonctionnel, pas de dessin ; il est consigné pour S5, dont c'est exactement le
sujet.

**La liste n'est pas un `<table>`.** Le nom accessible de chaque ligne est une
phrase unique en `sr-only` (« POUYTENGA : stock 180 000 FCFA, sous le seuil
bas ; liquidité 2 940 000 FCFA »), et tout le visuel est masqué de l'arbre.
Un tableau aurait associé chaque cellule à son intitulé de colonne, mais il
aurait fallu le démonter pour empiler les deux pistes à 390 px — et un tableau
démonté n'est plus un tableau, juste des `<div>` qui mentent sur leur rôle.

---

## L'écran des « Boutiques » fait maintenant double emploi

`DealerStores` montre les mêmes caisses, en moins bien : une carte par
boutique, **20 par page**, une requête de solde **par boutique**, et une
recherche qui ne porte que sur la page affichée. L'accueil le remplace sur les
trois points.

Il n'est **pas** supprimé dans ce lot : rien dans S4 ne le demandait, et
supprimer un écran routé se décide, ne se glisse pas. À trancher avec le
client — le retirer, ou le réduire à la fiche d'une boutique, ce que l'accueil
ne fait pas.
