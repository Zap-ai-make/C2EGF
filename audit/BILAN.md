# Audit C2EGF BURKINA — 14–15 septembre 2026

## Synthèse

**La base a un vrai socle de qualité. Depuis le lot critique du 16 septembre 2026, le serveur protège aussi les écritures financières du circuit boutique.** Les circuits dealer, collaborations et règlements disposaient déjà de validations, de transactions atomiques et de nombreux tests. Les écritures directes de soldes, brouillons et historiques boutique sont désormais fermées ; une commande serveur atomique applique les mouvements et leur audit.

Trois constats étaient classés **CRITIQUES** : soldes boutique arbitraires sans audit, auto-enrôlement donnant accès au fichier clients global, et suppression/recréation de brouillons partiellement réglés. Ils ont été corrigés et leurs six reproductions sur émulateur sont devenues des assertions de refus. Aucune exploitation d'un système distant n'a été effectuée.

Deux défauts fonctionnels concrets ont ensuite été fermés : l'historique de collaboration est désormais visible par la requête filtrée de la boutique, et les quatre commandes de mouvement dealer résistent aux répétitions réseau grâce à une clé d'intention atomique.

**La meilleure évolution est progressive : rendre le serveur seul responsable des mouvements financiers, terminer le pilotage par profil, puis simplifier les couches existantes.** Une réécriture globale ou une migration massive vers TypeScript n'est pas justifiée par cet audit.

### État de remédiation — lots 1, 3A, 3B, 3C et 3D exécutés

- **SEC-01 corrigé** : la nouvelle Function `storeTransactionCommand` relit l'acteur et la boutique, valide le profil C2EGF, puis écrit soldes, mouvement et audit dans une transaction. L'initialisation reste limitée à zéro et l'édition manuelle est refusée par le profil C2EGF.
- **SEC-02 corrigé** : `onboarding.selfRegistration` est un axe de profil. Il vaut `false` pour C2EGF ; les règles refusent l'auto-création de boutique/profil et l'interface ne propose plus l'inscription. Les accès passent par le gérant.
- **SEC-03 corrigé** : les écritures directes sur brouillons, historiques et soldes sont refusées. La suppression locale d'un brouillon portant des champs de règlement est aussi bloquée. L'annulation serveur est terminale, auditée et n'applique la contre-écriture qu'une fois.
- **BUG-01 / BUG-02 corrigés** : schéma d'historique canonique pour les collaborations et idempotence transactionnelle des mouvements dealer.
- **SEC-04 / SEC-05 corrigés** : profil C2EGF imposé au serveur et activité de la boutique exigée dans les règles et commandes sensibles.
- **SEC-06 à SEC-09 corrigés** : imports Excel bornés et validés, PII non persistées, en-têtes HTTP déclarés et environnements Firebase hors production fermés par défaut.
- **QUA-01 / BUG-04 / UI-01 corrigés** : erreurs temps réel remontées, réponses obsolètes ignorées et formulaires/modales accessibles.
- **BUG-03 / BUG-05 corrigés** : rapports exhaustifs au-delà de 500 lignes, historiques ordonnés avant pagination et journée métier calculée dans le fuseau du profil avec bascule à minuit.
- **PERF-01 / PERF-02 / QUA-02 / DOC-01 corrigés côté navigateur** : routes chargées à la demande, historique boutique limité à 100 lignes puis paginé explicitement, journée courante suivie séparément pour garder le tableau de bord exact, et agrégat « Dehors » calculé par une callable qui ne transmet plus les brouillons ni les données client au dealer. Le scan serveur de tous les brouillons reste un coût à matérialiser si le volume l'exige.
- Branches locales : `codex/audit-critical-remediation` (commit `99e25b5`), `codex/audit-important-business` (`a66250e`), `codex/audit-important-security` (`49ffeb3`), `codex/audit-important-data-ops` (`ca34881`) puis `codex/audit-history-aggregation` (`9a1bf79`). Aucun déploiement, accès à un projet réel, script administrateur destructif ou push distant.

## Périmètre, méthode et limites

- Référence Git : `b88dfbc5ad33866d829d80726b57aa7f3d6893f8` ; état de travail conservé. Des modifications dans `.claude/agents/`, ainsi que `METHODE-REFONTE-DESIGN.md` et `vercel-env.ps1`, existaient avant l'audit.
- Inventaire reproductible : **481 fichiers suivis ; 255 fichiers de code dans `src`, `functions/src`, `scripts`, `config` ; 40 638 lignes**, commentaires et lignes vides inclus. Commande : `node audit/inventory.mjs`. Détails : [INVENTORY.json](INVENTORY.json).
- Couverture : inventaire et recherches transversales sur ces domaines ; lecture approfondie des frontières de confiance, services financiers, profils, abonnements, imports, scripts administratifs et écrans concernés. Ce n'est pas une certification de lecture ligne par ligne ni un pentest de production.
- Référence méthodologique : `ADOPTION.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DESIGN.md`, documentation des profils. Les anciens audits ont été confrontés au code, pas repris comme état actuel.
- L'audit initial n'ajoutait que ses pièces de travail sous `audit/`. Les lots de remédiation validés ont ensuite modifié le produit et ses dépendances. Aucun déploiement, script admin destructif ni push distant n'a été exécuté.
- Les tests utilisent exclusivement des projets `demo-*`. Les scripts de reproduction vérifient explicitement un hôte local d'émulateur. Le navigateur de QA bloque les requêtes externes et emploie une configuration Firebase fictive.
- Gravité : **CRITIQUE** = confidentialité/intégrité du CRM directement compromise ; **IMPORTANT** = défaut substantiel ou risque exploitable sous conditions ; **MINEUR** = dette sans incident actuel établi. Effort **S/M/L** relatif, pas un devis.

### Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npm run lint` | Réussi après remédiation ; attention à son périmètre, QUA-02 |
| `npm run test:unit` | **87 fichiers, 2 423 tests réussis** |
| `npm run test:components` | **20 fichiers, 310 tests réussis** |
| Suite `vitest.firestore.config.js`, émulateur `demo-akayis-test` | **20 fichiers, 433 tests réussis** |
| Suite `vitest.functions.config.js`, émulateur `demo-akayis-test` | **12 fichiers, 304 tests réussis** |
| Suite `vitest.integration.config.js`, émulateurs `demo-akayis-test` | **2 fichiers, 42 tests réussis** |
| `npm run build` | Réussi ; bundle principal **1 206,26 kB, gzip 323,46 kB** ; chunk xlsx 499,86 kB ; précache PWA 2 451,65 KiB |
| Générateurs règles et Functions, `--client c2egf_burkina --check` | Les trois artefacts générés correspondent au profil |
| `npm run check:secrets` | Aucune signature de secret à haute confiance dans les fichiers suivis |
| `node audit/reproduce-rules.mjs` | **6 scénarios fermés** : écritures directes et auto-enrôlement refusés |
| `audit/reproduce-backend.mjs` | Preuve d'exposition initiale conservée ; fermeture vérifiée par `tc-060`, `tc-067`, `tc-070`, `tc-072` et `tc-112` |
| `node audit/scan-secrets.mjs` | **907 blobs texte Git examinés ; aucune signature détectée** |
| `node audit/visual-check.mjs` | Authentification, boutique et dealer capturés après remédiation ; vues inspectées en **1 440 px et 390 px**. Aucun lien d'auto-inscription C2EGF ne subsiste |
| `npm audit --omit=dev --audit-level=high` | **Zéro vulnérabilité connue dans le graphe de production** après mises à jour ciblées ; cela ne remplace pas les avis éditeur |

La première exécution unitaire, concurrente avec d'autres contrôles, a rencontré un timeout ; deux relances complètes passent. L'émulateur Java a d'abord échoué sur une socket locale Windows ; l'option temporaire `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=.` a permis l'exécution des suites Firestore et intégration. Le scan Git a subi un refus temporaire du contrôle d'approbation pour limite d'usage, puis a pu être exécuté après la reprise demandée.

Le scan de secrets couvre des signatures de clés privées et jetons connus dans les blobs texte atteignables de Git. Il ne couvre pas tous les mots de passe possibles, les formats inconnus, les objets Git inatteignables ou tous les fichiers locaux ignorés/non suivis. Les clés de configuration web Firebase ne sont pas assimilées à des clés privées Admin.

## 1. Sécurité et intégrité financière

### SEC-01 — Soldes boutique arbitraires, sans mouvement justificatif

**CRITIQUE · CORRIGÉ le 16 septembre 2026 · non-régression sur émulateur.**

