# S3 — Le poste : shell de l'espace dealer

```
Statut     : terminée
Périmètre  : MVP
Dépend de  : S1
```

---

## Objectif

La barre latérale cesse d'être un menu et devient le poste de travail : le dealer y
lit ses deux cuves en permanence, y trouve son action principale, et navigue entre
ce qu'il distribue et ce qu'il consulte. Le contenu récupère la hauteur que le
bandeau d'inventaire lui prenait sur chaque écran.

---

## Critères d'acceptation

- [x] La barre latérale porte, sans jamais défiler : la marque et le rôle, les deux
      cuves (stock et liquidité) en chiffres tabulaires, l'action « Nouveau
      ravitaillement », la navigation, et le compte en pied.
- [x] La navigation est en **deux groupes** — ce qu'on distribue, ce qu'on consulte
      — et l'invariant déjà exécutable de `constants/navigation.js` s'y applique :
      **un compteur d'attente ne peut apparaître que sur le groupe où l'on agit.**
- [x] `DealerInventoryBar` ne rend plus de bande dans `<main>`. Sa modale
      d'ajustement et son verrou de double-soumission `submittingRef` sont conservés
      à l'identique — c'est une action financière.
- [x] Une cuve sous le seuil bas (S2) le signale **par un mot**, pas seulement par
      une couleur ou un anneau.
- [x] Sur mobile : les cuves restent atteignables sans ouvrir le menu, et le panneau
      de navigation se ferme à Échap et à la navigation.
- [x] Zéro emoji : le `✕` de fermeture devient une icône `lucide`, comme dans
      l'espace boutique.
- [x] Zéro couleur hors palette dans `src/layouts/DealerLayout.jsx` (10 aujourd'hui).
- [x] Le bouton « Se déconnecter » n'est plus rouge : quitter n'est pas détruire.
      `danger` reste réservé à l'échec et à la suppression.
- [x] Focus clavier visible partout, piège de focus géré dans la modale, ordre de
      tabulation logique, cibles tactiles suffisantes.
- [x] `DealerHome.jsx`, mort et jamais routé, est supprimé selon la procédure
      d'`AGENTS.md` : absence d'import statique, recherche d'imports dynamiques,
      vérification des scripts et configurations, test avant/après.
- [x] Aucun débordement horizontal à 390 px (`npm run deborde`).
- [x] Les tests de S1 passent sans modification.

---

## Hors périmètre

Le contenu des écrans. Cette spec ne touche que le châssis ; les pages qu'il
contient restent telles quelles et seront reprises en S4 et S5.

---

## Notes techniques

Réutiliser `workspaceTheme.js` (`BRAND`, `CARD`, `BTN_PRIMARY`…) plutôt que d'écrire
de nouvelles classes. ⚠ Ce fichier sert **aussi l'espace admin** : toute
modification s'y répercute, donc on y ajoute plutôt qu'on n'y change.

La structure est ce qui distingue les trois espaces — barre latérale ici,
navigation haute dans la boutique. C'est un choix déjà pris et documenté en tête de
`workspaceTheme.js` : ne pas le défaire.

~~Le fond de la tête de barre réutilise `.bandeau-marque`.~~ **Écarté à
l'implémentation** — cette classe charge la photographie selon la largeur du
*viewport*, pas du conteneur. Voir « Deux écarts par rapport au plan ».

`navigation.js` expose déjà `NAV_GROUPS`, `navItemsOfGroup` et
`assertCompteurAutorise` pour l'espace boutique. Les étendre au dealer plutôt que
de dupliquer la mécanique : c'est le même invariant, il doit rester exécutable au
même endroit.

---

## Ce qui a été fait

| Où | Quoi |
|---|---|
| `src/hooks/useDealerInventory.js` | l'abonnement aux cuves, sorti de la bande |
| `src/layouts/DealerLayout.jsx` | le poste : **une seule** barre, deux comportements |
| `src/components/dealer/DealerInventoryBar.jsx` | rail vertical ; modale et double verrou conservés |
| `src/constants/navigation.js` | deux groupes dealer + `assertCompteurDealerAutorise` |
| `src/index.css` | `.poste-marque` — texture de la tête de barre |
| `src/preview-doubles/` + `scripts/lib/banc.mjs` | le banc monte le poste (`?espace=dealer`) |
| `scripts/deborde.mjs` | accepte une variante d'adresse |
| `src/pages/dealer/DealerHome.jsx` | **supprimé** |

Vérifié : 2 207 unitaires · 297 composants · lint propre · build passant · banc
absent de `dist/` · `scrollWidth` = 390 à 390 px, cuves garnies **et** basses.

---

## Ce que la capture a trouvé, et que rien d'autre n'aurait vu

Deux défauts, tous deux invisibles aux tests et au lint. C'est la raison d'être
de la règle « regarder le rendu » (`AGENTS.md` §5).

**1. Un anneau d'alerte invisible.** Une cuve sous le seuil portait
`ring-warn` — `#8a5a00`, une teinte conçue pour un fond CLAIR. Sur le marine de
la barre, elle disparaissait : le signal existait dans le code et pas à l'œil.
Passé à `warn-soft`. La leçon est plus large que ce cas : **un jeton sémantique
n'est pas neutre au fond sur lequel on le pose**, et la paire `warn` /
`warn-soft` existe précisément pour ça.

**2. Le marqueur « bas » tronqué sur mobile.** À 390 px, le résumé des cuves
utilisait `formatCurrency`, qui suffixe « FCFA ». Les deux montants suffixés
dépassaient, et la troncature emportait d'abord la devise, puis le mot
« bas » — c'est-à-dire **le seul signal d'alerte de cet en-tête, sur l'écran où
il compte le plus**. La devise part du résumé ; le marqueur ne rétrécit plus
(`shrink-0`), c'est le nombre qui cède la place.

---

## Deux écarts par rapport au plan, assumés

**La barre n'est plus rendue deux fois.** Le plan disait « panneau mobile » ;
l'ancien shell rendait effectivement DEUX barres — deux listes de liens, deux
boutons de déconnexion, deux copies à garder d'accord. Il n'y en a plus qu'une :
dans le flux sur le bureau, coulissante sur mobile. Un seul `<nav>`, un seul jeu
de compteurs.

**La tête de barre n'utilise pas `.bandeau-marque`.** Cette classe charge la
photographie en `cover` dès 768 px de **viewport** — pas de conteneur. Dans un
bloc de 224 × 64 px elle en montrerait un fragment arbitraire, et le cadrage qui
fait tout l'intérêt du bandeau (focus 0,22) n'a aucun sens à cette taille. D'où
`.poste-marque` : deux dégradés radiaux, prévisibles à toute dimension, zéro
octet transféré.

---

## Trouvé en supprimant `DealerHome.jsx`

La procédure d'`AGENTS.md` a révélé plus qu'un fichier mort.
`tc-028-app-integration` **mockait** `DealerHome`, et son test A-12 s'intitulait
« dealer sur /dealer → DealerHome rendu ». Or la route `/dealer` rend
`DealerDashboard`. Le test passait uniquement parce que `DealerDashboard` porte
le **même** `data-testid="dealer-home"`.

Le mock était donc mort, et le nom du test décrivait un composant qu'il ne
rendait pas. Les deux sont corrigés. Le testid trompeur reste — il appartient à
l'écran que S4 réécrit, et le renommer ici aurait mélangé deux lots.
