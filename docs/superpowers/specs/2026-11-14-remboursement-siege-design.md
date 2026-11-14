# Le remboursement au siège — l'argent que la boutique encaisse pour le siège

```
Statut     : conception, en attente d'approbation
Périmètre  : C2EGF (drapeau de profil, éteint pour le pilote)
Dépend de  : la file d'envoi (lots G3-G4), le ravitaillement et son retour
```

---

## Objectif

Une caissière enregistre, au nom de l'agent, l'argent qu'il rapporte pour le
siège, et l'envoi de cet argent au siège. Ses soldes suivent sa caisse réelle à
chaque instant, et chaque franc envoyé au siège reste rattaché à l'agent qui
l'a remboursé.

## Le problème

Le soir, après la descente, les franchises ferment ; le siège, lui, travaille
la nuit. Les agents l'appellent pour prendre du stock électronique à crédit.
Le lendemain, ils viennent rembourser dans une boutique, et la caissière
transfère ce montant au siège.

Cet argent n'appartient pas à la boutique, et le logiciel n'a aucun geste pour
lui. La caissière l'encaisse en espèces ou en Orange Money, attend souvent
d'avoir assez de stock (les retraits des autres clients le font monter), puis
l'envoie au siège. Entre les deux, sa caisse contient de l'argent que le
logiciel ne connaît pas, et rien ne relie l'envoi au siège à l'agent qui a
remboursé.

« Le siège » n'existe pas dans le logiciel : le compte « C2EGF SIEGE » qu'on
voit dans l'historique est un compte de test du développeur. Le siège n'aura
pas de compte dans ce lot.

## Les cas réels (dits par l'utilisateur, 2026-11-14)

1. L'agent rembourse en Orange Money, la caissière envoie tout de suite au siège.
2. L'agent rembourse en espèces, la caissière a le stock et envoie tout de suite.
3. L'agent rembourse en espèces, la caissière n'a pas le stock : elle attend
   que les retraits le fassent monter, puis envoie, parfois en plusieurs fois.
4. L'agent rembourse en Orange Money, la caissière envoie plus tard.
5. L'agent rembourse une partie en stock et une partie en espèces.
6. L'agent rembourse en plusieurs fois (plusieurs passages).

---

## Objectifs

- Un troisième choix de nature, « Remb. siège », dans le formulaire
  « Enregistrer une transaction », à côté de Dépôt et Retrait.
- Les soldes stock et espèce de la boutique suivent sa caisse réelle à chaque
  geste, y compris quand l'envoi au siège n'est pas encore fait.
- Chaque remboursement est une ligne au nom de l'agent : elle apparaît dans
  son historique, toutes boutiques confondues.
- L'envoi au siège se fait depuis la ligne en attente, par tranches, toujours
  depuis le stock.
- Tout marche sans connexion, comme le reste de la caisse.

## Non-objectifs

- **Suivre ce que l'agent doit encore au siège.** Décision de l'utilisateur :
  le crédit de la nuit n'est saisi nulle part ; la boutique enregistre ce
  qu'elle encaisse et ce qu'elle envoie, rien de plus. Le suivi de la dette
  viendra quand le siège aura un compte.
- **Un compte ou un écran pour le siège.**
- **L'envoi groupé** (un envoi qui solde plusieurs agents). Décision de
  l'utilisateur : chaque remboursement s'envoie seul.
- **L'envoi au siège en espèces.** Décision de l'utilisateur : l'envoi
  déduit toujours le stock.
- **L'assistant** (`src/lib/ia`) ne sait pas créer de remboursement siège dans
  ce lot. Il peut en voir dans les non terminées ; il ne doit pas les prendre
  pour des dépôts ou des retraits.
- **Une colonne « dû au siège »** sur les écrans du patron et du dealer.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Un dépôt ou un retrait qui se comporte autrement qu'aujourd'hui. Ce sont les
  gestes que les caissières font cent fois par jour.
- Un solde qui bouge en silence de travers : une commande générique
  (annulation, modification, règlement) appliquée à une ligne « Remb. siège »
  et qui ne défait qu'une jambe, ou aucune.
- Une caissière qui doit apprendre un nouvel écran. Un choix de plus dans le
  formulaire qu'elle connaît, un bouton de plus sur la ligne en attente.