- Localisation : [firestore.rules:549](../firestore.rules#L549), création/mise à jour à la ligne 558 ; [balanceService.js:108](../src/services/balanceService.js#L108) ; [createStoreDealerTransfer.js:67](../functions/src/storeTransfers/createStoreDealerTransfer.js#L67).
- La règle vérifie le schéma et l'appartenance à la boutique, mais pas la provenance du solde ni un mouvement lié. Un utilisateur boutique peut fixer son stock et sa liquidité à 9 000 000 sans écrire d'audit. Il peut ensuite demander un retour dealer, dont le serveur lit ce solde comme disponible. La confirmation dealer reste nécessaire : il ne s'agit pas d'un crédit automatique de son inventaire.
- `cashier.canEditBalances=false` ne protège pas cette API. La recherche de ce champ ne trouve d'ailleurs aucun consommateur dans `src` : le profil ne pilote pas réellement cette affordance, même si les écrans actuels peuvent masquer l'édition autrement.
- Correction : déplacer création, édition, annulation et initialisation des mouvements dans des commandes serveur ; y garantir soldes, autorisations et audit atomiques. Fermer ensuite les écritures directes. Ne pas simplement interdire la règle avant de migrer les appels existants.
- Test cible : édition directe refusée ; mouvement légitime accepté ; audit obligatoire ; isolation A/B ; reprise et concurrence ; initialisation à zéro.

### SEC-02 — Auto-enrôlement et accès immédiat au fichier clients global

**CRITIQUE · CORRIGÉ le 16 septembre 2026 · non-régression sur émulateur.**

- Localisation : [firestore.rules:297](../firestore.rules#L297), [firestore.rules:326](../firestore.rules#L326), [firestore.rules:341](../firestore.rules#L341), [AuthContext.jsx:129](../src/context/AuthContext.jsx#L129), `AuthSidebar.jsx` et `SignUpForm.jsx`.
- Une identité Firebase sans profil peut créer atomiquement sa boutique et son profil actif `store_admin`, puis lire `globalClients`, dont les fiches d'autres boutiques. L'interface propose cette inscription ; aucun parrainage, invitation ou validation du gérant n'est exigé par les règles. L'exploitation par un nouvel internaute dépend de l'ouverture effective de la création de comptes Auth, configuration distante non inspectée.
- Le partage du répertoire entre boutiques autorisées peut être légitime. Le problème est l'absence de contrôle d'admission au réseau, pas le partage en lui-même. Les modifications inter-boutiques de fiches ont, elles, été restreintes dans les règles actuelles.
- Correction : admission serveur par invitation/validation, état inactif par défaut, contrôle des droits de lecture après approbation. Déclarer dans le profil tout choix d'onboarding propre à un client.
- Test cible : compte Auth nouvellement créé incapable de s'accorder seul l'accès au répertoire ; boutique invitée fonctionnelle ; A ne peut pas modifier les clients de B.

### SEC-03 — Brouillon réglé supprimable/recréable ; historique réversible sans audit

**CRITIQUE · CORRIGÉ le 16 septembre 2026 · non-régression sur émulateur et tests Functions.**

- Localisation : [firestore.rules:519](../firestore.rules#L519), [firestore.rules:536](../firestore.rules#L536), [draftService.js:150](../src/services/draftService.js#L150), [historyService.js:90](../src/services/historyService.js#L90).
- Le gel des champs de règlement sur `update` est contournable : supprimer un brouillon partiellement payé est autorisé, puis le recréer au même identifiant avec un autre type, montant et client. Les sous-documents `settlements` restent présents, mais le parent a perdu sa comptabilité et sa filiation. La reproduction conserve une tranche de 40 et recrée le parent avec un autre montant/type.
- Un historique peut aussi passer de `Validée` à `Annulée`, puis revenir à `Validée`, par écritures directes de statut, sans mouvement compensatoire ni audit associé. Les transactions client utilisées dans le parcours normal ne contraignent pas un client modifié à suivre ce parcours.
- Correction : interdire la suppression des brouillons ayant engagé un règlement ; traiter les annulations au serveur avec état terminal et journal append-only. Éviter la réutilisation d'identifiants déjà réglés. Conserver les tranches et leur parent consultables.
- Test cible : supprimer/recréer un parent partiellement réglé échoue ; l'annulation autorisée ne s'applique qu'une fois et produit la contre-écriture attendue.

### SEC-04 — Profil C2EGF partiellement imposé côté serveur

**IMPORTANT · CORRIGÉ le 22 septembre 2026 · profil imposé par règles et handlers.**

- Localisation : [firestore.rules:102](../firestore.rules#L102), [firestore.rules:227](../firestore.rules#L227), [addTransactionPayment.js:30](../functions/src/settlements/addTransactionPayment.js#L30), `addTransactionRefund.js`, `config/clients/c2egf-burkina.js`.
- Les règles acceptent encore `Crédit` et des réseaux hors Orange. Les règlements utilisent une liste fixe de six méthodes. Une demande `Moov Money` est acceptée par le handler C2EGF et crédite le stock Moov, invisible dans les cartes du client. Les générateurs sont à jour : c'est leur couverture qui est incomplète, pas une dérive des fichiers générés.
- Correction : dériver types, réseaux et méthodes serveur du profil central. Prévoir explicitement le traitement des opérations historiques d'un réseau ensuite désactivé ; ne pas les rendre impossibles à solder.
- Test cible : nouvelle opération hors profil refusée sur API directe ; opérations autorisées et régularisation historique testées séparément.
- Résultat : le bloc de règles généré expose les réseaux, types et méthodes du profil C2EGF ; `validTransaction` refuse les types et réseaux désactivés. Les nouveaux paiements utilisent `STORE_PAYMENT_METHODS`. Un remboursement sur une méthode retirée reste possible uniquement si le récapitulatif historique contient encore un net suffisant sur ce réseau.

### SEC-05 — Désactiver une boutique ne révoque pas ses accès serveur

**IMPORTANT · CORRIGÉ le 22 septembre 2026 · révocation testée sur émulateur.**

- Localisation : [firestore.rules:24](../firestore.rules#L24), [firestore.rules:49](../firestore.rules#L49), [AuthContext.jsx:43](../src/context/AuthContext.jsx#L43), [dealerRequests/shared.js:173](../functions/src/dealerRequests/shared.js#L173).
- Le front vérifie `stores/{id}.active` à la connexion ; les helpers d'autorisation utilisent surtout `users/{uid}.active`. Avec une boutique inactive mais un utilisateur encore actif, une session/API directe peut toujours écrire ses soldes. Certains flux vérifient l'activité de la boutique cible, ce qui ne constitue pas une révocation globale.
- Correction : définir la sémantique de désactivation et l'imposer dans les règles et commandes sensibles, ou désactiver atomiquement tous les comptes concernés via un workflow contrôlé. Ne pas compter sur le seul blocage de l'écran de connexion.
- Test cible : token existant après désactivation, lectures et écritures A/B, règlements en cours selon politique explicite.
- Résultat : `isStoreMember` et `isStoreAdmin` exigent désormais un document boutique actif. Les commandes de transaction, règlement et transfert boutique relisent aussi cet état côté serveur. Un profil utilisateur encore actif ne conserve donc aucun accès aux données de sa boutique désactivée et ne peut plus initier de mouvement sensible.

### SEC-06 — Import Excel sur une version vulnérable et sans limite de taille

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · formats, limites et graphe npm vérifiés.**

- Localisation : `package.json` (`xlsx:^0.18.5`), version installée **0.18.5**, [excelUtils.js:341](../src/utils/excelUtils.js#L341), [excelUtils.js:384](../src/utils/excelUtils.js#L384), [historique/ActionButtons.jsx:35](../src/components/historique/ActionButtons.jsx#L35).
- Les deux imports appellent `XLSX.read()` sur le fichier fourni. La validation clients accepte extension **ou** type déclaré, sans taille maximale ; l'import historique n'applique pas cette validation. Parsing sur le thread UI et imports lancés en masse : un gros fichier peut bloquer l'interface, même sans exploiter une CVE.
- L'éditeur indique que les versions jusqu'à 0.19.2 sont affectées par une pollution de prototype et jusqu'à 0.20.1 par un ReDoS. Sources : [avis SheetJS CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533), [avis SheetJS CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363). Le chemin d'import est concerné ; un usage exclusivement export ne suffirait pas à établir le premier risque.
- Correction : choisir une version corrigée depuis une distribution officielle vérifiée, ou un remplacement ciblé ; borner taille, lignes, colonnes et volume décompressé ; valider le contenu et utiliser un worker pour le parsing si nécessaire. Ne pas lancer un `npm update` global.
- Test cible : formats valides, mauvais type réel, fichier trop gros, limites de lignes, erreur partielle, conservation des zéros initiaux. L'import historique utilise aussi `parseFloat`, à remplacer par le parseur métier après caractérisation des anciens imports.
- Résultat : SheetJS vient désormais de la distribution officielle en version 0.20.3. Les deux imports partagent la même validation : 5 Mo compressés, 50 Mo décompressés annoncés, 1 000 entrées d'archive, 1 000 lignes et 32 colonnes ; extension, MIME et signature réelle sont contrôlés avant parsing. L'import historique utilise `parseFcfaAmount` et valide toutes les lignes localement avant la première écriture ; une ligne localement invalide bloque donc le fichier entier. La vérification a aussi révélé des avis transitifs plus récents : React Router 7.18.4, Firebase 12.19.0 et deux surcharges transitives corrigées ont été appliqués séparément. `npm audit --omit=dev` retourne zéro vulnérabilité connue.

### SEC-07 — Brouillon client persistant partagé entre utilisateurs du navigateur

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · non-persistance et purge legacy testées.**

- Localisation : [ClientForm.jsx:21](../src/components/ClientForm.jsx#L21), lignes 27 et 65 ; [clientIsolation.js:15](../src/config/clientIsolation.js#L15) ; [AuthContext.jsx:213](../src/context/AuthContext.jsx#L213).
- La clé `client_form_draft` n'est préfixée que par l'instance client, pas par utilisateur/boutique. Elle conserve nom, téléphone et pièce d'identité ; la déconnexion ne la supprime pas. Sur un poste partagé, le prochain compte peut récupérer la saisie précédente. Le répertoire global ne justifie pas de partager une saisie non enregistrée.
- Correction : éviter la persistance des champs sensibles, ou isoler par compte avec durée de vie et nettoyage explicites. Examiner aussi les migrations legacy `localStorage`, qui ne portent pas d'identité d'origine vérifiée.
- Test cible : A saisit sans enregistrer, se déconnecte ; B ne récupère rien ; expiration et stockage indisponible gérés.
- Résultat : le formulaire reste uniquement en mémoire React et supprime au montage l'ancienne clé persistante. Aucun nom, téléphone ou numéro d'identité saisi n'est restauré pour le compte suivant.

### SEC-08 — Durcissement HTTP absent de la configuration Vercel

**IMPORTANT · CORRIGÉ dans la configuration le 23 septembre 2026 · site distant non déployé ni interrogé.**

- Localisation : `vercel.json`, `public/_headers`, `index.html`.
- `vercel.json` ne contient que build, sortie et rewrite. Aucun CSP ni contrôle d'encadrement n'y est défini. `_headers` porte quelques protections, mais n'est pas la configuration native d'en-têtes Vercel ; il ne faut pas présumer qu'il protège cet hébergement. La CSP manque également à cet endroit.
- Correction : configurer les en-têtes sur la cible réelle, avec les origines Firebase nécessaires et une CSP testée progressivement ; vérifier le résultat HTTP après déploiement humain. Le HTTPS/HSTS éventuellement fourni par l'hébergeur n'a pas été déclaré absent.
- Source : [configuration Vercel](https://vercel.com/docs/project-configuration/vercel-json).
- Résultat : `vercel.json` déclare CSP, HSTS, refus d'encadrement, `nosniff`, politique de référent et permissions minimales. La CSP autorise les origines Firebase nécessaires au client. Son effet distant devra être contrôlé après un déploiement humain.

### SEC-09 — Démarrage dev non fermé par défaut vis-à-vis de Firebase

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · politique fail-closed testée.**

- Localisation : [src/config/firebase.js:76](../src/config/firebase.js#L76), connexion aux émulateurs à la ligne 96.
- En dev, un flag absent/faux laisse les SDK utiliser la configuration Firebase chargée ; aucun garde n'impose `demo-*`. En build preview, `isDev` vaut faux : même le flag d'émulation ne connecte pas les SDK aux émulateurs. Le commentaire du `catch` laisse entendre qu'un émulateur absent est ignoré ; ces connecteurs ne sont pas un test de disponibilité réseau.
- Correction : mode de test explicite qui impose projet démo et hôtes locaux avant initialisation, erreur bloquante en cas d'incohérence. Distinguer preview de production et preview de QA.
- Test cible : dev/QA avec projet réel ou sans flag doit refuser de démarrer ; configuration demo valide acceptée.
- Résultat : `resolveFirebaseRuntime` bloque tout mode développement/QA sans émulateurs, tout projet ne commençant pas par `demo-` et tout hôte non local, avant l'initialisation Firebase. Les connecteurs ne masquent plus leurs erreurs. `.env.example` fournit une configuration locale cohérente et le build de production reste explicite.

### Durcissements à valider dans l'environnement réel

`functions/src/index.js:85` laisse `enforceAppCheck:false` ; aucune politique de quota par acteur n'est portée par les handlers. `maxInstances:3` borne les instances, pas les opérations autorisées ni un budget global. Prévoir App Check et limitation adaptée aux commandes sensibles après validation de la configuration client. **Ce n'est pas une preuve de contournement de l'authentification.** CORS, règles Auth, MFA, durée/révocation des sessions, sauvegardes automatiques/PITR, alertes et IAM effectifs nécessitent une vérification humaine de la configuration distante. Les scripts de backup/restauration ne prouvent pas qu'une sauvegarde planifiée fonctionne.

## 2. Défauts fonctionnels et fiabilité

### BUG-01 — La collaboration confirmée est absente de l'historique boutique

**IMPORTANT · CORRIGÉ le 22 septembre 2026 · requête réelle vérifiée sur émulateur.**

- Localisation : [confirmStoreCollaboration.js:184](../functions/src/collaborations/confirmStoreCollaboration.js#L184), [historyService.js:151](../src/services/historyService.js#L151).
- La Function écrit sous `clients/{requestingStoreId}/history` mais omet `storeId`. L'abonnement exige `where('storeId','==',activeStore.id)` : le document existe, mais la requête renvoie zéro résultat dans la reproduction.
- Correction : établir le schéma canonique d'historique et l'appliquer à cette écriture. Prévoir une reprise contrôlée des documents déjà créés. **Avant de rendre ces lignes visibles**, empêcher leur annulation financière générique : une trace de collaboration n'a pas déplacé les soldes de la demandeuse, alors que `reverseHistoryTransactionImpact` ne distingue pas `collaborationId`.
- Test cible : créer → confirmer → lire avec la requête réelle du front ; date et identité visibles ; aucune contre-écriture boutique pour une simple trace de collaboration.
- Résultat : la confirmation écrit `storeId` et `storeName`, et le test interroge réellement l'historique avec `where('storeId', '==', storeId)`. La garde serveur du lot critique refuse déjà l'annulation d'une trace portant `collaborationId`.

### BUG-02 — Reprise réseau pouvant doubler un mouvement dealer

**IMPORTANT · CORRIGÉ le 22 septembre 2026 · répétition et concurrence vérifiées.**

- Localisation : [replenishDealerInventory.js:28](../functions/src/storeTransfers/replenishDealerInventory.js#L28), `decreaseDealerInventory.js:30`, `createStoreDealerTransfer.js:29`, `createPartnerDeposit.js`.
- Une même requête d'approvisionnement de 100, appliquée deux fois, produit 200. La transaction garantit l'atomicité de chaque appel, pas l'unicité de l'intention. Si la réponse est perdue après commit, une nouvelle tentative peut doubler le mouvement. Les autres commandes citées présentent la même absence de clé à la lecture ; elles n'ont pas toutes été rejouées dynamiquement.
- Correction : identifiant stable par intention, enregistré avec acteur/payload/résultat dans la transaction. Même clé et même payload renvoient le résultat ; payload différent produit un conflit. Réutiliser le principe déjà présent pour règlements et dettes.
- Test cible : réponse perdue après commit, appels concurrents, payload modifié, nouvelle intention distincte.
- Résultat : les quatre commandes citées exigent une clé stable et écrivent un reçu atomique avec le mouvement. Une répétition identique renvoie le résultat initial, une réutilisation avec un autre payload produit `IDEMPOTENCY_CONFLICT`, et deux appels concurrents ne créent qu'un débit et une trace. Les formulaires conservent la clé après une erreur réseau tant que l'intention ne change pas.

### BUG-03 — Rapports plafonnés et historique sans ordre chronologique global

**IMPORTANT · CORRIGÉ le 24 septembre 2026 · 501 demandes et ordre des requêtes couverts.**

- Localisation : [adminService.js:369](../src/services/adminService.js#L369), ligne 450 et [ligne 524](../src/services/adminService.js#L524), [AdminReports.jsx:220](../src/pages/admin/AdminReports.jsx#L220), [ligne 313](../src/pages/admin/AdminReports.jsx#L313).
- Le rapport agrège au maximum 500 demandes. **Un avertissement existe**, mais apparaît dans le détail ; les indicateurs supérieurs présentent quand même un montant « Toutes boutiques ». Au-delà de la limite, ces indicateurs ne couvrent pas la période complète.
- Les historiques paginent sans `orderBy(createdAt)`, puis trient chaque page localement. Le tri n'est donc globalement correct qu'une fois toutes les pages chargées. La recherche est aussi limitée aux pages chargées ; `AdminHistory` l'annonce et maintient « Charger plus », ce qui évite de la qualifier de disparition silencieuse.
- Correction : agrégats serveur ou parcours paginé exhaustif pour les rapports ; ordre indexé stable avec curseur pour l'historique, après normalisation des dates legacy. Mettre l'état incomplet au niveau des totaux tant que le plafond subsiste.
- Test cible : 501+ opérations et dates volontairement décorrélées des identifiants ; comparer total et ordre attendus.
- Résultat : le rapport parcourt toutes les tranches de 500 jusqu'à épuisement et n'affiche plus de total présenté comme complet sur une tranche. Les deux historiques appliquent `orderBy(createdAt, desc)` avant le curseur ; l'index collection-group correspondant est déjà déclaré. Avant activation sur un jeu ancien réel, les documents sans `createdAt` doivent être recensés et normalisés, car Firestore les exclut d'une requête ordonnée. Aucun jeu distant n'a été lu ou migré pendant ce lot.

### BUG-04 — Une réponse ancienne peut remplacer un filtre plus récent

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · ordre inverse reproduit en test.**

- Localisation : [AdminHistory.jsx:57](../src/pages/admin/AdminHistory.jsx#L57), effets à partir de la ligne 104.
- `load` écrit `records`, curseur et état après sa promesse sans génération de requête. Si la requête A se termine après une requête B déclenchée par un nouveau filtre, les données de A peuvent s'afficher sous le filtre B. L'auth dispose déjà d'un compteur de génération pour un problème analogue.
- Correction : garde de génération/annulation, remise à zéro cohérente et pagination liée à la requête courante ; partager un petit hook seulement si plusieurs pages ont exactement le même besoin.
- Test cible : deux promesses résolues dans l'ordre inverse, puis changement de boutique pendant « Charger plus ».
- Résultat : chaque remise à zéro incrémente une génération ; seules les données, erreurs, curseurs et indicateurs de la génération active peuvent modifier l'écran. Le test résout la réponse courante avant l'ancienne et vérifie que l'ancienne reste ignorée.

### QUA-01 — Erreurs d'abonnement non transmises aux écrans

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · erreurs et timeout transmis explicitement.**

- Localisation : [firestore.js:554](../src/services/firestore.js#L554), [ClientsContext.jsx:79](../src/context/ClientsContext.jsx#L79), [transactions.jsx:92](../src/context/transactions.jsx#L92), [draftService.js:181](../src/services/draftService.js#L181), [balanceService.js:153](../src/services/balanceService.js#L153).
- Le service appelle une propriété `callback.onError` que les callbacks des contextes ne définissent pas. D'autres abonnements se contentent de logger. Un refus de permission ou une perte durable de connexion peut donc laisser un affichage vide/périmé sans état d'erreur pertinent. Le timeout du listener appelle par ailleurs `unsubscribeFromCollection(subscriptionKey)`, alors que cette méthode compare un nom de collection, pas cette clé.
- Correction : contrat explicite `{onNext,onError}` ou adoption ciblée de `resilientOnSnapshot`, déjà présent ; conserver les dernières données avec indicateur périmé, au lieu de les présenter comme actuelles.
- Test cible : snapshot refusé, reconnexion, démontage avant réponse, deuxième abonné et timeout.
- Résultat : les abonnements normalisent désormais une fonction historique ou un observateur `{onNext,onError}`. Clients, transactions, brouillons et soldes remontent les refus Firestore sans effacer les dernières données. Le timeout ferme directement la souscription identifiée par sa clé et notifie ses observateurs, au lieu d'appeler l'API par nom de collection. Les tests couvrent la propagation des erreurs des soldes et brouillons ; le démontage et le partage de listener restent couverts par les suites existantes.

### BUG-05 — Fuseau métier déclaré mais non utilisé dans plusieurs calculs

**IMPORTANT sous condition d'un poste réglé dans un autre fuseau · CORRIGÉ le 24 septembre 2026.**

- Localisation : `config/clients/_pilot.js:100`, `src/utils/formatters.js:27`, `src/hooks/useTodayTransactions.js:14`, `src/services/adminService.js:517`.
- Le profil déclare `Africa/Ouagadougou`, tandis que ces chemins utilisent le fuseau du navigateur (`toDateString`, `toLocaleDateString` sans `timeZone`, `setHours`). Près de minuit, une session sur un poste hors UTC peut classer/afficher une opération dans un autre jour métier. `useTodayTransactions` ne se réévalue pas non plus au passage de minuit si la liste reste inchangée.
- Correction : un module de dates métier alimenté par le profil, avec bornes UTC de la journée métier ; rafraîchissement temporel explicite là où l'écran reste ouvert.
- Test cible : même timestamp depuis deux fuseaux, changement de mois et passage de minuit.
- Résultat : `businessDate.js` dérive le fuseau du profil, calcule les bornes UTC y compris lors d'un changement d'heure et interprète les dates françaises stockées comme dates murales métier. Les rapports utilisent une borne de fin exclusive et le tableau de bord programme sa réévaluation au prochain minuit métier. Les formateurs partagés fixent aussi explicitement ce fuseau.

## 3. Performance, architecture et maintenance

### PERF-01 — Historique complet chargé et dédupliqué en coût quadratique

**IMPORTANT à mesure que les données croissent · CORRIGÉ côté navigateur le 24 septembre 2026 ; coût serveur résiduel documenté.**

- Localisation : `historyService.js:146`, `transactions.jsx:103`, `ClientsContext.jsx:84`, `dealerService.js:300`.
- L'abonnement historique boutique ne pose pas de limite ni période par défaut. Les contextes exécutent `filter(...findIndex(...))` sur les snapshots complets : coût O(n²), alors que les identifiants d'un snapshot Firestore sont uniques. La virtualisation du tableau réduit le DOM, pas les lectures ni ces calculs. Le dealer lit également tous les brouillons pour son rapprochement ; cet accès est une décision antérieure explicite, pas une découverte d'IDOR.
- Correction : pagination/période pour l'historique, agrégats adaptés aux tableaux de bord, `Map`/`Set` seulement là où plusieurs sources doivent réellement être fusionnées. Mesurer avec un volume réaliste avant d'ajouter une couche de cache.
- Résultat : les trois `filter(...findIndex(...))` sur snapshots uniques ont été supprimés. L'historique boutique écoute les 100 dernières lignes, expose « Charger les transactions précédentes » avec un curseur et fusionne les pages par identifiant. Une écoute limitée à la journée métier conserve les indicateurs du tableau de bord exacts au-delà de 100 opérations quotidiennes et se renouvelle à minuit. Le dealer appelle `listOutstandingDrafts` : le serveur vérifie son profil, agrège les brouillons des boutiques actives et ne renvoie que les totaux utiles ; les règles refusent désormais au dealer toute lecture directe ou `collectionGroup` des brouillons, sur deux boutiques testées. La callable parcourt encore tous les brouillons côté serveur : une vue matérialisée avec reprise/backfill serait le lot suivant si les mesures de volume montrent que ce coût devient significatif. Les historiques réels sans `createdAt` doivent toujours être recensés et normalisés avant activation, aucune donnée distante n'ayant été ouverte pendant l'audit.

### PERF-02 — Toutes les grandes routes partagent un bundle initial volumineux

**IMPORTANT pour les connexions mobiles · CORRIGÉ le 24 septembre 2026 · mesuré au build.**

- Localisation : imports statiques de `src/App.jsx`, `vite.config.js`.
- Le bundle principal minifié mesure 1 608,93 kB (429,56 kB gzip), et la PWA précache environ 2,1 MiB. `xlsx` est déjà chargé par import dynamique, bonne pratique à conserver. Les espaces admin/dealer/boutique restent importés ensemble.
- Correction : découper les routes avec `React.lazy`/`Suspense`, puis mesurer le coût réel de Recharts/Firebase et le téléchargement PWA. Vérifier le fonctionnement hors ligne avant de changer le précache ; ne pas simplement masquer l'avertissement de taille.
- Résultat : les pages boutique, admin et dealer sont chargées avec `React.lazy` sous un `Suspense` commun. Le bundle principal passe de 1 608,93 kB (429,56 kB gzip) dans la mesure initiale à 1 205,23 kB (323,23 kB gzip), soit environ 25 % de moins en taille brute. Le précache reste exhaustif (61 entrées, 2 450,09 KiB), donc les chunks de route restent disponibles hors ligne ; sa politique n'a pas été assouplie.

### QUA-02 — Les garde-fous qualité ne couvrent pas tout le dépôt

**IMPORTANT · CORRIGÉ le 24 septembre 2026.**

- Localisation : [eslint.config.js:10](../eslint.config.js#L10), `package.json`, `firebase.json`.
- Les règles ESLint recommandées ciblent `.js/.jsx`, pas `.mjs` : les scripts administratifs ne bénéficient pas de cette même analyse. `varsIgnorePattern:'^[A-Z_]'` laisse aussi passer des imports/constantes inutilisés commençant par une majuscule. Le lint ne détecte pas les fichiers inutilisés.
- Aucun hook actif de scan, pipeline `.github/.husky` ou script de porte qualité sécurité n'a été trouvé dans les chemins inspectés. Les commandes de génération `--check` existent mais ne sont pas intégrées au build ou à un `predeploy`. Des contrôles externes peuvent exister ; ils n'ont pas été inspectés.
- Correction : configuration Node pour les `.mjs`, contrôle local reproductible de secrets/dépendances/profil, puis tests de règles et build. L'outil importe moins que le contrôle effectif. Conserver un mode sans dépendance à un remote puisque ce dépôt est volontairement local.
- Résultat : ESLint couvre `.mjs` et `eslint-plugin-react` distingue les composants utilisés en JSX, ce qui a permis de retirer 19 déclarations réellement inutilisées sans réintroduire l'exception générale des majuscules. `quality:check` enchaîne artefacts générés, scan de signatures suivies, audit de dépendances, lint, tests locaux et build ; `quality:check:emulators` couvre Firestore, intégration et Functions sur `demo-*`, et `quality:check:full` réunit les deux.

### QUA-03 — Code non relié à l'application à trier avant suppression

**MINEUR · graphe d'imports et recherches croisées · effort S/M.**

L'inventaire trouve 15 modules `src` non atteignables depuis `src/main.jsx`. **Ce n'est pas une liste de 15 fichiers à supprimer.**

| Catégorie | Fichiers | Décision proposée |
|---|---|---|
| Candidats sans appelant produit trouvé | `components/historique/HistoriqueFilters.jsx`, `components/ui/WorkspaceTopbar.jsx`, `components/ui/StatCard.jsx`, `pages/admin/AdminHome.jsx`, `pages/admin/AdminStoresPlaceholder.jsx`, `utils/contextFactory.jsx` | Vérifier intention métier puis suppression par petit lot testable |
| Sous-arbres devenus inaccessibles | `components/ui/DashboardCard.jsx` → `CardHeader.jsx` ; `utils/initializeApp.jsx` → `performanceMonitor.jsx` | Vérifier les anciens usages externes/configuration ; suppression groupée seulement si confirmée |
| Compatibilité encore testée | `components/auth/ProtectedRoute.jsx` | Garder jusqu'à migration explicite des tests/consommateurs de compatibilité vers `RoleGuard` |
| Outils de QA | `src/preview.jsx` et les trois `src/preview-doubles/*` | **Conserver** : `preview.html` et `scripts/lib/banc.mjs` les utilisent hors point d'entrée production |

`listAllNetworkBalances` n'a pas d'appelant trouvé dans `src` ; sa requête suspecte et son repli `[]` ne sont donc pas présentés comme un défaut d'écran actuellement utilisé. Le vieux composant `StatCard.jsx` ne doit pas être confondu avec la fonction locale du même nom dans `AdminReports.jsx`.

Avant toute suppression : références statiques/dynamiques, scripts/configurations, usage métier, tests avant/après et possibilité de restauration par commit local, conformément à AGENTS.md. Rien n'a été supprimé.

### QUA-04 — Duplication réelle, mais plusieurs ressemblances sont intentionnelles

**MINEUR sauf divergence métier · effort S/M par lot.**

L'analyse trouve **220 fenêtres identiques de 12 lignes significatives**, qui se chevauchent : **ce n'est ni un pourcentage de duplication, ni 220 blocs distincts**. Exemples vérifiés :

- `AdminProfile.jsx:10` / `DealerProfile.jsx:10` : présentation du profil presque identique ; composant simple à paramètres suffisants.
- `ChangePasswordModal.jsx:107` / `ForgotPasswordModal.jsx:96` : coquilles dupliquées, avec les mêmes lacunes d'accessibilité. Réutiliser `Dialog` a une valeur fonctionnelle directe.
- Pagination/états dans `AdminClients`, `AdminDealer`, `AdminStores`, `AdminUsers` : extraire seulement la mécanique commune après avoir stabilisé le comportement asynchrone.
- Prévalidation/relecture de profil dans les handlers de confirmation/rejet et d'inventaire : duplication à encadrer, mais **garder les vérifications autoritatives dans la transaction**. Ne pas les déplacer toutes avant la transaction au nom du DRY.
- `functions/src/settlements/financialUtils.js` / `src/utils/financialImpact.js` : duplication volontaire de fonctions pures, contrôlée par `tc-081-financial-parity.test.js`. Conserver ce test ; un module partagé n'est utile que si le packaging Functions/front reste simple.
- `formatters.js` / `formatFirestoreDate.js` : affichage similaire, gardes d'entrée pas strictement identiques. `parseAmount`, `parseStrictInteger`, `parseFcfaAmount` diffèrent notamment pour espaces et types ; **ne pas les fusionner aveuglément**.

### QUA-05 — Frontières de modules encore trop larges

**MINEUR structurel · effort M par extraction motivée.**

`firestore.js` compte 1 049 lignes et mélange accès générique, cache, listeners, clients, migrations et façade financière. Des délégations `DraftService`, `HistoryService`, `BalanceService` existent déjà : partir d'elles, sans recommencer une architecture parallèle. Le contexte injecté expose beaucoup de méthodes ; privilégier une dépendance étroite par service lorsqu'un changement le justifie.

Les composants `CollaborationsPanel` (676 lignes), `TransactionForm` (639) et `StoreAdminDealerRequestDetails` (630) sont des points de vigilance, **pas des bugs à cause de leur taille**. Extraire calculs purs, orchestration asynchrone et dialogue seulement avec un besoin testable. Les longues explications dans certains fichiers pourraient devenir une courte décision documentaire, en gardant les invariants près du code.

## 4. Interface et accessibilité

### UI-01 — Formulaire client sans labels associés, anciennes modales non accessibles

**IMPORTANT · CORRIGÉ le 23 septembre 2026 · clavier, inertie et rendu mobile vérifiés.**

- Localisation : [ClientForm.jsx:132](../src/components/ClientForm.jsx#L132), [ForgotPasswordModal.jsx:96](../src/components/auth/ForgotPasswordModal.jsx#L96), [ChangePasswordModal.jsx:105](../src/components/auth/ChangePasswordModal.jsx#L105), `components/ui/Dialog.jsx`.
- Les labels du formulaire client ne portent pas de `htmlFor` et les inputs correspondants n'ont pas d'identifiant/nom accessible alternatif. Les deux anciennes modales Auth n'ont pas de rôle dialog, de piège/restauration du focus ni de gestion Échap. Le composant `Dialog` a déjà une partie de cette mécanique, mais son commentaire « fond inerte » n'est pas réalisé par un attribut `inert` : `aria-modal` ne bloque pas à lui seul les interactions DOM.
- Correction : associer les labels, migrer ces modales vers le composant commun, vérifier focus et arrière-plan inerte. S'assurer que le focus reste visible après erreurs et fermeture.
- Test cible : `getByRole`/`getByLabelText`, Tab/Shift+Tab, Échap, restauration du focus et capture mobile.
- Résultat : tous les champs client sont associés à leurs labels. Les deux modales Auth utilisent `Dialog`, avec nom/description accessibles, piège et restauration du focus, Échap et arrière-plan réellement `inert`. Une capture Playwright à 390 px confirme le rendu de la récupération de mot de passe et le focus initial sur l'adresse email.

Les thèmes et composants sémantiques existants constituent un socle utile. Quelques pages admin emploient encore des classes vertes/grises en dur plutôt que les tokens C2EGF : dette de cohérence, pas une raison de redessiner tout le CRM. Un avis sur tous les contrastes/états réels demanderait une matrice visuelle complète, distincte de quelques captures de référence.

## 5. Documentation et exploitation

### DOC-01 — Contrats de projet en retard sur la configuration de production

**IMPORTANT pour les décisions opérationnelles · CORRIGÉ le 24 septembre 2026.**

- `AGENTS.md` dit encore « aucun projet Firebase ni production ». `.firebaserc` porte `production:c2egf-b0b5a`, le profil cite ce projet et `functions/src/index.js` décrit des déploiements et quotas rencontrés. Cela prouve que les instructions ne reflètent plus la configuration locale ; l'état exact du service distant n'a pas été vérifié.
- `docs/adaptation-nouveau-client.md` conserve aussi des indications TAOFIC anciennes et présente un namespace client comme isolation générale, alors que `users`, `stores`, `globalClients` restent à la racine et les données métier sont organisées par boutique.
- Correction : remettre à jour le statut de production, le registre clients, l'isolation effective par projet, la procédure de validation des artefacts générés et les responsabilités de sauvegarde. Les anciens audits doivent être datés comme historiques ; leur phrase « aucun test / aucune Function » est désormais fausse pour le code actuel.
- Aucun projet Firebase réel n'a été contacté pour cet audit ; les règles de prudence production ont été maintenues.
- Résultat : `AGENTS.md` décrit désormais l'alias C2EGF sans présumer l'état distant et active immédiatement les interdits de production. Le guide d'adaptation explique l'isolation effective par projet, les collections racine, la vérification des artefacts et la responsabilité de sauvegarde ; ses anciens identifiants TAOFIC ont été retirés de la procédure courante.

## 6. Ce qui est sain et doit être conservé

- Les contrôles de rôle côté règles et handlers ne dépendent pas seulement de l'interface ; les commandes financières relisent généralement le profil dans la transaction.
- Les opérations dealer/collaborations/dettes sont atomiques, valident les montants entiers sûrs et conservent une piste d'audit.
- Le dealer unique est recherché avec `limit(2)` pour détecter une anomalie, plutôt que choisir arbitrairement un compte.
- Les règlements partiels gèlent déjà leurs champs serveur et leur type ; le trou de suppression/recréation doit être fermé sans enlever ces protections.
- Les tests de règles A/B, de parité financière et les tests de concurrence métier existants sont une vraie base pour corriger progressivement.
- Les règles refusent par défaut les chemins non ouverts ; l'historique n'est plus directement supprimable.
- Les profils et leurs générateurs existent, avec vérification `--check` ; il faut compléter leur couverture, pas créer une seconde configuration client.
- Les scripts admin disposent de gardes de projet et de contrôles de sauvegarde ; aucun n'a été lancé contre des données réelles.
- Aucun point d'injection HTML brut, `eval` ou requête HTTP arbitraire n'a été trouvé dans les recherches ciblées de `src`. Cela ne constitue pas une preuve d'absence de toute XSS/SSRF. Les mots de passe passent par Firebase Auth ; ne pas ajouter un hachage maison dans React.

## 7. Plan de remédiation proposé

| Lot | Contenu | Critère de sortie |
|---|---|---|
| 1 — sécurité critique | SEC-01, SEC-02, SEC-03 ; caractériser avant modification, fermer les admissions non autorisées et la suppression/recréation ; migration serveur des mouvements par sous-lots | Reproductions d'exposition transformées en tests de refus ; parcours légitimes A/B conservés ; audit et concurrence vérifiés |
| 2 — autres critiques | Aucun autre critique confirmé dans ce bilan | Revoir ce lot si les vérifications d'exploitation révèlent un critique |
| 3A — importants métier | BUG-01 avec garde anti-annulation de trace, BUG-02, SEC-04, SEC-05 | ✅ Terminé : requêtes réelles, reprise réseau, concurrence, profil et révocation testés |
| 3B — importants sécurité/fiabilité | SEC-06 à SEC-09, QUA-01, BUG-04, UI-01 | ✅ Terminé : imports bornés, isolation navigateur, erreurs visibles, concurrence et modales testées |
| 3C — importants données/exploitation | BUG-03, BUG-05, PERF-02, QUA-02, DOC-01 et première réduction de PERF-01 | ✅ Terminé le 24 septembre |
| 3D — historique et agrégat dealer | Pagination visible de l'archive, exactitude du jour courant, agrégat serveur et fermeture des brouillons au dealer | ✅ Terminé le 24 septembre ; scan serveur à matérialiser seulement si les mesures le justifient |
| Backlog — mineurs | QUA-03/04/05, cohérence des tokens | Petits refactors sans changement métier ; suppression démontrée et réversible |

Une correction de sécurité et un refactor esthétique ne doivent pas partager un lot. Toute restriction variable par client doit être nommée dans `_pilot.js`, dérivée pour les couches concernées et testée avec au moins le pilote et C2EGF. Le typage progressif/JSDoc peut renforcer les payloads et documents aux frontières ; éviter de migrer tout le dépôt avant d'avoir fermé les failles.

**Point d'arrêt ADOPTION.md : les lots 1, 3A, 3B, 3C et 3D sont terminés. La normalisation d'éventuels historiques réels sans `createdAt`, la matérialisation éventuelle de l'agrégat dealer et le backlog mineur restent des chantiers séparés ; aucun autre changement métier n'est implicite.**

## 8. Reproduction et pièces de travail

- [INVENTORY.json](INVENTORY.json) / [inventory.mjs](inventory.mjs) : métriques, import graph, fenêtres identiques.
- [SECRET-SCAN.json](SECRET-SCAN.json) / [scan-secrets.mjs](scan-secrets.mjs) : recherche de signatures Git, sans exposition des valeurs.
- [reproduce-rules.mjs](reproduce-rules.mjs) : six non-régressions de sécurité. Les assertions qui passent confirment désormais le refus des anciens chemins d'exposition.
- [reproduce-backend.mjs](reproduce-backend.mjs) : trois constats avec handlers réels.
- [visual-check.mjs](visual-check.mjs) : banc de capture avec données fictives et réseau externe bloqué.

Exemple PowerShell, depuis la racine, pour les reproductions :

```powershell
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=.'
firebase emulators:exec --only firestore --project demo-akayis-test 'node audit/reproduce-rules.mjs && node audit/reproduce-backend.mjs'
```

Les jeux fictifs utilisent leurs propres projets `demo-c2egf-audit-repro` et `demo-c2egf-audit-backend`, uniquement sur l'hôte d'émulateur local. Les scripts ne doivent jamais être adaptés pour viser une base réelle.
