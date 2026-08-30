# S2 — Les caisses en une requête, et l'argent dehors

```
Statut     : terminée
Périmètre  : MVP
Dépend de  : S1
```

---

## Objectif

Le dealer voit l'état des 84 caisses de son réseau sans que l'application fasse 84
allers-retours, et il voit enfin **combien de son argent est dehors** : ce qu'il a
envoyé aux boutiques moins ce qui lui est revenu, les retours se déduisant tout
seuls.

---

## Critères d'acceptation

- [x] Les soldes des boutiques sont obtenus par **une seule** requête
      `collectionGroup('networkBalances')`, et non plus par un `getDoc` par
      boutique. Le nombre de **requêtes réseau** ne dépend plus du nombre de
      boutiques : deux, quel qu'il soit.
      *(Critère corrigé après implémentation. Il disait « le nombre de lectures » ;
      c'était faux — Firestore facture au document lu, et on lit toujours les
      84 soldes. Voir « Ce que l'implémentation a appris » §1.)*
- [x] Le nombre de boutiques actives affiché est **exact**, jamais `"20+"`.
- [x] `dealerBalances/{dealerUid}` porte deux compteurs cumulés : total envoyé aux
      boutiques, total revenu des boutiques. Ils sont exposés à l'UI par
      l'abonnement `subscribeDealerBalance` déjà en place — donc sans lecture
      supplémentaire.
- [x] Les deux compteurs sont mis à jour **dans la transaction existante** de
      `confirmDealerRequest` et `confirmStoreDealerTransfer`, jamais après coup.
      Une confirmation et son compteur ne peuvent pas diverger.
- [x] Un rejet (`rejectDealerRequest`, `rejectStoreDealerTransfer`) ne touche aucun
      compteur : rien n'est parti, rien n'est revenu.
- [x] Le seuil bas est un **champ nommé et commenté du profil client**
      (`config/clients/_pilot.js`), unique pour tout le réseau. Aucune constante de
      seuil ne subsiste dans un composant.
- [x] Les compteurs sont testés sous émulateur, avec **au moins deux boutiques**
      différentes (`AGENTS.md`).
- [x] Une transaction interrompue ne laisse pas un compteur avancé : test de
      rollback.

---

## Hors périmètre

- **Dénormaliser les soldes sur le document `stores`.** Envisagé puis écarté :
  `networkBalances/current` est écrit depuis neuf chemins serveur *et* directement
  par le client (`balanceService.js`). Y ajouter une copie ferait toucher des
  chemins d'écriture financiers pour un gain que la requête de groupe obtient sans
  risque.
- Le tri et la pagination de la liste : ils vivent dans S4, sur les données que
  cette spec ramène.
- Toute reprise d'historique pour initialiser les compteurs sur les opérations
  passées — voir Notes.

---

## Notes techniques

**Le droit existe déjà.** `firestore.rules` ligne 552 :

```
match /{path=**}/networkBalances/{docId} {
  allow read: if isDealer() || isSystemManager();
}
```

C'est un choix métier déjà validé et documenté ligne 363 (« Accès autorisé : stores
(toutes actives), networkBalances, ses propres dealerRequests »). **Aucune règle à
modifier** — ce qui veut dire aussi : aucune surface d'accès à élargir.

**Le motif existe déjà.** `adminService.js:485` fait la même requête de groupe pour
l'espace admin. La reprendre, ne pas la réinventer (`ARCHITECTURE.md` §1). Attention
à son `limit(100)` : c'est un plafond, pas une pagination, et 84 boutiques n'en sont
pas loin. Le retenir comme point de rupture explicite, et le dire à l'écran plutôt
que de tronquer en silence.

**Retrouver la boutique.** Une requête de groupe rend des documents `current` ; le
`storeId` se lit sur `doc.ref.parent.parent.id`.

**Les boutiques inactives** apparaissent dans la requête de groupe : croiser avec la
liste des boutiques actives, sinon la somme des caisses inclut des boutiques fermées.

**L'initialisation des compteurs.** Les deux compteurs démarrent à zéro et ne
comptent que les opérations postérieures à leur mise en place. Tant qu'ils n'ont pas
rattrapé l'historique, « l'argent dehors » ne peut pas être rapproché de la somme
des caisses. **L'écran doit le dire** plutôt que d'afficher un écart trompeur —
c'est un état à dessiner en S4, pas un détail d'implémentation. Une reprise
d'historique est possible, mais c'est un script admin, donc une opération sensible
(`AGENTS.md` règle 6) : elle ne s'exécute pas à l'initiative d'un agent.

**Sécurité.** Les compteurs sont une donnée financière dérivée : entiers sûrs non
négatifs, mêmes garde-fous que `validBalanceValue` dans les règles. Ils n'entrent
dans aucun calcul de solde — ils ne peuvent donc pas corrompre une caisse s'ils
dérivent.

