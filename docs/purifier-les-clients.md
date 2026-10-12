# Purifier la liste des clients

> Chantier du 2026-10-11 au 2026-10-12. Base passée de **16 127** à **15 679** fiches.

## Ce qu'on croyait, et ce que la base a dit

La demande partait d'un écart : « on a normalement 13 000 clients, le logiciel en
enregistre plus de 16 000 ». L'hypothèse naturelle était donc ~3 000 doublons.

**Elle était fausse.** La règle la plus large — mêmes nom et prénom — comptait bien
4 196 fiches « en trop », mais le croisement avec les identifiants agent a tranché :

| Grappes de même nom | Verdict |
|---|---|
| 1 901 | identifiants agent **tous différents** → commerces distincts, à garder |
| 2 | un seul identifiant → doublon confirmé |
| 2 | mélange → à regarder |

Un identifiant agent désigne un commerce. Les 44 fiches « OUEDRAOGO SOULEYMANE »
sont 44 commerçants homonymes, pas 44 doublons. Les vrais doublons étaient **~473**.

L'écart avec le compte de la boutique est donc à chercher ailleurs : commerces
fermés jamais retirés, ou périmètre du comptage.

## La règle de comparaison

Donnée par la boutique : **le code agent d'abord, le numéro seulement à défaut.**
Une fiche a donc UNE identité, pas une liste. Implémentée dans
`identiteAgent()` ([scripts/lib/doublonsClients.mjs](../scripts/lib/doublonsClients.mjs)),
qui délègue le tri code/numéro à `champsAgent()` de l'application — pour que le
rapport range les fiches exactement comme l'écran les montre.

Répartition réelle : 97 % identifiées par un code, 3 % par un numéro, 0 % sans
identité lisible.

## Les quatre lots, et ce qui a été exécuté

| Lot | Règle | Grappes | Fiches supprimées |
|---|---|---|---|
| A | noms identiques, aucune opération sur les perdantes | 111 | 113 |
| B | même identifiant, mais repointage et/ou report de nom | 179 | 181 |
| C | doublon de nom exact isolé dans une grappe à intruses | 3 | 3 |
| D | noms sans aucun rapport, réduits à une fiche **sur décision** | 177 | 179 |

Lot B : 79 opérations repointées, 76 noms reportés.
Sauvegardes dans `backups/fusion-<horodatage>/`, relues et vérifiées avant écriture.

### Ce qui distingue le lot D

Les lots A, B et C reposent sur une règle. **Le lot D est une décision**, prise
après arbitrage : 0 succession sur 175 grappes, des écarts d'orthographe
(`KOANDA`/`KAONDA`), et 174 grappes sur 175 à cheval sur plusieurs boutiques — ce
qui désignait le garde-fou manquant, pas un changement de titulaire.

Deux retenues dans son implémentation :

- **La survivante garde son nom.** Reporter « le nom le plus complet » comme
  ailleurs ferait gagner `BANQUE RETRAIT DEPOT` (trois mots) sur `MME SAWADOGO`
  (deux). Sur des noms étrangers l'un à l'autre, « plus complet » ne veut rien dire.
- **Le nom abandonné est nommé** — affiché avant écriture, puis écrit dans le
  journal d'audit (`nomsAbandonnes`) et la sauvegarde.

Le lot D **remplace** le lot C, il ne s'y ajoute pas : `--lot=CD` est refusé.

## La cause des nouveaux doublons, et sa correction

`_refuserDoublonAgent` ([src/services/firestore.js](../src/services/firestore.js))
interrogeait bien les trois champs (`codeAgent`, `numeroAgent`, et l'ancien
`orange`) — mais filtrait sur `registeredStoreId`. Il ne voyait donc que la
boutique de l'opérateur, et laissait créer un second enregistrement de tout ce que
les autres avaient déjà saisi. **Huit nouvelles grappes sont apparues dans les
24 h suivant la purge, par ce chemin.**

Corrigé le 2026-10-12 : le filtre est retiré, le contrôle porte sur toute la base.

