# ROADMAP — Refonte de l'espace dealer

**Source de vérité de la progression** (`WORKFLOW.md` §3). Une ligne par spec.

Chantier : refonte UI/UX de l'espace dealer, validée sur la proposition v2.
Réseau réel : **84 boutiques**. Contrats applicables : `DESIGN.md`, `SECURITY.md`,
`ARCHITECTURE.md`.

---

## Les specs

| ID | Spec                                          | Dépend de | Périmètre | Statut  |
|----|-----------------------------------------------|-----------|-----------|---------|
| S1 | Caractérisation de l'espace dealer            | aucune    | MVP       | **terminée** |
| S2 | Les caisses en une requête, et l'argent dehors| S1        | MVP       | **terminée** |
| S3 | Le poste — shell de l'espace dealer           | S1        | MVP       | **terminée** |
| S4 | L'accueil — les caisses et la position        | S2, S3    | MVP       | **terminée** |
| S5 | Les files et le geste de ravitaillement       | S3        | MVP       | à faire |
| S6 | Le vocabulaire — « ravitaillement »           | S5        | MVP       | à faire |
| S7 | La règle qui empêche l'arc-en-ciel de revenir | S6        | post-MVP  | à faire |

---

## La ligne MVP

**MVP = S1 → S6.** Le service central de l'espace dealer, c'est : *voir l'état des
caisses du réseau, savoir combien de son argent est dehors, ravitailler, traiter les
retours.* S1 à S5 le rendent. S6 est un renommage sans nouvelle capacité — il est
dans le MVP parce que la décision 4 l'a explicitement demandé « dans ce chantier »,
et il est placé en dernier pour pouvoir être détaché sans rien casser.

**S7 est post-MVP par construction**, et pas par prudence : une règle ESLint qui
interdit les couleurs hors palette bloquerait le travail qu'elle doit protéger si
elle était posée avant. Elle vient après le dernier lot de restyle
(`REFONTE.md` §4 F).

---

## Journal

**Baseline** (branche `feat/design-lot2-dealer`, issue de
`feat/collaborations-dettes-socle-serveur`) :

| | avant S1 | après S1 |
|---|---|---|
| Tests unitaires | 2 173, 74 fichiers | **2 207, 75 fichiers** |
| Tests composants | 297, 18 fichiers | 297, 18 fichiers |
| Tests functions (émulateur) | 275, 10 fichiers | **285, 11 fichiers** |
| Lint · build | propre · passant | propre · passant |

Après S4 : **2 255 unitaires (78 fichiers)** · 297 composants (18) · 285
functions (11) · lint propre · build passant.

⚠ **Le premier relevé de baseline était faux et a été corrigé.** Il annonçait
1 858 tests sur 67 fichiers. Cette exécution s'était terminée sur
« 7 errors — Timeout waiting for worker to respond », que j'avais écartés comme un
incident d'arrêt de worker : c'était en réalité une exécution **dégradée**, qui
sous-comptait huit fichiers. La leçon est celle d'`ARCHITECTURE.md` §4 et du §0 de
`REFONTE.md` : une mesure qui s'accompagne d'erreurs n'est pas une mesure, même
quand la ligne de résumé affiche « passed ». Les chiffres ci-dessus viennent de
deux exécutions complètes et sans erreur.

**S1 — terminée.** Le relevé de couverture a montré que six écrans dealer étaient
déjà tenus par `tc-031`, `tc-041`, `tc-074`, `tc-080`, `tc-087` et `tc-089`.
Quatre ne l'étaient par **aucun** test — dont l'écran d'accueil. `tc-200` couvre
ces quatre-là et eux seuls : `DealerDashboard`, `DealerTransfers`,
`DealerHistory`, `DealerProfile`. **24 tests ajoutés**, zéro assertion sur une
classe CSS.

Trois défauts sont **figés tels quels**, avec un test qui les nomme, pour pouvoir
prouver plus tard qu'ils ont été corrigés et non déplacés :

