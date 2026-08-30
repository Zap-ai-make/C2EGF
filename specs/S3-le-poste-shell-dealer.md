# S3 — Le poste : shell de l'espace dealer

```
Statut     : à faire
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

- [ ] La barre latérale porte, sans jamais défiler : la marque et le rôle, les deux
      cuves (stock et liquidité) en chiffres tabulaires, l'action « Nouveau
      ravitaillement », la navigation, et le compte en pied.
- [ ] La navigation est en **deux groupes** — ce qu'on distribue, ce qu'on consulte
      — et l'invariant déjà exécutable de `constants/navigation.js` s'y applique :
      **un compteur d'attente ne peut apparaître que sur le groupe où l'on agit.**
- [ ] `DealerInventoryBar` ne rend plus de bande dans `<main>`. Sa modale
      d'ajustement et son verrou de double-soumission `submittingRef` sont conservés
      à l'identique — c'est une action financière.
- [ ] Une cuve sous le seuil bas (S2) le signale **par un mot**, pas seulement par
      une couleur ou un anneau.
- [ ] Sur mobile : les cuves restent atteignables sans ouvrir le menu, et le panneau
      de navigation se ferme à Échap et à la navigation.
- [ ] Zéro emoji : le `✕` de fermeture devient une icône `lucide`, comme dans
      l'espace boutique.
- [ ] Zéro couleur hors palette dans `src/layouts/DealerLayout.jsx` (10 aujourd'hui).
- [ ] Le bouton « Se déconnecter » n'est plus rouge : quitter n'est pas détruire.
      `danger` reste réservé à l'échec et à la suppression.
- [ ] Focus clavier visible partout, piège de focus géré dans la modale, ordre de
      tabulation logique, cibles tactiles suffisantes.
- [ ] `DealerHome.jsx`, mort et jamais routé, est supprimé selon la procédure
      d'`AGENTS.md` : absence d'import statique, recherche d'imports dynamiques,
      vérification des scripts et configurations, test avant/après.
- [ ] Aucun débordement horizontal à 390 px (`npm run deborde`).
- [ ] Les tests de S1 passent sans modification.

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

Le fond de la tête de barre réutilise les dégradés radiaux de `.bandeau-marque`
(`index.css`), qui ne coûtent aucun octet transféré et tiennent hors ligne.

`navigation.js` expose déjà `NAV_GROUPS`, `navItemsOfGroup` et
`assertCompteurAutorise` pour l'espace boutique. Les étendre au dealer plutôt que
de dupliquer la mécanique : c'est le même invariant, il doit rester exécutable au
même endroit.
