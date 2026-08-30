# S1 — Caractérisation de l'espace dealer

```
Statut     : terminée
Périmètre  : MVP
Dépend de  : aucune
```

---

## Objectif

Avant de toucher au dessin, figer par des tests ce que les huit écrans dealer font
aujourd'hui. Personne n'y gagne une fonctionnalité : ces tests sont le filet qui
permettra aux lots suivants de changer l'apparence sans changer le comportement, et
de le prouver.

---

## Critères d'acceptation

- [x] Chaque écran de `src/pages/dealer/` a un test qui décrit son comportement
      observable actuel : ce qui est chargé, ce qui est affiché, ce qui se passe au
      clic sur l'action principale.
- [x] La pagination est couverte là où elle existe (`DealerRequests`,
      `DealerStores`, `DealerHistory`) : première page, page suivante, dernière page.
- [x] Les filtres de statut et la recherche par boutique sont couverts.
- [x] Confirmation et rejet d'un retour (`DealerTransfers`) sont couverts, y compris
      le motif obligatoire de 3 caractères minimum.
- [x] La double-soumission verrouillée par `submittingRef` dans
      `DealerInventoryBar` est couverte : deux clics dans le même tick ne
      produisent qu'un seul appel.
- [x] **Aucune assertion ne porte sur une classe CSS.** Un test qui casse au
      prochain lot parce qu'une couleur a changé est un test raté.
- [x] `npm run test:unit && npm run test:components` au vert, et le nombre de tests
      est reporté dans la roadmap.

---

## Hors périmètre

Corriger quoi que ce soit. Si un défaut est trouvé en écrivant un test, il est
consigné dans la spec concernée — le test fige le comportement **actuel**, défaut
compris, et c'est le lot suivant qui le corrige en connaissance de cause.

---

## Notes techniques

Le lot boutique a posé `tc-100` à `tc-106` selon la même méthode ; reprendre la
numérotation à `tc-200` pour l'espace dealer. Les doubles de données vivent dans
`src/preview-doubles/` — s'y brancher plutôt que de mocker Firestore à la main.

Deux défauts déjà repérés à la lecture, à figer tels quels et à corriger plus tard :

- `DealerStores` rend un état « Appuyez sur **Actualiser** pour charger les
  boutiques » qui n'est jamais atteint : le `useEffect` charge au montage.
- `DealerDashboard` affiche `storeCount` sous la forme `"20+"` dès que la première
  page est pleine — ce qui est le cas permanent à 84 boutiques.

---

## Ce qui a été fait

`tests/unit/tc-200-dealer-ecrans-caracterisation.test.jsx` — **24 tests**.

Le périmètre a été **réduit après relevé**, et c'est le point important de cette
spec : six des dix écrans étaient déjà couverts par `tc-031`, `tc-041`, `tc-074`,
`tc-080`, `tc-087` et `tc-089`. Écrire une caractérisation complète aurait
dupliqué du travail existant (`ARCHITECTURE.md` §1). `tc-200` ne couvre donc que
les quatre écrans orphelins.

La double-soumission de `DealerInventoryBar` était déjà tenue par `tc-074` ; elle
n'est pas réécrite ici.

Trois défauts trouvés et **figés, non corrigés** — voir le journal de
`specs/ROADMAP.md` pour leur affectation (S2, S4, S6). Le troisième — deux tables
de libellés divergentes entre l'accueil et l'historique — n'était pas au plan :
il a été trouvé en écrivant le test.
