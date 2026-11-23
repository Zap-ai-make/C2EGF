# Les transferts d'argent — Western Union, Ria, MoneyGram et autres

```
Statut     : conception, en attente d'approbation
Périmètre  : C2EGF (drapeau de profil, éteint pour le pilote) + option par boutique
Dépend de  : le remboursement au siège (2026-11-14), la file d'envoi (lots G3-G4),
             les numéros de la boutique (2026-11-17)
```

---

## Objectif

Une boutique qui fait aussi Western Union, Ria, MoneyGram ou un autre service
de transfert garde des soldes qui collent à sa caisse réelle. Elle coche une
option dans son Profil ; un onglet « Western Union · Ria · MoneyGram » apparaît
dans la fenêtre « Enregistrer une transaction », et chaque opération reste en
non terminée jusqu'à ce qu'elle soit envoyée au siège ou encaissée.

## Le problème (dit par l'utilisateur, 2026-11-23)

Certaines boutiques n'arrivent pas à tenir les soldes du logiciel identiques
aux soldes réels : elles font aussi Western Union, Ria ou MoneyGram, et cet
argent passe par leur caisse sans que le logiciel le connaisse. Le client de
ces opérations n'est pas un agent C2EGF mais une personne ordinaire : le
formulaire actuel, qui cherche un agent, ne lui correspond pas.

## Le Profil, dans le même chantier

- Retirer de la carte « Informations du compte » : **ID utilisateur** et
  **Statut du compte** (email vérifié).
