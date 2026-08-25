0. Le principe

L'agent ne se jette pas sur le code. Il comprend, découpe, priorise, construit le strict nécessaire, s'arrête, puis itère. À l'intérieur d'une phase il travaille de façon autonome ; entre les phases, il y a des points d'arrêt où l'humain valide.

Tout ce pipeline s'exécute sous les quatre contrats déjà en place : AGENTS.md, DESIGN.md, SECURITY.md, ARCHITECTURE.md. Ce fichier ne les répète pas, il les ordonne dans le temps.

1. Les points d'arrêt (non négociables)

L'autonomie est encadrée par trois arrêts obligatoires. L'agent ne franchit jamais l'un d'eux sans un feu vert explicite :

Après l'analyse du cahier des charges — si quoi que ce soit est ambigu, il pose ses questions avant de découper. Il n'invente pas un besoin.
Après la définition du périmètre MVP — il présente le découpage et la ligne MVP / post-MVP, et attend validation avant de construire.
À la livraison du MVP — il s'arrête, démontre, et attend le feu vert avant toute feature post-MVP.

Entre ces arrêts, il enchaîne les specs seul, mais chaque spec reste vérifiée (§5).

2. Phase 0 — Comprendre le cahier des charges
Lire le cahier des charges en entier avant toute chose.
En extraire, en quelques lignes : le problème résolu, les utilisateurs, la valeur centrale (le job sans lequel le produit n'a pas de sens), et les contraintes (techniques, légales, de délai).
Lister explicitement les zones floues, manquantes ou contradictoires. Sur ces points : poser les questions (point d'arrêt 1). On ne comble pas un trou du cahier des charges par une supposition.
Sortie de phase : un court résumé du besoin validé, qui fait foi pour la suite.
3. Phase 1 — Découper en specs
Décomposer le besoin en specs discrètes : chaque spec est une capacité vérifiable, autonome, testable (ex. « inscription par e-mail », « tableau de bord — liste des projets »). Ni trop gros (un pan entier du produit), ni trop fin (un bouton).
Chaque spec suit le gabarit SPEC.template.md et reçoit un identifiant (S1, S2…).
Identifier les dépendances entre specs (ce qui doit exister avant quoi) pour en déduire un ordre de construction.
Sortie de phase : un fichier specs/ROADMAP.md listant toutes les specs, leurs dépendances et leur ordre.
4. Phase 2 — Définir le MVP
Tracer la ligne MVP : le sous-ensemble minimal de specs qui permet au produit de rendre son service central, et rien de plus. Tout le reste passe en post-MVP.
Principe directeur (esprit ARCHITECTURE.md §1) : le MVP n'est pas « la v1 avec tout », c'est le moins qui délivre la valeur. Dans le doute, une spec est post-MVP.
Marquer chaque spec MVP ou post-MVP dans la roadmap, et ordonner le backlog post-MVP par valeur.
Point d'arrêt 2 : présenter le découpage + la ligne MVP, attendre validation.
5. Phase 3 — Construire le MVP, spec par spec

Pour chaque spec MVP, dans l'ordre des dépendances, une seule à la fois (cette phase répétitive peut tourner en boucle supervisée — cf. §9) :

Plan court — ce qui va être fait, les fichiers touchés, les points de sécurité éventuels. (agent planner si ECC présent.)
Implémentation minimale — la version juste qui satisfait les critères d'acceptation, pas plus (échelle ARCHITECTURE.md §1). Réutiliser l'existant avant d'écrire du neuf.
Vérification — exécuter le code, lancer les tests, et pour l'UI regarder le rendu (capture). « Ça compile » n'est pas « ça marche ».
Revue contre les trois contrats : SECURITY.md (auth/données/entrées), DESIGN.md (UI/états/accessibilité), ARCHITECTURE.md (qualité/structure).
Commit — un commit propre par spec, message qui dit le pourquoi. Marquer la spec terminée dans la roadmap.

On ne démarre pas la spec suivante tant que la courante n'est pas terminée et vérifiée. Pas d'empilement, pas de features hors périmètre glissées « tant qu'on y est ».

6. Le MVP gate

Une fois toutes les specs MVP terminées :

S'arrêter. Démontrer le MVP (ce qui marche, comment le lancer, ce qui est volontairement hors périmètre).
Un passage rapide de la checklist de sortie SECURITY.md §13 avant toute mise en ligne.
Point d'arrêt 3 : attendre le feu vert. Aucune feature post-MVP ne démarre sans validation.
7. Phase 4 — Itérer, feature par feature

Après le feu vert, on traite le backlog post-MVP une feature à la fois, chacune comme un mini-cycle complet :

spec (gabarit) → plan → implémentation minimale → vérification → revue trois contrats → commit.

On reprend la spec depuis SPEC.template.md, on la construit, on la vérifie, on la livre. Puis la suivante.
À tout moment, une nouvelle demande = une nouvelle spec ajoutée au backlog et priorisée, jamais un ajout improvisé en cours de route.
Après chaque feature notable, appliquer ARCHITECTURE.md §10 : si une leçon est généralisable, la remonter dans le contrat concerné.
8. Règles permanentes du workflow
MVP d'abord. Dans le doute sur l'inclusion d'une spec, elle est post-MVP.
Une chose à la fois. Une spec ouverte à la fois, un commit par spec.
S'arrêter plutôt que deviner — sur une ambiguïté du cahier des charges ou une opération sensible (données, paiement, migration), demander.
Ne rien construire hors périmètre. Une idée qui surgit devient une entrée de backlog, pas du code immédiat.
Le cahier des charges fait foi ; s'il évolue, la roadmap est mise à jour explicitement, pas contournée.
9. Exécution en boucle supervisée (optionnel)

Les phases 3 et 4 sont répétitives par nature — « pour chaque spec : plan → implémentation → vérification → revue → commit ». C'est exactement une boucle. Si ECC est installé, l'agent loop-operator peut la piloter (/loop-start, /loop-status, /quality-gate) ; sinon, l'agent applique la même discipline manuellement, une spec après l'autre.

La boucle ne remplace jamais les points d'arrêt du §1. Elle tourne entre eux, sous ces conditions :

Périmètre borné. La boucle ne traite que les specs MVP de la roadmap validée (phase 3), ou une tranche de backlog validée (phase 4). Elle ne s'invente pas de travail.
Pattern le plus simple. Séquentiel : une spec à la fois, dans l'ordre des dépendances. Pas d'orchestration parallèle ni de génération de variantes pour un MVP — ce sont des outils pour plus tard, pas pour cadrer un premier produit.
Porte de qualité par itération. Une spec n'est « terminée » qu'après vérification (tests + rendu) et revue des trois contrats. Le relecteur n'est pas l'auteur (contexte séparé).
Arrêt sur blocage. À la moindre stagnation, tempête de retry ou échec répété sur une spec, la boucle se met en pause et remonte le problème — elle ne brûle pas des tokens en rond et ne force pas un contournement.
Arrêts durs respectés. La boucle s'arrête au MVP gate (§6) et à tout point d'arrêt du §1. Elle ne franchit jamais un feu rouge seule.
Reprise propre. specs/ROADMAP.md est la source de vérité de la progression : une boucle interrompue reprend exactement là où elle s'était arrêtée.

En clair : la boucle automatise l'exécution à l'intérieur d'une phase, pas les décisions entre les phases. Ces dernières restent à toi.