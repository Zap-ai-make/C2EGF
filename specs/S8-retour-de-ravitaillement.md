# S8 — Le retour de ravitaillement

```
Statut     : à faire
Périmètre  : MVP
Dépend de  : aucune
```

> ⚠ **Cette spec n'appartient PAS à la refonte de l'espace dealer** (S1 → S7,
> `specs/ROADMAP.md`). Elle ouvre un chantier **métier**, dans l'espace boutique.
> Elle continue la numérotation pour que les identifiants restent uniques.
>
> Ne pas confondre avec S5/S6 : ceux-là décrivent la **demande** de ravitaillement
> adressée au dealer (`dealerRequests`, désactivé chez C2EGF). S8 porte sur le
> geste côté boutique — la boutique déclare ce qu'elle a **reçu**, puis ce qu'elle
> **rend**.

---

## Objectif

Une boutique reçoit du stock ou des espèces dans la journée, parfois plusieurs
fois, et de **personnes différentes**. Elle doit rendre ce qu'elle a reçu, à celui
qui le lui a envoyé.

Aujourd'hui elle ne peut pas : les seules opérations qui font sortir de l'argent
en font aussi entrer — un dépôt sort du stock *et* remplit la liquidité. Pour
rendre, il ne reste que « Vider les soldes », qui met tout à zéro.

Après S8, la boutique voit à tout moment **ce qu'elle doit encore, et à qui**, et
le solde en un geste qui ne déplace qu'une seule réserve.

---

## Critères d'acceptation

### Le ravitaillement porte son expéditeur

- [ ] Le formulaire de ravitaillement demande l'**expéditeur** dans une liste
      déroulante, en plus du montant, de la réserve et de la note.
- [ ] La liste vient du profil client. Pour C2EGF : *Patron, Mme Sawadogo,
      Mohamed, DG, Maï, Yasmine*.
- [ ] Un dernier choix, **« Ajouter un nom »**, ouvre une saisie libre.
- [ ] Un nom ajouté est mémorisé pour la boutique et réapparaît dans la liste
      aux ravitaillements suivants.
- [ ] Un nom ajouté qui ne diffère d'un nom existant que par la casse ou les
      espaces ne crée pas un second expéditeur.

### La liste et le badge

- [ ] Le bouton **Ravitaillement** porte un badge : le nombre de ravitaillements
      **en cours**. Aucun badge quand il n'y en a pas.
- [ ] Le bouton ouvre un modal listant les ravitaillements en cours, **groupés
      par expéditeur**, du plus ancien au plus récent dans chaque groupe.
- [ ] Chaque groupe affiche le **total encore dû** à cette personne.
- [ ] Chaque ligne affiche : la date, le montant reçu, la réserve, ce qui a déjà
      été rendu, et le **reste dû**.
- [ ] Le modal porte un bouton **Nouveau ravitaillement** qui ouvre le formulaire
      de saisie.
- [ ] Les états vide, chargement et erreur sont couverts (`DESIGN.md` §10).

### Le retour

- [ ] Chaque ligne porte un bouton **Retour** : il demande un **montant** et une
      **réserve** (`Stock` ou `Espèce`).
- [ ] La réserve rendue peut différer de la réserve reçue — on reçoit du stock et
      on rend des espèces.
- [ ] Un retour **décrémente la réserve choisie, et elle seule**. Aucun autre
      solde ne bouge.
- [ ] Un retour est refusé si la réserve ne détient pas le montant, avec le
      disponible dans le message.
- [ ] Un retour est refusé s'il dépasse le **reste dû** de la livraison.
- [ ] Les retours **s'accumulent** : reste dû = montant reçu − somme des retours.
- [ ] Une livraison dont le reste dû atteint zéro quitte la liste et le badge.
- [ ] Un retour est **supprimable** : la réserve est recréditée, le reste dû
      remonte, et la livraison revient dans la liste si elle en était sortie.
- [ ] Chaque retour écrit une piste d'audit (`SECURITY.md`).

### Les lignes déjà en base