- La lecture globale est permise par `firestore.rules` (`allow read: if hasProfile()`) ;
  seules création, mise à jour et suppression sont limitées à la boutique.
- Une seule égalité reste dans la requête : aucun index composite à déclarer.
- **Arbitrage assumé** : un agent légitimement client de deux boutiques C2EGF est
  désormais refusé à la seconde. Au mieux 1 cas sur 175 d'après les données — et
  c'est pour lui que le refus nomme la boutique détentrice, afin de dire qui appeler.

Le message de refus nomme le porteur et sa boutique (`messageDoublonAgent`,
[src/utils/agentFields.js](../src/utils/agentFields.js)). Un refus vérifiable en
trois secondes est un refus qu'on ne contourne pas ; « existe déjà dans cette
boutique », sans dire chez qui, poussait à retirer un chiffre ou à écrire le nom
autrement.

> **Trou connu, non corrigé** : `updateClient` n'appelle pas le garde-fou. Modifier
> une fiche pour y mettre un identifiant déjà pris passe donc toujours. Le corriger
> demande d'exclure la fiche d'elle-même du contrôle — un changement avec son propre
> risque, à décider à part.

## Les quatre scripts

Tous refusent un projet qui n'est ni `c2egf-b0b5a` ni `demo-*`, **avant toute requête**.

```powershell
node scripts/auditClients.mjs          # LECTURE SEULE — 7 sections, aucune écriture
node scripts/fusionnerClients.mjs      # dry-run par défaut ; --lot=A|B|C|D
node scripts/relireFusions.mjs         # relit les journaux : noms réécrits, noms abandonnés
node scripts/arbitrerCodesAgent.mjs    # dossier de décision, colonne `decision` vide exprès
```

Pour écrire, `fusionnerClients.mjs` exige **quatre verrous** :
`--execute`, `--allow-production`, `AKAYIS_ALLOW_CLIENT_MERGE='true'`, et le
projectId tapé au clavier sur un vrai terminal. La variable est propre à cette
opération : déverrouiller un reset ne déverrouille pas une fusion.

Puis une **porte de vérification** : sauvegarde écrite, relue depuis le disque,
comparée à ce que le plan détruirait. Un seul manque abandonne tout. Et un
**abandon sur sous-collection inconnue** : `delete()` ne supprime pas les
sous-collections, elles survivraient invisibles à leur parent.

L'ordre des écritures ne se discute pas : **repointer, compléter, supprimer,
journaliser**, une transaction par grappe.

## Ce qui reste à faire à la main

1. **Deux consignes de gestion perdues** par le lot D — `ZERBO YACOUBA PLUS DE
   DEPOT A CREDIT` et `ILBOUDO ZACHARIA INTERDI DG`. La fiche qui reste ne porte
   plus l'interdiction : un client banni peut obtenir du crédit.
   `relireFusions.mjs` les retrouve seul (section « À CORRIGER À LA MAIN »).
2. **9 orthographes arbitraires** parmi les 76 noms reportés — `relireFusions.mjs`
   les sépare des 67 justifiés.
3. **Le numéro agent n'a jamais été collecté** pour 97 % des fiches. Rien n'est
   perdu (les valeurs à huit chiffres de `orange` sont bien des téléphones : 4 %
   seulement ont une tête qu'aucun téléphone de la base n'utilise) — il faut le
   saisir, ou l'importer : voir « Importer les numéros agent » ci-dessous.
4. **18 numéros de remplissage** portant 182 fiches, dont un porté par 66 fiches
   aux 53 noms distincts. Les règles « téléphone » les excluent déjà, mais ils
   restent en base.
5. **Des libellés techniques utilisés comme fiches clients** : `BANQUE RETRAIT
   DEPOT`, `ADELE MOBICASH`, `DARIS MS`.
6. **1 suite de chiffres existe à la fois comme code et comme numéro**, sur 2
   fiches : elles échappent à la comparaison par construction.

## Tests

