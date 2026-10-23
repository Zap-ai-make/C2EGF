# Assistant IA — le dossier

Ce dossier prépare l'assistant IA de C2EGF. Il **aiguille**, il ne développe pas.

La source d'origine est `feuillederoute_assistant_ia.md` (racine) : un retour
d'expérience écrit depuis le dépôt SDI, où l'assistant tourne en production. Il
est générique ; les documents ci-dessous l'instancient pour C2EGF.

---

## Le périmètre, décidé par le commanditaire

> **L'assistant ne sert que l'espace boutique** (`store_admin`, `member`).
> Ni l'espace gérant (`system_manager`), ni l'espace dealer.
>
> **Chaque boutique avec ses données. Aucune information de la boutique A ne
> parvient à la boutique B.**

Cette seconde phrase a une conséquence qu'il faut lire avant tout le reste :
c'est la seule exigence du lot que **les règles Firestore ne savent pas tenir**.
Voir `QUESTIONS-DU-COMPTOIR.md` §2.

---

## Les documents

| Document | Ce qu'il tranche |
|---|---|
| `QUESTIONS-DU-COMPTOIR.md` | Le catalogue d'outils, le **trou de cloisonnement** (§2), et les notions voisines que le modèle confondra |
| `LOT-APPCHECK.md` | La condition d'entrée n° 1. Arbitre un **conflit** avec `docs/audit/consolidated/APP_CHECK_RECOMMANDATION.md`. Porte la CSP exacte |
| `COUT-LECTURES.md` | Le coût réel. La taxe des règles est négligeable ; le poste dominant est en **jetons**, et il se multiplie par 84 boutiques |

---

## Les deux décisions bloquantes

Rien de sérieux ne commence avant qu'elles soient tranchées.

1. **`globalClients` est lisible par toute boutique** (`hasProfile()`, sans
   vérification de boutique). C'est délibéré — c'est ce qui a permis de sortir des
   175 grappes de doublons purgées le 2026-10-12 — et ça contredit la consigne
   d'isolation telle qu'énoncée. Trois issues et une recommandation :
   `QUESTIONS-DU-COMPTOIR.md` §2.
2. **Les dettes internes nomment forcément l'autre boutique.** Les mettre dans le
   catalogue d'outils, ou pas ? Recommandation : pas au premier lot.
   `QUESTIONS-DU-COMPTOIR.md` §4.

---

## Où en est le Lot 0

| Condition d'entrée (§9 de la feuille de route) | État |
|---|---|
| Règles = le mur, refus par défaut, testées | ✅ 26 blocs `match`, 20 fichiers de tests — **sauf `globalClients`** |
| Rôle non auto-attribuable | ✅ en document, mais verrouillé — voir ci-dessous |
| Plan Blaze | ✅ |
| Facturation IA sur le compte Google Cloud | ⬜ à choisir — **pas** la cagnotte prépayée |
| API du modèle activée | ⬜ |
| App Check | ❌ `LOT-APPCHECK.md` |
| CSP, les quatre directives | ❌ `LOT-APPCHECK.md` §2.3 |
| Jeton de débogage App Check | ⬜ |

**Sur le rôle.** La feuille de route exige un *custom claim* et interdit un rôle
en document. C2EGF lit le rôle dans `users/{uid}` — mais `update` est borné à
`hasOnly(['lastLogin'])`, `create` est fermé par `profileAllowsSelfRegistration()`
qui vaut `false`, et `delete` est `if false`. **Personne ne peut se promouvoir** :
le risque visé par la feuille de route n'existe pas ici. Le coût résiduel est
chiffré, et il est négligeable.

---

## Deux pièges à connaître avant d'écrire une ligne

1. **`Permissions-Policy: camera=(), microphone=()`** est une liste vide : photo
   et voix (Lot 8) sont impossibles tant qu'elle n'est pas ouverte.
   `LOT-APPCHECK.md` §2.4 dit pourquoi ce n'est pas dans le lot App Check.
2. **`chiffreAffaires()` est hors de portée d'une boutique** — requête de groupe
   réservée au gérant. Un CA boutique se recalcule, avec un risque de divergence
   nommé. `QUESTIONS-DU-COMPTOIR.md` §5.

---

## Ce dossier n'est pas dans `specs/`

`specs/ROADMAP.md` est la source de vérité d'**un** chantier : la refonte de
l'espace dealer. L'assistant IA est un chantier distinct. S'il est lancé, il
prendra sa propre numérotation selon `SPEC.template.md`, et ces documents
deviendront son dossier d'instruction.
