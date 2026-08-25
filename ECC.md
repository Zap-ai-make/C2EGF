# ECC.md — Annexe d'outillage (optionnelle)

> **Statut : annexe.** Ce fichier ne prime sur aucun contrat et n'impose aucun outil (cf. `AGENTS.md`, ordre de préséance). Le pack fonctionne entièrement sans ECC. Cette annexe sert au moment où l'on décide d'installer ECC, et documente les seuls composants qui apportent une valeur nette sur du web full-stack.

---

## 0. Ce qu'il faut comprendre d'abord

ECC (Everything Claude Code, `affaan-m/ECC`) n'est pas un skill : c'est un harness complet. Le composant qui ressemble à « le skill ECC » s'appelle `configure-ecc` — l'assistant d'installation interactif.

Les skills ne consomment des tokens que quand elles sont invoquées ; en avoir beaucoup d'installées n'alourdit pas le contexte en soi. Ce qui l'alourdit, c'est le nombre de composants **actifs en permanence** (agents, commandes, hooks) et le fait que le plugin annonce tout le catalogue au modèle. La bonne « découpe » n'est donc pas de fragmenter un fichier : c'est de n'installer et n'activer qu'un profil restreint.

---

## 1. Sécurité : sources officielles uniquement

N'installer ECC que depuis : le dépôt `github.com/affaan-m/ECC`, les paquets npm `ecc-universal` et `ecc-agentshield`, la GitHub App officielle, le slug de plugin `ecc@ecc`, et le site `ecc.tools`.

Les miroirs et ré-uploads tiers ne sont pas maintenus et peuvent contenir des malwares. Ne jamais prendre un « ECC » trouvé ailleurs. Se méfier également des paquets nommés `opencode-ecc`, `everything-claude-code` et assimilés : les traiter comme non officiels tant que le dépôt ne les documente pas.

---

## 2. Les agents qui valent le coup (web full-stack)

