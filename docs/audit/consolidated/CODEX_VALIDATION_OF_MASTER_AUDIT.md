# Validation Codex du MASTER_AUDIT

Date : 2026-06-17

Périmètre : validation documentaire et vérification directe en lecture seule des findings CRITIQUE / ÉLEVÉ du `MASTER_AUDIT.md`.

Sous-agent explicitement utilisé : `reviewer` (`Sentinel`, id `019ed658-2785-7163-940e-0a29bcb06046`). Son verdict indépendant est intégré : **ACCEPTABLE SOUS CONDITIONS**.

Garanties de cette validation : aucun fichier source modifié, aucun script administratif lancé, aucun test/build/lint lancé, aucun accès Firebase production, aucun déploiement, aucun commit, aucun push.

---

## 1. Synthèse

Le `MASTER_AUDIT.md` consolide correctement l'essentiel des quatre rapports sources :

- `docs/audit/claude/CLAUDE_AUDIT.md`
- `docs/audit/codex/CODEX_AUDIT.md`
- `docs/audit/consolidated/CLAUDE_REVIEW_OF_CODEX.md`
- `docs/audit/consolidated/CODEX_REVIEW_OF_CLAUDE.md`

Aucun finding critique ou élevé majeur n'a été totalement perdu lors de la fusion. Les preuves principales correspondent au code pour les risques de sécurité et d'intégrité financière les plus importants.

Le document ne peut toutefois pas être validé sans conditions, car plusieurs points documentaires doivent être renforcés avant d'en faire une base de stabilisation V2 : couverture incomplète des scripts Admin, séparation trop compacte de deux sous-lots du Lot 3, formulation de rollback potentiellement dangereuse, et critères V2 encore trop peu mesurables sur certains axes.

Verdict unique : **ACCEPTABLE SOUS CONDITIONS**.

---

## 2. Findings critiques et élevés correctement consolidés

### MASTER-SEC-001

Statut : correctement consolidé.

Preuve code : `firestore.rules:87-92` autorise la création de `users/{userId}` avec `storeId is string`, sans vérifier l'existence de `stores/{storeId}` ni `adminUid`. `firestore.rules:20-22` fait ensuite confiance à `profile().storeId` dans `isStoreMember(storeId)`.

Évaluation : sévérité CRITIQUE cohérente.

### MASTER-SEC-002

Statut : correctement consolidé.

Preuve code : `firestore.rules:98` autorise `globalClients.read` à tout profil actif ; `firestore.rules:104-108` autorise `update/delete` sans vérifier `resource.data.registeredStoreId == profile().storeId`.

Évaluation : sévérité CRITIQUE cohérente. Le MASTER consolide bien le fait que Claude ne couvrait que le `read` et que Codex ajoutait `update/delete`.

### MASTER-SEC-003

Statut : correctement consolidé.

Preuve code : `firestore.rules:134` autorise `history.delete`, `firestore.rules:151` interdit l'écriture client dans `auditLogs`, `src/context/transactions.jsx:184-194` route la suppression vers `deleteFromHistory`, et `src/services/firestore.js:1098-1100` supprime sans journalisation.

Évaluation : sévérité CRITIQUE cohérente, car la règle projet impose une piste d'audit pour toute opération financière.

### MASTER-SEC-004

Statut : correctement consolidé.

Preuve code : `src/services/firestore.js:1098-1100` appelle uniquement `deleteDocument(HISTORY, historyId)`, sans compensation des soldes. Le MASTER le distingue correctement de la perte de piste d'audit.

Évaluation : sévérité ÉLEVÉ cohérente.

### MASTER-SEC-005

Statut : correctement consolidé comme décision métier à trancher.

Preuve code : `src/context/AuthContext.jsx:107` crée un compte Auth, `src/context/AuthContext.jsx:131-134` écrit `stores/{storeId}` et `users/{uid}`, `src/components/auth/SignInForm.jsx:152-160` expose "Créer un compte boutique", et `firestore.rules:71-76` autorise `stores.create`.

Évaluation : sévérité ÉLEVÉ cohérente si l'auto-enrôlement public n'est pas une exigence métier explicite. Le lien avec MASTER-SEC-001 est correctement décrit.

### MASTER-SEC-006

Statut : correctement consolidé.

Preuve code : `firestore.rules:139-141` ne valide que `request.resource.data.balances is map`. `src/components/network/NetworkCard.jsx:52-60` expose une sauvegarde UI des soldes, et `src/services/firestore.js:825-844` écrit `networkBalances/current`.

Évaluation : sévérité ÉLEVÉ / moyen-élevé cohérente à condition de séparer décision métier et vulnérabilité technique.

### MASTER-SEC-007

Statut : correctement consolidé.

Preuve code : `firestore.rules:37` accepte des types corrompus, et `firestore.rules:48-67` accepte des statuts corrompus.