- Une ligne « Remb. siège » lue comme une dette de l'agent envers la boutique
  (dans son historique, dans « l'argent dehors », chez Oxygen).

## Contraintes

- **Hors connexion d'abord** (objectif n°1 depuis le 2026-11-06) : chaque
  geste passe par la file d'envoi, avec un `commandeId` reconnu par le serveur
  au second passage.
- **Quota gratuit Firebase** : aucune écoute de plus. Les lignes en attente
  vivent dans `drafts`, que l'application écoute déjà en entier.
- **Toutes les écritures passent par les callables** ; les règles Firestore
  n'ont rien à changer (`drafts` et `history` refusent déjà toute écriture
  directe).
- **Le profil est la seule source de variation** : un drapeau dans
  `config/clients/c2egf-burkina.js`, éteint dans `_pilot.js`, recopié dans
  `functions/src/config/storeProfile.js`.
- **AGENTS.md** : tests de caractérisation avant de toucher une règle
  métier ; jamais refactorer et changer un comportement dans le même lot ;
  jamais déployer à l'initiative d'un agent.
- **Caissières** : messages courts, aucune attente du réseau.

---

## Approches

**A. Un troisième type dans le moteur des dépôts et retraits.** Ajouter
« Remb. siège » à `STORE_TRANSACTION_TYPES` et apprendre le nouveau type à
`financialImpact.js` / `financialUtils.js`, aux callables de règlement et aux
huit chemins d'annulation et de correction. Le tableau, Modifier, les tranches
et le hors connexion viennent presque seuls. Mais c'est le code le plus
sensible, en double navigateur/serveur, et une erreur de signe toucherait les
dépôts et retraits.

**B. Une famille à part, sur le modèle du ravitaillement — retenue.** Des
actions propres dans `storeTransactionCommand`, qui ne déplacent qu'une
réserve à la fois (+ espèce, ou − stock), comme `replenish` et
`returnReplenishment`. Le moteur des dépôts et retraits ne bouge pas ; les
commandes génériques apprennent seulement à **refuser** une ligne « Remb.
siège ». Prix : le tableau des non terminées doit montrer un second genre de
ligne, et Modifier doit être câblé pour elle.

Pour la caissière, A et B donnent le même écran. B a été retenu (l'utilisateur,
« vas y », 2026-11-14) parce qu'il ne peut pas casser les dépôts et retraits.

---

## Ce que la caissière voit

### Le formulaire (décidé par l'utilisateur)

```
[ Rechercher l'agent…                              ]
Montant (FCFA) : [ 200 000 ]
Nature :  ( ) Dépôt   ( ) Retrait   (•) Remb. siège
Reçu en : (•) Stock   ( ) Espèce
                 [ Non Terminées ]   [ Valider ]
```

- « Reçu en » n'apparaît qu'avec « Remb. siège ». Aucun choix par défaut :
  la caissière doit cocher (un défaut silencieux serait une erreur de réserve
  invisible).
- La recherche d'agent, le contrôle du code réseau et la fenêtre « Confirmer
  la transaction » sont ceux du dépôt. La confirmation ajoute une ligne
  « Reçu en : Espèce ».
- Le paiement mixte (cas 5) se fait en deux saisies, une par réserve.

### Les règles d'impact (décidées par l'utilisateur)

| Geste | Stock | Espèce |
|---|---|---|
| Valider, reçu en Stock | rien (+ montant − montant) | rien |
| Valider, reçu en Espèce | − montant | + montant |
| Non Terminées, reçu en Stock | + montant | rien |
| Non Terminées, reçu en Espèce | rien | + montant |
| « Envoyer au siège » (une tranche) | − tranche | rien |