Sur les 68 agents, voici le noyau pertinent pour du TypeScript/React/Next + base Postgres/Supabase. On active ceux-là, on ignore les agents de langages non utilisés (Rust, Go, C++, Java, Kotlin, F#, Django/Python, PyTorch/ML…).

- **`planner`** — planification des features complexes / refactors. Renforce `ARCHITECTURE.md` §7 et le plan court de `WORKFLOW.md` §5.
- **`architect`** — décisions de design système et scalabilité.
- **`tdd-guide`** — écrit les tests avant l'implémentation. Renforce `ARCHITECTURE.md` §4.
- **`code-reviewer`** — revue qualité/maintenabilité juste après avoir écrit du code.
- **`security-reviewer`** — détection de vulnérabilités avant commit. Renforce `SECURITY.md`.
- **`database-reviewer`** — spécialiste PostgreSQL/Supabase : schéma, optimisation de requêtes, et c'est là que vivent les questions RLS de `SECURITY.md` §4.
- **`typescript-reviewer`** — revue TS/JS.
- **`e2e-runner`** — tests E2E Playwright sur les parcours critiques. Se branche sur la boucle QA visuelle de `DESIGN.md` §14.
- **`build-error-resolver`** — corrige les erreurs de build/type de façon incrémentale.
- **`refactor-cleaner`** — suppression de code mort.
- **`doc-updater`** — docs et codemaps.
- **`docs-lookup`** — recherche de docs d'API via Context7 (MCP). Anti-hallucination : l'agent lit la vraie doc au lieu d'inventer une API.
- **`spec-miner`** — extraction de specs sur un projet existant (utile pour onboarder une base déjà là).
- **`harness-optimizer`** — réglage de la config (fiabilité, coût, débit).
- **`loop-operator`** — pilote l'exécution en boucle des phases 3 et 4 de `WORKFLOW.md` (construction spec par spec). Adapté ici parce que le workflow lui donne ce qu'il faut pour rester sûr : périmètre borné (roadmap MVP), condition d'arrêt (MVP gate), porte de qualité par spec. À utiliser en mode séquentiel simple, borné par les points d'arrêt — cf. `WORKFLOW.md` §9.

**À laisser de côté par défaut** : les commandes `/multi-*` et l'orchestration parallèle (Ralphinho, Infinite Agentic Loop — overkill pour cadrer un MVP), `rag-pipeline-reviewer`, `mle-reviewer` (ML/RAG uniquement).

---

## 3. Les skills et commandes utiles

- **`security-scan` (AgentShield)** — audit de la config des agents : `npx ecc-agentshield scan`. Déjà référencé dans `SECURITY.md` §14.
- **`react-patterns` / `react-testing` / `nextjs-turbopack` / `bun-runtime`** — seulement celles de la stack réelle du projet.
- **`continuous-learning` / `instincts`** (`/skill-create`, `/instinct-import`) — mécanisme d'auto-apprentissage : l'agent extrait des « instincts » de l'historique git et les rejoue. C'est la version outillée du principe « standards vivants » de `ARCHITECTURE.md` §10.
- **`configure-ecc`** — le wizard d'installation.

---

## 4. Installation légère

**1. Plugin, profil restreint** — commencer en `core`, jamais `full` :

```
/plugin marketplace add affaan-m/ECC
/plugin install ecc@ecc
```

Alternative OSS (plus fiable si le marketplace auto-hébergé ne résout pas) : `npx ecc install --profile minimal --target claude`, puis ajouter des capacités à la carte.

> **À vérifier avant d'exécuter cette commande.** `npx ecc` résout un paquet npm nommé `ecc`, qui ne figure pas dans la liste blanche du §1 (`ecc-universal`, `ecc-agentshield`). Confirmer le nom exact du paquet officiel auprès du dépôt avant de lancer la commande, ou passer par le paquet listé. Le §1 existe précisément parce que des paquets homonymes circulent : une commande d'installation qui sort de la liste blanche annule la protection qu'elle décrit.

**2. Wizard sélectif** — lancer `configure ecc` et n'activer que les agents listés au §2, plus Workflow/Qualité et Research-first. Laisser le reste décoché.

**3. Règles copiées à la main** (le plugin ne distribue pas les rules), uniquement pour la stack du projet :

```
git clone https://github.com/affaan-m/ECC.git
mkdir -p ~/.claude/rules/ecc
cp -r ECC/rules/common     ~/.claude/rules/ecc/
cp -r ECC/rules/typescript ~/.claude/rules/ecc/   # adapter à la stack
```

**Ne jamais cumuler deux méthodes d'installation** (plugin + manuel) : cela duplique skills, commandes et hooks. C'est le bug de setup le plus courant. En cas de doublons : `ecc list-installed`, `ecc doctor`, `ecc repair`.

---

## 5. Garder la surface petite

- Après installation, vérifier ce qui est actif (`ecc list-installed`) et désactiver tout ce qui ne sert pas la tâche.
- Cap de `ARCHITECTURE.md` §6 : moins de 10 MCP actifs, peu d'agents chargés en permanence.
- Sur les 14 configs MCP fournies, n'activer que celles réellement utilisées (ex. Context7 pour `docs-lookup`). Remplacer les placeholders de clés par de vraies valeurs via `.env`, jamais en dur (`SECURITY.md` §2).
- Activer une brique pour un chantier ponctuel, puis la désactiver.

---

## 6. Conventions ECC proposées — non appliquées à ce jour

ECC porte six conventions concrètes, plus précises que ce que disent aujourd'hui les contrats. Elles sont consignées ici comme **proposition** : elles ne font pas partie du pack tant qu'elles n'ont pas été explicitement retenues et écrites dans le contrat concerné.

| Convention | Contrat visé |
|---|---|
| **Immutabilité** — créer de nouveaux objets, ne jamais muter l'existant | `ARCHITECTURE.md` §3 |
| **Seuils de taille chiffrés** — fonctions < 50 lignes, fichiers 200-400 lignes (800 max), imbrication < 4 niveaux | `ARCHITECTURE.md` §2-3 |
| **Règle des 20 %** — éviter les 20 derniers % de la fenêtre de contexte pour les gros refactors et features multi-fichiers | `ARCHITECTURE.md` §6 |
| **Enveloppe d'API cohérente** — même format de réponse partout (succès, données, message d'erreur, pagination) | `ARCHITECTURE.md` §2 |
| **Deux portes de revue** — Gate 1 : revue multi-dimensions (qualité + langage + sécurité conditionnelle) ; Gate 2 : vérification adverse de chaque constat CRITICAL/HIGH | `ARCHITECTURE.md` §9 |
| **Couverture 80 % minimum** — seuil explicite | `ARCHITECTURE.md` §4 |

Ces six points sont cohérents avec le reste du pack et le rendraient plus précis ; ils le rendraient aussi plus prescriptif. La décision de les intégrer reste ouverte.

---

## 7. La règle

On adapte, on ne force pas. Pour du vibe-coding, les fichiers de ce pack couvrent déjà l'essentiel ; ECC ajoute de la valeur surtout par ses agents spécialisés (`database-reviewer`, `docs-lookup`, `e2e-runner`, `security-reviewer`) et son mécanisme d'apprentissage (`instincts`). Prendre ce noyau, garder le reste en réserve.

C'est le principe de soustraction de `ARCHITECTURE.md` §1, appliqué à l'outillage.
