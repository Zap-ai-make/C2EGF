# Audit des espaces Dealer & Gérant/Admin

> Audit réalisé le 2026-08-01. Périmètre : le code ajouté à partir de l'implémentation des
> espaces V2 dealer et gérant/admin — ~40 commits depuis `230b24f feat: add role-based V2
> application spaces`, soit **~9 900 lignes ajoutées dans 53 fichiers** (pages admin/dealer,
> services, composants dealer, Cloud Functions, règles Firestore). Méthode : trois passes
> d'analyse (sécurité, duplication, qualité) suivies d'une contre-vérification manuelle de
> chaque constat majeur. Les constats non vérifiables ou erronés ont été écartés (voir §6).

## Verdict d'ensemble

Le tableau est contrasté et plutôt rassurant. Le **cœur financier serveur** (Cloud Functions +
règles Firestore) a été durci sérieusement même pendant la phase rapide : validation stricte des
payloads (listes blanches de clés, protection anti-injection de prototype), transactions
atomiques, idempotence, audit logs, double vérification des profils dans les transactions.
**Aucune faille critique exploitable n'a été trouvée.**

Le « développement en vrac » a laissé ses traces sur **la couche front** : duplication massive
de petits helpers (~400-500 lignes), constantes centralisées ignorées, cinq mappings d'erreurs
divergents, et surtout un **trou de couverture de tests** : ~15 % sur le périmètre dealer/admin
contre ~80 % sur l'espace boutique.

---

## 1. Sécurité

### 1.0 CRITIQUE — Frontière de confiance draft→callable (manqué à l'audit initial, remonté par contre-revue) — ✅ CORRIGÉ

