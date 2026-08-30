 Cahier des charges — Collaborations inter‑boutiques, Dettes internes, Historique

**Destinataire : agent d'implémentation, sur un projet .**
**Objet : reproduire à l'identique la logique métier des trois onglets, sans en inventer.**

> Ce document décrit **la logique**, pas le design. Chaque règle est tracée vers le fichier
> qui la porte dans le projet de référence. Toute règle non écrite ici mais présente dans le
> code de référence doit être considérée comme une omission du document, pas comme une
> autorisation d'improviser : en cas de doute, relire le fichier cité.

---

## Sommaire

1. [Périmètre et principes non négociables](#1-périmètre-et-principes-non-négociables)
2. [Vocabulaire métier](#2-vocabulaire-métier)
3. [Architecture imposée](#3-architecture-imposée)
4. [Conditions d'activation (drapeau multi‑réseaux)](#4-conditions-dactivation-drapeau-multi-réseaux)
5. [Modèle de données complet](#5-modèle-de-données-complet)
6. [Règles métier serveur — Collaborations](#6-règles-métier-serveur--collaborations)
7. [Règles métier serveur — Dettes internes et règlements](#7-règles-métier-serveur--dettes-internes-et-règlements)
8. [Règles métier serveur — Compensation](#8-règles-métier-serveur--compensation)
9. [Onglet 1 — Collaborations](#9-onglet-1--collaborations)
10. [Onglet 2 — Dettes internes](#10-onglet-2--dettes-internes)
11. [Onglet 3 — Historique](#11-onglet-3--historique)
12. [Connexions entre les trois onglets (cycle de vie)](#12-connexions-entre-les-trois-onglets-cycle-de-vie)
13. [Règles Firestore à répliquer](#13-règles-firestore-à-répliquer)
14. [Index composites requis](#14-index-composites-requis)
15. [Abonnements temps réel : contrat technique](#15-abonnements-temps-réel--contrat-technique)
16. [Pièges connus — à ne pas réintroduire](#16-pièges-connus--à-ne-pas-réintroduire)
17. [Limites connues du comportement de référence](#17-limites-connues-du-comportement-de-référence)
18. [Plan d'implémentation par lots](#18-plan-dimplémentation-par-lots)
19. [Recette — scénarios d'acceptation](#19-recette--scénarios-dacceptation)
20. [Annexes : constantes, libellés, codes d'erreur](#20-annexes--constantes-libellés-codes-derreur)

---

## 1. Périmètre et principes non négociables

### 1.1 Ce qui est couvert

| Onglet | Emplacement | Rôle |
|---|---|---|
| **Collaborations** | sous‑onglet de `Transactions` (`/transactions?tab=collaborations`) | file **opérationnelle** : ce qu'il reste à faire |
| **Dettes internes** | page dédiée (`/store/debts`) | **en‑cours** financier entre boutiques |
| **Historique** | page dédiée (`/historique`), 4 sous‑onglets | **terminé uniquement**, en lecture seule |

### 1.2 Le principe structurant (à graver)

> **Une opération vit dans son onglet opérationnel tant qu'elle appelle une action.
> Dès qu'elle est terminée, elle quitte cet onglet et n'existe plus que dans l'Historique.
> On ne mélange JAMAIS l'en‑cours et le déjà géré dans un même tableau.**

Conséquences directes, toutes obligatoires :

- Collaborations (page opérationnelle) ne liste que `status == 'pending'`.
- Dettes internes ne liste que les dettes `status != 'settled'`.
- Historique ne liste que : collaborations `confirmed`/`rejected`, dettes `settled`,
  opérations dealer `confirmed`/`rejected`, transactions clients complétées.

### 1.3 Principes techniques non négociables

1. **Aucune écriture Firestore directe depuis le client** sur `storeCollaborations`,
   `internalDebts` et leurs sous‑collections. Toutes les écritures passent par des
   Cloud Functions `onCall`. Les règles Firestore doivent l'imposer (`allow write: if false`).
2. **Le serveur est autoritatif** : il relit le profil, la config réseau, les soldes et les
   montants dans la transaction. Aucune donnée envoyée par le client n'est acceptée telle
   quelle (payload en liste blanche stricte).
3. **Atomicité** : chaque commande financière tient dans **une seule** `runTransaction`
   (mouvement de solde + création/imputation de dette + mise à jour du document + audit).
4. **Piste d'audit obligatoire** : toute opération financière écrit au moins un document
   dans `clients/{storeId}/auditLogs` avec ancien et nouveau solde.
5. **Lectures avant écritures** dans toute `runTransaction` Firestore (contrainte du SDK Admin).
6. **Le client ne fait jamais autorité sur le solde** : les garde‑fous UI sont des miroirs de
   confort, le blocage réel est serveur.

### 1.4 Hors périmètre de ce document

Reçus/QR, application mobile agent, RH, NFC, transactions client classiques (moteur
`drafts`/`history`), ravitaillement dealer. Ces briques sont **déjà présentes** dans le projet
copie ; voir §18 Lot 0 pour l'inventaire à vérifier.

### 1.5 Contexte : greffe sur une application existante

**Le reste de l'application est déjà développé** (Tableau de bord, Clients, Transactions
client, Opération dealer, Formulaire, Demandes Dealer, Profil, cartes réseau, soldes, audit).
Il ne s'agit donc **pas** de construire une application, mais d'**ajouter trois surfaces** à un
produit qui tourne, sans en modifier le comportement existant.

**Règle d'or de ce chantier : non‑régression stricte.** Tout ce qui existe doit continuer à se
comporter exactement pareil. En particulier :

- l'onglet **Transactions client** et l'onglet **Opération dealer** ne changent pas d'une ligne ;
- le sous‑onglet **Historique ▸ Transactions clients** garde **son** filtrage historique, son
  moteur, sa pagination journalière et son « Voir plus » — on ne le réécrit pas, on l'entoure ;
- les soldes, la caisse de liquidité et le moteur de transactions client ne sont **jamais**
  touchés par ce module (seul le `stock` d'un réseau bouge, cf. §6.2.1 et §7.2).

#### Points de greffe — la liste exhaustive des fichiers existants à modifier

| Fichier existant | Modification | Nature |
|---|---|---|
| Constantes de navigation | ajouter `IS_MULTI_NETWORK` + l'entrée de menu « Dettes internes » **conditionnelle** | ajout |
| Barre de navigation | 2 compteurs supplémentaires (collaborations reçues, règlements à confirmer) + leurs badges | ajout |
| Routeur | route `/store/debts` + 2 redirections de compatibilité | ajout |
| Page **Transactions** | 3ᵉ mode « Collaborations » (conditionnel), pilotage par `?tab=` et `?sub=`, badge de l'onglet | ajout — **les deux modes existants restent intacts** |
| Page **Historique** | passage à 4 sous‑onglets, filtres remontés au niveau de la page | **transformation de structure** — le contenu du sous‑onglet clients est déplacé tel quel, pas réécrit |
| `firestore.rules` | 3 blocs `match` + 1 fonction d'aide + 1 bloc joker | ajout |
| `firestore.indexes.json` | 7 index | ajout |
| Entrée des Cloud Functions | 10 exports `onCall` | ajout |
| Constantes métier | libellés et tailles de fenêtre du module | ajout |

Fichiers **entièrement nouveaux** : service front des collaborations, page Collaborations,
modale de création, page Dettes internes, filtre générique d'historique, utilitaire de sens
entrée/sortie, les 10 handlers serveur et leurs 2 modules de helpers purs.

> **Le seul fichier existant réellement transformé est la page Historique.** C'est donc le seul
> endroit qui exige un **test de caractérisation écrit AVANT** la modification : capturer le
> comportement actuel de l'onglet clients (filtres, pagination journalière, « Voir plus »,
> export), puis vérifier qu'il est identique après la mise en onglets.

---

## 2. Vocabulaire métier

| Terme | Définition exacte |
|---|---|
| **Boutique demandeuse** (`requestingStore`) | Celle qui a le client en face d'elle mais **pas de SIM/compte** sur le réseau demandé. Elle crée la collaboration. |
| **Boutique fournisseuse** (`supplierStore`) | Celle qui **possède le float** sur ce réseau et exécute réellement l'opération Mobile Money. Elle confirme ou rejette. |
| **Fournisseur éligible** | Boutique dont `storeNetworkConfig/{storeId}.networks[réseau].isProvider === true`. |
| **Dépôt** (`deposit`) | Le client **dépose du cash** en boutique et reçoit du float sur son compte. |
| **Retrait** (`withdrawal`) | Le client **envoie du float** et reçoit du cash en boutique. |
| **Stock** | Float électronique d'un réseau détenu par une boutique (`balances[réseau].stock`). |
| **Liquidité** | Cash en caisse, commun à tous les réseaux. **Jamais déplacé** par les collaborations. |
| **Dette interne** | Créance née d'une collaboration confirmée, entre deux boutiques. |
| **Boutique débitrice** (`debtorStore`) | Celle qui doit. Elle **déclare** les remboursements. |
| **Boutique créancière** (`creditorStore`) | Celle à qui l'on doit. Elle **confirme ou rejette** les remboursements. |
| **Tranche / règlement** (`settlement`) | Remboursement partiel déclaré puis confirmé. Une dette se solde en N tranches. |
| **Compensation** | Solde une dette D1 (A→B) contre la dette opposée D2 (B→A), tous réseaux confondus. |
| **Reste dû** (`remainingAmount`) | Ce qui reste à régler. Le montant affiché en premier partout. |

---

## 3. Architecture imposée

```
┌──────────────────── FRONT (React) ────────────────────┐
│  Pages/composants  →  services  →  httpsCallable      │  ÉCRITURE
│                    →  onSnapshot (lecture temps réel) │  LECTURE
└───────────────────────────────────────────────────────┘
                 │ écriture                 │ lecture
                 ▼                          ▼
┌──── Cloud Functions onCall (europe-west1) ────┐   ┌──── Firestore ────┐
│  validation → runTransaction → audit          │──▶│  règles = cloison │
└───────────────────────────────────────────────┘   └───────────────────┘
```

- **Région Functions : `europe-west1`** (proximité Afrique de l'Ouest). Le front doit
  initialiser `getFunctions(app, 'europe-west1')`.
- **Une seule couche service front** centralise : appel des callables, mapping des erreurs
  serveur en messages français, et les abonnements temps réel.
  Référence : [collaborationService.js](../src/services/collaborationService.js).
- **Les handlers serveur reçoivent `{ db, FieldValue }` par injection** (testabilité
  émulateur). Référence : [functions/src/index.js](../functions/src/index.js).
- **Les erreurs métier serveur** sont des `DealerRequestError(code, message)`, converties en
  `HttpsError` par un wrapper unique (`wrapCallable`). Le front lit `err.details.code` et le
  traduit via un dictionnaire — **jamais** le message brut du serveur.

### 3.1 Liste exhaustive des callables à implémenter

| Callable | Acteur autorisé | Effet |
|---|---|---|
| `createStoreCollaboration` | store_admin actif, boutique demandeuse | crée une collaboration `pending`. **Aucun mouvement.** |
| `confirmStoreCollaboration` | store_admin de la fournisseuse | bouge le stock fournisseur + crée la dette + passe `confirmed`. |
| `rejectStoreCollaboration` | store_admin de la fournisseuse | passe `rejected` + motif. **Aucun mouvement.** |
| `listStoreCollaborationProviders` | store_admin actif | annuaire `{storeId, storeName}` des fournisseurs d'un réseau. Lecture seule. |
| `declareInternalDebtSettlement` | store_admin de la **débitrice** | crée une tranche `declared`. **N'impute pas.** |
| `confirmInternalDebtSettlement` | store_admin de la **créancière** | impute la tranche + éventuel mouvement de stock. |
| `rejectInternalDebtSettlement` | store_admin de la **créancière** | passe la tranche `rejected` + motif. Dette intacte. |
| `declareInternalDebtCompensation` | store_admin de la **débitrice de D1** | crée une tranche `declared` `method:'compensation'`. |
| `confirmInternalDebtCompensation` | store_admin de la **créancière de D1** | impute sur **D1 et D2** + tranche miroir. |
| `rejectInternalDebtCompensation` | store_admin de la **créancière de D1** | passe `rejected`. Les deux dettes intactes. |

---

## 4. Conditions d'activation (drapeau multi‑réseaux)

Les trois fonctionnalités sont **opt‑in par profil client**. Un client mono‑réseau ne doit
voir **aucune** trace de collaborations/dettes (non‑régression stricte).

```js
// src/constants/navigation.js
export const IS_MULTI_NETWORK = (activeProfile?.networks?.enabled?.length ?? 0) > 1
```

Points de garde à reproduire **tous** :

| Emplacement | Comportement si `IS_MULTI_NETWORK === false` |
|---|---|
| Entrée de menu « Dettes internes » | absente de `NAV_ITEMS` |
| Sous‑onglet « Collaborations » de Transactions | bouton non rendu **et** `?tab=collaborations` retombe sur `client` |
| Badge du sous‑onglet Collaborations | abonnement non ouvert (compteur reste 0) |
| Sous‑onglets « Collaborations » / « Dettes internes » de l'Historique | boutons non rendus, abonnements non ouverts, états vidés |
| Badges de la barre de navigation | non alimentés |

> **Note d'architecture** : les collaborations n'ont **pas** d'entrée de premier niveau —
> « une collaboration EST une transaction », donc sous‑onglet de Transactions. Les dettes
> internes gardent leur entrée — « une dette n'est pas une transaction ».

---

## 5. Modèle de données complet

### 5.1 `storeCollaborations/{collabId}` — collection racine

Créé par `createStoreCollaboration`. **Un seul document** par collaboration : il porte à la
fois la transaction de la demandeuse et la demande faite à la fournisseuse (anti‑duplication —
la fournisseuse ne crée jamais de transaction de son côté, elle confirme).

| Champ | Type | À la création | Après confirmation | Après rejet |
|---|---|---|---|---|
| `requestingStoreId` | string | storeId de l'acteur (relu serveur) | inchangé | inchangé |
| `requestingStoreName` | string\|null | dénormalisé depuis `stores/{id}.name` | — | — |
| `requestingStoreAdminUid` | string | uid de l'acteur | — | — |
| `supplierStoreId` | string | fourni, validé | — | — |
| `supplierStoreName` | string\|null | dénormalisé | — | — |
| `clientId` | string | fourni, doit exister dans `globalClients` | — | — |
| `clientNom` / `clientPrenom` | string\|null | **dénormalisés par lecture serveur** | — | — |
| `network` | string | dans les 6 réseaux supportés | — | — |
| `operationType` | `'deposit'\|'withdrawal'` | validé | — | — |
| `amount` | number | entier strictement positif | — | — |
| `status` | string | `'pending'` | `'confirmed'` | `'rejected'` |
| `previousSupplierBalance` | number\|null | `null` | solde stock avant | reste `null` |
| `newSupplierBalance` | number\|null | `null` | solde stock après | reste `null` |
| `debtId` | string\|null | `null` | id de la dette créée | reste `null` |
| `createdAt` / `updatedAt` | Timestamp | `serverTimestamp()` | `updatedAt` rafraîchi | idem |
| `confirmedBy` / `confirmedAt` | string\|null / Ts\|null | `null` | uid / now | reste `null` |
| `rejectedBy` / `rejectedAt` | string\|null / Ts\|null | `null` | reste `null` | uid / now |
| `rejectionReason` | string\|null | `null` | reste `null` | motif 3–500 car. |

**Transitions autorisées** : `pending → confirmed` ou `pending → rejected`. **Aucune autre.**
Un document déjà `confirmed`/`rejected` est terminal — toute nouvelle commande renvoie
`COLLABORATION_NOT_PENDING`.

### 5.2 `internalDebts/{debtId}` — collection racine

Créé **uniquement** par `confirmStoreCollaboration`, jamais autrement.

| Champ | Type | Valeur initiale |
|---|---|---|
| `collaborationId` | string | id de la collaboration d'origine |
| `debtorStoreId` / `debtorStoreName` | string / string\|null | selon la règle de direction (§6.2) |
| `creditorStoreId` / `creditorStoreName` | string / string\|null | idem |
| `network` | string | réseau de la collaboration |
| `operationType` | string | type de la collaboration |
| `originalAmount` | number | montant de la collaboration — **jamais modifié** |
| `settledAmount` | number | `0`, croît à chaque tranche confirmée |
| `remainingAmount` | number | `= originalAmount`, décroît |
| `status` | `'open'\|'partially_settled'\|'settled'` | `'open'` |
| `createdAt` / `updatedAt` | Timestamp | `serverTimestamp()` |

**Invariant permanent** : `settledAmount + remainingAmount === originalAmount`, et
`remainingAmount >= 0`.
**Recalcul du statut** à chaque imputation : `remainingAmount === 0 ? 'settled' : 'partially_settled'`.

### 5.3 `internalDebts/{debtId}/settlements/{settlementId}` — tranches

Trois formes de documents dans cette sous‑collection, **distinguées par le préfixe d'id** —
préfixes obligatoires, ils garantissent l'absence de collision :

| Forme | Id déterministe | Créé par |
|---|---|---|
| Règlement | `dst_{debtId}_{actorUid}_{idempotencyKey}` | `declareInternalDebtSettlement` |
| Compensation | `dcp_{debtId}_{actorUid}_{idempotencyKey}` | `declareInternalDebtCompensation` |
| Miroir de compensation | `comp_{debtId}_{settlementId}` sous **D2** | `confirmInternalDebtCompensation` |

Champs :

| Champ | Type | Note |
|---|---|---|
| `debtId` | string | dette parente |
| `oppositeDebtId` | string | **compensation uniquement** |
| `debtorStoreId` / `creditorStoreId` | string | **dénormalisés** — indispensables au compteur collection‑group |
| `amount` | number | entier > 0 |
| `method` | string | méthode de règlement, ou `'compensation'` |
| `settlementStatus` | `'declared'\|'confirmed'\|'rejected'` | |
| `idempotencyKey` | string | 1–100 caractères |
| `previousRemaining` | number | reste dû au moment de la déclaration |
| `newRemaining` | number\|null | `null` tant que non confirmé |
| `declaredBy` / `declaredAt` | string / Timestamp | |
| `confirmedBy` / `confirmedAt` | string\|null / Ts\|null | |
| `rejectedBy` / `rejectedAt` / `rejectionReason` | string\|null | |
| `mirrorOf` | string | **miroir uniquement** : id de la tranche source |

**Transitions** : `declared → confirmed` ou `declared → rejected`. Le miroir naît directement
`confirmed`. Une tranche `rejected` **ne rouvre rien** et n'est jamais réactivable.

### 5.4 `storeNetworkConfig/{storeId}` — prérequis

```
{ storeName: string|null,
  networks: { [réseau]: { operates: bool, supplyMode: 'dealer'|'external_partner',
                          isSupplied: bool, isProvider: bool } } }
```

Écrit **exclusivement** par un callable réservé au `system_manager`
(`adminSetStoreNetworkConfig`). **`isProvider` est la seule clé qui compte** pour les
collaborations : elle décide qui apparaît dans l'annuaire des fournisseurs et conditionne la
confirmation (défense en profondeur).

### 5.5 `clients/{storeId}/networkBalances/current` — soldes

```
{ balances: { [réseau]: { stock: number, liquidite: number } }, updatedAt: Timestamp }
```

Lecture serveur tolérante : document absent, réseau absent ou champ absent ⇒ **0**. Une valeur
présente mais non entière, non finie ou négative ⇒ erreur `INVALID_BALANCE_DATA` (on ne
« répare » jamais silencieusement un solde corrompu).
Écriture **toujours** en `set(..., { merge: true })` sur `balances.{réseau}.stock` seul, pour
ne jamais écraser les autres réseaux ni la liquidité.

### 5.6 `clients/{storeId}/auditLogs/{id}` — piste d'audit

Actions à écrire, toutes avec `actorUid`, `actorEmail`, `actorName`, `actorRole`,
`actorStoreId`, `createdAt` :

| Action | Écrite par | Champs spécifiques |
|---|---|---|
| `STORE_COLLABORATION_CREATED` | demandeuse | `collaborationId`, `supplierStoreId`, `clientId`, `network`, `operationType`, `amount` |
| `STORE_COLLABORATION_CONFIRMED` | fournisseuse | + `debtId`, `requestingStoreId`, `previousBalance`, `newBalance` |
| `STORE_COLLABORATION_REJECTED` | fournisseuse | + `rejectionReason` |
| `INTERNAL_DEBT_SETTLEMENT_DECLARED` | débitrice | `debtId`, `settlementId`, `amount`, `method` |
| `INTERNAL_DEBT_SETTLEMENT_CONFIRMED` | créancière | + `previousRemaining`, `newRemaining`, `debtStatus` |
| `INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED` | **les deux boutiques** | `storeId`, `direction: 'DEBITED'\|'CREDITED'`, `network`, `previousBalance`, `newBalance` |
| `INTERNAL_DEBT_SETTLEMENT_REJECTED` | créancière | + `rejectionReason` |
| `INTERNAL_DEBT_COMPENSATION_DECLARED` | débitrice de D1 | + `oppositeDebtId` |
| `INTERNAL_DEBT_COMPENSATION_CONFIRMED` | **les deux boutiques** | + `debtStatus`, `oppositeDebtStatus` |
| `INTERNAL_DEBT_COMPENSATION_REJECTED` | créancière de D1 | + `rejectionReason` |

---

## 6. Règles métier serveur — Collaborations

### 6.1 `createStoreCollaboration` — ordre exact des contrôles

Payload autorisé, **liste blanche stricte** : `clientId`, `network`, `operationType`,
`amount`, `supplierStoreId`. Toute clé supplémentaire ⇒ rejet immédiat.

1. `request.auth.uid` non vide et non espacé ⇒ sinon `UNAUTHENTICATED`.
2. Payload : objet simple (prototype `Object.prototype`), pas de tableau, pas de `null`, clés
   toutes des chaînes appartenant à la liste blanche.
3. `clientId` non vide ; `operationType ∈ {deposit, withdrawal}` ; `amount` **`Number.isSafeInteger` et `> 0`** ;
   `supplierStoreId` chaîne non vide et sans espaces de bord ; `network` dans les 6 supportés.
4. Pré‑lecture `users/{uid}` : existe, `active === true`, `role === 'store_admin'`, `storeId` non vide.
5. **Dans la transaction** (relecture autoritative) :
   a. relire `users/{uid}` → `requestingStoreId` ;
   b. `requestingStoreId !== supplierStoreId` ⇒ sinon `SAME_STORE_COLLABORATION` ;
   c. lire `stores/{requestingStoreId}` → nom (absent toléré → `null`) ;
   d. lire `stores/{supplierStoreId}` : doit exister ⇒ sinon `SUPPLIER_STORE_NOT_FOUND` ;
   e. lire `storeNetworkConfig/{supplierStoreId}.networks[network].isProvider === true`
      ⇒ sinon `SUPPLIER_NOT_PROVIDER` ;
   f. lire `globalClients/{clientId}` : doit exister ⇒ sinon `CLIENT_NOT_FOUND` ; dénormaliser
      `nom`/`prenom` **depuis la lecture serveur**, jamais depuis le client ;
   g. écrire le document `pending` + l'audit `STORE_COLLABORATION_CREATED`.
6. **Aucun mouvement de solde, aucune dette.** Retour `{ success: true, collaborationId }`.

### 6.2 `confirmStoreCollaboration` — le cœur financier

**Toute la mécanique financière est ici, rien à la création.** Payload : `collaborationId` seul.

1. Auth + profil `store_admin` actif (idem §6.1 étapes 1‑4).
2. Dans la transaction :
   a. relire le profil → `actorStoreId` ;
   b. lire `storeCollaborations/{id}` ⇒ sinon `COLLABORATION_NOT_FOUND` ;
   c. **`collab.supplierStoreId === actorStoreId`** ⇒ sinon `COLLABORATION_STORE_MISMATCH`
      (seule la fournisseuse confirme — la demandeuse ne peut jamais s'auto‑servir) ;
   d. `collab.status === 'pending'` ⇒ sinon `COLLABORATION_NOT_PENDING` ;
   e. revalider `operationType` et `amount` **lus dans le document** ;
   f. **défense en profondeur** : `storeNetworkConfig/{actorStoreId}.networks[network].isProvider === true`
      ⇒ sinon `SUPPLIER_NOT_PROVIDER` (la config a pu changer depuis la création) ;
   g. lire le stock fournisseur `clients/{actorStoreId}/networkBalances/current` → `previousSupplierBalance` ;
   h. appliquer la **règle de delta** (§6.2.1) et la **règle de contrôle** ;
   i. écrire : solde (merge), dette, mise à jour de la collaboration, audit — **dans cet ordre logique, une seule transaction**.

#### 6.2.1 Les deux règles à ne jamais confondre

| `operationType` | Delta du **stock fournisseur** | Contrôle de suffisance | Direction de la dette |
|---|---|---|---|
| `deposit` | **`−amount`** (elle a envoyé le float au client) | `previousSupplierBalance >= amount` ⇒ sinon `INSUFFICIENT_SUPPLIER_BALANCE` | **demandeuse → fournisseuse** (la demandeuse a encaissé le cash) |
| `withdrawal` | **`+amount`** (sa SIM a reçu le float du client) | *aucun* | **fournisseuse → demandeuse** (la demandeuse a remis le cash au client) |

Contrôle final commun : `newSupplierBalance` doit être un `Number.isSafeInteger` **≥ 0**,
sinon `BALANCE_OVERFLOW`.

> **Le stock de la boutique demandeuse ne bouge JAMAIS. La liquidité ne bouge JAMAIS.**
> Seul le stock du fournisseur se déplace, et la contrepartie est portée par la dette.

Fonctions pures à extraire (testables sans Firestore) :

```js
supplierStockDelta(operationType, amount) // 'deposit' ? -amount : +amount
debtDirection(operationType, { requestingStoreId, supplierStoreId })
// 'deposit'    → { debtorStoreId: requesting, creditorStoreId: supplier }
// 'withdrawal' → { debtorStoreId: supplier,  creditorStoreId: requesting }
```

### 6.3 `rejectStoreCollaboration`

Payload : `collaborationId`, `rejectionReason`. Mêmes contrôles d'acteur et de statut que la
confirmation. Motif **obligatoire, 3 à 500 caractères après `trim()`** ⇒ sinon
`INVALID_REJECTION_REASON`. `pending → rejected`. **Aucun mouvement, aucune dette.**

### 6.4 `listStoreCollaborationProviders`

Nécessaire parce que les règles Firestore **interdisent** à une boutique de lire la
`storeNetworkConfig` d'une autre. Ce callable est le seul chemin.

- Payload : `network` (dans les 6 supportés).
- Acteur : `store_admin` actif.
- Parcourt `storeNetworkConfig`, **exclut le document de l'acteur lui‑même**, et retourne
  `{ storeId, storeName }` pour chaque doc où `networks[network].isProvider === true`.
- Lecture seule, hors transaction. Retour `{ success: true, providers: [...] }`.

---

## 7. Règles métier serveur — Dettes internes et règlements

### 7.1 `declareInternalDebtSettlement` (boutique **débitrice**)

Payload : `debtId`, `amount`, `method`, `idempotencyKey`.

1. Validations : `amount` entier > 0 ; `method` dans l'ensemble autorisé (§20.3) ;
   `idempotencyKey` chaîne de 1 à 100 caractères après `trim()`.
2. `settlementId = dst_{debtId}_{actorUid}_{idempotencyKey}` — **déterministe**.
3. Dans la transaction, **dans cet ordre impératif** :
   a. relire le profil → `actorStoreId` ;
   b. lire la dette ⇒ sinon `DEBT_NOT_FOUND` ;
   c. **`debt.debtorStoreId === actorStoreId`** ⇒ sinon `DEBT_STORE_MISMATCH` ;
   d. **⚠️ IDEMPOTENCE D'ABORD** : lire `settlements/{settlementId}`.
      - existe **et** (`amount` identique **et** `method` identique) ⇒ retour no‑op
        `{ settlementId, idempotent: true }` ;
      - existe avec un payload différent ⇒ `IDEMPOTENCY_CONFLICT` ;
      - n'existe pas ⇒ on continue.
      *Ce court‑circuit doit précéder le calcul du reste dû, sinon la tranche déjà écrite se
      compterait elle‑même et un simple retour arrière du navigateur ferait échouer un retry légitime.*
   e. `debt.status !== 'settled'` **et** `remainingAmount > 0` ⇒ sinon `DEBT_ALREADY_SETTLED` ;
   f. **réservation** : lire toutes les tranches `settlementStatus == 'declared'` de la dette,
      sommer leurs `amount` → `pending`. Exiger `amount <= remainingAmount − pending`
      ⇒ sinon `SETTLEMENT_EXCEEDS_REMAINING` ;
   g. écrire la tranche `declared` + l'audit.
4. **La dette n'est PAS modifiée** : `remainingAmount` inchangé. **Aucun mouvement de solde.**

### 7.2 `confirmInternalDebtSettlement` (boutique **créancière**)

Payload : `debtId`, `settlementId`.

1. Dans la transaction :
   a. lire la dette ⇒ `DEBT_NOT_FOUND` ; **`debt.creditorStoreId === actorStoreId`**
      ⇒ sinon `DEBT_STORE_MISMATCH` ;
   b. lire la tranche ⇒ `SETTLEMENT_NOT_FOUND` ; `settlementStatus === 'declared'`
      ⇒ sinon `SETTLEMENT_NOT_DECLARED` ;
   c. `amount` de la tranche revalidé (entier > 0) ;
   d. `newRemaining = remainingAmount − amount` ; si `< 0` ⇒ `SETTLEMENT_EXCEEDS_REMAINING` ;
   e. `newSettled = settledAmount + amount` ;
      `status = newRemaining === 0 ? 'settled' : 'partially_settled'`.
2. **Mouvement de stock conditionnel** — la règle la plus subtile du module :

   ```
   net = mapPaymentMethodToNetwork(settlement.method)
   movesStock = net ∈ { Orange, Moov, Telecel, Coris, Sank, Wave }
   ```

   | Méthode | Réseau mappé | Mouvement de stock |
   |---|---|---|
   | `Orange Money`, `Moov Money`, `Telecel Money`, `Coris Money`, `Sank Money`, `Wave` | réseau correspondant | **OUI** |
   | `Cash` | `Liquidite` | **NON** |
   | `Banque` | `Banque` | **NON** |
   | `compensation` | — | **NON** (voir §8) |

   Si `movesStock` :
   - lire **les deux** soldes (débitrice = payeuse, créancière = receveuse) **avant tout write** ;
   - `payerPrev >= amount` ⇒ sinon `SETTLEMENT_INSUFFICIENT_BALANCE` ;
   - `payerNext = payerPrev − amount`, `receiverNext = receiverPrev + amount` ;
   - contrôle `Number.isSafeInteger(receiverNext)` et les deux ≥ 0 ⇒ sinon `BALANCE_OVERFLOW` ;
   - écrire les deux soldes en `merge` **et** deux audits `..._BALANCE_MOVED`
     (`DEBITED` chez la débitrice, `CREDITED` chez la créancière).

   > **Le remboursement par Mobile Money déplace réellement du float** : la dette n'est pas
   > qu'une écriture comptable, elle se solde par un vrai transfert de stock. Le remboursement
   > en cash ou par banque, lui, ne bouge aucun solde de l'application (l'argent circule hors
   > système) — la dette est quand même imputée.

3. Écritures : dette (settled/remaining/status/updatedAt), tranche (`confirmed`, `confirmedBy`,
   `confirmedAt`, `previousRemaining`, `newRemaining`), audit `..._CONFIRMED`.
4. **La méthode n'est PAS revalidée à la confirmation** — c'est délibéré : les tranches
   historiques portant d'anciens codes (`especes`, `transfert`…) doivent rester confirmables.

### 7.3 `rejectInternalDebtSettlement` (boutique **créancière**)

Payload : `debtId`, `settlementId`, `rejectionReason` (3–500). Contrôles identiques.
`declared → rejected`. **La dette n'est pas modifiée, aucun mouvement de solde.**
Effet de bord attendu : le montant réservé par cette tranche redevient disponible pour une
nouvelle déclaration (puisque `pending` ne compte que les `declared`).

---

## 8. Règles métier serveur — Compensation

**Définition** : compenser la dette D1 (A→B) contre la dette opposée D2 (B→A). Même paire de
boutiques, sens inverse, **tous réseaux confondus** — on compense la position nette entre A et
B, pas réseau par réseau. **Aucun float ne bouge**, seuls les restes dus des deux dettes.

### 8.1 `declareInternalDebtCompensation` (débitrice de D1)

Payload : `debtId`, `oppositeDebtId`, `amount`, `idempotencyKey`.

1. `oppositeDebtId !== debtId` ⇒ sinon `INVALID_OPPOSITE_DEBT`.
2. `settlementId = dcp_{debtId}_{actorUid}_{idempotencyKey}`.
3. Dans la transaction :
   a. lire D1 et D2 ⇒ `DEBT_NOT_FOUND` si l'une manque ;
   b. `D1.debtorStoreId === actorStoreId` ⇒ sinon `DEBT_STORE_MISMATCH` ;
   c. **paire opposée** : `D2.debtorStoreId === D1.creditorStoreId` **et**
      `D2.creditorStoreId === D1.debtorStoreId` ⇒ sinon `NOT_OPPOSITE_PAIR` ;
   d. **idempotence d'abord** (même logique qu'en §7.1d, comparaison sur
      `method === 'compensation'`, `amount` et `oppositeDebtId`) ;
   e. aucune des deux dettes `settled`, aucun `remainingAmount <= 0` ⇒ sinon `DEBT_ALREADY_SETTLED` ;
   f. **plafond** — lire les tranches `declared` de **chacune** des deux dettes :
      ```
      capacity = min( D1.remaining − pendingD1 , D2.remaining − pendingD2 )
      amount > capacity ⇒ COMPENSATION_EXCEEDS_REMAINING
      ```
   g. écrire la tranche `declared` sous **D1** avec `method: 'compensation'` et
      `oppositeDebtId` + audit `..._COMPENSATION_DECLARED`.
4. **Aucune dette n'est modifiée.**

### 8.2 `confirmInternalDebtCompensation` (créancière de D1)

1. Contrôles : `D1.creditorStoreId === actorStoreId` ; tranche existante, `method === 'compensation'`
   (sinon `SETTLEMENT_NOT_FOUND`), `settlementStatus === 'declared'`.
2. Relire D2 depuis `settlement.oppositeDebtId` ; **re‑valider la paire opposée** et
   **re‑valider le plafond au moment présent** : `amount <= min(D1.remaining, D2.remaining)`
   ⇒ sinon `COMPENSATION_EXCEEDS_REMAINING` (garde‑fou anti‑dérive : les dettes ont pu bouger
   entre la déclaration et la confirmation).
3. Imputer **atomiquement sur les deux dettes** : `remaining −= amount`, `settled += amount`,
   recalcul du statut de chacune indépendamment.
4. Passer la tranche de D1 en `confirmed` (avec `previousRemaining`/`newRemaining` de **D1**).
5. **Écrire la tranche miroir** sous `internalDebts/{D2}/settlements/comp_{D1}_{settlementId}` :
   `settlementStatus: 'confirmed'`, `mirrorOf: settlementId`, `previousRemaining`/`newRemaining`
   de **D2**, `declaredBy`/`declaredAt` **recopiés de la tranche source** (la déclaration reste
   attribuée à son auteur réel), `confirmedBy`/`confirmedAt` = l'acteur.
6. **Audit sur les DEUX boutiques** (`debt.creditorStoreId` et `debt.debtorStoreId`) — chacune
   doit voir la compensation dans son propre journal.
7. **Aucun mouvement de solde.**

### 8.3 `rejectInternalDebtCompensation`

`declared → rejected` + motif. **Les deux dettes restent intactes**, pas de miroir.

---

## 9. Onglet 1 — Collaborations

**Fichiers de référence** : [StoreCollaborations.jsx](../src/pages/store/StoreCollaborations.jsx),
[CollaborationFormModal.jsx](../src/components/store/CollaborationFormModal.jsx),
[Transactions.jsx](../src/pages/Transactions.jsx).

### 9.1 Emplacement et navigation

- Rendu comme **3ᵉ mode** de la page Transactions : `Transaction client` | `Opération dealer` | `Collaborations`.
- **L'onglet vit dans l'URL** : `?tab=collaborations` (partageable, compatible bouton Retour).
  `?tab=client` est représenté par l'absence de paramètre. Navigation en `replace: true`.
- Un `tab` inconnu, ou `collaborations` en mono‑réseau, retombe sur `client`.
- **Redirections des anciennes routes** (obligatoires si le projet copie les a eues) :
  `/store/collaborations` et `/store/collaborations/new` → `/transactions?tab=collaborations`.
- Le composant est monté avec `embedded` : pas de `PageHeader` (le `<h1>Transactions</h1>` fait
  titre), le bouton d'action passe au‑dessus de la liste.

### 9.2 Badge de l'onglet parent — règle de pilotage

- Compteur alimenté par un abonnement **indépendant du montage du composant** : il doit rester
  vivant onglet fermé. Requête : `storeCollaborations where supplierStoreId == moi and status == 'pending'`,
  on ne lit que `snap.size`.
- **Pastille masquée à zéro** : un onglet fermé ne doit alerter que s'il y a du travail.
- **Le clic sur l'onglet pointe sur la tâche** : si le compteur > 0, il ouvre
  `?tab=collaborations&sub=incoming` ; sinon `?tab=collaborations` (→ « Mes demandes »).
- Le paramètre `?sub=` est propagé par le parent en `initialTab` ; le composant **se
  resynchronise** quand `initialTab` change (`useEffect(() => setTab(initialTab), [initialTab])`)
  car il peut être déjà monté quand l'utilisateur reclique. Entre deux changements, la
  navigation interne reste locale.

### 9.3 Les deux sous‑onglets

| Sous‑onglet | Requête | Pastille |
|---|---|---|
| **Mes demandes** (défaut) | `requestingStoreId == moi` **et** `status in ['pending']`, `orderBy createdAt desc`, `limit 20` | neutre, `outgoing.length` |
| **Reçues (à exécuter)** | `supplierStoreId == moi` **et** `status == 'pending'`, `orderBy createdAt desc`, `limit 20` | **alerte (rouge)**, `incoming.length` |

Règles impératives :

1. **Le filtre de statut est CÔTÉ SERVEUR**, jamais côté client. Voir §16.1 — c'est un bug
   historique corrigé : filtrer après `limit()` fait disparaître des lignes.
2. **Les deux abonnements restent montés** quel que soit le sous‑onglet affiché : les pastilles
   doivent vivre même quand leur tableau n'est pas rendu, et basculer d'onglet ne doit pas
   attendre un rechargement.
3. « Mes demandes » est le défaut : c'est l'écran de la boutique qui sollicite, le geste courant.
4. Une collaboration confirmée ou rejetée **disparaît immédiatement** des deux tables et
   réapparaît dans l'Historique → onglet Collaborations.

### 9.4 Colonnes

**Reçues** : `Date & heure` · `Demandeuse` (`requestingStoreName`, repli « Boutique inconnue ») ·
`Client` (`clientNom + clientPrenom`, repli « Client inconnu ») · `Type` (libellé Dépôt/Retrait) ·
`Réseau` · `Montant` (`toLocaleString('fr-FR') + ' FCFA'`) · **`Actions`** (Confirmer / Rejeter).

**Mes demandes** : mêmes colonnes, sauf `Demandeuse` → **`Fournisseur`** (`supplierStoreName`)
et `Actions` → **`Statut`** (badge). La demandeuse **n'a aucune action** : elle attend.

Vides : « Aucune collaboration en attente. » / « Aucune demande en attente. »

### 9.5 Actions de la fournisseuse

- **Confirmer** : appel direct, bouton désactivé pendant l'appel (verrou par id de ligne pour
  ne bloquer que la ligne concernée). Erreur affichée en bandeau de page.
- **Rejeter** : ouvre une modale de motif. Validation **côté front avant l'appel** :
  `reason.trim().length` entre 3 et 500. Le bouton affiche « Rejet… » pendant l'appel ; en cas
  d'erreur, la modale reste ouverte avec le message.

### 9.6 Formulaire « Nouvelle collaboration » (modale)

| Champ | Source | Règles |
|---|---|---|
| **Client** | `ClientsContext` (liste de la boutique) | champ de recherche libre ; filtre insensible à la casse sur `nom + prenom` ; **8 résultats maximum** ; la sélection remplit le champ et ferme la liste ; taper à nouveau **efface** `clientId` (on ne soumet jamais un id périmé) |
| **Réseau** | `activeProfile.networks.enabled` | valeur par défaut = 1ᵉʳ réseau |
| **Opération** | `deposit` / `withdrawal` | défaut `deposit` |
| **Montant** | saisie `text` + `inputMode="numeric"` | transmis **brut** au service, qui est la **source unique du parse** (entier strict) |
| **Boutique fournisseuse** | `listStoreCollaborationProviders(network)` | **rechargé à chaque changement de réseau**, avec remise à zéro de la sélection ; désactivé pendant le chargement ou si la liste est vide ; libellés « Chargement… » / « Aucun fournisseur pour ce réseau » |

Comportements de la modale :

- **Pas de fermeture au clic sur le fond** : c'est un formulaire de saisie, un clic à côté
  effacerait un client et un montant déjà choisis. Fermeture par « Annuler » ou **Échap**.
- Validations avant appel : client sélectionné, fournisseur sélectionné (messages explicites).
- Succès : message « Collaboration créée. » affiché **800 ms**, puis fermeture.
  Le minuteur doit être **annulé au démontage** (sinon `setState` hors cycle de vie).
- Le chargement des fournisseurs doit être **annulable** (drapeau `cancelled`) pour ignorer une
  réponse arrivée après un nouveau changement de réseau.

---

## 10. Onglet 2 — Dettes internes

**Fichier de référence** : [StoreInternalDebts.jsx](../src/pages/store/StoreInternalDebts.jsx).

### 10.1 Emplacement, badge de navigation

- Page dédiée `/store/debts`, entrée de menu présente **seulement** en multi‑réseaux.
- **Badge de navigation** = nombre de tranches en attente de **ma** confirmation :
  requête **collection‑group** sur `settlements`,
  `where creditorStoreId == moi and settlementStatus == 'declared'`, on ne lit que `snap.size`.
  Le badge s'éteint dès qu'il n'y a plus rien à traiter (voir §13.3 pour le piège du nom de
  sous‑collection partagé).

### 10.2 Abonnements

```
mes dettes   : internalDebts where debtorStoreId   == moi, orderBy createdAt desc, limit 20
mes créances : internalDebts where creditorStoreId == moi, orderBy createdAt desc, limit 20
```

**L'erreur affichée doit être effacée au premier snapshot réussi** (`onUpdate` fait
`setError(null)`) : couplé au réabonnement résilient (§15), un blip de listener ne laisse plus
de bandeau figé sur une page pourtant à jour.

### 10.3 Ce que la page affiche — et ce qu'elle exclut

- **Filtrage client** : `status !== 'settled'`. Une dette réglée vaut 0, n'est plus
  actionnable, et se consulte dans l'Historique → onglet « Dettes internes ».
- **Deux cartes‑totaux qui servent aussi de sélecteur de vue** :

  | Carte | Total | Compte | Sélectionne |
  |---|---|---|---|
  | **Ce que je dois** (défaut) | Σ `remainingAmount` des dettes actives | nb de lignes actives | la table des dettes |
  | **Ce qu'on me doit** | Σ `remainingAmount` des créances actives | nb de lignes actives | la table des créances |

  Les totaux **ne comptent que l'en‑cours**. Le sous‑titre est `N ligne(s)`.

- **Solde net par partenaire** — bloc de bilan de fin de journée :
  - agrégation par `storeId` de partenaire, **toutes dettes et tous réseaux confondus** ;
  - `net = ce que je lui dois − ce qu'il me doit` ;
  - libellé : `net > 0` → « Vous devez X » ; `net < 0` → « On vous doit X » ; `net === 0` → « Soldé » ;
  - si la boutique a **à la fois** une dette et une créance avec ce partenaire, afficher
    « Compensable jusqu'à `min(dette, créance)` » — c'est le repère visuel qui désigne où une
    compensation est possible ;
  - les partenaires dont dette et créance sont toutes deux nulles sont exclus.

### 10.4 Ligne « Dette » (je suis débitrice) — actions

Colonnes : `Date & heure` · `À qui` (`creditorStoreName`) · `Type` · `Réseau` · `Montant` ·
`Statut` · `Règlement`.

**Cellule Montant** : le **reste dû en avant**, et l'original rappelé en petit `/ X FCFA`
**uniquement s'il diffère** du reste dû.

**Statut** : `open` → ambre, `partially_settled` → bleu, `settled` → vert (couleurs passées
explicitement, ces statuts n'existent pas dans les presets du badge générique).

Chaque ligne s'abonne aux tranches de **sa** dette (`orderBy declaredAt desc`) et calcule :

```
pending   = Σ amount des tranches settlementStatus === 'declared'
available = remainingAmount − pending      ← ce qu'il reste réellement à déclarer
```

Si `pending > 0`, afficher « Déjà en attente : X FCFA » sous la ligne.

#### 10.4.1 Remboursement

- Saisie `Montant` (texte, `inputMode="numeric"`) + `select` de **méthode**.
- Liste des méthodes = **méthodes de paiement du profil + `Banque`**
  (les anciens codes des tranches historiques restent **lisibles** via le dictionnaire de
  libellés, mais ne sont plus proposés à la saisie).
- **Garde‑fou stock (miroir du blocage serveur)** : une méthode Mobile Money dont le stock du
  réseau est à 0 chez **la boutique payeuse (moi, la débitrice)** est affichée **désactivée**
  avec le suffixe « — stock épuisé ». `Cash` et `Banque` ne sont jamais désactivés.
- **Méthode présélectionnée = la première réellement disponible** (ne jamais présélectionner un
  réseau grisé) ; repli sur la première de la liste si tout est indisponible.
- Validations avant appel, dans cet ordre :
  1. montant entier strictement positif ⇒ « Le montant doit être un entier positif. » ;
  2. `montant <= available` ⇒ sinon, message **différencié** :
     `pending > 0` → « Le montant dépasse le reste dû (X FCFA déjà en attente). »,
     sinon → « Le montant dépasse le reste dû. » ;
  3. si méthode Mobile Money : stock du réseau > 0, puis `montant <= stock`
     ⇒ « Stock {réseau} insuffisant. Disponible : X FCFA. ».
- **La saisie brute est transmise au service** (source unique du parse), pas une valeur déjà
  convertie — la conversion reste idempotente et centralisée.
- Une **clé d'idempotence est générée à chaque envoi** (`Date.now().toString(36) + aléatoire`).
- Succès : « Remboursement déclaré. En attente de confirmation. » + champ montant vidé.
- Bouton « Rembourser » désactivé si `available <= 0`.

#### 10.4.2 Compensation

- **Cible** : la créance opposée **la plus ancienne** (`createdAt` croissant) du **même
  partenaire** — c'est‑à‑dire une créance où `credit.debtorStoreId === debt.creditorStoreId` —
  et non soldée (`status !== 'settled'` et `remainingAmount > 0`).
- **Montant compensable** : `min(available, cible.remainingAmount)`.
  *Le `pending` de la créance opposée n'est pas soustrait côté client : le plafond exact est
  garanti par le serveur (§8.1f). Le client ne fait qu'éviter les propositions absurdes.*
- Le bouton **« Compenser X FCFA » n'apparaît que si `compensable > 0`**, avec l'infobulle
  « Solder avec la créance opposée de cette boutique ».
- **Revérifier la cible au clic** : elle a pu être soldée entre l'affichage et le clic (temps
  réel) ⇒ « La créance opposée n'est plus disponible. »
- Succès : « Compensation proposée. En attente de confirmation par la boutique créancière. »
- Une dette `settled` n'affiche **aucune action** (un simple `—`).

### 10.5 Ligne « Créance » (je suis créancière) — actions

Colonnes : `Date & heure` · `Qui` (`debtorStoreName`) · `Type` · `Réseau` · `Montant` ·
`Statut` · `Règlements`.

- Affiche **l'historique complet des tranches** de la dette (déclarées, confirmées, rejetées),
  **les plus récentes d'abord** (`declaredAt` décroissant).
- Chaque tranche est teintée par son statut : `declared` = ambre, `confirmed` = vert,
  `rejected` = gris. Ligne de texte : `montant · méthode · statut`.
- **Boutons Confirmer / Rejeter présents uniquement si** la dette n'est pas `settled`
  **et** la tranche est `declared`. Sinon on montre la trace sans bouton.
- **Aiguillage obligatoire selon la méthode** :

  ```
  method === 'compensation' → confirmInternalDebtCompensation / rejectInternalDebtCompensation
  sinon                     → confirmInternalDebtSettlement   / rejectInternalDebtSettlement
  ```

  *Se tromper d'appel sur une compensation n'imputerait qu'une seule des deux dettes.*
- Motifs de rejet par défaut du comportement de référence : `'Non reçu'` pour un règlement,
  `'Refusée'` pour une compensation (pas de saisie de motif sur cet écran).
- Verrou d'action par identifiant de tranche (ne bloquer que la tranche cliquée).

---

## 11. Onglet 3 — Historique

**Fichier de référence** : [Historique.jsx](../src/pages/Historique.jsx),
[historyFilter.js](../src/utils/historyFilter.js).

### 11.1 Principe

> **L'Historique ne montre que le TERMINÉ.** Une opération « En attente » reste dans son onglet
> opérationnel. Cette règle vaut pour les quatre sous‑onglets, sans exception.

### 11.2 Filtres — partagés par les quatre sous‑onglets

Un **seul** jeu de filtres en haut de page, appliqué aux quatre sources :

- `Du` / `Au` (bornes de jour **incluses**),
- bouton `Filtrer`, bouton `Aujourd'hui` (revient au jour courant et efface le reste),
- champ de recherche libre + bouton `Rechercher`.

Les transactions clients gardent **strictement** leur filtrage historique existant. Les trois
autres sources passent par un filtre générique qui **reproduit la même sémantique de dates** :

```
matchesDateRange(when, {from, to}, todayOnly):
  jour = date normalisée au jour local de `when`
  si todayOnly et aucune borne  → jour === aujourd'hui (une ligne sans date est exclue)
  si from ou to                 → from <= jour <= to    (une ligne sans date est exclue)
  sinon                         → tout passe
```

La recherche est une **sous‑chaîne insensible à la casse** sur une chaîne `search`
**pré‑calculée** par ligne (voir la composition exacte en §11.4 et §11.5).

⚠️ **Le cadran doit être local, pas UTC**, partout : groupement par jour, filtre et affichage.
Un mélange local/UTC décale d'un jour et « cliquer sur une carte n'affiche rien ».

### 11.3 Les quatre sous‑onglets et leurs pastilles

| Sous‑onglet | Source | Condition d'entrée | Pastille |
|---|---|---|---|
| **Transactions clients** (défaut) | contexte transactions | transactions complétées | nb filtré |
| **Opérations dealer** | `storeTransfers where storeId == moi`, `limit 20` | `status ∈ {confirmed, rejected}` | nb filtré |
| **Collaborations** *(multi‑réseaux)* | `storeCollaborations`, **filtre serveur** `status in ['confirmed','rejected']` | — | nb filtré |
| **Dettes internes** *(multi‑réseaux)* | `internalDebts` (dettes + créances) | `status === 'settled'` | nb filtré |

Les abonnements des quatre sources **restent montés quel que soit l'onglet actif** : les
pastilles vivent, et basculer d'onglet n'attend pas un rechargement.

### 11.4 Sous‑onglet Collaborations

- **Deux abonnements fusionnés**, tous deux avec `statuses: ['confirmed','rejected']` **côté
  serveur** et `limitCount = collabLimit` :
  - entrantes (`supplierStoreId == moi`) → **Sens = « Reçue »**, partenaire = `requestingStoreName` ;
  - sortantes (`requestingStoreId == moi`) → **Sens = « Envoyée »**, partenaire = `supplierStoreName`.
- Fusion, puis **tri par `createdAt` décroissant** sur l'ensemble, puis application des filtres.
- **Fenêtre + « Voir plus »** : `collabLimit` démarre à **50**, chaque clic ajoute 50 et
  **re‑souscrit** les deux abonnements. Le bouton n'apparaît que si
  `incoming.length >= collabLimit || outgoing.length >= collabLimit` (une fenêtre pleine d'un
  côté ⇒ il peut rester des lignes plus anciennes).
- Chaîne de recherche : `« {sens} {partenaire} {client} {réseau} {libellé type} {montant} »`.
- Colonnes : `Date & heure` · `Sens` (badge) · `Partenaire` · `Client` · `Type` · `Réseau` ·
  `Montant` · `Statut`.

### 11.5 Sous‑onglet Dettes internes

- Fusion des deux abonnements de dettes, **filtrés `status === 'settled'`** côté client :
  - mes dettes → **Sens = « Dette »**, partenaire = `creditorStoreName` ;
  - mes créances → **Sens = « Créance »**, partenaire = `debtorStoreName`.
- **Date affichée et utilisée pour le tri et le filtre : `updatedAt ?? createdAt`** — c'est la
  date de **règlement**, pas de création, qui fait sens dans un historique.
- **Montant affiché : `originalAmount`** (le reste dû vaut 0 par définition).
- Chaîne de recherche : `« {sens} {partenaire} {réseau} {libellé type} {originalAmount} »`.
- Colonnes : `Date & heure` · `Sens` · `Partenaire` · `Type` · `Réseau` · `Montant` · `Statut`.
- **Pas de « Voir plus »** sur ce sous‑onglet (voir §17.2).

### 11.6 Code couleur entrée / sortie

Purement présentationnel — **n'affecte aucun calcul de solde**. Source unique :

| Sens de ligne | Direction | Rendu |
|---|---|---|
| Collaboration **Reçue**, Dette interne **Créance** | **ENTRÉE** | vert (badge, liseré gauche, fond de ligne) |
| Collaboration **Envoyée**, Dette interne **Dette** | **SORTIE** | orange |
| autre | NEUTRE | gris |

Cohérent avec les transactions clients : Dépôt = entrée, Retrait = sortie, Crédit = neutre.

### 11.7 Sous‑onglet Transactions clients (rappel — comportement inchangé)

- **Navigation par jour** : groupement des transactions par jour local, tri décroissant,
  **7 jours par page**, boutons Précédent/Suivant, chaque carte affiche `JJ/MM/AAAA` et
  `N transaction(s)` ; cliquer une carte pose `{from: jour, to: jour}` sur le filtre partagé.
- **« Voir plus »** piloté par le contexte transactions, actif seulement si la fenêtre de
  chargement est plafonnée par le profil client (`history.pageSize`, ex. 200 ; `null` = illimité,
  comportement historique).
- Boutons d'action (export, réinitialisation des filtres) conservés.

---

## 12. Connexions entre les trois onglets (cycle de vie)

### 12.1 Le flux complet, de bout en bout

```
   BOUTIQUE A (demandeuse)                        BOUTIQUE B (fournisseuse)
   ───────────────────────                        ─────────────────────────
1. Transactions ▸ Collaborations ▸ Nouvelle
   → createStoreCollaboration ................... status = pending
   apparaît dans « Mes demandes » (A)            apparaît dans « Reçues » (B) + badge rouge
                                                  (badge onglet parent ET badge navigation)

2.                                             B exécute l'opération dans l'app opérateur,
                                               puis ▸ Confirmer
                                               → confirmStoreCollaboration
                                                  • stock B : −montant (dépôt) / +montant (retrait)
                                                  • création internalDebts (direction §6.2.1)
                                                  • status = confirmed

3. la ligne QUITTE « Mes demandes » (A)        la ligne QUITTE « Reçues » (B)
   → Historique ▸ Collaborations (Envoyée)     → Historique ▸ Collaborations (Reçue)
   → Dettes internes ▸ « Ce que je dois »      → Dettes internes ▸ « Ce qu'on me doit »
     (si A est débitrice)                        (si B est créancière)

4. la DÉBITRICE déclare une tranche           la CRÉANCIÈRE voit la tranche « Déclaré »
   (montant + méthode, ou compensation)        + badge de navigation « règlements à confirmer »
   → declare… : la dette N'EST PAS modifiée

5.                                             ▸ Confirmer → confirm…
                                                  • remaining −= montant ; settled += montant
                                                  • si méthode Mobile Money : stock débitrice −,
                                                    stock créancière + (sur le réseau de la méthode)
                                                  • statut = partially_settled … puis settled

6. remaining atteint 0 → status = settled
   la dette QUITTE « Dettes internes » (les deux côtés)
   → Historique ▸ Dettes internes (A : « Dette » / B : « Créance »)
```

### 12.2 Tableau de vérité : où s'affiche quoi

| Objet | État | Collaborations | Dettes internes | Historique |
|---|---|---|---|---|
| Collaboration | `pending` | ✅ (les deux côtés) | — | ❌ |
| Collaboration | `confirmed` | ❌ | (via sa dette) | ✅ Collaborations |
| Collaboration | `rejected` | ❌ | — (aucune dette créée) | ✅ Collaborations |
| Dette | `open` | — | ✅ | ❌ |
| Dette | `partially_settled` | — | ✅ (reste dû affiché) | ❌ |
| Dette | `settled` | — | ❌ | ✅ Dettes internes |
| Tranche | `declared` | — | ✅ (dans sa dette, + badge nav) | ❌ |
| Tranche | `confirmed` / `rejected` | — | ✅ (trace, non actionnable) | ❌ (visible via la dette) |

### 12.3 Points de couplage à ne pas casser

1. **Une dette n'existe que si une collaboration a été confirmée.** `internalDebts.collaborationId`
   est la trace de cette filiation ; `storeCollaborations.debtId` la trace inverse.
2. **La même ligne est vue des deux côtés avec un sens inversé.** Un seul document, deux
   lectures. La dénormalisation des noms de boutiques (`requestingStoreName`,
   `supplierStoreName`, `debtorStoreName`, `creditorStoreName`) est ce qui rend cela possible
   sans lecture croisée — les règles interdisant de lire la fiche d'une autre boutique.
3. **Les badges sont des abonnements séparés, indépendants du montage des pages.** Trois
   compteurs distincts : collaborations reçues en attente (Transactions + navigation),
   règlements à confirmer (navigation, collection‑group), demandes dealer en attente.
4. **Le stock affiché en haut de l'application (cartes réseau) est la même source** que celle
   utilisée par les garde‑fous du remboursement. Une confirmation de collaboration ou de
   règlement Mobile Money doit faire bouger ces cartes en temps réel.

---

## 13. Règles Firestore à répliquer

### 13.1 Collaborations et dettes

```
match /storeCollaborations/{collabId} {
  allow read: if isStoreAdmin(resource.data.requestingStoreId)
              || isStoreAdmin(resource.data.supplierStoreId)
              || isSystemManager();
  allow create, update, delete: if false;      // CF-only
}

match /internalDebts/{debtId} {
  allow read: if isStoreAdmin(resource.data.debtorStoreId)
              || isStoreAdmin(resource.data.creditorStoreId)
              || isSystemManager();
  allow create, update, delete: if false;      // CF-only

  match /settlements/{settlementId} {
    allow read: if canReadInternalDebt(debtId);   // ← voir 13.2
    allow write: if false;
  }
}

match /storeNetworkConfig/{storeId} {
  allow read: if isSystemManager() || isStoreAdmin(storeId) || isDealer();
  allow create, update, delete: if false;
}
```

### 13.2 ⚠️ La règle des tranches : `get()` du parent, PAS `resource.data`

La page Dettes internes liste les tranches **sans clause `where`** (`orderBy declaredAt`).
Une règle écrite en `resource.data.debtorStoreId` **fait échouer TOUTE la requête LIST**
(« Property debtorStoreId is undefined ») — les règles filtrent l'accès, elles ne filtrent pas
les résultats.

```
function canReadInternalDebt(debtId) {
  return isSystemManager()
    || isStoreAdmin(get(/databases/$(database)/documents/internalDebts/$(debtId)).data.debtorStoreId)
    || isStoreAdmin(get(/databases/$(database)/documents/internalDebts/$(debtId)).data.creditorStoreId);
}
```

`$(debtId)` est **fixe** pour une requête donnée : la condition est donc évaluable sur une LIST
non contrainte. Débitrice, créancière et gérant passent ; les tiers sont refusés.

### 13.3 ⚠️ La requête collection‑group `settlements` : collision de nom

Le nom `settlements` est **partagé** avec le moteur de transactions clients
(`clients/{storeId}/drafts/{id}/settlements` et `.../history/{id}/settlements`). Le joker
traverse aussi ces documents. La règle doit donc **exiger explicitement la présence du champ
dénormalisé** :

```
match /{path=**}/settlements/{settlementId} {
  allow read: if 'creditorStoreId' in resource.data
              && isStoreAdmin(resource.data.creditorStoreId);
  allow write: if false;
}
```

Les règlements du moteur de transactions n'ont pas ce champ → condition fausse → ils restent
inaccessibles par ce chemin. **Pas de clause `isSystemManager()` ici** (moindre privilège :
seule la boutique créancière a besoin de ce compteur ; le gérant garde ses accès par les blocs
dédiés).

Symétriquement, la requête front **doit** filtrer sur `creditorStoreId` — c'est ce filtre qui
exclut les documents homonymes.

### 13.4 Tests de règles à écrire (obligatoires)

Un fichier par surface, exécuté sur l'émulateur, **avec au moins deux boutiques différentes** :

| Test | Vérifie |
|---|---|
| `storeCollaborations.rules` | demandeuse lit, fournisseuse lit, **une tierce boutique ne lit pas**, écriture client refusée |
| `internalDebts.rules` | débitrice lit, créancière lit, tiers refusé, écriture refusée |
| `internalDebtsSettlementsList.rules` | **LIST sans `where`** autorisée pour débitrice et créancière, refusée pour un tiers |
| `settlements.collection-group.rules` | la requête de groupe filtrée `creditorStoreId` passe ; les `settlements` du moteur de transactions **ne fuient pas** |
| `storeNetworkConfig.rules` | une boutique ne lit **pas** la config d'une autre |

---

## 14. Index composites requis

À déclarer dans `firestore.indexes.json` **avant** de déployer : sans eux, les abonnements
échouent en `failed-precondition`, une erreur **non auto‑résolvable** (voir §15).

| Collection | Portée | Champs |
|---|---|---|
| `storeCollaborations` | COLLECTION | `requestingStoreId` ASC, `createdAt` DESC |
| `storeCollaborations` | COLLECTION | `requestingStoreId` ASC, `status` ASC, `createdAt` DESC |
| `storeCollaborations` | COLLECTION | `supplierStoreId` ASC, `createdAt` DESC |
| `storeCollaborations` | COLLECTION | `supplierStoreId` ASC, `status` ASC, `createdAt` DESC |
| `internalDebts` | COLLECTION | `debtorStoreId` ASC, `createdAt` DESC |
| `internalDebts` | COLLECTION | `creditorStoreId` ASC, `createdAt` DESC |
| `settlements` | **COLLECTION_GROUP** | `creditorStoreId` ASC, `settlementStatus` ASC |

Les requêtes internes des handlers (`settlements where settlementStatus == 'declared'` sur une
sous‑collection unique, égalité sur un seul champ) n'exigent **aucun** index composite.

---

## 15. Abonnements temps réel : contrat technique

**Un `onSnapshot` qui tombe en erreur est TERMINAL** : le listener meurt et ne se rétablit
jamais. La page cesse de se mettre à jour, le bandeau d'erreur reste figé, et l'utilisateur ne
voit rien changer. Tous les abonnements de ce module doivent donc passer par un **wrapper
résilient** :

```
resilientOnSnapshot(query, { onNext, onError, delayMs = 4000 }):
  - à l'erreur : prévenir l'appelant, PUIS se réabonner après un délai
  - backoff exponentiel : 4 s → 8 s → 16 s → 32 s → plafond 60 s
  - au snapshot réussi : réinitialiser le backoff
  - NE PAS réabonner sur les codes PERMANENTS : 'permission-denied' et 'failed-precondition'
    (règle refusée / index manquant : ils exigent un déploiement, réabonner en boucle
     ne fait que marteler le backend)
  - l'unsubscribe rendu annule le minuteur ET le listener courant
```

Côté appelant : **effacer l'erreur au premier snapshot réussi** (`onUpdate` fait
`setError(null)`), sinon le bandeau survit à la reprise.

---

## 16. Pièges connus — à ne pas réintroduire

### 16.1 « Limiter puis filtrer » — le piège le plus coûteux

**Symptôme** : des lignes disparaissent alors qu'elles existent, ou des lignes terminées
restent éternellement dans une file d'attente.

**Cause** : `limit(N)` s'applique **côté serveur, avant** tout filtre côté client. Si les N
documents les plus récents sont majoritairement d'un statut qu'on filtre ensuite, les
documents recherchés n'ont jamais été chargés.

**Règle** : **le filtre de statut doit être dans la requête**, jamais après.

```js
// ❌ INTERDIT
subscribeOutgoing({ storeId, limit: 20, onUpdate: rows => setState(rows.filter(r => r.status === 'pending')) })

// ✅ OBLIGATOIRE
constraints.push(where('status', 'in', statuses))   // avant orderBy + limit
```

Le même service doit donc exposer deux chemins : `statusFilter` (`==` un statut, chemin
opérationnel) et `statuses` (`in` plusieurs statuts, chemin historique).

### 16.2 Idempotence avant calcul

Dans `declare…`, la lecture de la tranche déterministe **doit précéder** le calcul du reste dû.
Sinon la tranche déjà écrite se compte elle‑même dans `pending` et un retry légitime échoue en
`SETTLEMENT_EXCEEDS_REMAINING` au lieu d'être un no‑op.

### 16.3 Lectures avant écritures

Firestore refuse toute lecture après une écriture dans une même transaction. Dans
`confirmInternalDebtSettlement`, les deux soldes **doivent** être lus avant toute écriture,
y compris avant la mise à jour de la dette.

### 16.4 Écrasement de solde

Toujours `set(ref, { balances: { [réseau]: { stock: X } }, updatedAt }, { merge: true })`.
Un `set` sans merge, ou un `update` sur `balances`, efface les autres réseaux et la liquidité.

### 16.5 Collision de noms de sous‑collection

Voir §13.3. À vérifier dans le projet copie **avant** d'écrire la règle joker : si une autre
sous‑collection s'appelle `settlements`, la garde `'creditorStoreId' in resource.data` est
indispensable.

### 16.6 Fuseau horaire

Groupement par jour, filtre de dates et affichage doivent tous utiliser le **cadran local**.
Un `toISOString()` glissé dans le groupement décale l'affichage d'un jour par rapport au filtre.

### 16.7 Minuteurs et abonnements non nettoyés

Le minuteur de fermeture différée de la modale de succès, le drapeau d'annulation du chargement
des fournisseurs, et chaque `unsubscribe` doivent être libérés au démontage.

---

## 17. Limites connues du comportement de référence

À reproduire **telles quelles** pour rester iso‑comportement, ou à améliorer explicitement
**en lot séparé** — jamais en même temps qu'un portage.

1. **Fenêtre des dettes** : `subscribeMyDebts` / `subscribeMyCredits` chargent les **20 plus
   récentes par `createdAt`, tous statuts confondus**, puis filtrent `settled` côté client
   (page Dettes internes) ou `settled` seulement (Historique). C'est structurellement le motif
   décrit en §16.1 : avec beaucoup de dettes récentes réglées, une vieille dette ouverte peut
   sortir de la fenêtre. Correctif propre si vous le traitez : filtre serveur `status in [...]`
   + index `(debtorStoreId, status, createdAt)`.
2. **Pas de « Voir plus »** sur l'onglet Historique ▸ Dettes internes (contrairement à
   Collaborations, qui en a un).
3. **Compensation : une seule cible à la fois** — la créance opposée la plus ancienne. Si un
   partenaire a plusieurs créances opposées, il faut plusieurs compensations successives.
4. **Motifs de rejet des tranches non saisissables** : `'Non reçu'` / `'Refusée'` sont figés
   dans l'interface, alors que le serveur accepte tout motif de 3 à 500 caractères.
5. **Plafond de compensation côté client** : `min(available, cible.remainingAmount)` ne
   soustrait pas les tranches en attente de la créance opposée ; le serveur, lui, le fait. Une
   proposition peut donc être refusée par le serveur avec `COMPENSATION_EXCEEDS_REMAINING`.

---

## 18. Plan d'implémentation par lots

**Un lot = un commit, avec ses tests. Ne jamais refactoriser et changer le comportement métier
dans le même lot.** Chaque lot se termine par : lint, tests, build, examen du diff.

### Lot 0 — Inventaire de l'existant (vérification, aucune construction)

Le reste de l'application est déjà développé (§1.5). Ce lot ne code rien : il **constate** ce
qui est là et **liste les manques** avant d'écrire la première ligne. Chaque case cochée doit
l'être en citant le fichier qui la porte.

- [ ] Profil client actif exposant `networks.enabled` (≥ 2 réseaux pour activer le module) et
      `transactions.paymentMethods`. Sinon : le module resterait invisible.
- [ ] Collection `stores/{storeId}` avec `name` — sinon les noms dénormalisés seront tous `null`.
- [ ] Collection `globalClients/{clientId}` avec `nom`, `prenom` (liste **commune** aux boutiques).
- [ ] `users/{uid}` avec `active`, `role: 'store_admin'`, `storeId`, `email`, `name`.
- [ ] `clients/{storeId}/networkBalances/current` au format `balances[réseau].{stock,liquidite}`.
- [ ] **`storeNetworkConfig/{storeId}` alimenté avec `isProvider`** + son callable
      d'administration réservé au gérant. **C'est le seul prérequis susceptible de manquer
      réellement** : sans lui, aucun fournisseur n'est éligible et l'annuaire revient vide.
      S'il manque, le construire est un **lot préalable à part entière**, pas un à‑côté.
- [ ] Cloud Functions initialisées en `europe-west1`, avec wrapper d'erreurs
      (`DealerRequestError → HttpsError`) et injection `{ db, FieldValue }`.
- [ ] Contexte clients de la boutique disponible côté front (alimente la recherche client de la
      modale de création).
- [ ] Émulateurs Firestore + Functions opérationnels (**l'audit et les tests se font
      exclusivement sur émulateur, jamais sur la production**).
- [ ] **Test de caractérisation de la page Historique actuelle écrit et vert** (§1.5) — c'est le
      filet qui protège le seul fichier existant réellement transformé.

### Lot 1 — Modèle, règles, index (aucune UI)

Écrire `firestore.rules` (§13) et `firestore.indexes.json` (§14). Écrire **d'abord** les tests
de règles (§13.4), les voir échouer, puis les faire passer. Déployer sur émulateur uniquement.

### Lot 2 — Helpers purs des collaborations

`validateOperationType`, `validateCollaborationAmount`, `validateCollaborationId`,
`validateStoreRef`, `validateClientId`, `debtDirection`, `supplierStockDelta`.
Tests unitaires sans Firestore : table de vérité complète de `debtDirection` × `supplierStockDelta`.

### Lot 3 — Callables collaborations

`createStoreCollaboration`, `confirmStoreCollaboration`, `rejectStoreCollaboration`,
`listStoreCollaborationProviders`. Tests sur émulateur : chaque code d'erreur de §20.4,
+ vérification des soldes avant/après et de la dette créée.

### Lot 4 — Helpers purs des dettes

`validateDebtId`, `validateSettlementId`, `validateSettlementMethod`, `validateSettlementAmount`,
`validateIdempotencyKey`, `deterministicSettlementId`, `sumDeclaredAmounts`.
Puis compensation : `deterministicCompensationId`, `deterministicMirrorId`,
`validateOppositeDebtPair`, `compensableAmount`.

### Lot 5 — Callables règlements

`declare` / `confirm` / `reject` `InternalDebtSettlement`. Tests : idempotence (double appel
identique = no‑op ; payload différent = conflit), réservation par les tranches déclarées,
mouvement de stock Mobile Money **et** absence de mouvement en Cash/Banque, insuffisance de solde.

### Lot 6 — Callables compensation

`declare` / `confirm` / `reject` `InternalDebtCompensation`. Tests : paire opposée refusée,
imputation sur les **deux** dettes, tranche miroir, double audit.

### Lot 7 — Service front + abonnements résilients

Dictionnaire d'erreurs, `mapCollaborationError`, `resilientOnSnapshot` (§15), les 7 abonnements,
`generateIdempotencyKey`. Tests : réabonnement après erreur transitoire, **absence** de
réabonnement sur `permission-denied` / `failed-precondition`.

### Lot 8 — UI Collaborations

Sous‑onglet de Transactions, pilotage par l'URL, deux sous‑onglets, badges, modale de création,
modale de rejet. Tests composants : filtre serveur `pending` bien demandé, `?sub=incoming`
respecté, pastille masquée à zéro.

### Lot 9 — UI Dettes internes

Cartes‑totaux/sélecteur, solde net par partenaire, ligne débitrice (remboursement + garde‑fou
stock), ligne créancière (tranches + aiguillage compensation), badge de navigation.

### Lot 10 — UI Historique

Filtre générique partagé, quatre sous‑onglets, pastilles, « Voir plus » collaborations,
couleurs entrée/sortie.

### Lot 11 — Recette complète (§19) sur émulateur, avec deux boutiques

---

## 19. Recette — scénarios d'acceptation

Chaque scénario doit être rejouable sur émulateur avec **deux boutiques A et B**, B fournisseuse
sur le réseau testé (`isProvider: true`), A non fournisseuse.

| # | Scénario | Résultat attendu |
|---|---|---|
| 1 | A crée une collaboration **dépôt** 20 000 sur un réseau, fournisseur B | doc `pending` ; **aucun solde ne bouge** ; visible dans « Mes demandes » (A) et « Reçues » (B) ; badge B = 1 |
| 2 | B confirme le dépôt, stock B = 50 000 | stock B → 30 000 ; dette **A→B** de 20 000 `open` ; collab `confirmed` ; ligne partie des deux files ; présente dans les deux Historiques ; A voit « Ce que je dois 20 000 », B « Ce qu'on me doit 20 000 » |
| 3 | Même chose avec stock B = 10 000 | `INSUFFICIENT_SUPPLIER_BALANCE` → « Stock insuffisant pour exécuter cette collaboration. » ; **rien n'a bougé, aucune dette** |
| 4 | A crée une collaboration **retrait** 15 000, B confirme | stock B **+15 000** ; dette **B→A** de 15 000 ; aucun contrôle de suffisance |
| 5 | B rejette une collaboration avec motif « ok » (2 car.) | refus `INVALID_REJECTION_REASON`, modale reste ouverte |
| 6 | B rejette avec un motif valide | collab `rejected` ; **aucune dette** ; visible en Historique ▸ Collaborations avec le statut Rejetée |
| 7 | A tente de confirmer sa **propre** demande | `COLLABORATION_STORE_MISMATCH` |
| 8 | B confirme deux fois la même collaboration | 2ᵉ appel → `COLLABORATION_NOT_PENDING` ; un seul mouvement de stock, une seule dette |
| 9 | A (débitrice, 20 000 dus) déclare 25 000 | `SETTLEMENT_EXCEEDS_REMAINING`, message client avant même l'appel |
| 10 | A déclare 5 000 puis 5 000 (deux clés) puis 12 000 | la 3ᵉ échoue : `20 000 − 10 000 en attente = 10 000` disponibles |
| 11 | A rejoue **exactement** la même déclaration (même clé) | no‑op idempotent, `{ idempotent: true }`, **une seule** tranche |
| 12 | A rejoue la même clé avec un montant différent | `IDEMPOTENCY_CONFLICT` |
| 13 | B confirme une tranche de 5 000 méthode **Orange Money** | dette : reste 15 000, `partially_settled` ; **stock Orange A −5 000, stock Orange B +5 000** ; 2 audits `BALANCE_MOVED` |
| 14 | Idem méthode **Cash** | dette imputée, **aucun solde ne bouge**, aucun audit `BALANCE_MOVED` |
| 15 | A déclare un règlement Orange 5 000 alors que son stock Orange = 0 | méthode grisée « — stock épuisé » ; si forcée : `SETTLEMENT_INSUFFICIENT_BALANCE` à la confirmation |
| 16 | B rejette une tranche | tranche `rejected`, **dette inchangée**, le montant redevient déclarable |
| 17 | A confirme sa propre tranche | `DEBT_STORE_MISMATCH` |
| 18 | Dernière tranche confirmée, reste = 0 | dette `settled` ; **disparaît de Dettes internes des deux côtés** ; apparaît dans les deux Historiques ▸ Dettes internes (A « Dette », B « Créance ») avec `originalAmount` et la date de règlement |
| 19 | A doit 20 000 à B **et** B doit 12 000 à A | « Solde net par partenaire » affiche « Vous devez 8 000 » côté A et « Compensable jusqu'à 12 000 » ; bouton « Compenser 12 000 » présent |
| 20 | A compense, B confirme | **les deux dettes** imputées de 12 000 : D1 reste 8 000 `partially_settled`, D2 reste 0 `settled` ; tranche miroir sous D2 ; audit chez A **et** chez B ; **aucun solde ne bouge** |
| 21 | Compensation contre une dette non opposée | `NOT_OPPOSITE_PAIR` |
| 22 | Une tierce boutique C tente de lire la collaboration ou la dette de A et B | refus par les règles (test émulateur) |
| 23 | Historique, filtre sur une seule journée | les quatre sous‑onglets et leurs pastilles reflètent le même jour ; une collaboration confirmée hier n'apparaît pas |
| 24 | Plus de 50 collaborations terminées | « Voir plus » présent, un clic charge les 50 suivantes, l'ordre reste décroissant |
| 25 | Profil **mono‑réseau** | aucune entrée « Dettes internes », aucun sous‑onglet Collaborations, aucun sous‑onglet Historique supplémentaire, `?tab=collaborations` retombe sur `client`, aucun abonnement ouvert |
| 26 | **Non‑régression** : rejouer le test de caractérisation de l'Historique écrit au Lot 0 | filtres, navigation par jour, « Voir plus » et export du sous‑onglet Transactions clients **identiques** avant et après la mise en onglets |
| 27 | **Non‑régression** : parcours complet Transaction client puis Opération dealer | comportement, soldes et historique strictement inchangés — ce module ne touche ni la liquidité ni le moteur de transactions client |

---

## 20. Annexes : constantes, libellés, codes d'erreur

### 20.1 Réseaux supportés (référentiel produit, ordre d'affichage)

```
['Orange', 'Moov', 'Telecel', 'Coris', 'Sank', 'Wave']
```

Les 6 réseaux mobile money — **`Liquidite` n'en est pas un** : c'est la caisse cash, agrégée à
part, jamais déplacée par ce module.

### 20.2 Libellés d'affichage

```js
COLLAB_OPERATION_TYPE_LABELS = { deposit: 'Dépôt', withdrawal: 'Retrait' }
COLLAB_STATUS_LABELS         = { pending: 'En attente', confirmed: 'Confirmée', rejected: 'Rejetée' }
DEBT_STATUS_LABELS           = { open: 'Ouverte', partially_settled: 'Partiellement réglée', settled: 'Réglée' }
DEBT_SETTLEMENT_STATUS_LABELS= { declared: 'Déclaré', confirmed: 'Confirmé', rejected: 'Rejeté' }
DEBT_SETTLEMENT_METHOD_LABELS= { especes: 'Espèces', depot_bancaire: 'Dépôt bancaire',
                                 transfert: 'Transfert', compensation: 'Compensation',
                                 retour_stock: 'Retour de stock' }   // codes historiques, lecture seule
```

### 20.3 Méthodes de règlement acceptées par le serveur

```
'Orange Money', 'Moov Money', 'Telecel Money', 'Coris Money', 'Sank Money', 'Wave', 'Cash', 'Banque'
```

Mapping méthode → réseau (`mapPaymentMethodToNetwork`) :
`Orange Money→Orange`, `Moov Money→Moov`, `Telecel Money→Telecel`, `Coris Money→Coris`,
`Sank Money→Sank`, `Wave→Wave`, `Cash→Liquidite`, tout autre → **lui‑même**.
`'compensation'` n'est **pas** une méthode déclarable par ce chemin : elle est posée par le
handler de compensation.

### 20.4 Tailles de fenêtre

| Constante | Valeur | Usage |
|---|---|---|
| `COLLABORATIONS_PAGE_SIZE` | 20 | files opérationnelles |
| `INTERNAL_DEBTS_PAGE_SIZE` | 20 | dettes et créances |
| `STORE_TRANSFERS_PAGE_SIZE` | 20 | opérations dealer (Historique) |
| `COLLABORATIONS_HISTORY_PAGE_SIZE` | **50** | Historique ▸ Collaborations, +50 par « Voir plus » |
| `history.pageSize` (profil) | 200 (ou `null` = illimité) | transactions clients |

### 20.5 Codes d'erreur serveur → messages utilisateur (dictionnaire front)

| Code | Message affiché |
|---|---|
| `UNAUTHENTICATED` | Votre session a expiré. Reconnectez-vous. |
| `PROFILE_NOT_FOUND` | Votre profil est introuvable. |
| `PROFILE_INACTIVE` | Votre compte est inactif. |
| `ROLE_FORBIDDEN` | Action réservée aux boutiques. |
| `INVALID_OPERATION_TYPE` | Type d'opération invalide (dépôt ou retrait). |
| `INVALID_COLLABORATION_AMOUNT` | Montant invalide : entier strictement positif requis. |
| `INVALID_COLLABORATION_NETWORK` | Réseau invalide. |
| `INVALID_STORE_ID` | Boutique invalide. |
| `SAME_STORE_COLLABORATION` | La boutique fournisseuse doit être différente de la vôtre. |
| `CLIENT_NOT_FOUND` | Client introuvable. |
| `SUPPLIER_STORE_NOT_FOUND` | Boutique fournisseuse introuvable. |
| `SUPPLIER_NOT_PROVIDER` | Cette boutique n'est pas fournisseuse sur ce réseau. |
| `INSUFFICIENT_SUPPLIER_BALANCE` | Stock insuffisant pour exécuter cette collaboration. |
| `COLLABORATION_NOT_FOUND` | Collaboration introuvable. |
| `COLLABORATION_NOT_PENDING` | Cette collaboration a déjà été traitée. |
| `COLLABORATION_STORE_MISMATCH` | Cette collaboration ne vous est pas destinée. |
| `INVALID_DEBT_ID` | Dette invalide. |
| `INVALID_SETTLEMENT_ID` | Règlement invalide. |
| `INVALID_SETTLEMENT_METHOD` | Méthode de règlement invalide. |
| `INVALID_SETTLEMENT_AMOUNT` | Montant invalide : entier strictement positif requis. |
| `INVALID_IDEMPOTENCY_KEY` | Clé de règlement invalide. |
| `DEBT_NOT_FOUND` | Dette introuvable. |
| `DEBT_ALREADY_SETTLED` | Cette dette est déjà réglée. |
| `DEBT_STORE_MISMATCH` | Vous n'êtes pas autorisé sur cette dette. |
| `SETTLEMENT_NOT_DECLARED` | Ce règlement n'est pas en attente de confirmation. |
| `SETTLEMENT_NOT_FOUND` | Règlement introuvable. |
| `SETTLEMENT_EXCEEDS_REMAINING` | Le montant dépasse le reste dû (des règlements sont peut-être déjà en attente). |
| `SETTLEMENT_INSUFFICIENT_BALANCE` | Solde réseau insuffisant chez la boutique débitrice pour ce remboursement. |
| `INVALID_OPPOSITE_DEBT` | Dette opposée invalide. |
| `NOT_OPPOSITE_PAIR` | La dette opposée doit lier les deux mêmes boutiques en sens inverse. |
| `COMPENSATION_EXCEEDS_REMAINING` | Le montant dépasse ce qui est compensable. |
| `IDEMPOTENCY_CONFLICT` | Une tranche différente existe déjà pour cette action. |
| `INVALID_REJECTION_REASON` | Le motif est invalide (3 à 500 caractères). |
| `BALANCE_OVERFLOW` | Le solde résultant est invalide. |
| `TRANSACTION_FAILED` | L'opération n'a pas pu être finalisée. |
| *(défaut)* | Une erreur inattendue s'est produite. |

Règle de mapping : lire `err.details.code` en priorité ; à défaut, un code Functions contenant
`unauthenticated` → message de session expirée ; sinon message générique (et log en
développement seulement — **jamais** exposer l'erreur brute à l'utilisateur).

### 20.6 Fichiers de référence du projet source

| Sujet | Fichier |
|---|---|
| Service front (appels + abonnements + erreurs) | [src/services/collaborationService.js](../src/services/collaborationService.js) |
| Page Collaborations | [src/pages/store/StoreCollaborations.jsx](../src/pages/store/StoreCollaborations.jsx) |
| Modale de création | [src/components/store/CollaborationFormModal.jsx](../src/components/store/CollaborationFormModal.jsx) |
| Page Dettes internes | [src/pages/store/StoreInternalDebts.jsx](../src/pages/store/StoreInternalDebts.jsx) |
| Page Historique | [src/pages/Historique.jsx](../src/pages/Historique.jsx) |
| Filtre générique historique | [src/utils/historyFilter.js](../src/utils/historyFilter.js) |
| Sens entrée/sortie | [src/utils/transactionDirection.js](../src/utils/transactionDirection.js) |
| Constantes métier | [src/constants/dealerConstants.js](../src/constants/dealerConstants.js) |
| Drapeau multi‑réseaux + menu | [src/constants/navigation.js](../src/constants/navigation.js) |
| Helpers purs collaborations | [functions/src/collaborations/shared.js](../functions/src/collaborations/shared.js) |
| Helpers purs dettes/compensation | [functions/src/collaborations/debtShared.js](../functions/src/collaborations/debtShared.js) |
| Handlers | [functions/src/collaborations/](../functions/src/collaborations/) |
| Câblage des callables | [functions/src/index.js](../functions/src/index.js) |
| Règles | [firestore.rules](../firestore.rules) |
| Index | [firestore.indexes.json](../firestore.indexes.json) |

### 20.7 Tests existants à transposer

Serveur (émulateur) : `tc-104` création, `tc-106` confirmation, `tc-107` rejet,
`tc-110` règlements, `tc-112` annuaire fournisseurs, `tc-124` compensation.
Purs : `tc-103` helpers collaborations, `tc-109` helpers dettes, `tc-123` helpers compensation.
Interface : `tc-120` sous‑onglets, `tc-121` dettes internes, `tc-122` onglets historique,
`tc-125` compensation, `tc-126` vue des dettes réglées, `tc-152` couleurs entrée/sortie,
`tc-116` badges de navigation.
Règles : `storeCollaborations`, `internalDebts`, `internalDebtsSettlementsList`,
`settlements.collection-group`, `storeNetworkConfig`.

> Exécuter les suites émulateur **en sérialisé** (`--no-file-parallelism`) : plusieurs suites
> concurrentes sur le même émulateur provoquent des `ECONNREFUSED` intermittents.