| Défaut | Corrigé en |
|---|---|
| `storeCount` rend « 2+ » dès que la première page est pleine — donc « 20+ » en permanence à 84 boutiques | S2 |
| « Mes demandes récentes » compte la longueur d'une liste plafonnée à 8 : ce n'est pas un indicateur | S4 |
| `DealerDashboard` a sa **propre** table `TYPE_LABELS` (« Ajout stock ») qui diverge de `DEALER_REQUEST_TYPE_LABELS` (« Ajout de stock ») : deux noms pour le même objet selon l'écran | S6 |

Le troisième n'était pas au plan : trouvé en écrivant le test, il est consigné
ici plutôt que corrigé au passage (`WORKFLOW.md` §8 — ne rien construire hors
périmètre).

**S2 — terminée.** Les 84 soldes passent par une requête de groupe
(`collectionGroup`), le motif que l'espace admin utilise déjà et que les règles
autorisent déjà au dealer — **aucune règle élargie**. Deux compteurs
`flux.envoyeCumul` / `flux.revenuCumul` vivent sur `dealerBalances/{uid}`, écrits
dans les transactions qui existaient. Le seuil bas est un champ du profil client.

Quatre choses apprises en écrivant le code, détaillées dans la spec :

| | |
|---|---|
| **Une annonce corrigée** | Le gain est en **allers-retours** (≈90 → 2), pas en lectures facturées. Firestore facture au document lu : on lit toujours 84 soldes. Le critère d'acceptation a été réécrit. |
| **Une régression évitée** | Le compteur, écrit en `set(merge)`, créait `dealerBalances` — ce qui aurait fait passer la garde d'amorçage de `confirmDealerRequest` pour « inventaire amorcé », qui aurait alors levé `INSUFFICIENT_DEALER_BALANCE` à la confirmation suivante. **Un compteur d'affichage aurait bloqué tous les ravitaillements.** Attrapé par `tc-069 [CO-A]`. |
| **Un type exclu** | `open_day` fixe les soldes sans débiter le dealer : il ne compte pas. |
| **⚠ Une identité plus fine — pour S4** | `somme des caisses + retours en attente = solde initial + envoyé − revenu`. La boutique est débitée à la **création** du retour, le compteur avance à la **confirmation**. La ligne « en transit » devient le terme qui réconcilie, au lieu d'être décorative. Et « cuves + dehors » n'est **pas** conservé : un envoi de liquidité part vers Orange, hors inventaire suivi. |

**S3 — terminée.** La barre latérale porte les cuves en permanence, la
navigation en deux groupes avec son invariant de compteur exécutable, et le
compte en pied. `DealerInventoryBar` cesse d'être une bande dans `<main>` :
elle devient un rail, et rend au contenu la centaine de pixels qu'elle prenait
sur chaque écran. `DealerHome.jsx`, mort, est supprimé. Zéro emoji, zéro couleur
hors palette dans le shell.

Le banc d'essai monte désormais le poste : `preview.html?espace=dealer`, avec
`&cuves=basses` et `&cuves=vides`. Les doublures rendent **84 boutiques** — S4
en aura besoin, et un écran vérifié à trois lignes ne prouve rien à
quatre-vingt-quatre.

**Deux défauts que seule la capture pouvait montrer** — ni les tests ni le lint
ne les voyaient :

| Défaut | Leçon |
|---|---|
| L'anneau d'alerte d'une cuve basse était `ring-warn` (#8a5a00), une teinte pour fond **clair** : invisible sur le marine de la barre. | Un jeton sémantique n'est pas neutre au fond sur lequel on le pose. La paire `warn` / `warn-soft` existe pour ça. |
| À 390 px, le résumé des cuves tronquait « FCFA » **puis le mot « bas »** — le seul signal d'alerte de l'en-tête, sur l'écran où il compte le plus. | Ce qui rétrécit doit être le nombre, jamais l'alerte (`shrink-0`). |

**Et un mensonge de test, trouvé en supprimant le fichier mort.**
`tc-028` mockait `DealerHome` et son test A-12 s'appelait « → DealerHome
rendu ». La route rend `DealerDashboard` ; le test passait parce que les deux
portaient le même `data-testid`. Mock retiré, test renommé.

**S4 — terminée.** L'accueil répond aux deux questions du matin : les 84
caisses sur une échelle commune, le seuil bas en filet continu, et « mon argent
dehors » rapproché de la somme des caisses. Les quatre `StatCard` à émoji ont
disparu, la table des demandes aussi — elle doublait l'écran
« Ravitaillements » avec ses propres libellés.