- Retirer toute la carte **Activité** (et `useUserActivity` si plus rien ne
  le lit — vérifié selon la règle de suppression d'`AGENTS.md`).
- Ajouter une carte **Configuration** qui regroupe ce qui se règle :
  « Numéros de la boutique » (composant existant `NumerosBoutique`, déplacé
  dedans) et la nouvelle option. Visible du seul compte boutique
  (`AUTH_ROLES.STORE_ADMIN`), comme les numéros aujourd'hui.

---

## Objectifs

- Une option par boutique, cochée par la boutique elle-même dans
  Profil → Configuration : « Western Union, Ria, MoneyGram et autres ».
- Cochée : deux mini-onglets en haut de la fenêtre « Enregistrer une
  transaction » — « Agent » (le formulaire d'aujourd'hui, inchangé) et
  « Western Union · Ria · MoneyGram » (un formulaire propre).
- Les soldes stock et espèce suivent la caisse réelle à chaque geste.
- Les lignes arrivent dans les non terminées de la boutique, avec leur bouton :
  « Envoyer au siège » pour un transfert, « Encaisser » pour un retrait.
- Tout marche sans connexion, comme le reste de la caisse (sauf cocher ou
  décocher l'option, qui demande le réseau, comme les numéros).

## Non-objectifs

- **Un annuaire des clients ordinaires.** Pas de fiche, pas de recherche : on
  tape le nom à chaque opération.
- **Un compte ou un écran pour le siège**, ni un suivi de ce que le siège doit
  à la boutique au-delà des lignes en attente.
- **L'envoi ou l'encaissement groupé** (une tranche qui solde plusieurs lignes).
- **L'assistant** (`src/lib/ia`) ne crée pas ces opérations. Il peut les voir ;
  il ne doit pas les prendre pour des dépôts ou des retraits.
- **Une colonne transferts** sur les écrans du patron et du dealer.
- **Les frais et commissions du service.** Décision de l'utilisateur
  (2026-11-23) : pas de frais dans le logiciel. La caissière tape le montant
  transféré ou remis, rien d'autre ; les frais se gèrent hors du logiciel.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Un dépôt, un retrait ou un remboursement au siège qui se comporte autrement
  qu'aujourd'hui.
- Une boutique qui n'a pas coché l'option et voit quoi que ce soit changer.
- Une ligne de transfert comptée comme un dépôt ou un retrait d'agent : dans
  le chiffre d'affaires, l'historique d'un agent, « l'argent dehors », les
  totaux du jour, les métriques du dealer, ou chez Oxygen.
- Une commande générique (Modifier, Annuler, Encaisser d'un dépôt…) appliquée
  à une ligne de transfert, qui ne défait qu'une jambe ou aucune.

## Contraintes

- **Hors connexion d'abord** : chaque geste sur une opération passe par la
  file d'envoi, avec un `commandeId` reconnu par le serveur au second passage.
- **Quota gratuit Firebase** : aucune lecture ni écoute de plus. L'option vit
  sur `stores/{storeId}`, déjà lue à la connexion (`fetchStoreProfile`) et par
  le serveur à chaque commande (`readActor`). Les lignes vivent dans `drafts`
  et `history`, déjà écoutés.
- **Toutes les écritures passent par `storeTransactionCommand`** ; les règles
  Firestore n'ont rien à changer (`stores` refuse déjà toute mise à jour
  directe, `drafts` et `history` toute écriture directe).
- **Le profil est la seule source de variation produit** : un drapeau dans
  `_pilot.js` (éteint) et `c2egf-burkina.js` (allumé), recopié dans
  `functions/src/config/storeProfile.js` par `scripts/lib/generateStoreProfile.mjs`.
- **AGENTS.md** : tests de caractérisation avant de toucher une règle métier ;
  jamais refactorer et changer un comportement dans le même lot ; jamais
  déployer à l'initiative d'un agent.
- **Caissières** : messages courts, aucune attente du réseau.

---

## Approches

### Le formulaire (choisi par l'utilisateur)

**A. Une 4ᵉ nature dans le formulaire actuel.** On coche « Transfert
d'argent » en bas et le haut du formulaire se transforme (la recherche d'agent
disparaît). Aucun écran nouveau, mais la caissière commence par chercher un
agent et voit tout bouger quand elle coche la nature — le formulaire que
l'utilisateur trouvait inadapté.

**B. Deux mini-onglets en haut de la même fenêtre — retenue.** Le premier choix
se fait d'entrée ; chaque formulaire ne montre que ses champs. L'onglet
« Agent » reste celui d'aujourd'hui. Sans l'option, pas d'onglets du tout.

**C. Un bouton à part sur la page Transactions.** Séparation nette, mais un
bouton de plus dans la barre et la perte du réflexe « tout passe par
Enregistrer une transaction ».

B retenu par l'utilisateur (« oui vas y pour le B », 2026-11-23), avec
« Autres » ajouté aux services.

### Le serveur (mon choix)

**Une famille à part, sur le modèle du remboursement au siège.** Des actions
propres dans `storeTransactionCommand`, qui ne déplacent qu'une réserve à la
fois avec `applyReplenishmentImpact` / `applyReplenishmentReturnImpact`, déjà
éprouvées. Le moteur des dépôts et retraits ne bouge pas ; les commandes
génériques apprennent seulement à **refuser** une ligne de transfert.
L'autre voie — un type de plus dans le moteur des dépôts et retraits — a été
écartée pour la même raison qu'en novembre : une erreur de signe y toucherait
les gestes que les caissières font cent fois par jour.

---

## Ce que la caissière voit

### Profil → Configuration

```
Configuration
──────────────────────────────────────────────────────
Numéros de la boutique           (le bloc actuel, inchangé)
  Numéro flotte : [ ........ ]   Numéro dealer Orange : [ ........ ]
                                              [ Enregistrer ]

[x] Western Union, Ria, MoneyGram et autres
    Ajoute un onglet dans « Enregistrer une transaction ».
```

- La case enregistre au clic (pas de bouton) et dit « Enregistré. ». Sans
  réseau, elle reste dans son état d'avant et dit « Connexion nécessaire. ».
- Décocher avec des lignes encore en attente est permis : elles restent dans
  les non terminées avec leurs boutons, seul l'onglet de saisie disparaît.

### La fenêtre « Enregistrer une transaction »

```
[ Agent ]  [ Western Union · Ria · MoneyGram ]
──────────────────────────────────────────────
Service :   ( ) Western Union  ( ) Ria  ( ) MoneyGram  ( ) Autres
            Précisez (facultatif) : [ ........ ]      ← seulement avec Autres
Opération : ( ) Transfert   ( ) Retrait
Nom du client : [                    ]
Téléphone (facultatif) : [ ........ ]   Code (facultatif) : [ .......... ]
Montant (FCFA) : [          ]
Reçu en :   ( ) Stock   ( ) Espèce                   ← « Payé en » pour un retrait
                                   [ Non Terminées ]
```

- Les onglets n'existent que si le profil le permet **et** que la boutique a
  coché l'option. L'onglet ouvert par défaut est « Agent ». Après un
  enregistrement, la fenêtre reste ouverte (comme aujourd'hui) sur l'onglet
  utilisé, champs vidés.
- En modification d'une ligne, la fenêtre s'ouvre sur l'onglet de la ligne,
  et l'autre onglet est inactif (une ligne ne change pas de famille).
- Aucun choix coché par défaut (service, opération, réserve) : un défaut
  silencieux serait une erreur que personne ne verrait.
- **Pas de bouton « Valider »** (décision de l'utilisateur) : un seul bouton,
  « Non Terminées ».
- Un retrait payé en Stock (ou en Espèce) exige que la réserve contienne le
  montant ; sinon le bouton est grisé avec « Stock insuffisant. » (ou
  « Espèce insuffisante. »), et le serveur refuse de même.
- La fenêtre « Confirmer la transaction » existante sert aussi ici : Service,
  Opération, Client, Montant, Reçu en / Payé en.

### Les règles d'impact (décidées par l'utilisateur)

| Geste | Stock | Espèce |
|---|---|---|
| Transfert, reçu en Stock | + montant | |
| Transfert, reçu en Espèce | | + montant |
| « Envoyer au siège » (une tranche d'un transfert) | − tranche | |
| Retrait, payé en Stock | − montant | |
| Retrait, payé en Espèce | | − montant |
| « Encaisser » (une tranche d'un retrait, le siège rembourse) | + tranche | |

« Envoyer au siège » et « Encaisser » sont **toujours en stock** (décision de
l'utilisateur). Sur une boutique à un seul réseau, « Espèce » est la liquidité
de `STORE_NETWORKS[0]`, comme pour le remboursement au siège.

### La ligne en attente

```
DIALLO Awa  ·  Western Union · Transfert  ·  50 000  ·  reçu en Espèce
Envoyé : 20 000  ·  Reste : 30 000
                       [ Modifier ] [ Envoyer au siège ] [ Annuler ]

OUEDRAOGO Paul  ·  Ria · Retrait  ·  75 000  ·  payé en Stock
Encaissé : 0  ·  Reste : 75 000
                       [ Modifier ] [ Encaisser ] [ Annuler ]
```

- « Envoyer au siège » réutilise le menu du remboursement au siège
  (`EnvoiSiegeMenu`, ou une version généralisée) : un montant pré-rempli avec
  tout le reste si le stock le contient, sinon le stock disponible. Plafonds :
  le reste, et le stock.
- « Encaisser » : le même menu, pré-rempli avec tout le reste. Plafond : le
  reste (une entrée de stock n'a pas d'autre limite).
- Reste à zéro : la ligne quitte les non terminées et entre dans l'historique,
  validée, sous le même identifiant.
- Elle compte dans le badge des non terminées et passe par leur filtre de
  recherche (le nom du client et le code doivent y être cherchables).

---

## Le modèle de données

Une ligne de transfert, en attente (`clients/{storeId}/drafts/{id}`) ou
validée (`clients/{storeId}/history/{id}`) :

```js
{
  type: 'Transfert argent',          // une seule chaîne, constante partagée ; jamais affichée telle quelle
  service: 'Western Union' | 'Ria' | 'MoneyGram' | 'Autres',
  servicePrecise: '',                 // facultatif, ≤ 40 car., seulement avec « Autres »
  operation: 'transfert' | 'retrait',
  nomClient: 'DIALLO Awa',            // obligatoire, ≤ 60 car.
  telephone: '',                      // facultatif, chiffres seulement, ≤ 15
  codeTransfert: '',                  // facultatif, ≤ 30 car.
  balanceType: 'stock' | 'liquidite', // reçu en (transfert) / payé en (retrait)
  montant,
  montantTraite,                      // cumul des tranches envoyées ou encaissées
  resteATraiter,                      // montant − montantTraite
  tranches: [{ id, montant, at, by, byName }],  // bornées à 50, comme `envoisSiege`
  reseau,                             // STORE_NETWORKS[0], posé par le serveur
  statut: 'Non Terminées' | 'Validée' | 'Supprimée',
  // + storeId, storeName, operator*, date, createdAt, updatedAt, validatedAt,
  //   modifications (journal borné, comme les autres lignes)
}
```

**Ni `client`, ni `clientId`, ni `code`.** Ces trois champs désignent un agent :
`historiqueClient.js`, `pointEntreeOxygen.js` et les recherches d'agent les
lisent pour rattacher une ligne à une fiche. Un client ordinaire n'en a pas, et
une ligne sans eux n'entre dans aucun historique d'agent. Le code du transfert
s'appelle donc `codeTransfert`, jamais `code`.

**Pourquoi pas les noms du remboursement au siège** (`envoyeAuSiege`,
`resteAuSiege`) : un retrait ne « s'envoie » pas, il s'encaisse ; et
`caisse.js` lit déjà `resteAuSiege` pour le remboursement. Des noms neutres
évitent qu'un lecteur existant compte la ligne en silence.

**Pourquoi un type unique et non « Transfert » / « Retrait »** : `Retrait` est
déjà un type d'agent, et `normaliserLibelle` le reconnaîtrait partout. Le
libellé affiché se construit : `${service} · Transfert` ou `${service} · Retrait`
(avec `servicePrecise` à la place de « Autres » quand il est rempli).

`'Transfert argent'` **n'entre pas** dans `STORE_TRANSACTION_TYPES` ni dans
`transactions.types` du profil : `cleanTransaction` refuse donc qu'`add` crée
une telle ligne.

## L'option de la boutique

```js
// stores/{storeId}
transfertsArgent: true      // absent ou false = pas d'onglet
```

- **Écrite** par une action nouvelle `updateStoreSettings`
  `{ transfertsArgent: boolean }` : réservée à `store_admin`, refusée si le
  drapeau de profil est éteint, avant la lecture des soldes (comme
  `updateStoreNumbers`), journal `auditLogs` avec l'avant et l'après.
  **Jamais par la file d'envoi** (même raison que les numéros : un réglage mis
  en file et appliqué plus tard surprendrait).
- **Lue** par `fetchStoreProfile` (`AuthContext.jsx`), qui l'ajoute à
  `activeStore` ; après un enregistrement réussi, `AuthContext` met à jour
  `activeStore` sans relire la fiche.
- Le serveur la relit dans `readActor` (fiche déjà lue) : `addMoneyTransfer`
  est refusé si elle n'est pas à `true`. Les trois autres actions ne la
  demandent pas, pour qu'une boutique qui a décoché puisse fermer ses lignes.

## Le drapeau de profil

```js
// _pilot.js
moneyTransfer: Object.freeze({ enabled: false }),
// c2egf-burkina.js
moneyTransfer: Object.freeze({ enabled: true }),
// functions/src/config/storeProfile.js (généré)
export const MONEY_TRANSFER_ENABLED = true
```

Éteint : pas de case dans Configuration, pas d'onglet, et le serveur refuse
les cinq actions nouvelles (les quatre du transfert et `updateStoreSettings`).

## Les commandes du serveur (`storeTransactionCommand`)

Quatre actions, sur le modèle exact des actions du remboursement au siège.
Chacune : `commandeId` facultatif et vérifié **avant** tout impact, datation
par `instantDeLaCaisse`, une entrée `auditLogs` avec soldes avant/après. Les
jambes s'appliquent **le + d'abord** (voir l'en-tête de
`functions/src/storeTransactions/rembSiege.js`).

**`addMoneyTransfer`** `{ transaction: { service, servicePrecise, operation, nomClient, telephone, codeTransfert, montant, balanceType } }`
- Toujours `Non Terminées` → `drafts`. Transfert : `+montant` dans
  `balanceType`. Retrait : `−montant` de `balanceType` (refus avec le
  disponible si la réserve ne le contient pas). `montantTraite: 0`,
  `resteATraiter: montant`, `tranches: []`.

**`settleMoneyTransfer`** `{ draftId, amount }`
- `amount ≤ resteATraiter`. Transfert : `−amount` du stock (refus avec le
  disponible). Retrait : `+amount` au stock.
- Idempotence et passage à l'historique **à l'identique de `sendToSiege`** :
  tranche sous l'id `commandeId`, rejouée → réponse idempotente (dans le
  brouillon, ou dans l'historique si la ligne est partie) ; reste à zéro →
  `history/{draftId}`, `statut: 'Validée'`, refus `IDEMPOTENCY_CONFLICT` si cet
  id porte déjà une autre ligne.

**`updateMoneyTransfer`** `{ draftId, updates }`
- Champs modifiables : `service`, `servicePrecise`, `nomClient`, `telephone`,
  `codeTransfert`, `montant`, `balanceType`. Jamais `operation` (supprimer et
  ressaisir), ni le statut, ni le suivi des tranches.
- Refusé dès qu'une tranche est partie (`montantTraite > 0`). Défait l'ancien
  impact puis applique le nouveau, le + d'abord ; journal `modifications`.

**`trashMoneyTransfer`** `{ draftId }` ou `{ historyId }`
- « Cette opération n'a pas eu lieu » : défait **toutes** les jambes, à tout
  moment, le + d'abord.
  Transfert : `+montantTraite` au stock, puis `−montant` de `balanceType`.
  Retrait : `+montant` à `balanceType`, puis `−montantTraite` du stock.
  Refus avec le disponible si une réserve ne contient plus de quoi rendre.
- La ligne finit dans `history` avec `statut: 'Supprimée'`.

### Les gardes sur les commandes existantes

Partout où `refuserSiRembSiege` et `UNCANCELLABLE_TYPES` protègent déjà le
remboursement au siège, la ligne de transfert est refusée de même, avant tout
calcul : `updateDraft`, `deleteDraft`, `validateDraft`, `trashDraft`,
`cancelHistory`, `trashHistory`, `reopenHistory`, `correctHistory`
(`storeTransactionCommand.js`), `addTransactionPayment`, `addTransactionRefund`
(`settlements/`). Et inversement : `sendToSiege`, `updateSiegeRepayment`,
`trashSiegeRepayment` refusent une ligne de transfert (c'est déjà le cas par
`estRembSiege`, à verrouiller par un test). Message : « Une ligne de transfert
se traite par ses propres boutons. », code `STORE_TRANSACTION_INVALID`.

## Le hors connexion

Quatre opérations nouvelles dans la file (`fileEnvoi.js`), envoyées par
`services/envois.js` : saisie, tranche, modification, annulation. Chacune
projette son effet sur les soldes provisoires et sur les lignes affichées
avec les règles du tableau, comme les opérations du remboursement au siège
(`effetRembSiegeSurLesSoldes`). `EnvoisListe` et `envoisEnAttente.js` leur
donnent un libellé.

## Les lecteurs à adapter

**Règle pour le constructeur :** chaque fichier qui traite aujourd'hui
`estRembSiege` / `TYPE_REMB_SIEGE` / `'Remb. siège'` est un lecteur à
examiner (29 fichiers au 2026-11-23, liste par `grep`). Les principaux :

| Lecteur | Ce qu'il doit faire d'une ligne de transfert |
|---|---|
| `getAvailableActions` (`helpers.js`) | Modifier, Annuler, et Envoyer au siège (transfert) ou Encaisser (retrait, menu sans méthode) ; ni Payer par, ni Rembourser |
| `TransactionTable` | nom du client depuis `nomClient`, libellé `${service} · …`, « Reçu en / Payé en », « Envoyé / Encaissé », « Reste » ; recherche par nom et code |
| `HistoriqueTable`, styles de type | un libellé et une teinte (jeton de `DESIGN.md`, à créer) |
| `transactions.jsx` (boutons d'une ligne validée) | « Annuler » part vers `trashMoneyTransfer` ; pas de « Corriger » |
| `caisse.js` | ni dépôt ni retrait d'agent ; voir « Le total de la caisse » |
| `chiffreAffairesService.js` | **exclure** (`TYPES_HORS_CA`) |
| `reseauStats.js` | ni visite, ni volume d'agent |
| `argentDehors.js`, `listOutstandingDrafts.js` | ignorer, sans compter la ligne parmi les illisibles |
| `historiqueClient.js`, `LigneHistorique.jsx` | sans `clientId` la ligne n'y arrive pas ; à verrouiller par un test |
| `pointEntreeOxygen.js` | **exclure** |
| export remis au gérant (`helpers.js`) | garder la ligne, avec son libellé |
| `src/lib/ia` | ne pas la compter comme dépôt ou retrait |
| `aideFiches.js` | une fiche d'aide courte pour l'onglet |

### Le total de la caisse

`totalCaisse` doit rester vérifiable à la main. Une ligne de transfert en
attente se lit comme suit :

- **Transfert** : l'argent du client est entré dans une réserve mais part au
  siège → on **retranche** le reste à traiter (comme le remboursement au siège).
- **Retrait** : l'argent est sorti d'une réserve et le siège le rendra → on
  **ajoute** le reste à traiter (comme un dépôt non terminé).

Ainsi T ne bouge ni à la saisie, ni à chaque tranche. Le détail du total
montre ces deux restes sur le modèle de la ligne « siège » d'aujourd'hui.

---

## Les décisions prises par moi (à relire)

1. **Serveur en famille à part**, comme le remboursement au siège.
2. **Tranches** pour « Envoyer au siège » et « Encaisser », pré-remplies avec
   tout le reste.
3. **Option écrite par le serveur, jamais par la file**, visible du seul
   compte boutique ; la case enregistre au clic.
4. **Décocher est permis** avec des lignes en attente ; elles se ferment
   toujours.
5. **« Autres »** accompagné d'un champ « Précisez » facultatif.
6. **Pas de `client` / `clientId` / `code`** sur la ligne ; `codeTransfert` à la place.
7. **Retrait refusé si la réserve ne contient pas le montant.**
8. **Exclu du chiffre d'affaires, des statistiques d'agent et d'Oxygen.**
9. **Modifier, seulement avant la première tranche** ; l'opération (transfert
   ou retrait) ne se modifie pas.
10. **« Annuler » défait tout, à tout moment** ; c'est le seul chemin pour
    corriger une tranche mal tapée.
11. **Total caisse** : − reste des transferts, + reste des retraits.

## Laissé au constructeur

- Les noms exacts des opérations de file et des fonctions pures, sur le modèle
  de `src/utils/rembSiege.js` (évaluer, préparer, vérifier une tranche, effet
  sur les soldes) et de `functions/src/storeTransactions/rembSiege.js`.
- Généraliser `EnvoiSiegeMenu` ou en écrire un frère pour « Encaisser ».
- La teinte des lignes de transfert (jeton nouveau dans `index.css`, contraste
  vérifié comme les autres).
- Le découpage de `TransactionForm` : l'onglet transfert gagne à être son
  propre composant ; l'onglet « Agent » ne doit pas changer de comportement.
- Les numéros de TC.

---

## Découpage en lots

1. **Profil.** Retrait des trois blocs, carte Configuration avec les numéros.
   Front seul, sans dépendance : peut partir avant le reste.
2. **Caractérisation.** Figer ce que font aujourd'hui les commandes génériques
   et les callables de règlement sur un type inconnu, et ce que font
   `caisse.js`, le chiffre d'affaires, `reseauStats`, `argentDehors`,
   `listOutstandingDrafts`, `historiqueClient` et l'export. Aucun code de
   production.
3. **Serveur.** Drapeau de profil, `updateStoreSettings`, les quatre actions,
   les gardes. Tests sur l'émulateur avec au moins deux boutiques : chaque
   ligne du tableau d'impact, les refus, l'idempotence de chaque action,
   l'option décochée.
4. **Écran et file.** Case de Configuration, onglets, formulaire, ligne en
   attente, menus, historique, file d'envoi et soldes provisoires. Tests de
   composant et de la file ; capture de l'écran.
5. **Lecteurs.** Caisse, chiffre d'affaires, statistiques, dealer, historique
   client, Oxygen, assistant, export, aide.

**Ordre de déploiement : les functions avant le front** (lots 3 à 5). Un
serveur qui ne connaît pas `addMoneyTransfer` répond « Commande inconnue. »,
que la file prend pour un refus définitif. Le déploiement reste un geste
humain (`docs/deployer-les-functions.md`).

## Tests d'acceptation

Soldes stock / espèce avant et après, boutique à stock 300 000 et espèce
200 000 :

| Cas | Gestes | Stock | Espèce |
|---|---|---|---|
| T1 | Transfert WU 50 000 reçu en Espèce ; envoyer 50 000 | −50 000 à l'envoi | +50 000 à la saisie |
| T2 | Transfert Ria 50 000 reçu en Stock ; envoyer 20 000 puis 30 000 | +50 000, −20 000, −30 000 | inchangé |
| T3 | T1 avec stock 10 000 à l'envoi | envoi plafonné à 10 000 | — |
| R1 | Retrait MoneyGram 75 000 payé en Espèce ; encaisser 75 000 | +75 000 à l'encaissement | −75 000 à la saisie |
| R2 | Retrait « Autres » 75 000 payé en Stock ; encaisser 75 000 | −75 000 puis +75 000 | inchangé |
| R3 | Retrait 250 000 payé en Espèce (espèce 200 000) | refusé, bouton grisé | inchangé |
| A1 | T2 annulé après l'envoi de 20 000 | +20 000 puis −50 000 | inchangé |
| A2 | R1 annulé avant encaissement | inchangé | +75 000 |
| O1 | Option décochée, ligne T1 en attente | « Envoyer au siège » marche toujours | — |
| O2 | Boutique sans l'option, appel direct d'`addMoneyTransfer` | refusé | inchangé |
| H | T1 entièrement hors ligne, puis retour du réseau | mêmes soldes, une seule fois | même |
| C | T1 en attente puis R1 en attente | total caisse inchangé à chaque geste | — |
