# ARCHITECTURE.md — Contrat d'organisation et de qualité

 **Objectif : un code minimal, lisible, organisé et vérifié — pensé comme le ferait un senior expérimenté qui n'écrit que ce qui est nécessaire, et qui le fait bien.**

---

## 0. Comment lire ce fichier

Comme les deux autres contrats (`DESIGN.md`, `SECURITY.md`) : des principes appliqués avec jugement, pas une liturgie. La cohérence avec l'existant prime sur la préférence personnelle — **on suit d'abord les conventions déjà en place dans le projet**, on ne les remplace que si elles posent un vrai problème, et on le dit.

---

## 1. Le principe directeur : le meilleur code est celui qu'on n'écrit pas

Le piège n°1 des agents est la sur-construction : abstractions prématurées, couches inutiles, dépendances superflues, code « au cas où ». On l'attaque à la racine avec cette échelle, appliquée **avant d'écrire quoi que ce soit** :

1. **Est-ce que ça doit exister ?** Si le besoin n'est pas réel et actuel, on ne le construit pas (YAGNI).
2. **Est-ce déjà dans le code ?** On réutilise l'existant avant d'écrire du neuf.
3. **La bibliothèque standard ou une feature native le fait ?** (`<input type="date">` avant un date-picker, `Intl` avant une lib de formatage…)
4. **Une dépendance déjà installée le fait ?** On exploite ce qu'on paie déjà.
5. **Sinon : la version minimale qui marche.** Pas la version extensible, configurable, générique — la version juste.

**Garde-fous absolus — jamais sacrifiés au nom du minimalisme :**
- validation aux frontières de confiance (toute entrée externe),
- gestion des erreurs sur les chemins qui peuvent échouer,
- les règles de `SECURITY.md`,
- l'accessibilité et les états de `DESIGN.md`.

Le minimalisme porte sur la *quantité de construction*, jamais sur la *solidité de ce qui est construit*.

---

## 2. Structure du projet

- **Prévisible.** Un nouveau venu (humain ou agent) doit deviner où vit chaque chose. Arborescence par domaine ou par couche — mais une seule logique, tenue partout.
- **Séparation des responsabilités.** UI, logique métier, accès aux données ne se mélangent pas dans le même fichier. Un module fait une chose.
- **Pas de duplication silencieuse.** Avant de créer un utilitaire, un composant, un helper : vérifier qu'il n'existe pas déjà. S'il existe presque, on l'étend, on ne le clone pas.
- Les fichiers d'agents et de standards (`AGENTS.md`, `WORKFLOW.md`, `ADOPTION.md`, `DESIGN.md`, `SECURITY.md`, `SPEC.template.md`, ce fichier) restent **à la racine** et à jour.

---

## 3. Qualité du code

- **Lisible avant malin.** Un code qu'on comprend en une lecture bat un code compact qu'il faut décoder.
- **Nommage qui dit la vérité** : une fonction fait ce que son nom annonce, rien de plus.
- Fonctions courtes, à une responsabilité. Pas de code mort, pas de blocs commentés laissés « au cas où », pas de `TODO` fantômes.
- **Typé** là où la stack le permet (TypeScript strict plutôt que `any` de confort).
- **Lint + format automatisés** et non discutés : la machine tranche les débats de style, les humains gardent leur attention pour le fond.
- Les commentaires expliquent le **pourquoi** (décision, contrainte, piège), jamais le *quoi* que le code dit déjà.

---

## 4. Tests : vérifier ce qui compte

- On teste **les frontières de confiance et la logique métier** — là où un bug coûte cher — pas les getters pour gonfler un pourcentage de couverture.
- Un bug corrigé gagne un test qui l'empêche de revenir.
- Les tests passent **avant** de merger. Un agent ne déclare jamais une tâche terminée sans avoir exécuté le code, lancé les tests, et pour l'UI, regardé le rendu (capture Playwright).
- « Ça compile » n'est pas « ça marche ».

---

## 5. Documentation minimale mais réelle

