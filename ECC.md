Ce qu'il faut comprendre d'abord

ECC (Everything Claude Code, affaan-m/ECC) n'est pas un skill : c'est un harness complet. Le composant qui ressemble à « le skill ECC » s'appelle configure-ecc — l'assistant d'installation interactif.

Les skills ne consomment des tokens que quand elles sont invoquées ; en avoir beaucoup d'installées n'alourdit pas le contexte en soi. Ce qui l'alourdit, c'est le nombre de composants actifs en permanence (agents, commandes, hooks) et le fait que le plugin annonce tout le catalogue au modèle. La bonne « découpe » n'est donc pas de fragmenter un fichier : c'est de n'installer/activer qu'un profil restreint.

Sécurité : sources officielles uniquement

N'installe ECC que depuis : le dépôt github.com/affaan-m/ECC, les paquets npm ecc-universal et ecc-agentshield, la GitHub App officielle, le slug de plugin ecc@ecc, et le site ecc.tools. Les miroirs et ré-uploads tiers ne sont pas maintenus et peuvent contenir des malwares. Ne prends jamais un « ECC » trouvé ailleurs. (Méfie-toi aussi des paquets nommés opencode-ecc, everything-claude-code, etc. : traiter comme non officiels tant que le dépôt ne les documente pas.)

Les agents qui valent le coup (web full-stack)