**Défaut manqué par la première passe d'audit, révélé par une contre-revue indépendante
(ChatGPT) puis vérifié dans le code.** `validTransaction` ([firestore.rules:79-84](../../../firestore.rules#L79))
ne validait que `type/montant/clientId` et la règle `update` des drafts n'avait **aucune liste
blanche de champs**. Un membre boutique pouvait donc écrire directement les champs de
comptabilité de règlement (`originalAmount`, `paidAmount`, `refundedAmount`, `remainingAmount`,
`settlementSummary`, `settlementStatus`) sur un draft. Or les callables de règlement les
**lisent sans les recalculer** ([addTransactionPayment.js:150-153](../../../functions/src/settlements/addTransactionPayment.js#L150),
[addTransactionRefund.js:138-141](../../../functions/src/settlements/addTransactionRefund.js#L138))
pour borner un règlement (`amount <= remainingAmount`, `amount <= netPaid`).

**Scénario** : le membre crée un draft, force `remainingAmount`/`paidAmount` à une valeur
arbitraire, puis appelle la callable avec un montant « cohérent » avec ces champs falsifiés → un
document `settlement` serveur, immuable et « audité », atteste alors une donnée métier manipulée.
Ce n'était donc **pas un backend autoritaire**.

**Correctif (Lot B)** : verrou par les règles Firestore — les champs de règlement sont désormais
gérés **exclusivement** par les Cloud Functions (Admin SDK, qui contourne les règles) :
- `create` : `draftHasNoSettlementFields(...)` — refus si un de ces champs est présent.
- `update` : `draftSettlementFieldsUnchanged(...)` — refus si un de ces champs est ajouté,
  modifié ou retiré ([firestore.rules:350-361](../../../firestore.rules#L350)).
- Tests émulateur négatifs+positifs : `tests/firestore/drafts.settlement-fields.rules.test.js`
  (12 cas, dont cloisonnement 2 boutiques). Suite de règles complète : 347 verts.

### 1.0-bis CRITIQUE — Inversion de signe via `draft.type` / `draft.montant` (2e passe, agent code-reviewer) — ✅ CORRIGÉ

Le verrou 1.0 couvrait les 8 champs comptables mais **pas `type` ni `montant`**. Une contre-revue
adversariale (agent `code-reviewer`) a démontré, **tests à l'appui**, que le verrou restait
contournable :
- **C1 (CRITIQUE)** : entre deux tranches d'un même règlement, un membre pouvait faire
  `updateDraft(type: 'Retrait'→'Dépôt')` (accepté). Le handler lit `draft.type` frais à chaque
  tranche → `delta = isRetrait(type) ? -amount : amount` s'inverse → **écart de 2× la tranche**
  sur le solde réseau (quantifié par `tests/unit/tc-082-...`).
- **E1 (ÉLEVÉ)** : `montant` modifiable sur un draft en cours de règlement (borne / pollution de
  l'audit history via `...draft`).

**Correctif** : `draftCoreFieldsFrozenIfSettling(...)` — dès qu'un draft porte un champ de
règlement (`settlementStatus`/`paidAmount`/`remainingAmount`/`settlementSummary` dans le document
EXISTANT), `type` et `montant` sont **figés** côté client ([firestore.rules](../../../firestore.rules#L131)).
Un brouillon **non** réglé reste librement éditable (flux caissier normal préservé).
Preuve→non-régression : `tests/firestore/drafts.core-fields-freeze.rules.test.js` (FREEZE-01/02
d'abord `assertSucceeds` = trou, puis `assertFails` = fermé) + `deleteField()` et sous-champ
imbriqué couverts. **Suite de règles : 355 verts.**

Défense en profondeur restante (différée, à repenser en P0) : ne plus jamais faire confiance au
draft — recalculer `remaining`/`paid` (et valider `type` constant) depuis le registre immuable
`drafts/{id}/settlements` (write:false) côté callable.

### 1.1 ÉLEVÉ — Écriture financière directe par la boutique, sans piste d'audit (héritage V1)

**Vérifié par lecture directe des règles.** `firestore.rules:386-391` autorise tout membre de
boutique à **créer/écraser directement** `networkBalances/current`. La validation est uniquement
**structurelle** (entiers sûrs ≥ 0, clés réseau figées) — aucune validation métier. Un compte
boutique compromis peut donc fixer ses soldes à une valeur arbitraire **sans laisser de trace**
(contrairement au circuit dealer où chaque mouvement passe par une Cloud Function avec audit log).

Même logique : `src/services/historyService.js:90-139` (`deleteFromHistory`) inverse les soldes
**côté client** lors d'une annulation (transaction atomique, statut « Annulée » conservé — la
trace de l'annulation existe, mais la voie d'écrasement direct des soldes, elle, n'en laisse pas).

C'est un **héritage V1 (boutique)** qui cohabite avec le modèle V2 (serveur autoritaire).
L'exception n'est documentée nulle part, et contredit la règle projet « toute opération
financière doit préserver une piste d'audit ».

**Décision retenue (court terme)** : documenter l'exception (fait, ce document + commentaire de
règles). **Moyen terme** : basculer ces écritures vers une Cloud Function auditée — chantier
séparé à décider lors de la mise en place du nouveau projet Firebase (impacte draftService,
historyService et le mode hors ligne).

### 1.2 MOYEN — Constats « par conception » à acter

- **Le dealer lit les soldes de toutes les boutiques** via collectionGroup
  (`firestore.rules:416-418`). Intentionnel et commenté dans les règles ; exposition
  d'information acceptée pour le métier (le dealer cible ses ravitaillements).
- **`replenishDealerInventory` est déclaratif** : le dealer déclare ses achats fournisseur sans
  justificatif (`functions/src/storeTransfers/replenishDealerInventory.js`). Circuit de
  confiance, chaque crédit tracé dans les audit logs (`DEALER_INVENTORY_REPLENISHED`). Le
  contrôle des achats réels relève de l'audit métier externe, pas de l'application.

### 1.3 FAIBLE

- ~~Les messages d'erreur d'idempotence **révèlent les montants** de la tentative précédente~~
  **CORRIGÉ** (`addTransactionPayment.js`, `addTransactionRefund.js`) : message client désormais
  générique, sans montants ni méthode. **Correction du correctif** (suite à la contre-revue qui a
  montré que `wrapCallable` ne journalise PAS les `DealerRequestError`) : le détail est désormais
  **journalisé côté serveur** via `writeSafeAuditLog` (`event: SETTLEMENT_IDEMPOTENCY_CONFLICT`)
  → diagnostic préservé, aucune fuite client. **M2 (2e contre-revue)** : le log était appelé
  DANS la transaction (doublons possibles sur retry de contention) → il est désormais **capturé
  dans la transaction et émis une seule fois hors transaction** (bloc `catch`). **Émission unique
  désormais couverte par test** (`tc-060-settlement-handlers` TC-060-L : `logWriter` espion,
  `toHaveBeenCalledTimes(1)` y compris sur rejeu de transaction ; aucun log sur succès/idempotent).
- Pas de rate-limiting applicatif sur la création de demandes dealer (quotas Firestore seuls).

### 1.3ter Chantiers OUVERTS (non acceptés définitivement — à repriorer)

- ~~**M1 (MOYEN)** — `history/create` n'applique PAS le verrou des champs de règlement~~
  **CORRIGÉ** (durcissement de règle, sans changer le flux legacy). Constat : la règle
  `history/create` ne validait que `type/montant/clientId` + statut ; un membre pouvait forger
  `paidAmount`/`settlementStatus`/`settlementSummary`/… dans un doc `history` terminal (corruption
  des rapports ; **blanchiment d'annulation** — `reverseHistoryTransactionImpact`
  [financialImpact.js:432](../../../src/utils/financialImpact.js#L432) recrédite les soldes à partir
  de `settlementSummary.netByNetwork`). Correctif : `validClientHistorySettlement` (firestore.rules)
  impose la forme légitime unique (`settlementStatus=='settled'`, `remaining/refunded==0`,
  `originalAmount==montant`, `paid==settlementAmount` entiers>0, **aucun `settlementSummary`** côté
  client — réservé à l'Admin SDK qui contourne les règles). Preuve+non-régression :
  `tests/firestore/history.create-settlement-lock.rules.test.js` (11 tests : rouge → 6 forges
  refusées après correctif ; formes légitimes, override>montant et cross-store préservés).
  **Rappel** : effet réel uniquement après **déploiement** des règles (à la main de l'utilisateur).
- **networkBalances direct** (§1.1) et **App Check** (§1.3bis) : **ne doivent pas être considérés
  comme acceptés définitivement** ; ce sont des chantiers P0/P1 avec propriétaire/date à fixer.
- ~~**Défense en profondeur draft** : recompute serveur depuis le ledger immuable (cf. §1.0-bis).~~
  **CORRIGÉ** : le type métier est désormais **épinglé** dès la 1re tranche dans un champ serveur
  immuable `settlementType` (ajouté à `settlementManagedFields` → verrouillé côté règles, écrit
  uniquement par l'Admin SDK). Les callables lisent `draft.settlementType ?? draft.type` pour
  déterminer le signe de l'impact réseau : même si le gel des règles était contourné et `draft.type`
  falsifié entre deux tranches, le signe reste stable. Preuve : `tc-060` TC-060-M (draft.type=Dépôt
  falsifié + settlementType=Retrait → impact reste un débit ; propagé dans `history`).

### 1.3quater Alignements complémentaires (2e vague — traités)

- ~~**`clientId` mutable** sur un draft en cours de règlement (intégrité de l'attribution dans la
  piste d'audit settlement/history)~~ **CORRIGÉ** : `draftCoreFieldsFrozenIfSettling` fige aussi
  `clientId` dès qu'un règlement est engagé (avant tout règlement, la correction du titulaire reste
  libre). Tests règles : `drafts.core-fields-freeze` FREEZE-07 (réattribution refusée) / FREEZE-08
  (correction sur draft non réglé autorisée).
- ~~**Régression UX du bouton « Modifier »** : l'UI proposait encore d'éditer un draft en cours de
  règlement, or les règles le refusent désormais~~ **CORRIGÉ** : `getActionButtons`
  ([src/context/transactions.jsx](../../../src/context/transactions.jsx)) masque `modifier` quand
  `isDraftSettling(transaction)` ([src/utils/helpers.js](../../../src/utils/helpers.js)) — miroir
  applicatif du helper de règles `draftIsSettling`. Les tranches restent accessibles via
  Encaisser/Payer/Rembourser.

### 1.3bis ÉLEVÉ — App Check absent (remonté par contre-revue)

Toutes les callables sont publiées avec `enforceAppCheck: false`
([functions/src/index.js:39+](../../../functions/src/index.js#L39)) : au-delà de l'auth, aucune
attestation d'app. Un jeton volé ou un client automatisé peut solliciter les opérations sans
protection additionnelle. **Décision** : activer App Check en **mode monitor** (mesure sans
blocage) sur le client web, puis **basculer `enforceAppCheck: true`** une fois le trafic validé,
avec plafonds métier par opération + alertes. Chantier phasé, propriétaire/date à fixer.
- Le logging « sûr » des functions masque volontairement les stack traces — le debug prod passe
  par Cloud Logging (observation opérationnelle, pas un défaut).

### 1.4 Points forts confirmés

- Rôles vérifiés côté serveur via profils Firestore **relus dans la transaction** (protection
  contre la désactivation concurrente d'un compte).
- `dealerBalances`, `settlements`, `dealerClosures` : **aucun accès en écriture client**
  (règles `allow write: if false`), tout passe par les callables.
- `history` : `delete: if false` ; update limité à `['statut', 'updatedAt', 'notes']`
  (`firestore.rules:373-376`).
- Validation de payload côté functions robuste (`validateInputPayload` : refus des prototypes
  non standards, des clés symboles, des clés hors liste blanche).

---

## 2. Duplication de code (~400-500 lignes)

| # | Duplication | Emplacements | Risque |
|---|---|---|---|
| 1 | **Moteur financier front/back** : ~6 fonctions dupliquées (`normalizeNetworkBalances`, `mapPaymentMethodToNetwork`, `applySettlementImpact`, `applyLiquidityDelta`, `adjustBalanceValue`…) | `src/utils/financialImpact.js` (493 l.) vs `functions/src/settlements/financialUtils.js` (175 l.) | **Élevé** — divergence déjà amorcée : le front valide les montants (`validateFcfaAmount`), la version functions suppose la validation faite en amont. Duplication assumée en en-tête de fichier mais sans test de parité automatique. → verrouillée par le test tc-081. |
| 2 | **Helpers functions clonés entre modules** : `validateAuthUid`, lecture de soldes (`readCurrentBalance` vs `readBalanceAmount`), validation de profils (`validateProfileData` store_admin vs `validateDealerProfile` dealer — rôles différents par conception mais structure clonée) | `functions/src/dealerRequests/shared.js` vs `functions/src/storeTransfers/shared.js` | Moyen |
| 3 | **Parsing de montant réimplémenté ≥ 3 fois** : `parseDealerAmount` (`dealerService.js:68`), `parseAmountLocal` (`storeTransferService.js:78`), `validateAmount` inline (`NewDealerRequest.jsx:14`) — même regex | 3 copies front (+ validations functions distinctes, légitimes) | Moyen |
| 4 | **`formatDate` copié dans ~8 pages** admin/dealer (AdminDashboard, AdminDealer, AdminDealerInventory, AdminHistory, DealerDashboard, DealerHistory, DealerRequests, DealerTransfers) | ~45 lignes | Faible mais symptomatique |
| 5 | **Labels/styles de statuts redéfinis inline** dans plusieurs pages alors que `src/constants/dealerConstants.js` les centralise (importé par une seule page, DealerHistory) ; styles déjà divergents (amber vs yellow pour « pending ») | Pages admin + dealer | Moyen — UX incohérente |
| 6 | **`StatusBadge` recréé localement dans 3 pages** alors que `src/components/ui/StatusBadge.jsx` existe | DealerRequests, StoreAdminDealerRequests(+Details) | Faible |
| 7 | **5 mappers d'erreurs distincts** (`mapErr`, `mapFirestoreError` ×2, `mapTransferError`, `mapCallableError`) + 2 tables `ERROR_MESSAGES`. **Revu au Lot 2.3 : ce n'est PAS de la vraie duplication.** Après lecture, les messages sont **tailorés au contexte** (lecture dealer vs lecture demandes store-admin vs transferts vs commandes) : p. ex. permission-denied → « Accès refusé… » (dealer) vs « Vous n'avez pas l'autorisation d'accéder à ces demandes » (store-admin). Les fusionner **changerait le texte d'erreur vu par le client** sans gain réel. **Laissé intentionnellement séparé.** Seul le *pattern* structurel se répète — non factorisable sans reparamétrer tous les messages. | 5 services | Faible (revu → non-défaut) |
| 8 | **Pagination incohérente** : 20 (constantes dealerConstants) vs 25 en dur (adminService, closureService) | — | Faible |

---

## 3. Qualité du code

### 3.1 Ce qui est bon

- **Aucune requête Firestore dans les composants React** — tout passe par les services.
  Séparation des préoccupations respectée sur l'ensemble du périmètre.
- Cleanup des `onSnapshot` correct (unsubscribe retourné et appelé), flags `cancelled` contre
  les setState après unmount, keys stables dans les listes, `useMemo`/`useCallback` employés à
  bon escient, pas de TODO/FIXME abandonnés, toasts systématiques sur les actions.

### 3.2 Ce qui pose problème

- **`src/pages/dealer/DealerRequests.jsx` (434 l.)** : orchestration temps réel + pagination à
  curseurs, 8 useState + 3 useRef et gardes de génération — le fichier le plus fragile du
  périmètre, sans aucun test. → tc-080.
- **`src/pages/admin/AdminReports.jsx:42-82`** : `aggregate()` = logique métier pure
  (statistiques financières) écrite dans le composant au lieu d'un service. → tc-079.
- ~~**`src/components/dealer/DealerInventoryBar.jsx`** : double verrou anti double-clic
  (ref + state) redondant.~~ **Revu : ce n'est PAS redondant.** `submittingRef` est un verrou
  *synchrone* qui bloque une double-soumission dans le même tick (avant que `disabled` ne prenne
  effet au re-render) — défense en profondeur légitime pour un appel de Cloud Function financier.
  Conservé, commentaire d'intention clarifié.
- `window.location.reload()` comme bouton « réessayer » (`DealerTransfers.jsx:84`) — perd
  l'état de l'UI.
- 7 `eslint-disable react-hooks/exhaustive-deps` (AdminHistory, AdminClients,
  AdminDealerInventory, AdminStores, AdminDealer, AdminUsers, DealerHistory) — **revus :
  même pattern intentionnel** (un `useEffect` appelle `load(true)` sur changement de filtre en
  excluant volontairement `lastDoc` des deps, sinon la pagination se re-déclenche). Modifier les
  deps casserait la pagination → laissés en l'état. Amélioration optionnelle : ajouter un
  commentaire de justification à chaque site.
- **`src/pages/admin/AdminHome.jsx`** : non importé par App.jsx (`/admin` → `AdminDashboard`), mais
  **référencé par le scaffolding de tests** (`vi.mock` dans tc-028 et tc-043). Suppression
  **non recommandée** : casserait la résolution de ces mocks pour un gain nul. Laissé en place
  (conforme au protocole de suppression CLAUDE.md — ne pas supprimer sur la seule foi d'un outil).

### 3.3 Le trou principal : la couverture de tests

| Zone | Couverture |
|---|---|
| Cloud Functions dealer/settlements | ✅ Bien testées (tc-035/044/045/061/067/069/070/072 + tests de règles émulateur) |
| dealerService / services de commandes | 🟡 Partielle (tc-030/032/034/038) |
| `adminService.js` (526 l.) | ❌ 0 test |
| 9 pages admin + 7 pages dealer + 2 layouts + composants dealer | ❌ 0 test |

≈ **15 % de couverture** sur le périmètre dealer/admin contre ≈ 80 % côté boutique. Le risque
n'est pas tant l'état actuel (les flux critiques s'appuient sur des functions testées) que
**toute modification future du front** — dont le chantier multi-réseaux à venir.

---

## 4. Priorités de remédiation

1. **P1 — Filet de tests de caractérisation** : tc-078 (adminService), tc-079
   (AdminReports.aggregate), tc-080 (orchestration DealerRequests), tc-081 (parité
   financialImpact ↔ financialUtils).
2. **P2 — Centralisation sans changement de comportement** : `src/utils/formatters.js`
   (formatDate), imports systématiques de dealerConstants + StatusBadge commun, mapping
   d'erreurs unique (`mapServiceError`), parseur de montant unique, constantes de pagination.
3. **P3 — Décision architecturale** sur l'écriture directe `networkBalances` (documentée ici ;
   bascule en Cloud Function auditée = chantier séparé) + anonymisation des erreurs d'idempotence.
4. **P4 — Nettoyages** : reload() → retry local, ref+state redondant, eslint-disable.
   (AdminHome.jsx : suppression écartée, voir Qualité §3.2.)

---

## 5. Lien avec le chantier « nouveau client »

Le chantier multi-réseaux (voir `docs/adaptation-nouveau-client.md`) touchera précisément les
fichiers les plus dupliqués/les moins testés de ce périmètre (pages dealer, storeTransfers,
constantes). **Ordre recommandé : P1 puis P2 avant la réactivation multi-réseaux**, pour lever
les brides sur une base dédupliquée et couverte par les tests.

---

## 6. Faux positifs écartés pendant l'audit

Deux constats remontés par l'analyse automatique ont été **invalidés par contre-vérification**
et ne figurent pas dans ce bilan :

- « `getNetworkBalanceDocRef` est du code mort » — **faux** : la méthode est utilisée par
  balanceService, draftService et historyService (délégation via `_ctx`).
- « AdminProfile.jsx et DealerProfile.jsx ne sont pas routés » — **faux** : routes
  `/admin/profile` et `/dealer/profile` présentes dans `src/App.jsx:138` et `:155`.
  Seul `AdminHome.jsx` est réellement non routé.