---

## Ce qui a été fait

| Où | Quoi |
|---|---|
| `functions/src/storeTransfers/shared.js` | `readFluxAmount` / `nextFluxAmount` — lecture et avance d'un compteur, avec garde d'entier sûr |
| `functions/src/dealerRequests/confirmDealerRequest.js` | compteur `flux.envoyeCumul`, dans la transaction existante |
| `functions/src/storeTransfers/confirmStoreDealerTransfer.js` | compteur `flux.revenuCumul`, dans la transaction existante |
| `src/services/dealerService.js` | `listNetworkCaisses()` — deux requêtes pour tout le réseau |
| `src/utils/dealerInventory.js` | `flux { envoyeCumul, revenuCumul, dehors, amorce }` dans la forme d'inventaire |
| `src/constants/dealerConstants.js` | `DEALER_SEUIL_BAS`, `estSousSeuil()` |
| `config/clients/_pilot.js` · `c2egf-burkina.js` | `dealer.seuilBas` |
| `tests/functions/tc-201-…` | 10 tests sous émulateur |
| `tests/unit/tc-030-…` | 7 tests pour `listNetworkCaisses` |
| `tests/unit/tc-086-…` | 3 tests pour `flux`, + l'égalité stricte mise à jour |

Vérifié : 2 207 unitaires · 297 composants · 285 functions (émulateur) · lint
propre · build passant · `generate-rules --check` sans dérive.

---

## Quatre choses que l'implémentation a apprises

### 1. Le gain est en allers-retours, pas en lectures facturées

La spec annonçait « le nombre de lectures ne dépend plus du nombre de
boutiques ». **C'est faux et le critère a été reformulé.** Firestore facture un
document lu : à 84 boutiques, on lit 84 fiches et 84 documents de soldes, avant
comme après. Ce qui change, c'est qu'on passe d'environ **90 requêtes réseau à
2** — et surtout que l'écran peut montrer les 84 d'un coup, ce que la pagination
à 20 lui interdisait structurellement.

### 2. Un compteur d'affichage a failli bloquer les approvisionnements

`confirmDealerRequest` porte une garde d'amorçage : sans document
`dealerBalances`, la confirmation n'affecte pas l'inventaire du dealer. Cette
garde teste **l'existence du document**.

Le compteur, écrit en `set(merge)`, créait ce document — avec un `flux` et sans
`balances`. À la confirmation suivante, la garde voyait un document existant,
entrait dans la branche de débit, y lisait un solde à 0 et levait
`INSUFFICIENT_DEALER_BALANCE`. **Un compteur d'affichage aurait bloqué tous les
ravitaillements du dealer.**

C'est `tc-069 [CO-A]` qui l'a attrapé. Les deux handlers n'écrivent désormais
leur compteur que sur un document déjà existant. `tc-201 [FX-C]`, `[FX-D]` et
`[FX-I]` tiennent la règle — le même piège existait dans le fichier des retours,
avec un envoi de liquidité qui aurait bloqué les ravitaillements depuis un
autre fichier.

Conséquence assumée : sans inventaire amorcé, aucun cumul. `flux.amorce` le dit.

### 3. `open_day` ne compte pas

Le type `open_day` — absent du front, mais accepté par le serveur et les règles —
**fixe** les soldes de la boutique au lieu de les augmenter, et ne débite pas
l'inventaire du dealer. Le compter reviendrait à déclarer sorti un argent qui
n'a pas bougé. `tc-201 [FX-E]`.

### 4. ⚠ Le rapprochement a un troisième terme — à traiter en S4

La proposition validée annonçait « l'argent dehors doit retomber sur la somme
des caisses ». **L'identité est plus fine que ça**, et S4 devra la dire
correctement :

```
somme des caisses  +  retours en attente  =  solde initial  +  envoyé − revenu
```

Parce que la boutique est débitée **à la création** du transfert de retour, pas
à sa confirmation, alors que le compteur `revenuCumul` n'avance qu'à la
confirmation. Entre les deux, l'argent a quitté la caisse sans être encore
compté revenu.

C'est une bonne nouvelle pour l'écran : la ligne « en transit » cesse d'être
informative et devient **le terme qui réconcilie**. Mais attention à ne pas
confondre les deux files : un *ravitaillement* en attente n'a bougé nulle part
(ni caisse, ni cuve) et n'entre pas dans l'identité ; un *retour* en attente,
si.

Second écart, indépendant : un envoi de liquidité quitte la caisse de la
boutique mais **ne crédite pas** l'inventaire du dealer — la liquidité part vers
Orange, hors inventaire suivi (règle métier existante, documentée dans
`confirmStoreDealerTransfer`). « Cuves + dehors » n'est donc pas un total
conservé. Seule l'identité ci-dessus tient.
