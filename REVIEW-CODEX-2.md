# REVIEW-CODEX-2.md — Contre-revue indépendante

Seconde passe effectuée après les corrections consignées dans `RAPPORT-HARMONISATION.md` §7. Aucun fichier existant n'a été modifié ; ce rapport est le seul livrable créé.

## 1. Périmètre et vérifications exécutées

Contrôle des fichiers du pack, des deux rapports, de `PROMPTS.md` et de `.harmonisation/verif.py`.

- L'arbre Git est propre ; le tag `origine` et les trois commits annoncés existent.
- `python .harmonisation/verif.py` réussit : neuf contrôles passent, avec les trois dérogations de sécurité annoncées.
- `git diff --check origine..HEAD` ne relève aucun défaut d'espacement.
- Les huit empreintes SHA-256 courtes publiées dans `RAPPORT-HARMONISATION.md` §2 correspondent aux fichiers actuels.

## 2. Réexamen des six constats initiaux

| Constat | État | Motif |
|---|---|---|
| C1 — validation des plans | Validé | `WORKFLOW.md` §5 et `ARCHITECTURE.md` §7 définissent le périmètre couvert par le feu vert MVP et les trois cas de retour vers l'humain. |
| C2 — secret et `.env` | Validé | `SECURITY.md` §2 et `AGENTS.md`, règle 2, distinguent désormais développement local et environnements partagés. |
| C3 — exigence et outil | Validé | `SECURITY.md` §0, `SECURITY.md` §2 et `SECURITY.md` §9 rendent le contrôle obligatoire, sans imposer GitGuardian ou Snyk. |
| C4 — commande ECC | Partiellement traité | L'avertissement est correct mais la commande non vérifiée reste dans le parcours d'installation ; voir constat important 1. |
| C5 — preuves de vérification | Partiellement traité | Le contrôle est reproductible pour l'avenir, mais l'authenticité historique de la référence reste à qualifier ; voir constat important 2. |
| C6 — titres H1 | Validé | Le rapport restreint le contrôle aux documents concernés et le script vérifie séparément l'unique directive de `CLAUDE.md`. |

## 3. Constats restants

### IMPORTANT — `ECC.md` §4

**Problème.** Le document conserve la recette `npx ecc install --profile minimal --target claude`, suivie d'un avertissement demandant de ne pas l'exécuter sans vérification. La protection est donc explicite, mais l'instruction opérationnelle reste inexécutable en l'état et peut être copiée sans son avertissement. La documentation officielle actuelle distingue le paquet `ecc-universal` et présente des commandes fondées sur ce paquet ; elle ne permet pas de conserver `npx ecc` comme recette vérifiée.

**Suggestion.** Retirer la ligne `npx ecc install …` jusqu'à ce qu'elle soit vérifiée, ou la remplacer par la commande officielle documentée pour le harness ciblé, avec sa source et sa date de vérification. La voie plugin déjà listée peut rester la seule procédure disponible entre-temps.

### IMPORTANT — `RAPPORT-HARMONISATION.md` §2 ; commit `b6c6251` (tag `origine`)

**Problème.** La vérification est maintenant reproductible à partir du dossier, ce qui est une amélioration substantielle. Toutefois, le message du commit de référence indique que l'état « avant audit » a été **reconstitué** pour servir de référence. Le diff depuis `origine` prouve donc l'absence de régression par rapport à cette reconstruction, mais ne prouve pas, indépendamment, que celle-ci est l'état réellement présent avant la première harmonisation.

**Suggestion.** Corriger le rapport pour distinguer clairement : (1) la traçabilité future, désormais reproductible ; (2) la fidélité historique du premier audit, fondée sur une référence reconstituée et non sur un instantané capturé avant modification. Pour les prochaines passes, créer et protéger le tag de référence avant toute écriture.

### IMPORTANT — `SECURITY.md` §2 ; racine du dépôt

**Problème.** `SECURITY.md` §2 exige que `.env` soit dans `.gitignore`, mais ce dépôt Git ne contient pas de `.gitignore`. Le pack ne fournit donc aucun mécanisme concret pour satisfaire sa propre exigence lorsqu'il sert de point de départ à un nouveau projet.

**Suggestion.** Ajouter un `.gitignore` minimal au pack — au moins `.env` et les variantes sensibles, tout en conservant `.env.example` — et inclure ce fichier dans la procédure d'installation. Si le fichier doit rester propre à chaque stack, écrire explicitement dans `AGENTS.md` l'étape obligatoire qui le crée avant tout secret.

### MINEUR — `ARCHITECTURE.md` §11 ; historique Git

**Problème.** Les commits d'harmonisation et de correction sont appliqués directement sur `master`, alors que `ARCHITECTURE.md` §11 impose une branche par correctif et interdit le travail direct sur la branche principale. Aucune exception pour la maintenance du pack n'est documentée.

**Suggestion.** Ne pas réécrire cet historique sans raison ; appliquer la règle aux prochaines évolutions du pack, via une branche de correctif puis revue avant intégration. Si une exception de dépôt de standards est voulue, la documenter explicitement.

## 4. Verdict

**VALIDÉ AVEC RÉSERVES.**

Les corrections répondent correctement à quatre des six constats de la première revue, et les contrôles mécaniques ainsi que les empreintes publiées sont cohérents. Les trois réserves importantes sont circonscrites : elles concernent une recette d'installation ECC encore non vérifiée, la portée probatoire de la référence Git reconstruite et l'absence de `.gitignore`. Aucune régression critique des points d'arrêt, de la sécurité ou de l'accessibilité n'a été observée.
