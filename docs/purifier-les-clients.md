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
   seulement ont une tête qu'aucun téléphone de la base n'utilise) — il faut le saisir.
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
