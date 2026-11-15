# Le remboursement au siège en bleu ciel, sa case, et le Total caisse

Date : 15 novembre 2026. Suite de `2026-11-14-remboursement-siege-design.md`, en production depuis le matin même.

## Pourquoi

Sur le tableau « Non Terminées », une ligne « Remb. siège » se confond avec les autres. Son type et son montant sont dans le marine de la marque, presque noir. La caissière doit pouvoir la repérer d'un coup d'œil, comme le vert des dépôts et le rouge des retraits. Elle doit aussi savoir, sans compter, combien de l'argent qu'elle tient part au siège.

En regardant le code, un second défaut est apparu : le **Total caisse** de la barre des soldes compte l'argent reçu pour le siège comme de l'argent de la boutique. Il grimpe à chaque remboursement en attente, alors que ce chiffre doit rester le même pour que la caissière le vérifie le soir.

## Décidé par l'utilisateur

- **Bleu ciel** pour le remboursement au siège.
- **Une troisième case en haut du tableau**, sur le modèle de « Dépôts » et « Retraits » : le nombre au-dessus, le libellé et le total dans la case.
- **Le Total caisse ne compte plus l'argent du siège.** Il retire le reste à envoyer, comme il retire déjà un retrait non terminé.

## Les approches pour distinguer la ligne

1. **Colorer le type et le montant**, comme le vert et le rouge. **Retenue** : c'est la règle que le tableau applique déjà, et la case du haut reprend la même couleur.
2. Teinter le fond de la ligne : une ligne teintée se lit comme une ligne sélectionnée.
3. Une bordure à gauche : elle marque déjà les lignes d'un groupe déplié (`border-l-brand-200`). Écartée.

## La conception

- **Deux jetons de couleur** dans `src/index.css`, à côté de `inflow` et `outflow` :
  - `--color-siege: #0270b0` ;
  - `--color-siege-soft: #e0f2fe`.

  Contraste du texte : 5,32:1 sur blanc, 4,64:1 sur `siege-soft`, 4,87:1 sur `brand-50`. C'est au niveau AA partout, comme les autres jetons. Plus clair, `#0277bd` tombe sous AA sur le fond de la case.
- **Partout où la teinte « Remb. siège » apparaît, le marine cède au bleu ciel** :
  - `TRANSACTION_STYLES` : le tableau et l'historique ;
  - la teinte de type de `LigneHistorique` ;
  - la nature choisie dans le formulaire, avec `border-siege bg-siege-soft`, comme `inflow` et `outflow`.
- **`sommesEnAttente`** renvoie aussi `siege` et `nbSiege`. La somme additionne le **reste à envoyer** (`resteAuSiege`) des lignes « Remb. siège » non terminées, sans les lignes refusées par le serveur. Cela couvre aussi une ligne saisie hors connexion, qui porte déjà son reste (`envoisEnAttente.js`). Les sommes des dépôts et des retraits ne changent pas.
- **`totalCaisse`** : T = stock + liquidité + dépôts en attente − retraits en attente − **reste à envoyer au siège**. La barre des soldes et l'assistant (`etat_de_la_caisse`) passent la nouvelle part. Avec ce terme, T ne bouge plus :
  - à la réception, parce que la réserve monte de M et que le reste vaut M ;
  - à chaque tranche, parce que le stock et le reste baissent tous deux de x ;
  - à la validation directe, parce que le reçu et l'envoi s'annulent.
- **La case** « Remb. siège » (bleu ciel) suit « Retraits », avec le même dessin. Elle n'apparaît que si le drapeau du profil est allumé, et alors toujours, même à zéro, comme les deux autres.
- **L'assistant** reçoit `remboursements_siege_non_envoyes: { nombre, montant }` dans `etat_de_la_caisse`, et sa description le mentionne.

## Hors champ

Rien côté serveur, aucune function à redéployer : c'est du front seul. Le calcul des soldes ne change pas, seul le total les lit autrement.

## Laissé à l'exécutant

Les identifiants de test de la nouvelle case, sur le modèle `case-…-non-terminees` ; les numéros de tests.
