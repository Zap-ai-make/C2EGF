# Reprise après la simplification du démarrage C2EGF

Ce document fixe le point de reprise du chantier d'audit interrompu le 29 septembre 2026
pour simplifier l'interface destinée aux caissières des cinq franchises pilotes.

## Point d'arrêt

- Branche locale : `codex/audit-history-aggregation`.
- Derniers commits terminés :
  - `10eea94` — décisions de collaboration partagées ;
  - `2f024a6` — bilan correspondant.
- Lots critiques et importants du bilan : terminés et vérifiés.
- QUA-04 : 21 sous-lots terminés ; mesure résiduelle de 25 fenêtres identiques.

## Chantiers de code restant à examiner

1. `AdminDealer.jsx` / `AdminUsers.jsx` — structure d'interface commune (3 fenêtres).
2. `dealerService.js` / `storeTransferService.js` — accès aux données similaires (3 fenêtres).
3. `DealerInventoryBar.jsx` / `DealerTransferForm.jsx` / `DealerTransfers.jsx` — présentation
   de l'inventaire et des réseaux (2 fenêtres par paire principale).
4. `findClient.mjs` / `inspectPath.mjs` — initialisation commune possible de deux scripts de
   diagnostic en lecture seule (3 fenêtres).
5. QUA-05 — réduire progressivement les responsabilités de `firestore.js`,
   `CollaborationsPanel`, `TransactionForm` et `StoreAdminDealerRequestDetails`, uniquement
   lorsqu'un besoin testable justifie chaque extraction.
6. Cohérence visuelle — remplacer progressivement les couleurs vertes/grises encore codées en
   dur dans certaines pages administrateur par les tokens C2EGF, avec matrice visuelle dédiée.

## Ressemblances à conserver ou à traiter avec prudence

- `functions/src/settlements/financialUtils.js` / `src/utils/financialImpact.js` : duplication
  volontaire entre les bundles Functions et navigateur, protégée par un test de parité.
- `resetDataToZero.mjs` / `restoreFromBackup.mjs` : scripts destructifs dont les politiques et
  verrous doivent rester distincts.
- `resolveAndAssertAdminProject.mjs` / `resolveServiceAccountProject.mjs` : responsabilités de
  sécurité différentes malgré des lignes communes.

## Données et performance conditionnelles

- Recenser et normaliser les historiques réels dépourvus de `createdAt` avant d'activer les
  requêtes ordonnées sur un ancien jeu de données.
- Mesurer le volume parcouru par `listOutstandingDrafts` ; matérialiser l'agrégat dealer avec
  reprise et backfill seulement si les mesures montrent un coût significatif.

## Validation humaine de l'environnement réel

- App Check et limitation par acteur sur les commandes sensibles.
- CORS, règles Auth, MFA, durée et révocation des sessions.
- Sauvegardes automatiques, PITR et preuve de restauration.
- IAM, alertes, quotas et en-têtes HTTP/CSP réellement servis.

Ces opérations distantes restent hors du périmètre d'un agent : aucun déploiement, accès aux
données réelles ou script administrateur destructif ne doit être lancé pour reprendre ce backlog.
