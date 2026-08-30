# S5 — Les files et le geste de ravitaillement

```
Statut     : à faire
Périmètre  : MVP
Dépend de  : S3
```

---

## Objectif

Les deux files du dealer — ce qu'il a envoyé, ce que les boutiques lui renvoient —
se lisent et se traitent avec le même dessin. Et l'action qu'il fait dix fois par
jour, envoyer un ravitaillement, cesse de redemander ce que l'écran précédent
savait déjà.

---

## Critères d'acceptation

**Les files**

- [ ] `DealerRequests`, `DealerTransfers` et `DealerHistory` partagent **un seul**
      dessin de tableau et le châssis `PageHeader` : la largeur appartient au
      Layout, pas à la page.
- [ ] Les états passent par les composants existants — `SkeletonTable`,
      `ErrorState`, `EmptyState` — et le squelette a la forme d'un **tableau**,
      pas de trois cartes.
- [ ] **Deux vides distincts** : « rien » invite à créer un premier
      ravitaillement ; « rien qui corresponde » propose d'effacer les filtres.
- [ ] L'état mort « Appuyez sur Actualiser » de `DealerStores`, jamais atteint,
      disparaît (relevé en S1).
- [ ] Les montants sont en chiffres tabulaires et alignés à droite, en-têtes
      compris.
- [ ] Les badges de statut passent aux jetons sémantiques : `pending` pour
      l'attente, `danger` pour le rejet. L'ambre reste aux seuils.
- [ ] Confirmer et rejeter gardent leur hiérarchie : une primaire, une secondaire —
      pas deux boutons pleins de deux couleurs.

**Le geste**

- [ ] **⚠ CORRECTION FONCTIONNELLE, trouvée en S4 — à faire AVANT le restyle et
      dans un commit à part.** `NewDealerRequest` appelle `listActiveStores()`
      **une seule fois**, sans boucle de pagination
      (`DEALER_STORES_PAGE_SIZE = 20`). Son menu ne propose donc que **20
      boutiques sur 84**, et sa garde d'existence efface silencieusement un
      `?storeId=` visant l'une des 64 autres. **Le formulaire de ravitaillement
      ne peut pas atteindre les trois quarts du réseau.** Le correctif est déjà
      écrit : `listNetworkCaisses()` (S2) rend les 84 en deux allers-retours.
      Un test de caractérisation fige d'abord le défaut.
- [ ] Depuis la ligne d'une boutique, le formulaire arrive avec la boutique **et**
      la ressource déjà choisies. Il ne reste qu'un montant à saisir.
      *(C'est ce critère qui rend l'action « ravitailler cette boutique »
      livrable sur les lignes de l'accueil — elle a été retenue en S4 tant que
      le formulaire ne voyait que 20 boutiques.)*
- [ ] Le champ « Réseau » en lecture seule disparaît en mono-réseau : un champ qui
      ne peut valoir qu'une chose n'est pas un champ. Le sélecteur reste en
      multi-réseaux.
- [ ] Avant confirmation, l'écran montre **l'état des cuves du dealer après
      l'envoi**, et signale si l'envoi le fait passer sous son propre seuil bas.
- [ ] Le verrou de double-soumission est conservé : `submitLockRef` **et** l'état
      `disabled`. Les deux sont volontaires (fenêtre de double-clic dans le même
      tick).
- [ ] La validation du montant est inchangée : entier strictement positif, sûr,
      sans virgule ni notation scientifique.
- [ ] Un message de retour suit l'action, avec le même mot que le bouton.

**Le socle**

- [ ] Zéro emoji, zéro couleur hors palette dans les cinq fichiers concernés —
      **91 aujourd'hui** : `NewDealerRequest` 37, `DealerStoreCard` 16,
      `DealerRequests` 13, `DealerTransfers` 13, `DealerStores` 12.
- [ ] `DealerStoreCard` ne porte plus l'orange opérateur en fond, en texte ni en
      bouton : `#FF6B35` plafonne à 2,84:1 et `index.css` le réserve aux données.
- [ ] Focus visible, contraste AA, noms accessibles sur les boutons d'action de
      ligne (« Confirmer le retour de Fada », pas « Confirmer »).
- [ ] Les tests de S1 passent sans modification de leurs assertions.

---

## Hors périmètre

- Le renommage « demande » → « ravitaillement » : c'est S6, un changement déclaré.
  Cette spec garde le vocabulaire actuel pour rester un restyle pur.
- La suppression ou la fusion d'un écran. ⚠ `DealerStores` n'est plus la liste
  de référence — l'accueil de S4 l'a remplacé sur les trois points où il était
  faible (20 par page, une requête de solde par boutique, recherche limitée à la
  page). Son sort est une décision client, consignée dans le journal de la
  ROADMAP ; cette spec le restyle sans le trancher.

---

## Notes techniques

La pagination de `DealerRequests` mêle un abonnement temps réel sur la première
page et un curseur `getDocs` sur les suivantes, avec quatre `ref` de garde
(génération, opération, curseurs séparés, drapeau de pages extra). **Ne pas y
toucher** : c'est de la logique de concurrence, pas du dessin, et S1 la fige.

`RejectionRemarkButton`, `DealerRequestStatusBadge` et `StatusBadge` existent déjà
et servent l'espace boutique. Les réutiliser ; si deux badges font le même travail,
en retirer un plutôt que d'en aligner les couleurs.

⚠ **Le lot n'est plus un restyle pur**, et il doit le dire. La correction de
`listActiveStores()` ci-dessus change un comportement métier : elle part donc
dans son **propre commit**, avant les commits de peinture, avec son test de
caractérisation — jamais mêlée à un changement de `className` (AGENTS.md :
« jamais refactoriser et changer le comportement métier dans le même lot »).

Rappel de la règle du dépôt : dans un commit de restyle, la seule chose autorisée à
changer est la valeur d'une chaîne `className`. Toute autre ligne modifiée sort du
commit, ou le commit change de nature et le dit.