| Fichier | Objet |
|---|---|
| `tests/unit/tc-247-doublons-clients.test.js` | reconnaître deux fiches, et les annotations dans les noms |
| `tests/unit/tc-248-fusion-clients.test.js` | qui survit, ce qui se reporte, ce qui se supprime |
| `tests/unit/tc-249-arbitrage-codes-agent.test.js` | la lecture du temps et de l'orthographe |
| `tests/unit/tc-062-client-duplicate-agent-code.test.js` | le garde-fou — réécrit, il protégeait le défaut |

---

# Importer les numéros agent

> Ajouté le 2026-10-12. Complète le **Numéro agent** des fiches existantes depuis
> un fichier à deux colonnes, sans créer un seul doublon.

## Les trois champs ne se confondent jamais

| Champ | Rôle dans l'import |
|---|---|
| **Code agent** | sert à **retrouver** la fiche, à l'exact, zéros initiaux compris |
| **Numéro agent** | c'est ce qu'on **ajoute**, et seulement s'il est vide |
| **Numéro personnel** | **jamais touché**, et jamais lu comme un numéro agent |

Les deux derniers font huit chiffres : les confondre écrirait le téléphone du
commerçant dans sa case agent sans qu'aucune règle de longueur ne s'en plaigne.
Le script **refuse** donc un fichier dont la colonne « Numéro agent » manque,
même s'il contient « Numéro personnel », et le dit en clair.

## Les commandes

```powershell
# Aperçu — aucune écriture. 16 000 lignes ne se lisent pas au terminal : --csv les écrit toutes.
node scripts/importerNumerosAgent.mjs --fichier=numeros.xlsx --csv=apercu.csv

# Application, quatre verrous comme la fusion
$env:AKAYIS_ALLOW_AGENT_IMPORT='true'
node scripts/importerNumerosAgent.mjs --fichier=numeros.xlsx --execute --allow-production

# Annulation
node scripts/importerNumerosAgent.mjs --annuler=backups/import-numeros-<horodatage> --execute --allow-production
```

`.xlsx` et `.csv` sont acceptés. Le CSV détecte son séparateur (`;`, `,`, tabulation),
avale le BOM d'Excel et gère les guillemets. Un classeur à plusieurs feuilles lit
la première **et dit lesquelles il n'a pas lues** ; `--feuille=<nom>` en choisit
une autre.

## Les six règles, et comment chacune est tenue

1. **Correspondance exacte du code agent, zéros conservés.** Le code d'une fiche
   est lu par `champsAgent()` — la fonction de l'écran —, donc une fiche d'avant la
   séparation est trouvée par la valeur de son ancien champ `orange`. Aucun
   rapprochement par le nom, nulle part.
2. **Le numéro agent n'est complété que s'il est vide.** La mise à jour ne porte
   que sur deux champs ; `numeroPersonnel`, `orange` et tout le reste sont intacts.
3. **Tout est stocké en texte.** 7 chiffres → un zéro devant. Espaces retirés.
4. **Vide, invalide ou multiple → ignoré.** « 06629924/55772628 » existe vraiment
   dans cette base : on ne choisit pas l'un des deux, on ignore la ligne.
5. **Même numéro → rien. Numéro différent → conflit, jamais écrasé.** La
   comparaison porte sur la forme normalisée, pour qu'un espace résiduel ne crée
   pas un faux conflit à vérifier à la main.
6. **Aucune fiche créée.** Codes introuvables, répétés dans le fichier, ou portés
   par plusieurs fiches : signalés, jamais devinés.

## Les deux pièges qui ne se verraient pas

### Écrire le numéro seul effacerait le code agent de l'écran

`champsAgent()` décide qu'une fiche est « rangée » par la **présence** des clés
`codeAgent`/`numeroAgent`, pas par leur valeur. Une fiche héritée n'en a aucune :
son code vient de `orange`. Écrire `numeroAgent` tout seul y ferait apparaître une
clé — et l'application cesserait aussitôt de lire `orange`.

**Le code agent disparaîtrait de l'écran, sur des milliers de fiches, sans erreur
et sans compteur.** L'import écrit donc les deux champs ensemble : le code tel que
`champsAgent()` le lit aujourd'hui, et le numéro. `orange` n'est pas touché.