Sur les 68 agents, voici le noyau pertinent pour du TypeScript/React/Next + base Postgres/Supabase. On active ceux-là, on ignore les agents de langages qu'on n'utilise pas (Rust, Go, C++, Java, Kotlin, F#, Django/Python, PyTorch/ML…).

planner — planification des features complexes / refactors. (Renforce ARCHITECTURE.md §7.)
architect — décisions de design système et scalabilité.
tdd-guide — écrit les tests avant l'implémentation. (Renforce §4.)
code-reviewer — revue qualité/maintenabilité juste après avoir écrit du code.
security-reviewer — détection de vulnérabilités avant commit. (Renforce SECURITY.md.)
database-reviewer — spécialiste PostgreSQL/Supabase : schéma, optimisation de requêtes, et c'est là que vivent les questions RLS de SECURITY.md §4. Très pertinent pour toi.
typescript-reviewer — revue TS/JS.
e2e-runner — tests E2E Playwright sur les parcours critiques. Se branche pile sur la boucle QA visuelle de DESIGN.md.
build-error-resolver — corrige les erreurs de build/type de façon incrémentale.
refactor-cleaner — suppression de code mort.
doc-updater — docs et codemaps.
docs-lookup — recherche de docs d'API via Context7 (MCP). Anti-hallucination : l'agent lit la vraie doc au lieu d'inventer une API. Une des meilleures briques du lot.
spec-miner — extraction de specs sur un projet existant (utile pour onboarder une base déjà là).
harness-optimizer — réglage de la config (fiabilité, coût, débit) si un jour tu veux tuner ton setup.
loop-operator — pilote l'exécution en boucle des phases 3 et 4 de WORKFLOW.md (construction spec par spec). Adapté ici, parce que le WORKFLOW lui donne ce qu'il faut pour rester sûr : périmètre borné (roadmap MVP), condition d'arrêt (MVP gate), porte de qualité par spec. À utiliser en mode séquentiel simple, borné par les points d'arrêt — cf. WORKFLOW.md §9.

À laisser de côté par défaut : les commandes /multi-* et l'orchestration parallèle (Ralphinho, Infinite Agentic Loop — overkill pour cadrer un MVP), rag-pipeline-reviewer, mle-reviewer (ML/RAG uniquement).

Les skills / commandes utiles
security-scan (AgentShield) — audit de la config des agents : npx ecc-agentshield scan. Déjà dans SECURITY.md §14.
react-patterns / react-testing / nextjs-turbopack / bun-runtime — seulement celles de ta stack réelle.
continuous-learning / instincts (/skill-create, /instinct-import) — le mécanisme d'auto-apprentissage : l'agent extrait des « instincts » de ton historique git et les rejoue. C'est la version outillée du principe « standards vivants » de ARCHITECTURE.md §10. À tester si tu veux que le système apprenne tes conventions.
configure-ecc — le wizard d'install.
Conventions à importer dans TES fichiers (indépendamment d'ECC)

Même si tu n'installes pas ECC, certaines de ses conventions concrètes méritent d'entrer dans tes propres standards. Elles sont plus précises que ce que j'avais écrit :

Immutabilité — créer de nouveaux objets, ne jamais muter l'existant. → à ajouter à ARCHITECTURE.md §3.
Seuils de taille chiffrés — fonctions < 50 lignes, fichiers 200-400 lignes (800 max), imbrication < 4 niveaux, « beaucoup de petits fichiers plutôt que peu de gros ». → précise ARCHITECTURE.md §2-3.
Règle des 20 % — éviter les 20 derniers % de la fenêtre de contexte pour les gros refactors / features multi-fichiers. → règle nette pour ARCHITECTURE.md §6, plus concrète que « contexte sobre ».
Enveloppe d'API cohérente — même format de réponse partout (succès, données, message d'erreur, pagination). → bon défaut pour ARCHITECTURE.md §2.
Deux portes de revue — Gate 1 : revue multi-dimensions (qualité + langage + sécurité conditionnelle) ; Gate 2 : vérification adverse de chaque constat CRITICAL/HIGH. → affine l'audit de ARCHITECTURE.md §9.
Couverture 80 % minimum — seuil explicite. → chiffre à poser dans ARCHITECTURE.md §4.

Dis-moi si tu veux que je répercute ces six points dans ARCHITECTURE.md — ils sont cohérents avec le reste et le rendent plus précis.

Installation légère
Plugin, profil restreint — commencer en core, jamais full :
   /plugin marketplace add affaan-m/ECC
   /plugin install ecc@ecc

Alternative OSS (plus fiable si le marketplace auto-hébergé ne résout pas) : npx ecc install --profile minimal --target claude puis ajouter des capacités à la carte. 2. Wizard sélectif — lancer « configure ecc » et n'activer que les agents listés ci-dessus + Workflow/Qualité + Research-first. Laisser le reste décoché. 3. Règles copiées à la main (le plugin ne distribue pas les rules), uniquement ta stack :

   git clone https://github.com/affaan-m/ECC.git
   mkdir -p ~/.claude/rules/ecc
   cp -r ECC/rules/common     ~/.claude/rules/ecc/
   cp -r ECC/rules/typescript ~/.claude/rules/ecc/   # adapter à ta stack
Ne jamais cumuler deux méthodes d'installation (plugin + manuel) : ça duplique skills, commandes et hooks. C'est le bug de setup le plus courant. En cas de doublons : ecc list-installed, ecc doctor, ecc repair.
Garder la surface petite
Après installation, vérifier ce qui est actif (ecc list-installed) et désactiver tout ce qui ne sert pas la tâche.
Règle des 20 % + cap ARCHITECTURE.md §6 : moins de 10 MCP actifs, peu d'agents chargés en permanence.
Sur les 14 configs MCP fournies, n'active que celles dont tu te sers (ex. Context7 pour docs-lookup). Remplace les placeholders de clés par des vraies via .env, jamais en dur.
Activer une brique pour un chantier ponctuel, puis la désactiver.
La règle

On adapte, on ne force pas. Pour du vibe-coding, tes quatre fichiers standards couvrent déjà l'essentiel ; ECC ajoute de la valeur surtout par ses agents spécialisés (database-reviewer, docs-lookup, e2e-runner, security-reviewer) et son mécanisme d'apprentissage (instincts). Prends ce noyau, garde le reste en réserve. C'est le principe de soustraction de ton propre ARCHITECTURE.md, appliqué à l'outillage.