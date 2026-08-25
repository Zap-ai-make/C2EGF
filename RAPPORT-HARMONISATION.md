# RAPPORT-HARMONISATION.md

Audit et harmonisation du pack de standards, exécutés selon `PROMPTS.md` (Prompt 1).
Plan présenté et validé avant toute modification. Ce rapport sert de base à la revue indépendante (Prompt 2).

---

## 1. Périmètre et méthode

Neuf fichiers lus intégralement avant toute modification :

`AGENTS.md`, `CLAUDE.md`, `WORKFLOW.md`, `DESIGN.md`, `SECURITY.md`, `ARCHITECTURE.md`, `SPEC.template.md`, `ECC.md`, `PROMPTS.md`.

Aucun autre fichier, aucun sous-dossier. Le fichier annoncé sous le nom `ECC-INTEGRATION.md` dans `PROMPTS.md` existe en réalité sous le nom `ECC.md`.

**Trois arbitrages ont été soumis avant exécution**, et ont orienté le travail :

1. Format — harmoniser tous les fichiers sur le gabarit d'`ARCHITECTURE.md`.
2. Manques à combler — conventions git, environnements dev/staging/prod, gabarit `specs/ROADMAP.md`. Versioning/releases écarté.
3. `ECC.md` — réécrire en voix contrat et brancher au pack, **sans** intégrer ses six conventions chiffrées.

**Contrainte transversale tenue : aucune section n'a été renumérotée.** Toute section nouvelle a été ajoutée en fin de fichier. C'est ce qui garantit que les renvois `§N` existants — tous vérifiés valides avant modification — le restent après.

---

## 2. Ce qui a été vérifié

Contrôle mécanique par script, exécuté après application. Les huit contrôles passent.

