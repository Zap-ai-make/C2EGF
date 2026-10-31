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

## Lot B — l'assistant prépare, la caissière confirme

Décision du responsable (30 octobre 2026) : l'assistant peut faire les
opérations du comptoir, et **la caissière voit et confirme** avant tout
enregistrement.

- **Le modèle n'écrit jamais.** Les outils `preparer_*` rendent une *carte* :
  ce qui partira, dans les mots de l'écran. Seul le bouton « Confirmer » du
  panneau l'exécute. Le modèle reçoit « présentée, rien n'est enregistré » ; le
  message « … enregistré » est écrit par l'application, après l'appel réussi.
- **Les règles sont celles des écrans.** Les cartes passent par
  `utils/preparationTransaction.js`, `utils/reglement.js` et
  `utils/ravitaillement.js`, que les formulaires emploient aussi : l'assistant ne
  peut proposer ni ce que l'écran refuserait, ni refuser ce qu'il permettrait.
- **Un doute est une question.** Deux clients, deux opérations en attente, deux
  livraisons : l'outil rend un choix, et le modèle le pose.
- **Une carte à la fois**, effacée à la question suivante.

| Opération | Outil | Exécuté par |
|---|---|---|
| Dépôt, retrait (validé ou non terminé) | `preparer_transaction` | `addTransaction` |
| « Encaisser », « Payer par » | `preparer_reglement` | `addPaymentTranche` (clé d'idempotence par carte) |
| « Annuler » une non terminée | `preparer_annulation` | `trashTransaction` |
| Ravitaillement, « Retour » | `preparer_ravitaillement`, `preparer_retour` | `runStoreTransactionCommand` |

**Hors du lot, volontairement** : l'effacement de l'historique, « Modifier ».
L'assistant les explique et propose l'écran. (« Vider les soldes » a été retiré
du logiciel le 31 octobre 2026.)

**Ce que le serveur refuserait, la carte ne le propose pas** (30 octobre 2026).
Premier essai réel : « paie le retrait en cash », pas un franc en caisse, et la
carte est venue quand même — le serveur a refusé après « Confirmer », sous un
« la transaction a échoué » qui ne disait pas pourquoi. Les écrans laissent ces
refus au serveur ; une carte, elle, se lit comme une promesse. Désormais :

- la **réserve d'un règlement** se juge avant la carte, en rejouant la fonction
  d'impact du serveur (`applySettlementImpact`, figée par TC-081) sur les
  soldes de l'écran : payer un retrait en Cash demande des espèces (la somme
  de tous les réseaux), en Orange Money du stock Orange ;
- **annuler** une non terminée est refusé si elle a reçu une tranche (même
  liste de champs que le serveur, comparée par TC-314) ou si c'est un retrait
  dont le stock n'est plus là ;
- un refus **dit l'issue** : un autre moyen qui passe, un règlement partiel, ou
  attendre dans les non terminées ;
- au clic sur « Confirmer », la demande est **rejugée** sur l'état de l'instant :
  si la caisse a bougé entre-temps, la carte le dit et rien ne part.

Côté serveur, le même jour : un refus de solde (`financialUtils.js`) est
désormais un refus métier `INSUFFICIENT_STORE_BALANCE` qui garde son message
(« Liquidite insuffisante. Disponible: 0 FCFA »). Il arrivait à l'écran en « La
transaction a échoué. Veuillez réessayer. » (règlements) ou « Une erreur
interne s'est produite. » (toutes les autres commandes de la boutique) — pour
l'assistant comme pour le tableau. TC-315. **À déployer** :
`storeTransactionCommand`, `addTransactionPayment`, `addTransactionRefund`
(commande dans `docs/deployer-les-functions.md`).

**Le modèle voit la caisse.** `etat_de_la_caisse` (`src/lib/ia/caisse.js`) lui
donne le stock par réseau, les espèces, les non terminées et le total caisse —
les chiffres exacts de la barre des soldes, servis par le panneau et non par la
base. La consigne lui dit ce que chaque geste fait au stock et aux espèces.
Tests : TC-308 (IP-33 à IP-39), TC-309 (AC-12 à AC-14), TC-314.

Code : `src/lib/ia/preparations.js` (pur), `src/components/assistant/` (panneau et carte, chargés au premier clic).
Tests : TC-305, TC-307, TC-308, TC-309. Banc visuel :
`preview.html?espace=assistant&carte=transaction|reglement|annulation|ravitaillement|retour`.

## Lot C — la dictée

Le bouton micro du panneau dicte la question **dans le champ**, avec la
reconnaissance vocale du navigateur (`src/lib/ia/dictee.js`). Rien ne part au
modèle avant « Envoyer » : la caissière relit ce qui a été compris, et un
montant mal entendu ne devient pas une carte sans qu'elle l'ait vu. Aucun appel
au modèle de plus. Le micro se coupe en fin de phrase, au second appui, à
l'envoi, à la fermeture du panneau. Navigateur sans reconnaissance (Firefox) :
pas de bouton. Tests : TC-310, TC-309 (AC-09 à AC-11), TC-211.

## Le volet (30 octobre 2026)

À la demande du responsable, l'assistant s'ouvre en volet sur toute la
hauteur, à droite : « Assistant » et la boutique servie en tête, puis
« Nouvelle conversation », « Historique des conversations » et « Fermer ».
Vide, il salue et propose quatre questions toutes faites. Les réponses
s'écrivent lettre par lettre (d'un coup si « mouvement réduit » est demandé),
et les titres, listes et gras du modèle sont mis en forme. Le volet **glisse**
depuis la droite, à l'ouverture comme à la fermeture (300 ms) : fermé, il reste
le temps de sortir, hors d'atteinte du clavier (`inert`), et le focus revient
au bouton de l'assistant.

**L'historique reste sur l'appareil** (`src/lib/ia/conversations.js`), rangé
par personne et par boutique : vingt conversations au plus, avec leur mémoire
pour que le modèle reprenne le fil. Il ne contient que ce que l'écran a montré
à cette personne ; aucune carte en attente n'y est gardée, une opération ne se
confirme qu'en direct. « Effacer l'historique » le vide. Tests : TC-312,
TC-313.

**Lot D (images, fichiers) : abandonné** le 30 octobre 2026, à la demande du
responsable. Rien n'a été écrit ; la caméra reste fermée (`camera=()`).

---

## Deux pièges à connaître avant d'écrire une ligne

1. **`Permissions-Policy`** : le micro est ouvert à notre origine seulement
   (`microphone=(self)`, lot C) ; la caméra reste une liste vide (`camera=()`),
   donc la photo est impossible tant qu'un lot ne l'ouvre pas.
   `LOT-APPCHECK.md` §2.4.
2. **`chiffreAffaires()` est hors de portée d'une boutique** — requête de groupe
   réservée au gérant. Un CA boutique se recalcule, avec un risque de divergence
   nommé. `QUESTIONS-DU-COMPTOIR.md` §5.

---

## Ce dossier n'est pas dans `specs/`

`specs/ROADMAP.md` est la source de vérité d'**un** chantier : la refonte de
l'espace dealer. L'assistant IA est un chantier distinct. S'il est lancé, il
prendra sa propre numérotation selon `SPEC.template.md`, et ces documents
deviendront son dossier d'instruction.
