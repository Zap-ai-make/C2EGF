# REVIEW-CODEX.md — Revue indépendante

Revue effectuée selon `PROMPTS.md` (Prompt 2). Aucun fichier existant n'a été modifié ; ce rapport est le seul livrable créé.

## 1. Périmètre lu

Fichiers lus intégralement : `AGENTS.md`, `CLAUDE.md`, `WORKFLOW.md`, `SPEC.template.md`, `DESIGN.md`, `SECURITY.md`, `ARCHITECTURE.md`, `ECC.md`, `PROMPTS.md` et `RAPPORT-HARMONISATION.md`.

## 2. Contrôles validés

- `CLAUDE.md` contient bien l'unique directive attendue : `Lis et applique AGENTS.md.`
- La hiérarchie est explicite dans `AGENTS.md` : `AGENTS.md` > `WORKFLOW.md` > contrats > gabarit. `ECC.md` est correctement déclaré annexe optionnelle.
- Les renvois de fichiers et de sections examinés pointent vers des fichiers et sections présents.
- Les trois points d'arrêt de `WORKFLOW.md` §1, les garde-fous de `ARCHITECTURE.md` §1, et les non-négociables de sécurité et d'interface sont présents. Aucune régression critique directement observable n'a été constatée.
- La langue, le ton prescriptif et la sobriété du format sont cohérents dans les contrats principaux.

## 3. Constats

### IMPORTANT — `AGENTS.md`, règle 4 ; `ARCHITECTURE.md` §7 ; `WORKFLOW.md` §0, §1 et §5

**Problème.** `AGENTS.md` et `ARCHITECTURE.md` exigent un plan validé pour toute tâche non triviale. À l'inverse, `WORKFLOW.md` annonce que l'agent travaille seul entre trois seuls points d'arrêt, et enchaîne explicitement « plan court » puis « implémentation » pour chaque spec. Il reste donc ambigu de savoir si chaque plan de spec doit recevoir une validation humaine, ou si la validation du découpage/MVP suffit.

**Suggestion.** Préciser dans `WORKFLOW.md` §5 ou dans `ARCHITECTURE.md` §7 que le point d'arrêt 2 valide le périmètre et les plans de specs déjà décrits dans la roadmap ; une validation supplémentaire n'est requise que pour un écart de périmètre, une décision structurante nouvelle ou une opération sensible.

### IMPORTANT — `AGENTS.md`, règle 2 ; `SECURITY.md` §2

**Problème.** La règle « aucun secret hors `.env` » et la formulation « tout vit dans un `.env` local » contredisent le recours, correctement recommandé juste après, aux gestionnaires de secrets et aux secrets d'hébergeur/CI. En production, un secret ne devrait généralement pas être stocké dans un fichier `.env` local.

**Suggestion.** Remplacer la règle par un principe de stockage sûr : `.env` local gitignoré pour le développement ; gestionnaire de secrets ou variables sécurisées de l'hébergeur/CI pour les environnements partagés ; jamais de secret dans le code, le dépôt, les fichiers d'agent ou les journaux.

### IMPORTANT — `SECURITY.md` §0, §2, §9, §12 et §14

**Problème.** Les scans de secrets et de dépendances sont imposés (« tourne pendant le dev », « bloque le commit »), alors que §0 et §14 indiquent qu'aucun outil n'est obligatoire et que l'outillage ne se force pas. Le niveau d'exigence du contrôle et celui du choix d'outil ne sont pas distingués explicitement.

**Suggestion.** Rendre obligatoire le résultat attendu — détection des secrets et des vulnérabilités avant commit/merge — mais préciser que GitGuardian, Snyk et les autres noms cités sont des exemples remplaçables par un équivalent adapté à la stack et au risque.

### IMPORTANT — `ECC.md` §1 et §4

**Problème.** §1 autorise seulement les paquets npm `ecc-universal` et `ecc-agentshield`, tandis que §4 propose la commande `npx ecc install`. Cette commande peut résoudre un paquet `ecc` qui ne figure pas dans la liste blanche annoncée.

**Suggestion.** Vérifier puis documenter la commande officielle exacte, ou ajouter explicitement son paquet à la liste des sources autorisées. Tant que ce point n'est pas clarifié, ne pas exécuter cette variante d'installation.

### IMPORTANT — `RAPPORT-HARMONISATION.md` §2

**Problème.** Le rapport affirme une comparaison phrase par phrase, un test de mutation et la conservation d'un état antérieur dans un répertoire temporaire. Ces artefacts et aucun historique Git ne sont disponibles dans ce dossier. Les résultats annoncés ne peuvent donc pas être reproduits ni la fidélité des modifications vérifiée indépendamment ; seule l'absence de régression directement visible peut être contrôlée.

**Suggestion.** Pour toute harmonisation future, joindre au rapport un diff ou des empreintes du contenu avant/après, la commande de vérification et son résultat. Conserver ces preuves dans un emplacement versionné ou explicitement fourni au relecteur.

### MINEUR — `RAPPORT-HARMONISATION.md` §2

**Problème.** Le rapport indique que « chaque fichier `.md` » possède un titre H1 et des sections H2. `CLAUDE.md` ne contient volontairement qu'une directive, et `PROMPTS.md` est une procédure sans cette structure. Cette affirmation est donc trop large.

**Suggestion.** Restreindre le contrôle aux contrats, au workflow, au gabarit et aux rapports structurés ; ne pas ajouter de titre à `CLAUDE.md`, ce qui violerait sa contrainte d'une seule directive.

## 4. Verdict

**VALIDÉ AVEC RÉSERVES.**

Le branchement, les références et les protections essentielles sont bien en place ; aucune régression critique n'est observable dans l'état actuel. Les cinq constats importants ne justifient pas de rejeter le pack, mais ils doivent être arbitrés avant de le considérer comme une règle opérationnelle sans ambiguïté, en particulier les règles de validation des plans et de gestion des secrets.