Évaluation : sévérité ÉLEVÉ pour les types et MOYEN pour les statuts cohérente. Le MASTER protège correctement la correction par D7.

### MASTER-PERF-001

Statut : correctement consolidé.

Preuve code : `src/services/firestore.js:1102-1107` construit `queryOptions` sans borne pour l'historique ; le MASTER cite aussi le comportement sans limite par défaut.

Évaluation : sévérité ÉLEVÉ cohérente pour une application client réelle avec coûts et latence croissants.

### MASTER-QUA-001

Statut : correctement consolidé.

Preuve code : `package.json:6-20` ne contient aucun script `test`, et aucune dépendance de test Firestore n'est déclarée. Le MASTER le positionne correctement comme prérequis bloquant Lot 0.

Évaluation : sévérité ÉLEVÉ comme prérequis V2 cohérente.

---

## 3. Problèmes documentaires relevés

### DOC-001

Sévérité : ÉLEVÉE

Section du MASTER_AUDIT concernée : `MASTER-SEC-009` et critères V2 liés aux scripts Admin.

Preuve :

- `MASTER_AUDIT.md:224-244` cite `deleteExistingAccounts.mjs`, `seedStores.mjs` et `updateAccountPassword.mjs`, mais parle d'un risque plus large sur les scripts Firebase Admin.
- `package.json:12-19` expose aussi `account:diagnose`, `account:reset-link`, `account:create-temp-access`.
- `scripts/createTemporaryStoreAccess.mjs:21-26` initialise Admin, puis `scripts/createTemporaryStoreAccess.mjs:48-77` modifie/crée un utilisateur Auth et écrit `users/{uid}`.
- `scripts/generatePasswordResetLink.mjs:20-24` initialise Admin et génère un lien de réinitialisation sensible.
- `scripts/diagnoseAccount.mjs:34-39` initialise Admin et lit Auth/Firestore.

Problème : le MASTER dit consolider le risque des scripts Admin, mais la preuve et le classement ne couvrent pas explicitement tous les scripts capables d'agir sur le projet pointé par les credentials.

Modification documentaire recommandée : étendre `MASTER-SEC-009` à tous les scripts Admin détectés par recherche `firebase-admin`, avec sous-classement : suppression massive, création/modification d'accès, mot de passe/reset link, seed, diagnostic lecture seule. Les scripts d'accès et de mot de passe doivent être classés ÉLEVÉS ou explicitement justifiés s'ils restent MOYENS.

### DOC-002

Sévérité : MOYENNE

Section du MASTER_AUDIT concernée : sections 6 et 7, Lot 3.

Preuve :

- `MASTER_AUDIT.md:559` regroupe schéma `networkBalances` et encodage dans le Lot 3.
- `MASTER_AUDIT.md:598-605` confirme que le Lot 3 porte à la fois un sous-lot A `networkBalances` et un sous-lot B encodage.
- `MASTER_AUDIT.md:676` reconnaît que l'encodage peut bloquer des `update` si des données corrompues existent.

Problème : le regroupement est compréhensible, mais ces deux corrections n'ont pas le même risque métier ni le même rollback. Un lecteur pressé pourrait les traiter comme un seul lot.

Modification documentaire recommandée : renommer explicitement en `Lot 3A - Schéma networkBalances` et `Lot 3B - Encodage des règles`, avec tests, prérequis D4/D7 et rollback séparés. Préciser qu'ils ne doivent pas être mélangés dans un même commit.

### DOC-003

Sévérité : MOYENNE

Section du MASTER_AUDIT concernée : section 9, stratégie de retour arrière.

Preuve :

- `MASTER_AUDIT.md:676` recommande de revenir au `firestore.rules` précédent par `git revert` / `git checkout` du fichier.
- `AGENTS.md:7-16` interdit les opérations dangereuses et impose un processus strict sur une application utilisée par un client réel.

Problème : la mention de `git checkout` sur fichier est dangereuse dans un worktree potentiellement sale, car elle peut écraser des changements locaux non liés.

Modification documentaire recommandée : remplacer la formulation par "commit local atomique de référence, puis `git revert` ciblé". Ajouter qu'aucun `git checkout` / `git restore` destructif ne doit être utilisé sans validation explicite, vérification du diff et confirmation qu'aucun changement utilisateur non lié ne sera écrasé.

### DOC-004

Sévérité : MOYENNE

Section du MASTER_AUDIT concernée : section 10, critères de passage à la V2.

Preuve :

- `MASTER_AUDIT.md:684-693` donne une liste go/no-go pertinente, mais certains critères restent qualitatifs : "encadrée selon D4", "bornée/paginée", "modèle multi-tenant documenté et aligné".
- `MASTER_AUDIT.md:663-666` propose des mesures de performance, mais la section go/no-go ne fixe pas de seuil ou de dataset minimal.

