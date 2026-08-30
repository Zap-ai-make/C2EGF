# S2 — Les caisses en une requête, et l'argent dehors

```
Statut     : à faire
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

- [ ] Les soldes des boutiques sont obtenus par **une seule** requête
      `collectionGroup('networkBalances')`, et non plus par un `getDoc` par
      boutique. Le nombre de lectures ne dépend plus du nombre de boutiques.
- [ ] Le nombre de boutiques actives affiché est **exact**, jamais `"20+"`.
- [ ] `dealerBalances/{dealerUid}` porte deux compteurs cumulés : total envoyé aux
      boutiques, total revenu des boutiques. Ils sont exposés à l'UI par
      l'abonnement `subscribeDealerBalance` déjà en place — donc sans lecture
      supplémentaire.
- [ ] Les deux compteurs sont mis à jour **dans la transaction existante** de
      `confirmDealerRequest` et `confirmStoreDealerTransfer`, jamais après coup.
      Une confirmation et son compteur ne peuvent pas diverger.
- [ ] Un rejet (`rejectDealerRequest`, `rejectStoreDealerTransfer`) ne touche aucun
      compteur : rien n'est parti, rien n'est revenu.
- [ ] Le seuil bas est un **champ nommé et commenté du profil client**
      (`config/clients/_pilot.js`), unique pour tout le réseau. Aucune constante de
      seuil ne subsiste dans un composant.
- [ ] Les compteurs sont testés sous émulateur, avec **au moins deux boutiques**
      différentes (`AGENTS.md`).
- [ ] Une transaction interrompue ne laisse pas un compteur avancé : test de
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