| Contrôle | Résultat |
|---|---|
| Renvois `<FICHIER>.md §N` — la section citée existe dans le fichier cité | OK |
| Renvois internes `§N` — la section existe dans le fichier courant | OK |
| `AGENTS.md` ne contient aucun `§N` pendant (il n'a pas de sections numérotées) | OK |
| Tout fichier `.md` mentionné existe sur disque | OK |
| Aucun emoji (catégories Unicode `So`/`Sk`) | OK |
| Cases à cocher bien formées, aucune ligne à espace nue | OK |
| Titre H1 et sections `##` présents dans chaque fichier | OK |
| **Non-régression du contenu protégé** | OK |

**Le contrôle de non-régression a lui-même été validé par test de mutation.** Sur une copie du pack, deux dégradations ont été injectées : suppression de la règle IDOR (`SECURITY.md` §4) et affaiblissement du point d'arrêt 1 (`WORKFLOW.md` §1). Le contrôle a détecté les deux. Un « tout passe » sur un contrôle incapable d'échouer n'aurait rien prouvé.

Le contenu placé sous protection : `WORKFLOW.md` §1 (les trois points d'arrêt), `SECURITY.md` §1 à §11 (tous les non-négociables), `DESIGN.md` §5, §8, §10, §11 (contraste, emoji, états, accessibilité), `ARCHITECTURE.md` §1 (l'échelle en cinq points et les garde-fous absolus). La comparaison se fait phrase par phrase contre l'état d'origine, insensible au reformatage.

**Vérification indépendante possible** — le script et la copie d'origine sont conservés hors du pack, dans le répertoire de travail temporaire de la session (`scratchpad/verif.py` et `scratchpad/avant/`). Ils ne font pas partie du pack et ne seront pas copiés dans les projets.

---

## 3. Modifications appliquées

Catégories : **[BR]** branchement cassé · **[CO]** contradiction · **[DO]** doublon · **[MA]** manque · **[HA]** harmonisation.

### CLAUDE.md

| Cat. | Modification | Raison |
|---|---|---|
| BR | `« Lis et applique AGENTS.md. »` → `Lis et applique AGENTS.md.` | Les guillemets faisaient de la ligne une citation plutôt qu'une directive. C'est littéralement ce que prescrit `AGENTS.md`, Note d'installation. |

### AGENTS.md

| Cat. | Section | Modification | Raison |
|---|---|---|---|
| BR | Nouveau projet | Section ajoutée, renvoyant à `WORKFLOW.md` et à `SPEC.template.md` | **Défaut le plus grave trouvé** : `WORKFLOW.md` n'était cité nulle part dans le point d'entrée. Le pipeline complet — dont les trois points d'arrêt — était inatteignable depuis la source unique de vérité. |
| BR | Ordre de préséance | Section ajoutée | Rien ne fixait quel fichier l'emporte en cas de conflit. La hiérarchie est désormais explicite et sans boucle. |
| BR | Note d'installation | Liste des fichiers à copier complétée | Elle n'en listait que quatre : un projet installé selon cette note perdait `WORKFLOW.md` et `SPEC.template.md`. |
| BR | Ordre de préséance | `ECC.md` déclaré annexe optionnelle | Le fichier était orphelin ; il est désormais situé dans la hiérarchie, sans primauté. |
| DO | Règles permanentes | Chaque règle porte son contrat d'origine (`→ SECURITY.md §2`, etc.) | Les règles permanentes restent — elles sont chargées en permanence et c'est voulu. Mais elles cessent d'être une seconde source de vérité : elles deviennent un index vers le domicile de chaque règle. |
| HA | En-tête | Titre H1 ajouté, deux lignes vides d'ouverture supprimées | Le fichier ouvrait sur du vide. |

### WORKFLOW.md

| Cat. | Section | Modification | Raison |
|---|---|---|---|
| CO | §0 | « les **quatre** contrats : AGENTS.md, DESIGN.md, SECURITY.md, ARCHITECTURE.md » → « sous `AGENTS.md` et les trois contrats » | Le fichier se contredisait lui-même : §0 disait quatre, §5 disait trois. Et il contredisait `AGENTS.md`, qui en compte trois. `AGENTS.md` est le point d'entrée, pas un contrat de même niveau. |
| MA | §3 | Emplacement des specs (`specs/S<n>-<slug>.md`) et gabarit de tableau pour `specs/ROADMAP.md` | §3 et §9 font de `ROADMAP.md` la source de vérité de la progression sans jamais décrire sa forme ni où vivent les specs. |
| BR | §5, §9 | Renvois explicites à `ECC.md` sur `planner` et `loop-operator` | Le workflow s'appuyait sur des composants ECC sans jamais dire où ils sont documentés. |
| DO | §5 | Renvoi à `ARCHITECTURE.md` §4 sur « ça compile n'est pas ça marche » | Formulation présente à trois endroits ; domicile fixé en `ARCHITECTURE.md` §4. |
| BR | §5 | Renvoi à `ARCHITECTURE.md` §11 sur le commit | Le commit par spec renvoie désormais à la convention qui le définit. |
| HA | Tout | Titre H1, sections `##`, listes à puces | Les sections étaient du texte brut alors que tout le pack les référence en `§N`. |

**Intouchés, mot pour mot** : les trois points d'arrêt du §1 et les six conditions de la boucle supervisée du §9. Vérifié par le contrôle de non-régression.

### DESIGN.md

| Cat. | Section | Modification | Raison |
|---|---|---|---|
| HA | §1 | `#F4F1EA` et `#D97757` réintégrés dans leur phrase, en code inline | Les deux hex étaient coupés en début de ligne : Markdown les rendait en **titres H1**, au milieu d'une liste de patterns à fuir. Bug de rendu visible. |
| HA | §14 | Cases `- [ ]` restaurées | Les marqueurs avaient été perdus ; la checklist ne se cochait pas. |
| HA | Tout | Titre H1, sections `##`, listes à puces, blocs de code | Idem `WORKFLOW.md`. |

**Intouchés** : §5, §8, §10, §11 — contraste AA, aucun emoji brut, tous les états, accessibilité. Hors reformatage, le contenu de `DESIGN.md` est inchangé (+2 mots de prose sur 2 149).

### SECURITY.md

| Cat. | Section | Modification | Raison |
|---|---|---|---|
| MA | §2 | Bloc « Cloisonnement par environnement » : un jeu de secrets par environnement, staging isolé de la production, données de production interdites en dev et staging | §12 et §14 supposaient un « staging isolé » qui n'était défini nulle part. Placé dans §2 plutôt qu'en section nouvelle : c'est la même leçon que les secrets, et cela évite toute renumérotation. |
| MA | §13 | Ligne de checklist ajoutée sur le cloisonnement par environnement | Pour que l'ajout au §2 soit réellement vérifié avant déploiement. |
| BR | §12, §14 | Renvoi au §2 sur le staging isolé ; renvoi à `ECC.md` sur AgentShield | Les deux mentions pointaient dans le vide. |
| HA | §13 | Cases `- [ ]` restaurées | Idem `DESIGN.md`. |
| HA | Tout | Titre H1, sections `##`, listes à puces | Idem. |

**Intouchés** : §1 à §11 en entier, tous non-négociables. Vérifié par le contrôle de non-régression.

### ARCHITECTURE.md

Déjà au format de référence ; trois modifications ciblées.

| Cat. | Section | Modification | Raison |
|---|---|---|---|
| BR | §2 | Liste des fichiers « à la racine » complétée avec `WORKFLOW.md` et `SPEC.template.md` | Même omission que dans la note d'installation d'`AGENTS.md` ; les deux listes sont désormais cohérentes. |
| DO | §8 | « Terminé = exécuté, testé, vérifié » remplacé par un renvoi au §4 | Le fichier énonçait deux fois la même règle. Doublon interne. |
| MA | §11 (nouvelle) | Section « Git, environnements et livraison » : nommage de branche, format de message de commit, moment de la revue ; parité dev/staging/prod, migrations versionnées | `WORKFLOW.md` §5 et `ARCHITECTURE.md` §8 exigeaient « un commit propre par spec » sans qu'aucun format soit fixé nulle part. Ajoutée en fin de fichier pour ne casser aucun renvoi §1-§10. |

**Intouché** : §1 en entier — l'échelle en cinq points et les garde-fous absolus.

### SPEC.template.md

| Cat. | Modification | Raison |
|---|---|---|
| HA | En-tête Statut / Périmètre / Dépend de éclaté en bloc lisible | Les trois champs étaient écrasés sur une seule ligne. |
| HA | Titre-gabarit, sections `##`, cases `- [ ]` restaurées | Cohérence avec le reste du pack. |
| MA | Ligne d'emplacement `specs/S<n>-<slug>.md` ajoutée | Cohérence avec l'ajout au `WORKFLOW.md` §3. |

### ECC.md

| Cat. | Modification | Raison |
|---|---|---|
| CO | Suppression de « Dis-moi si tu veux que je répercute ces six points dans ARCHITECTURE.md » et des adresses personnelles (« Très pertinent pour toi ») | Une question ouverte adressée au lecteur, laissée dans un fichier de référence, sans réponse possible. Voix de conversation, pas voix de contrat. |
| CO | « tes **quatre** fichiers standards couvrent déjà l'essentiel » → le pack complet | Le pack en compte six, plus un gabarit. |
| BR | En-tête : statut d'annexe optionnelle, ne prime sur aucun contrat | Le fichier était orphelin et sans statut déclaré. |
| HA | Liste d'installation numérotée réparée | Les étapes 2 et 3 étaient collées en milieu de paragraphe, illisibles. |
| HA | Titre H1, sections `##` numérotées | Cohérence. |

Le fond est conservé : noyau d'agents, sources officielles uniquement, installation légère, règle de non-forçage.

### PROMPTS.md

| Cat. | Modification | Raison |
|---|---|---|
| BR | `ECC-INTEGRATION.md` → `ECC.md` | Le fichier demandé n'existe pas sous ce nom. Seule modification apportée à ce fichier : le reste est votre procédure. |

---

## 4. Effet sur le volume

Le principe de soustraction demandait un pack **plus clair, pas plus gros**. Il sort plus clair, et légèrement plus gros. Mesure honnête, hors échafaudage Markdown (puces, séparateurs, marqueurs de titre) :

| Fichier | Avant | Après | Delta |
|---|---:|---:|---:|
| `AGENTS.md` | 394 | 590 | +196 |
| `ARCHITECTURE.md` | 1 109 | 1 318 | +209 |
| `CLAUDE.md` | 6 | 4 | -2 |
| `DESIGN.md` | 2 149 | 2 151 | +2 |
| `ECC.md` | 1 059 | 1 082 | +23 |
| `SECURITY.md` | 1 648 | 1 789 | +141 |
| `SPEC.template.md` | 178 | 200 | +22 |
| `WORKFLOW.md` | 1 154 | 1 251 | +97 |
| **Total (prose)** | **7 697** | **8 385** | **+688 (+8,9 %)** |

La croissance est concentrée là où du contenu a été explicitement demandé : la section git/environnements d'`ARCHITECTURE.md`, le branchement et la préséance d'`AGENTS.md`, le cloisonnement par environnement de `SECURITY.md`, le gabarit de roadmap de `WORKFLOW.md`. `DESIGN.md`, où aucun contenu n'était demandé, est à +2 mots sur 2 149 : purement reformaté.

Aucune règle n'a été supprimée. La soustraction a porté sur les doublons — transformés en renvois — pas sur le volume brut.

---

## 5. Proposé, non appliqué

| Sujet | Raison |
|---|---|
| **Versioning et schéma de release** | Manque réel : `ARCHITECTURE.md` §9 parle d'« avant une release majeure » sans définir ce qu'est une release ni de schéma de version. Écarté sur votre arbitrage. Reste à trancher si un projet du pack part en distribution publique. |
| **Les six conventions chiffrées d'ECC** — immutabilité, fonctions < 50 lignes et fichiers 200-400 lignes, règle des 20 % de fenêtre de contexte, enveloppe d'API cohérente, deux portes de revue, couverture 80 % | Écartées sur votre arbitrage. Conservées dans `ECC.md` §6 sous forme de tableau, avec le contrat visé pour chacune, explicitement marquées comme non appliquées. Elles rendraient le pack plus précis mais plus prescriptif — l'arbitrage est un choix de philosophie, pas un oubli. |
| **Fusion de `PROMPTS.md` dans le pack** | Non proposé à l'application. `PROMPTS.md` est votre procédure de travail (boucle exécutant/relecteur), pas un standard destiné aux projets. Il n'a pas vocation à être copié à la racine des projets et n'a donc pas été harmonisé sur le gabarit des contrats. |

---

## 6. Points d'attention pour la revue

Trois endroits où un relecteur devrait porter son regard en priorité :

1. **L'ordre de préséance ajouté dans `AGENTS.md`** est une règle nouvelle, pas une reformulation. Ses deux réserves — les non-négociables ne cèdent pas ; entre contrats, on tranche vers l'option qui expose le moins — sont dérivées de `SECURITY.md` §0, mais elles constituent une interprétation. À valider.

2. **Le placement du cloisonnement par environnement dans `SECURITY.md` §2** plutôt qu'en section autonome est un compromis assumé : il évite de renuméroter §3 à §14 et de casser les renvois d'`ECC.md`, d'`ARCHITECTURE.md` §9 et de `WORKFLOW.md` §6. Un relecteur pourrait juger qu'il mérite sa propre section.

3. **La section §11 d'`ARCHITECTURE.md`** fixe des conventions git qui n'existaient nulle part. Le nommage de branche proposé (`feat/`, `fix/`, `chore/`) est une convention courante, pas une déduction du pack existant. À confirmer ou à remplacer par la vôtre.