Les trois défauts figés par S1 sont maintenant tenus **à l'envers** dans
`tc-200` : un test exige la correction et nomme le défaut qu'il remplace.

| Défaut figé en S1 | Sort |
|---|---|
| « 20+ » boutiques en permanence | corrigé : le total exact, par la requête unique de S2 |
| « Mes demandes récentes » = longueur d'une tranche de 8 | supprimé avec les tuiles |
| « Ajout stock » ≠ « Ajout de stock » | résolu **par suppression** de l'écran qui portait la table locale. ⚠ Les trois écrans **admin** gardent chacun leur copie : hors chantier. Il reste donc à S6 le **renommage**, pas la déduplication. |

**Trois défauts que seule la capture pouvait montrer** — aucun visible dans un
test, un lint ou une relecture :

| Défaut | Leçon |
|---|---|
| Le filet du seuil **dérivait de 4,7 px** sur 84 lignes : la colonne des montants était dimensionnée à son contenu. | Un repère partagé n'existe que si la sonde le mesure. Largeur fixe → amplitude **0,00 px**. |
| Le filet était **invisible sur les barres de liquidité** (`ink-muted` sur `brand-400` = **1,03:1**), donc absent des lignes qu'on voulait écarter d'un coup d'œil. | S3 disait « un jeton n'est pas neutre au fond qui le porte ». Ici il y a **trois** fonds : le repère doit porter son propre contraste. |
| « 3 caisses **n'aont** pas pu être lues » — pluralisation assemblée par morceaux, sur un avertissement qui parle d'argent manquant. | Une phrase bascule en entier, verbe compris. Deux occurrences corrigées. |

**Une mesure assumée, pas masquée.** La barre de stock (`net-orange` sur
`brand-100`) est à **2,23:1**, sous le 3:1 de WCAG 1.4.11. Aucune piste ne
corrige ce chiffre : `#FF6B35` plafonne à 2,84:1 même sur blanc, ce
qu'`index.css` documente déjà. L'encodage est redondant de bout en bout
(montant exact écrit, colonne intitulée, mot « bas »). Sortir le stock de
l'identité opérateur ou ajouter un orange assombri sont des **décisions de
palette**, à prendre avec le client, pas des choix d'écran.

**⚠ Un défaut fonctionnel trouvé en chemin, pour S5.** `NewDealerRequest`
appelle `listActiveStores()` **une seule fois**, sans pagination : son menu ne
propose que **20 boutiques sur 84**, et un `?storeId=` visant l'une des 64
autres est silencieusement effacé. Le formulaire de ravitaillement ne peut donc
pas atteindre les trois quarts du réseau. Ce n'est pas du dessin — c'est la
raison pour laquelle l'action « ravitailler cette boutique » n'a **pas** été
posée sur les lignes de l'accueil.

**Et un écran qui fait désormais double emploi.** `DealerStores` montre les
mêmes caisses en 20-par-page, avec une requête de solde par boutique et une
recherche limitée à la page. Il n'est pas supprimé : rien dans S4 ne le
demandait, et supprimer un écran routé se décide avec le client.

---

## Les décisions qui cadrent ce chantier

Tranchées avec le client sur la proposition v2 :

1. **L'agrégat** — oui. Portée réduite après vérification du code (voir S2) : le
   gros du travail est côté client, le serveur ne reçoit que deux compteurs.
2. **Le seuil bas** — un seuil **unique** pour tout le réseau, pour commencer.
   Champ nommé du profil client, jamais une constante dans un composant.
3. **Les transferts entre boutiques** — hors de ce chantier. Le module
   collaborations existe mais tous ses abonnements sont indexés par `storeId` ;
   ouvrir cette vue au dealer est un chantier à part (droits, règles, écran).
4. **« Demande » → « ravitaillement »** — oui, dans ce chantier. C'est S6.

---

## Ce que ce chantier ne touche pas

Le modèle de données et le fonctionnement métier. Aucun champ Firestore renommé ou
supprimé, aucune modification des flux de transaction, du calcul des soldes, des
rôles ou des permissions. Les deux compteurs de S2 sont un **ajout**, et ils
n'entrent dans aucun calcul de solde.
