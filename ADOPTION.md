# ADOPTION.md — Reprendre un projet existant

---

## 0. Le principe

On n'arrive pas en conquérant. Un projet existant a une histoire, des conventions, des contraintes : on comprend d'abord, on audite ensuite, on corrige par priorité, et à partir de là tout nouveau code respecte intégralement les contrats. Pas de big-bang, pas de refonte générale.

**Trois points d'arrêt obligatoires :**

1. **Après l'audit** — le bilan et le plan de remédiation sont présentés ; rien n'est corrigé sans validation.
2. **Après le lot critique** — démonstration des corrections critiques avant d'enchaîner.
3. **Au bilan final** — état des lieux de sortie, reste à faire assumé.

Une seule exception à l'arrêt n°1 : **un secret exposé découvert pendant l'audit se signale immédiatement** (et se révoque/régénère, cf. `SECURITY.md` §2) — ça n'attend pas la fin du rapport.

---

## 1. Phase 0 — État des lieux

- Lire le code avant de le juger (research-first, `ARCHITECTURE.md` §6) : stack, structure des dossiers, points d'entrée, dépendances, scripts, conventions en place.
- Remplir le bloc projet d'`AGENTS.md` (nom, quoi, stack, lancer, tester, particularités).
- Noter les conventions existantes : **elles priment** (`ARCHITECTURE.md` §0). On ne les remplace que si elles posent un vrai problème — et ça se justifie dans le bilan, pas en silence.

---

## 2. Phase 1 — L'audit complet

Trois passes, dans cet ordre :

1. **Sécurité d'abord** — la checklist `SECURITY.md` §13 en entier : secrets dans le code ou l'historique git, hachage des mots de passe, contrôle d'accès/IDOR, RLS, validation des entrées, HTTPS/CORS, erreurs et logs, dépendances, sauvegardes.
2. **Les cinq piliers** — l'audit d'`ARCHITECTURE.md` §9 : architecture, qualité du code, sécurité (croisement avec la passe 1), performance, scalabilité.
3. **L'interface** — le passage `DESIGN.md` §14 sur les écrans principaux : états manquants, accessibilité, emojis bruts, esthétique générique, cohérence.

Chaque constat est consigné avec : **zone/fichier concerné · problème · correction proposée · effort estimé (S/M/L)**, et classé **CRITIQUE / IMPORTANT / MINEUR**.

---

## 3. Le bilan d'audit (livrable central)

L'agent rédige `audit/BILAN.md` :

- **Synthèse** — l'état du projet en quelques paragraphes honnêtes : ce qui est sain, ce qui inquiète, le niveau global vis-à-vis des trois contrats.
- **Constats classés** — la liste complète, par priorité.
- **Plan de remédiation par lots :**
  - Lot 1 — critiques de sécurité (toujours en premier),
  - Lot 2 — autres critiques,
  - Lot 3 — importants,
  - les mineurs restent en backlog, traités au fil de l'eau.

**Point d'arrêt 1 :** présentation du bilan et du plan, validation humaine du périmètre des lots. Rien n'est modifié avant.

---

## 4. Phase 2 — Remédiation par lots

- Un lot à la fois, dans l'ordre validé. Chaque correction se traite comme une mini-spec : **plan court → correction minimale → vérification (tests + rendu si UI) → revue contre le contrat concerné → commit.**
- Pas de refonte opportuniste (`ARCHITECTURE.md` §8) : on corrige le constat, pas la moitié du dépôt. Si un refactor lourd s'impose, il devient une entrée à part du plan, validée séparément.
- La phase peut tourner en boucle supervisée (`WORKFLOW.md` §9, `loop-operator` si ECC présent), bornée au lot validé — mêmes garde-fous : arrêt sur blocage, porte de qualité par correction, jamais au-delà du lot.

**Point d'arrêt 2** après le ou les lots critiques : démontrer, puis feu vert pour la suite.

---

## 5. Phase 3 — Conformité au fil de l'eau

Une fois les lots validés traités :

- **Tout nouveau code respecte intégralement les trois contrats.** Aucune exception « parce que le legacy fait autrement ».
- **Règle du boy-scout** : quand une tâche touche un fichier legacy, on le laisse un peu plus propre — dans le périmètre de la tâche, sans déborder.
- Le backlog des constats restants vit dans `audit/BILAN.md`, tenu à jour ; une nouvelle demande produit une spec (`SPEC.template.md`) comme en `WORKFLOW.md` phase 4.

---

## 6. Le bilan final

À la clôture des lots validés, l'agent met à jour `audit/BILAN.md` :

- **Corrigé** — chaque constat traité, avec le commit correspondant.
- **Restant** — ce qui demeure, assumé et priorisé.
- **Recommandations** — les deux ou trois chantiers qui apporteraient le plus, pour plus tard.

**Point d'arrêt 3 :** ce bilan final est le document de référence de l'état du projet. Il se présente, il ne s'enterre pas.
