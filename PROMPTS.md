PROMPT 1 — Audit et harmonisation (Claude Code — l'exécutant)


Tu es chargé d'auditer et d'harmoniser ce dossier de standards, destiné à être
copié à la racine de chacun de mes projets. Ta mission porte sur les fichiers
eux-mêmes — tu ne construis aucun produit ici.

1. INVENTAIRE
Lis intégralement chaque fichier du dossier : AGENTS.md, CLAUDE.md, WORKFLOW.md,
SPEC.template.md, DESIGN.md, SECURITY.md, ARCHITECTURE.md, ECC-INTEGRATION.md,
et tout autre fichier présent. Donne la liste exacte de ce que tu as lu.

2. BRANCHEMENT ET HIÉRARCHIE
- CLAUDE.md doit contenir une seule directive : lire et appliquer AGENTS.md
  (source unique de vérité). Si ce n'est pas le cas, corrige.
- AGENTS.md est le point d'entrée maigre : bloc projet, renvoi vers WORKFLOW.md
  pour un nouveau projet, les trois contrats avec leurs conditions de
  chargement, les règles permanentes. Il doit rester court.
- Vérifie que CHAQUE référence croisée (nom de fichier, numéro de section §)
  pointe vers quelque chose qui existe réellement. Corrige tout renvoi cassé.
- La hiérarchie doit être explicite et sans boucle :
  AGENTS.md > WORKFLOW.md > contrats (DESIGN/SECURITY/ARCHITECTURE) > gabarits.
  Si l'ordre de préséance en cas de conflit n'est écrit nulle part, ajoute une
  ligne le fixant dans AGENTS.md.

3. ANALYSE DE COHÉRENCE
Cherche et liste précisément :
- les contradictions entre fichiers ;
- les doublons — une même règle écrite à deux endroits : la garder à UN seul
  endroit (le plus logique) et la référencer depuis l'autre ;
- les manques — une couche absente que le pack devrait couvrir pour des projets
  web full-stack (ex. conventions git/commits, gestion des environnements
  dev/staging/prod, versioning). Propose ; n'invente aucune couche hors sujet ;
- les incohérences de ton, de langue et de format : tout est en français, voix
  « contrat », aucun emoji, formatage sobre.

4. PLAN AVANT MODIFICATION
Présente d'abord un plan de changements : fichier par fichier, chaque
modification proposée et sa raison, classée (branchement cassé / doublon /
contradiction / manque / harmonisation). ATTENDS MA VALIDATION avant
d'appliquer quoi que ce soit.

5. CONTRAINTES
- Principe de soustraction : le pack doit sortir PLUS CLAIR, pas plus gros.
- Ne supprime ni n'affaiblis jamais : les trois points d'arrêt de WORKFLOW.md,
  les non-négociables de SECURITY.md et DESIGN.md, les garde-fous de
  ARCHITECTURE.md §1.
- N'ajoute aucun emoji, aucune règle contradictoire, aucun outil imposé.
- Ne touche pas à la philosophie : principes appliqués avec jugement,
  qualité avant tout, ne rien forcer.

6. LIVRABLE
Après ma validation du plan : applique les modifications, puis écris un rapport
dans RAPPORT-HARMONISATION.md — ce qui a été vérifié, chaque modification
appliquée (fichier, section, raison), et ce qui reste proposé mais non
appliqué, avec les raisons. Ce rapport servira de base à une revue
indépendante par un autre agent.




PROMPT 2 — Revue indépendante (Codex — le relecteur)

À lancer dans le même dossier, après que Claude Code a terminé le Prompt 1. Codex ne modifie rien : il critique, valide et suggère.

Tu es relecteur indépendant. Un autre agent vient d'auditer et d'harmoniser ce
dossier de standards ; son rapport est dans RAPPORT-HARMONISATION.md. Ta
mission : contrôler son travail. Tu ne modifies AUCUN fichier existant — ton
seul livrable est un rapport de revue.

1. LECTURE
Lis intégralement chaque fichier du dossier, puis RAPPORT-HARMONISATION.md.

2. CONTRÔLE DU TRAVAIL
Vérifie point par point :
- le branchement : CLAUDE.md renvoie bien vers AGENTS.md (source unique de
  vérité) ; la hiérarchie AGENTS.md > WORKFLOW.md > contrats > gabarits est
  explicite ; toutes les références croisées (fichiers, numéros de §)
  pointent vers quelque chose qui existe ;
- les contradictions entre fichiers qui subsisteraient ;
- les doublons qui subsisteraient ;
- les RÉGRESSIONS : l'exécutant a-t-il affaibli ou supprimé un point d'arrêt
  de WORKFLOW.md, un non-négociable de SECURITY.md ou DESIGN.md, un garde-fou
  de ARCHITECTURE.md §1 ? Toute régression de ce type est CRITIQUE ;
- les manques encore présents pour des projets web full-stack ;
- l'homogénéité de ton, de langue et de format (français, voix « contrat »,
  aucun emoji, formatage sobre) ;
