# Filtrer les non terminées par nature

Date : 16 novembre 2026. Suite de `2026-11-15-remb-siege-bleu-ciel-design.md`.

## Pourquoi

Au-dessus du tableau « Non Terminées », trois cases donnent le nombre et le total des dépôts, des retraits et des remboursements au siège. La caissière veut s'en servir pour ne voir qu'une nature à la fois, au lieu de chercher sa ligne au milieu des autres.

## Décidé par l'utilisateur

- Les cases sont **cliquables** et **filtrent le tableau par nature**.
- Une case **« Tout » vient en premier**, avant les autres. **Elle est choisie par défaut.**

## Approches

1. **Filtrer les lignes avant le regroupement du tableau**, dans `TransactionTable`. **Retenue** : les groupes, qui sont par client et par type, restent intacts, et rien ne change ailleurs.
2. Filtrer dans le contexte des transactions. Écartée : la barre des soldes, l'assistant et les cases lisent la même liste, et le filtre fausserait leurs chiffres.

## La conception

- **Quatre boutons** dans cet ordre : `Tout`, `Dépôts`, `Retraits`, `Remb. siège`. La case Remb. siège n'existe que si le drapeau du profil est allumé, comme aujourd'hui. Les boutons sont réunis dans un groupe nommé « Filtrer par nature ». Chacun porte `aria-pressed`, et un seul est enfoncé à la fois.
- **La case « Tout »** (mon choix) a le même dessin que les autres, en teinte neutre (`ink` / `surface`).
  - Le nombre au-dessus est la somme des trois comptes.
  - Elle n'affiche pas de montant : additionner l'argent qui entre et celui qui sort ne dirait rien.
- **Choisir une nature** ne garde dans le tableau que les lignes de cette nature, y compris une ligne refusée de cette nature, qui reste à retirer. Le bouton choisi prend un contour marqué (`ring-2`), les autres sont estompés.
- **Recliquer la case choisie** revient à « Tout » (mon choix).
- **Les chiffres des cases ne bougent pas** : elles comptent toujours toutes les non terminées.
- **Une case de nature à 0 n'est pas cliquable** (mon choix). « Tout » l'est toujours.
- **Retour automatique à « Tout »** (mon choix) : si la nature choisie retombe à 0, par exemple quand la dernière ligne est réglée, le tableau repasse à « Tout » au lieu de rester vide.
- **Le filtre vit dans l'écran** (mon choix). Il s'efface quand on quitte la page, pour que la caissière ne revienne jamais sur un tableau qui cache des lignes.
- **Une seule lecture de la nature d'une ligne :** `natureEnAttente(transaction)` dans `src/utils/caisse.js` renvoie `'depot'`, `'retrait'`, `'siege'` ou `null`. `sommesEnAttente` l'emploie aussi, sans changer ses sommes, pour que la case et le filtre ne puissent pas diverger.

## Hors champ

Rien côté serveur, aucune function à déployer. Le tableau de l'historique n'est pas concerné.

## Laissé à l'exécutant

Les identifiants de test (`filtre-tout`, puis `case-…-non-terminees` qui deviennent des boutons), les numéros de tests, et le libellé accessible exact.