C'est la même raison qui oblige l'**annulation** à *supprimer* les clés plutôt
qu'à les vider : remettre `codeAgent: ''` laisserait la fiche en mode « rangée
puis vidée exprès », et l'annulation aurait causé le dégât qu'elle venait réparer.

### Excel mange les zéros initiaux

C'est le format de travail de la boutique, donc le zéro perdu n'est pas un cas
secondaire : c'est **le** problème. Une cellule Excel porte trois informations,
et il faut les trois.

| Cellule | `t` | `v` | `w` | Le zéro |
|---|---|---|---|---|
| texte `0123456` | `s` | `"0123456"` | `"0123456"` | **conservé** |
| nombre, format `0000000` | `n` | `123456` | `"0123456"` | **récupérable par le format** |
| nombre, format Général | `n` | `123456` | `"123456"` | perdu dans le fichier |
| nombre, milliers | `n` | `1234567` | `"1,234,567"` | `w` est piégé, `v` est juste |
| nombre, scientifique | `n` | `123456` | `"1.23E+05"` | idem |

Se fier à `w` casse les deux derniers cas ; se fier à `v` jette le zéro que le
format `0000000` avait conservé. La règle retenue : **prendre `w` quand il n'est
que des chiffres et au moins aussi long que `v`**, sinon prendre `v`.

Quand le zéro est vraiment perdu — cellule en format Général —, il n'est pas
deviné : **il est retrouvé dans la base.** Le code est complété jusqu'aux
longueurs qui existent réellement en base, et la variante n'est retenue que si
elle est **unique** :

- correspondance exacte → c'est elle, aucun remplissage ;
- **une seule** variante → c'est le même code, restitué et signalé ;
- **plusieurs** variantes → `ZÉRO AMBIGU`, on s'arrête. `0999888` et `00999888`
  existent tous les deux : choisir serait tirer au sort sur la fiche d'un commerce ;
- aucune → introuvable, et le rapport dit si une variante existait.

Une cellule **texte** n'est jamais rattrapée : `123456` écrit en texte est ce que
la boutique a saisi, et le compléter serait corriger une saisie plutôt que
réparer un dégât du tableur. La même dissymétrie vaut pour le numéro : une case
nombre se complète jusqu'à huit chiffres, une case texte seulement depuis sept.

Le script annonce avant d'écrire combien de lignes ont traversé Excel en nombre,
liste toutes les restitutions, et le bilan les recompte. Et **le code écrit dans
la fiche vient toujours de la base**, jamais du fichier : recopier le code du
fichier y ferait entrer la version tronquée.

Dernier cas : Excel convertit volontiers une saisie en **date**. `23/01/2026` est
reconnu comme tel et refusé sous ce motif — pas sous « plusieurs numéros », qui
enverrait chercher une barre de séparation dans une case qui n'en a jamais eu.

## Garanties vérifiées

- **Idempotence** : un second import du même fichier ne modifie rien. Vérifié sur
  émulateur, de bout en bout : le second passage rend « 0 à mettre à jour ».
- **Par lots** : 400 écritures par batch (limite Firestore : 500), groupées par
  boutique, chacune avec son journal d'audit **dans le même batch**. Mesuré :
  1 050 fiches en 8,2 s sur quatre lots — soit environ deux minutes pour 16 000.
- **Annulation** : l'état d'avant de chaque fiche est sauvegardé, relu depuis le
  disque et vérifié **avant** la première écriture. L'annulation refuse de toucher
  une fiche modifiée depuis l'import : une saisie humaine est toujours plus récente
  et plus juste que ce que le script avait mis.
- **72 tests unitaires** (`tests/unit/tc-250-import-numeros-agent.test.js`) et
  34 contrôles de bout en bout sur émulateur, dont un classeur abîmé exactement
  comme Excel l'abîme : zéros mangés, format `0000000`, cellule texte, cas
  ambigu, deux feuilles.