- la fidélité du rapport : les modifications annoncées correspondent-elles à
  ce qui est réellement dans les fichiers ?

3. FORMAT DES CONSTATS
Pour chaque constat : fichier + section concernée, description du problème,
et une SUGGESTION concrète de correction. Tu suggères, tu ne corriges pas.
Classe chaque constat : CRITIQUE / IMPORTANT / MINEUR.

4. VERDICT
Termine par un verdict global argumenté : VALIDÉ, VALIDÉ AVEC RÉSERVES, ou
À REPRENDRE.

5. LIVRABLE
Écris ce rapport dans REVIEW-CODEX.md — c'est le SEUL fichier que tu crées.
Tu ne touches à rien d'autre.
PROMPT 3 — Démarrage d'un nouveau projet

À lancer après avoir copié le dossier standard à la racine du nouveau projet et déposé le cahier des charges (ex. cahier-des-charges.md).

Ce dossier contient mes fichiers de standards. Le fichier cahier-des-charges.md
décrit le produit à construire.

1. Lis AGENTS.md. Si des informations du bloc projet manquent (stack, commandes
   de lancement…), remplis-les avec moi maintenant.
2. Lis le cahier des charges EN ENTIER, puis exécute WORKFLOW.md phase par
   phase :
   - pose-moi toutes tes questions sur les zones floues avant de découper
     (point d'arrêt 1) ;
   - propose le découpage en specs (SPEC.template.md) et la ligne MVP /
     post-MVP dans specs/ROADMAP.md, et attends ma validation
     (point d'arrêt 2) ;
   - après validation, construis le MVP spec par spec — plan, implémentation
     minimale, vérification (tests + rendu), revue contre DESIGN.md,
     SECURITY.md et ARCHITECTURE.md, commit — une spec à la fois ;
   - arrête-toi au MVP gate et démontre le résultat (point d'arrêt 3).
3. Ne construis rien hors périmètre. Ne comble aucune ambiguïté par une
   supposition. En cas de doute sur une opération sensible, demande.
Rappels d'usage — la boucle exécutant/relecteur
Claude Code exécute le Prompt 1 : plan → ta validation → modifications → RAPPORT-HARMONISATION.md.
Codex exécute le Prompt 2 : il contrôle les fichiers et le rapport, et livre REVIEW-CODEX.md (suggestions classées + verdict), sans rien toucher.
Toi, tu arbitres : tu lis la revue, tu choisis les suggestions à retenir, et tu les redonnes à Claude Code (« applique les points X, Y de REVIEW-CODEX.md »).
Si les corrections étaient lourdes, relance le Prompt 2 pour une seconde passe. On s'arrête quand le verdict est VALIDÉ — pas la peine de boucler pour des points MINEURS.

Le relecteur n'est jamais l'auteur, l'auteur n'applique que ce que tu as validé, et les deux rapports (RAPPORT-HARMONISATION.md, REVIEW-CODEX.md) laissent une trace de tout. Cette même boucle est re-jouable après toute évolution future du pack.

Prompt 3 : à chaque projet. Si tu pars d'une idée floue plutôt que d'un vrai cahier des charges, dis-le à l'agent — la phase 0 de WORKFLOW.md l'amènera à te poser les bonnes questions.
Les trois prompts respectent ta règle maîtresse : plan → validation → exécution. Aucun agent ne modifie ni ne construit sans ton feu vert explicite.