- Un `README` qui permet de lancer le projet en partant de zéro (installation, variables d'env via `.env.example`, commandes).
- Les **décisions structurantes** notées en quelques lignes quand elles sont prises (pourquoi cette base, pourquoi ce pattern) — un mini registre de décisions suffit, pas de bureaucratie.

---

## 6. Context engineering — la discipline de l'agent

Le contexte est une ressource qui se dégrade quand on la sature. La règle est la **soustraction, pas l'addition**.

- **Charger seulement ce qui sert la tâche.** On lit les fichiers pertinents, pas le dépôt entier. Les contrats (`DESIGN.md`, `SECURITY.md`, ce fichier) se chargent quand leur domaine est touché.
- **Discipline MCP : moins de 10 serveurs actifs par projet**, choisis pour la tâche ; on peut en avoir vingt de configurés, pas vingt d'activés. Trop d'outils actifs dégradent les décisions.
- **Comprendre avant d'écrire** (research-first) : sur une base existante, on lit le code concerné, on identifie les conventions et les composants réutilisables, *puis* on code. Jamais l'inverse.
- Les connaissances réutilisables (procédures, gabarits, règles métier) vivent dans des **skills chargées à la demande**, pas copiées dans chaque prompt.

---

## 7. Routing de modèles : décider haut, exécuter juste

- Les **décisions structurantes** (architecture, plan, arbitrages, revue finale) vont aux modèles les plus capables.
- L'**implémentation cadrée** (le plan est clair, la tâche est bornée) peut aller à des modèles intermédiaires.
- Le cycle : **plan → validation du plan → exécution → vérification.** Pour toute tâche non triviale, l'agent propose d'abord un plan court ; on n'exécute qu'un plan validé.
- **Ce qu'une validation couvre.** Une validation vaut pour le périmètre qu'elle a explicitement couvert, et le travail à l'intérieur de ce périmètre n'en redemande pas. Dans un projet piloté par `WORKFLOW.md`, la validation du découpage et de la ligne MVP (point d'arrêt 2) vaut donc validation des plans des specs qu'elle couvre — cf. `WORKFLOW.md` §5. Une nouvelle validation redevient nécessaire dès qu'on sort de ce périmètre, qu'une décision structurante non prévue apparaît, ou qu'une opération sensible est en jeu.

---

## 8. Façon de travailler

- **Une chose à la fois.** Petites étapes, petits commits, messages qui disent le pourquoi.
- Pas de refonte opportuniste : on ne « nettoie » pas la moitié du dépôt en corrigeant un bug. Si un refactor s'impose, il devient une tâche à part, annoncée.
- **En cas d'incertitude sur une opération sensible** (suppression de données, migration, paiement, envoi massif), l'agent s'arrête et demande. Deviner coûte plus cher que demander (`AGENTS.md` règle 6).
- Une tâche n'est terminée que vérifiée, et conforme aux trois contrats — au sens du §4.

---

## 9. L'audit cinq piliers

Avant une release majeure — ou périodiquement sur un projet qui vit — on lance un audit selon cinq piliers, chacun confié à une passe (ou un sous-agent) dédiée :

1. **Architecture** — la structure sert-elle encore le produit ? Couplages, frontières, dette structurelle.
2. **Qualité du code** — lisibilité, duplication, code mort, typage, conventions.
3. **Sécurité** — passage complet de la checklist de `SECURITY.md` §13.
4. **Performance** — requêtes N+1, poids du bundle, chemins critiques, temps de réponse.
5. **Scalabilité** — ce qui casse à 10× l'usage : données, files, limites, coûts.

Chaque passe produit des constats **actionnables et priorisés** (critique / important / mineur). Les correctifs repassent en revue jusqu'à épuisement des critiques — une boucle relecteur/testeur, pas un rapport qu'on classe.

---

## 10. Amélioration continue : des standards vivants

À la fin d'un chantier notable (ou après un raté), on prend cinq minutes :
- qu'est-ce qui a bien marché, qu'est-ce qui a frotté, qu'est-ce que l'agent a mal compris ?
- la leçon est-elle **généralisable** ? Si oui, elle est ajoutée au contrat concerné (`DESIGN.md`, `SECURITY.md`, ce fichier ou `AGENTS.md`).

C'est ainsi que le système apprend tes conventions au lieu de répéter les mêmes erreurs. Ces fichiers ne sont pas des monuments : ce sont des outils qu'on affûte.

### Leçons acquises

**Un bilan se vérifie contre le code, jamais contre ses propres messages de commit.** Le bilan d'un chantier de refonte affirmait trois choses fausses : un fichier « corrigé » qui n'avait jamais été modifié depuis l'import du produit, un inventaire « 7 entrées → 1 » quand il en restait six — le message du commit cité disait pourtant le contraire — et un décompte de couleurs restantes divisé par dix, parce qu'il ne comptait que les fichiers de *page* et pas les composants qui font ces écrans. Un bilan faux est plus coûteux qu'un bilan absent : on planifie le lot suivant dessus. Avant d'écrire « fait », on relance la mesure. Un chiffre dans un bilan porte la commande qui l'a produit, ou il n'y figure pas.

**Un test qui sélectionne par une classe de style est une bombe à retardement.** Un test de virtualisation identifiait les lignes de données par `td.border` — donc par leur *bordure*. Le premier restyle l'a fait tomber sans qu'aucun comportement n'ait bougé. Les sélecteurs se prennent sur ce que la page *est* (rôle, nom accessible, `aria-hidden`, texte), jamais sur ce à quoi elle *ressemble*.

**Il faut regarder l'écran, pas seulement les tests.** Trois défauts de ce même chantier — une couleur sémantique qui, répétée sur quarante lignes, tapissait au lieu d'informer ; une pastille de statut verte pour une opération annulée ; un débordement horizontal de 244 px sur mobile — étaient invisibles pour 2 000 tests au vert et n'ont été trouvés qu'à la capture. Le banc de QA visuelle doit couvrir les écrans qu'on modifie, et une doublure qui a divergé du vrai composant est pire qu'une doublure absente : elle donne confiance dans un rendu qui n'existe pas.

**Avant de dessiner une porte, vérifier qu'elle ouvre sur quelque chose.** Un dialogue de confirmation de suppression était prévu, spécifié, prêt à écrire — pour une action dont le bouton était `disabled` en dur et dont le composant de ligne ne lisait même pas la fonction de rappel. Une prop passée n'est pas une prop consommée : on suit la chaîne jusqu'au bout avant de construire par-dessus.

---

## 11. Git, environnements et livraison

**Git**

- Une branche par spec ou par correctif ; pas de travail direct sur la branche principale. Nommage lisible : `feat/S3-export-csv`, `fix/login-rate-limit`, `chore/bump-deps`.
- Un commit par unité cohérente, et au minimum un commit par spec (`WORKFLOW.md` §5). Le message dit **le pourquoi**, pas le *quoi* que le diff montre déjà : première ligne courte, un paragraphe en dessous si la décision mérite d'être expliquée.
- La branche principale reste déployable en permanence. Une branche part en revue quand la spec est terminée et vérifiée (§4) — pas avant : on ne fait pas relire du travail en cours.
- Aucun secret, aucun fichier généré, aucun `.env` dans un commit (`SECURITY.md` §2). Un `.gitignore` couvrant `.env` existe **avant** le premier commit.
- **Cette règle vaut aussi pour le dépôt de standards lui-même.** Toute évolution du pack passe par une branche de correctif et une revue avant intégration ; il n'y a pas d'exception de maintenance. Un contrat qu'on enfreint en le maintenant n'engage plus personne.

**Environnements**

- Trois environnements distincts — `dev`, `staging`, `prod` — cloisonnés comme l'exige `SECURITY.md` §2 : secrets, bases et comptes séparés.
- **Parité raisonnable** : staging tourne les mêmes versions de runtime, de base de données et de dépendances que la production. Un bug qui n'apparaît qu'en prod est d'abord un défaut de parité.
- **Migrations versionnées et rejouables**, appliquées dans l'ordre `dev → staging → prod`, jamais à la main sur la base de production. Une migration destructive se sauvegarde avant et s'annonce (`AGENTS.md` règle 6).