- [ ] Les ravitaillements enregistrés **avant ce lot** n'apparaissent ni dans la
      liste ni dans le badge. Ils n'ont pas d'expéditeur et leur reste dû est
      inconnaissable : les afficher comme entièrement dus serait un mensonge.

---

## Hors périmètre

- **Le côté dealer.** Le dealer ne voit aucun de ces mouvements — exactement
  comme pour le ravitaillement aujourd'hui. S8 ne crée pas de registre partagé.
- **Le Total caisse.** Sa formule ne change pas. Il dira toujours ce que la
  boutique *détient*, et non ce qu'elle *possède* une fois la dette déduite.
  C'est la question suivante ; elle n'est pas celle-ci.
- **« Vider les soldes »** reste tel quel. Il devient l'exception, il ne
  disparaît pas.
- **La gestion des expéditeurs** : renommer, fusionner ou retirer un nom ajouté.
  Un nom se corrige dans le profil pour la liste fixe ; les noms ajoutés
  s'accumulent sans écran dédié.
- **Un bouton « Solder »** pour clore une ligne sur un écart. Il avait été
  envisagé pour absorber une commission — **il n'y a pas de commission dans le
  réseau, ce sont des franchises de la même entreprise.** Le reste dû atteint
  donc zéro exactement, et la ligne se ferme d'elle-même. Une erreur de saisie
  se corrige en supprimant le retour.

---

## Notes techniques

**Le retour est l'inverse exact du ravitaillement, et la primitive existe déjà.**
`applyReplenishmentImpact` n'est qu'un `adjustBalanceValue(+montant)`. Le retour
est le même appel au signe opposé — et [`adjustBalanceValue`](../functions/src/settlements/financialUtils.js)
**refuse déjà** tout solde négatif, avec le disponible dans le message. Le
garde-fou « réserve insuffisante » est donc acquis et déjà testé.

**Serveur seul, pas de parité à créer.** `src/utils/financialImpact.js` ne
duplique pas le ravitaillement, et TC-081 ne couvre que `normalizeNetworkBalances`,
`mapPaymentMethodToNetwork` et `applySettlementImpact`. Le retour reste donc dans
`functions/` uniquement. **Ne pas en écrire de miroir client** : ce serait créer
une dette de parité là où il n'y en a pas.

**L'état vit sur le document de ravitaillement**, dans la forme que le dépôt
emploie déjà pour les règlements par tranches : `returnedAmount`, `remainingAmount`
et un statut. Un ravitaillement est « en cours » tant que `remainingAmount > 0`.
L'absence du champ ⇒ ligne d'avant le lot ⇒ soldée.

**Le retour est un document à part**, pas un champ du ravitaillement : il porte
son propre montant, sa propre réserve, son auteur et sa date, et il doit être
supprimable un par un. Il référence sa livraison.

**Le badge suit la règle du dépôt.** `constants/navigation.js` : *« un compteur
veut dire quelqu'un attend une réponse de vous »*. Ici il tient, parce qu'une
livraison en cours est une dette ouverte — et parce que sans commission, le
compteur redescend réellement à zéro.

**Les noms ajoutés vivent sur `stores/{storeId}`**, dans un tableau que seule
la fonction appelable écrit. Ce document est **déjà lisible** par la boutique
(`firestore.rules` : `allow read: if isStoreMember(storeId) …`) et elle le lit
déjà pour son nom. Aucune règle nouvelle, aucune couche générée touchée,
aucune collection de plus à protéger — c'est ce qui fait préférer cet
emplacement à un `clients/{storeId}/settings/…`.

**L'expéditeur n'autorise rien.** C'est une étiquette, pas une permission : le
montant et la réserve restent les seules données validées côté serveur. La liste
fixe du profil est néanmoins vérifiée comme `STORE_PAYMENT_METHODS` l'est déjà ;
un nom ajouté est normalisé (espaces, casse) avant d'être retenu.

**Le vocabulaire est celui du comptoir** — « dealer », jamais « centrale »
(cf. `src/content/aideFiches.js`). Les fiches d'aide 8 et 9 devront suivre, et
TC-225 refusera tout libellé cité qui n'existe pas à l'écran.