Problème : les critères sont globalement mesurables pour les règles Firestore, mais pas assez opérationnels pour performance, documentation multi-tenant, scripts Admin et audit financier.

Modification documentaire recommandée : ajouter des seuils ou artefacts vérifiables : commande de test exacte, nombre minimal de cas A/B, dataset performance minimal, preuve `rg firebase-admin src` vide, liste exhaustive des scripts Admin protégés, document de décision D1-D8 signé/daté, et preuve d'audit log ou de refus de suppression financière.

### DOC-005

Sévérité : FAIBLE à MOYENNE

Section du MASTER_AUDIT concernée : `MASTER-SEC-010`.

Preuve :

- `MASTER_AUDIT.md:247-260` classe `firebase-admin` en `dependencies` comme ÉLEVÉ mais précise "risque potentiel, pas faille active".
- `package.json:21-24` confirme `firebase-admin` en `dependencies`.
- La recherche `rg firebase-admin src` ne retourne aucun import client actif.

Problème : la nuance est présente, mais doit rester visible dans la matrice et les critères V2 afin d'éviter de traiter ce point comme une vulnérabilité active au même niveau que les règles Firestore.

Modification documentaire recommandée : conserver la sévérité ÉLEVÉ seulement sous la forme "hygiène préventive : faible probabilité / fort impact". Éviter tout libellé qui suggère une fuite active dans le bundle tant qu'aucun import `src/` n'existe.

---

## 4. Séparation métier / vulnérabilités techniques

La séparation est globalement claire dans `MASTER_AUDIT.md:533-548`.

Points à renforcer :

- `globalClients.read` peut relever d'une décision métier de partage réseau ; `globalClients.update/delete` reste une vulnérabilité technique même si la lecture partagée est voulue.
- L'édition manuelle de `networkBalances` peut être métier ; l'absence de schéma, de rôle et d'audit est technique.
- L'auto-enrôlement public peut être métier ; combiné à `users.storeId` arbitraire, il devient un amplificateur d'exploitation.
- La suppression d'historique validé ne doit pas être traitée comme simple préférence métier : l'absence de piste d'audit est une violation technique et documentaire du projet.

---

## 5. Ordre des lots et Lot 0

L'ordre `Lot 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7` est sûr dans son principe.

Le Lot 0 protège suffisamment les corrections futures si les tests couvrent réellement :

- deux boutiques A/B et deux utilisateurs ;
- création frauduleuse de profil `storeId=A` par utilisateur B ;
- `globalClients.read/update/delete` inter-boutiques ;
- suppression d'historique et absence de trace ;
- cohérence `networkBalances` avant/après suppression ou annulation ;
- schéma `networkBalances` ;
- `useDashboardData` avant pagination.

Réserve : le MASTER doit rendre plus explicite que le Lot 3 est composé de deux sous-lots indépendants, et que le Lot 5 ne doit pas mélanger refactor de calcul et durcissement Admin dans un seul changement.

---

## 6. Stratégies de retour arrière

Les stratégies sont réalistes si elles reposent sur des commits locaux atomiques et des tests de caractérisation.

Réserve obligatoire : retirer la mention de `git checkout` comme option normale de rollback. Dans ce projet, le retour arrière doit privilégier `git revert` ciblé de commits locaux, après inspection du diff et sans écraser les changements utilisateur.

---

## 7. Corrections dangereuses ou destructives

Aucune correction dangereuse ou destructive n'est proposée comme action immédiate dans le MASTER.

Points positifs :

- le document interdit implicitement de supprimer du code mort sans preuve complète ;
- il ne propose pas de lancer `deleteExistingAccounts --execute` ;
- il recommande les émulateurs et les tests avant modification de règles ;
- il sépare globalement refactor, règles et décisions métier.

Réserve : `MASTER-SEC-009` doit mieux documenter tous les scripts Admin sensibles afin de ne pas laisser un faux sentiment de couverture.

---

## 8. Confirmation de périmètre

Fichier créé par cette mission :

- `docs/audit/consolidated/CODEX_VALIDATION_OF_MASTER_AUDIT.md`

Aucun fichier source n'a été modifié.

Aucun commit n'a été effectué.

---

## Verdict

**ACCEPTABLE SOUS CONDITIONS**

Conditions documentaires avant validation complète :

1. Étendre `MASTER-SEC-009` à tous les scripts Admin réellement présents.
2. Reclasser explicitement les scripts d'accès/mot de passe comme risques élevés ou justifier leur classement.
3. Séparer `networkBalances` et encodage en sous-lots indépendants.
4. Remplacer la recommandation de rollback par `git revert` ciblé et éviter `git checkout` destructif.
5. Rendre les critères V2 plus mesurables sur performance, scripts Admin, audit financier et décisions métier.
