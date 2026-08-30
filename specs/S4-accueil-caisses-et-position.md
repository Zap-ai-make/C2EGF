# S4 — L'accueil : les caisses et la position

```
Statut     : à faire
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

- [ ] « Mon argent dehors » est affiché comme **un seul montant** — pas de découpage
      stock / liquidité, qui n'a pas de sens puisque l'un devient l'autre au
      comptoir de la boutique.
- [ ] Le détail envoyé / revenu est lisible, et le montant en transit (envoyé, pas
      encore confirmé) est distinct du montant dehors.
- [ ] La somme des caisses est affichée à côté, et **le rapprochement des deux est
      montré** : concordant, ou l'écart chiffré et nommé.
- [ ] Tant que les compteurs de S2 n'ont pas rattrapé l'historique, l'écran
      **le dit** au lieu d'afficher un écart trompeur.

**Les caisses**

- [ ] Pour chaque boutique : stock **et** liquidité, en montants exacts, en chiffres
      tabulaires, sur une **échelle commune** à toute la liste.
- [ ] Le seuil bas (S2) traverse la liste comme un filet vertical partagé. Une
      caisse en dessous est signalée **par un mot**, jamais par la seule couleur.
- [ ] L'échelle a un plafond annoncé ; une caisse qui le dépasse porte un cran
      visible et **son montant reste exact**.
- [ ] La liste se trie par stock et par liquidité, croissant et décroissant, et
      le tri courant est annoncé.
- [ ] La recherche par nom de boutique fonctionne sur l'ensemble des 84, pas sur la
      page affichée.
- [ ] Les quatre `StatCard` à emoji disparaissent. Les comptes encore utiles
      passent en sous-titre de page.
- [ ] Un seul `h1`, par `PageHeader`, comme les autres écrans.

**Les états** (`DESIGN.md` §10)

- [ ] Chargement : un squelette qui a **la forme de la liste**, seuil compris — la
      page ne saute pas à l'arrivée des données.
- [ ] Vide : aucune boutique active — dit ce qui manque et ce qui marche quand même.
- [ ] Erreur **partielle** : N caisses sur 84 illisibles — les autres restent
      affichées, et la somme refuse de se rapprocher tant qu'elle est incomplète.
      Un total faux qui s'annonce juste est pire que pas de total.
- [ ] Clairsemé : une seule boutique — l'échelle relative est alors trompeuse, et
      l'écran le dit.
- [ ] Dense : 84 lignes, vérifié au banc d'essai, pas à trois lignes de démonstration.

**Le socle**

- [ ] Contraste AA mesuré, focus visible, noms accessibles complets : les barres
      sont masquées de l'arbre d'accessibilité, et le nom accessible de chaque ligne
      porte le sens entier (« Pouytenga : stock 180 000 FCFA, sous le seuil ;
      liquidité 2 940 000 FCFA »).
- [ ] Zéro emoji, zéro couleur hors palette.
- [ ] Aucun débordement horizontal à 390 px.

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