- **Valider** = l'agent a payé et la caissière envoie tout de suite au siège.
- **Non Terminées** = l'agent a payé, l'envoi au siège n'est pas fait. L'argent
  reçu entre **tout de suite** dans la réserve cochée : les soldes doivent
  coller à la caisse réelle (l'utilisateur, 2026-11-14).
- **Valider, reçu en Stock passe toujours, même avec un stock à zéro**
  (l'utilisateur) : la réserve ne bouge pas.
- **Valider, reçu en Espèce** exige `stock ≥ montant`. Sinon le bouton est
  grisé avec la raison « Stock insuffisant : utilisez Non Terminées. », et le
  serveur refuse de même.

Sur une boutique à un seul réseau, « Espèce » est la liquidité du réseau du
profil (`STORE_NETWORKS[0]`), comme pour le retour de ravitaillement.

### La ligne en attente

```
KABORE Issa  ·  Remb. siège  ·  200 000  ·  reçu en Espèce
Envoyé : 50 000  ·  Reste : 150 000
                       [ Modifier ] [ Envoyer au siège ] [ Annuler ]
```

- « Envoyer au siège » ouvre le même menu que « Encaisser » / « Payer par »,
  sans choix de méthode : un montant, pré-rempli avec tout le reste si le
  stock le contient, sinon avec le stock disponible (règle de
  `montantRetourPropose`). Plafonds : le reste, et le stock.
- Quand le reste tombe à zéro, la ligne quitte les non terminées et entre dans
  l'historique, validée, sous le même identifiant.
- Elle compte dans le badge des non terminées comme les autres.

---

## Le modèle de données

Une ligne « Remb. siège », en attente (`clients/{storeId}/drafts/{id}`) ou
validée (`clients/{storeId}/history/{id}`) :

```js
{
  type: 'Remb. siège',          // une seule chaîne, partout
  balanceType: 'stock' | 'liquidite',   // « reçu en » — même nom que le ravitaillement
  montant,                       // ce que l'agent a remboursé
  envoyeAuSiege,                 // cumul des tranches envoyées
  resteAuSiege,                  // montant − envoyeAuSiege
  envoisSiege: [{ id, montant, at, by, byName }],  // borné à 50, comme `modifications`
  reseau,                        // STORE_NETWORKS[0], résolu au serveur
  statut: 'Non Terminées' | 'Validée' | 'Supprimée',
  directValidation: true,        // seulement pour « Valider » d'un geste
  // + client, clientId, code, storeId, storeName, operator*, date, createdAt,
  //   updatedAt, validatedAt — comme une ligne de dépôt
}
```

**Pourquoi pas `remainingAmount` ni les champs de règlement.** Ils ont déjà un
sens : « ce que le client doit encore ». `montantRestant`
(`historiqueClient.js`), `aggregateOutstandingDrafts` et `argentDehors.js` le
lisent ainsi, et les gardes `SETTLEMENT_FIELDS` s'en servent. Ici l'agent ne
doit rien : c'est la boutique qui doit au siège. Des noms à part évitent qu'un
lecteur existant se trompe de sens en silence.

`'Remb. siège'` **n'entre pas** dans `STORE_TRANSACTION_TYPES` ni dans
`transactions.types` du profil : `cleanTransaction` le refuserait, donc `add`
ne peut pas créer une telle ligne avec l'impact (nul) d'un type inconnu. Le
formulaire l'affiche à partir du drapeau de profil.

## Le drapeau de profil

```js
// config/clients/c2egf-burkina.js
siegeRepayment: Object.freeze({ enabled: true }),
// _pilot.js : enabled: false
// functions/src/config/storeProfile.js : export const SIEGE_REPAYMENT_ENABLED
```

Éteint, le choix « Remb. siège » n'apparaît pas et le serveur refuse les
actions nouvelles.

## Les commandes du serveur (`storeTransactionCommand`)

Quatre actions nouvelles. Chacune : `commandeId` facultatif et vérifié
**avant** tout impact (comme `add` et `returnReplenishment`), datation par
`instantDeLaCaisse`, une entrée `auditLogs` avec soldes avant/après.

**`addSiegeRepayment`** `{ transaction: { client, clientId, code, montant, balanceType, statut } }`
- Non Terminées → `drafts`, `+montant` dans `balanceType`, `envoyeAuSiege: 0`,
  `resteAuSiege: montant`.
- Validée → `history`, `+montant` dans `balanceType` puis `−montant` du stock
  (refus `Stock insuffisant` si le stock ne le contient pas après la première
  jambe ; « reçu en Stock » ne peut donc jamais être refusé),
  `envoyeAuSiege: montant`, `resteAuSiege: 0`, `directValidation: true`.

**`sendToSiege`** `{ draftId, amount }`
- La ligne doit être un brouillon « Remb. siège » ; `amount ≤ resteAuSiege` ;
  `−amount` du stock (refus avec le disponible, par `adjustBalanceValue`).
- Empile la tranche dans `envoisSiege` sous l'id `commandeId`. Rejouée : la
  tranche est déjà dans le tableau du brouillon, ou dans la ligne d'historique
  de même id si le brouillon est parti → réponse idempotente.
- Reste à zéro → la ligne passe dans `history/{draftId}`, `statut: 'Validée'`,
  `validatedAt`, et le brouillon est supprimé (même schéma que
  `addTransactionPayment`, y compris le refus `IDEMPOTENCY_CONFLICT` si cet id
  porte déjà une autre ligne d'historique).

**`updateSiegeRepayment`** `{ draftId, updates: { montant, balanceType, client, clientId, code } }`
- Refusé dès qu'une tranche est partie (`envoyeAuSiege > 0`), comme
  `updateDraft` refuse un brouillon entamé. Défait `+ancien` puis applique
  `+nouveau` ; journal `modifications` comme `updateDraft`.

**`trashSiegeRepayment`** `{ draftId }` ou `{ historyId }`
- « Annuler » = « ce remboursement n'a pas eu lieu » : défait **toutes** les
  jambes, à tout moment, en attente ou validé : `−montant` de `balanceType`,
  `+envoyeAuSiege` au stock. Refus si la réserve ne contient plus de quoi
  rendre (message avec le disponible).
- La ligne finit dans `history` avec `statut: 'Supprimée'` (la corbeille,
  comme `trashDraft` et `trashHistory`).

### Les gardes sur les commandes existantes

Chaque commande générique qui lit un brouillon ou une ligne d'historique
**refuse** une ligne « Remb. siège », avant tout calcul :

| Commande | Fichier |
|---|---|
| `updateDraft`, `deleteDraft`, `validateDraft`, `trashDraft` | `storeTransactionCommand.js` |
| `cancelHistory`, `trashHistory`, `reopenHistory`, `correctHistory` | `storeTransactionCommand.js` |
| `addTransactionPayment` | `settlements/addTransactionPayment.js` |
| `addTransactionRefund` | `settlements/addTransactionRefund.js` |

Message : « Une ligne « Remb. siège » se traite par ses propres boutons. »,
code `STORE_TRANSACTION_INVALID` (définitif pour la file). Sans ces gardes,
`reverseInitialTransactionImpact` rendrait les soldes **inchangés** pour ce
type inconnu, et la ligne disparaîtrait en laissant son argent dans la caisse.
Ces gardes protègent aussi une application ancienne (PWA pas encore
rechargée) qui verrait la ligne et proposerait « Modifier » ou « Annuler ».

## Le hors connexion

Quatre opérations nouvelles dans la file (`fileEnvoi.js`), envoyées par
`services/envois.js` vers les quatre actions : saisie, tranche, modification,
annulation. Chacune projette son effet sur les soldes provisoires
(`soldesProvisoires`) et sur les lignes affichées (`appliquerFile`) avec les
règles du tableau ci-dessus, comme `RAVITAILLEMENT` et `RETOUR`. Une tranche
hors ligne sur une ligne saisie hors ligne part après elle (l'ordre de la file
le garantit déjà).

## Les lecteurs à adapter

| Lecteur | Ce qu'il doit faire d'une ligne « Remb. siège » |
|---|---|
| `getAvailableActions` (`helpers.js`) | Modifier, Envoyer au siège, Annuler ; ni Encaisser, ni Payer par, ni Rembourser |
| `TransactionTable` | afficher « Reçu en », « Envoyé », « Reste » ; le menu sans méthode |
| `HistoriqueTable`, `LigneHistorique`, styles de type | un libellé et une teinte pour « Remb. siège » |
| `trashTransaction` et les boutons d'une ligne validée (`transactions.jsx`) | « Annuler » part vers `trashSiegeRepayment` (comme `estRetour` route vers `trashReplenishmentReturn`) ; pas de « Corriger » |
| export remis au gérant (`helpers.js`, `TYPES_DEALER`) | garder la ligne : c'est une opération d'agent |
| tout autre lecteur qui classe par type (totaux du jour, regroupements de non terminées, `caisse.js`) | ne la compter ni comme dépôt ni comme retrait, ne pas la grouper avec eux |
| `chiffreAffairesService.js` | **exclure** (avec Ravitaillement, Retour, Clôture) |
| `aggregateOutstandingDrafts` | ignorer, sans la compter parmi les `illisibles` |
| `argentDehors.js` | ignorer (c'est déjà le cas : ni dépôt ni retrait — à verrouiller par un test) |
| `historiqueClient.js` (`ligneDeDocument`, `montantRestant`) | garder la ligne dans l'historique de l'agent, avec `reste` nul : l'agent a payé |
| `pointEntreeOxygen.js` | **exclure** du flux Oxygen dans ce lot |
| `src/lib/ia` | ne pas la compter comme dépôt ou retrait |

---

## Les décisions prises par moi (à relire)

1. **Approche B** (validée par « vas y »).
2. **« Envoyer au siège »** comme nom du bouton de la ligne, parce que
   « Rembourser » existe déjà dans ce tableau et rend l'argent au client.
3. **Exclu du chiffre d'affaires** : l'utilisateur ne savait pas. Un
   remboursement n'est pas une vente de la boutique ; le compter gonflerait les
   boutiques qui encaissent beaucoup d'agents. Le rétablir = retirer le type de
   la liste d'exclusion.
4. **Exclu du flux Oxygen** : le contrat avec Oxygen a été validé par
   l'utilisateur ; y faire entrer un type nouveau le changerait. À rouvrir avec
   lui.
5. **« Annuler » défait tout, à tout moment.** C'est aussi le seul chemin pour
   corriger une tranche mal tapée : annuler, ressaisir, renvoyer. Pas de bouton
   « annuler la dernière tranche ».
6. **Modifier, seulement avant la première tranche**, comme un dépôt.
7. **Pas de correction d'une ligne validée** (le geste `correctHistory`) :
   Annuler puis ressaisir.
8. **Paiement mixte = deux saisies.**
9. **Aucun choix de réserve coché par défaut.**

## Laissé au constructeur

- Les noms exacts des opérations de file et des fonctions de préparation
  (`preparerRembSiege`, `evaluerRembSiege`…), sur le modèle de
  `ravitaillement.js` et `preparationTransaction.js`.
- La teinte de « Remb. siège » (jetons de `DESIGN.md`).
- Les numéros de TC.

---

## Découpage en lots

1. **Caractérisation.** Figer ce que font aujourd'hui les huit commandes
   génériques et les deux callables de règlement sur une ligne de type
   inconnu, et ce que font `aggregateOutstandingDrafts`, `argentDehors`,
   `ligneDeDocument` et le chiffre d'affaires. Aucun code de production.
2. **Serveur.** Drapeau de profil, les quatre actions, les gardes. Tests sur
   l'émulateur : les six cas réels, les refus (stock insuffisant, tranche >
   reste, modification après tranche, annulation sans réserve), l'idempotence
   de chaque action, les gardes.
3. **Écran et file.** Formulaire, ligne en attente, menu, historique, file
   d'envoi et soldes provisoires. Tests de composant et de la file.
4. **Lecteurs.** Chiffre d'affaires, agrégat dealer, historique client,
   Oxygen, assistant.

**Ordre de déploiement : les functions avant le front.** Un serveur qui ne
connaît pas `addSiegeRepayment` répond « Commande inconnue. »
(`STORE_TRANSACTION_INVALID`), que la file prend pour un refus définitif :
l'opération serait marquée refusée. Le déploiement reste un geste humain
(`docs/deployer-les-functions.md`).

## Tests d'acceptation

Pour chaque ligne, les soldes stock / espèce avant et après :

| Cas | Gestes | Stock | Espèce |
|---|---|---|---|
| 1 | Remb. 100 000, Stock, Valider (stock à 0) | 0 → 0 | inchangé |
| 2 | Remb. 100 000, Espèce, Valider (stock 300 000) | 300 000 → 200 000 | +100 000 |
| 2b | Idem avec stock 50 000 | refusé, bouton grisé | inchangé |
| 3 | Remb. 100 000, Espèce, Non Terminées ; envoi 60 000 ; envoi 40 000 | −60 000 puis −40 000 | +100 000 à la saisie |
| 4 | Remb. 100 000, Stock, Non Terminées ; envoi 100 000 | +100 000 puis −100 000 | inchangé |
| 5 | Deux saisies : 60 000 Stock et 40 000 Espèce | selon 1–4 | selon 1–4 |
| 6 | Trois remboursements du même agent | trois lignes dans son historique | — |
| A | Cas 3 annulé après l'envoi de 60 000 | +60 000 | −100 000 |
| H | Cas 3 entièrement hors ligne, puis retour du réseau | mêmes soldes, une seule fois | même |
