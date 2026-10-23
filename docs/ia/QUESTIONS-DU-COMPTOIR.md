# Les questions du comptoir — catalogue candidat

> Réponse aux questions 1 et 2 du §12 de `feuillederoute_assistant_ia.md`.
>
> ⚠ **Brouillon à confronter, pas une réponse.** La feuille de route est
> explicite : demander ces questions **au futur utilisateur, pas au
> commanditaire**. Cette liste est déduite des écrans et des services existants —
> donc de ce que le produit sait faire, qui n'est pas forcément ce qu'on lui
> demandera. Elle sert à **ouvrir** l'entretien avec les boutiques, pas à le
> remplacer.

---

## 0. Périmètre — décision du commanditaire

**L'assistant ne sert que l'espace boutique.** Rôles `store_admin` et `member`.

| Espace | Rôle | Assistant |
|---|---|:--:|
| Boutique | `store_admin`, `member` | ✅ **le seul périmètre** |
| Gérant (patron) | `system_manager` | ❌ hors périmètre |
| Dealer | `dealer` | ❌ hors périmètre |

Et une règle qui prime sur tout le reste :

> **Chaque boutique avec ses données. L'assistant ne mélange rien et ne livre
> aucune information de la boutique A à la boutique B.**

Conséquences immédiates :

- Les outils réseau n'existent pas : pas de CA réseau, pas de 84 caisses, pas de
  comparaison entre boutiques.
- `chiffreAffaires()` **n'est pas appelable** : sa requête de groupe est réservée
  à `isSystemManager()`. Un CA de boutique devra passer par
  `clients/{storeId}/history` — voir §5.
- Les lots 5 (gestes d'écran) et 7 (mode d'emploi) ne cataloguent que les écrans
  boutique.

---

## 1. Les questions, classées

Le §3 de la feuille de route impose que l'outil appelle **la même fonction que
l'écran**, pour que le chiffre rendu soit celui qu'on lit à l'écran.

| # | Question | Fonction à réutiliser | Garde (taxe) |
|:-:|---|---|:--:|
| 1 | « Où on en est aujourd'hui ? » | `useDashboardData` + `useTodayTransactions` | `isStoreMember` (2) |
| 2 | « C'est quoi le code de [client] ? Il existe déjà ? » | `globalClients`, recherche | `hasProfile` (1) ⚠ §2 |
| 3 | « Combien me doit [client] ? » | `draftService` + `settlementService` | `isStoreMember` (2) |
| 4 | « Qu'est-ce qui reste à régler ? » | brouillons non soldés | `isStoreMember` (2) |
| 5 | « Mon ravitaillement, il en est où ? » | `storeAdminDealerService` | `isStoreAdmin` (2) |
| 6 | « Retrouve la transaction de [montant] d'hier » | `historyService` | `isStoreMember` (2) |
| 7 | « Quel est mon solde Orange ? » | `BalanceService` | `isStoreMember` (2) |
| 8 | « Où en est ma clôture ? » | `closureService` | `isStoreAdmin` (2) |

Huit, pas dix : les deux manquantes sont à rapporter des entretiens, pas à
inventer ici.

---

## 2. ⚠ Le seul endroit où le mur ne tient pas

**C'est le point le plus important du dossier.**

Toute l'architecture de la feuille de route repose sur une phrase : *les règles
sont le mur, et elles s'appliquent sans une ligne de code en plus*. Pour le
cloisonnement entre boutiques, c'est vrai partout — **sauf une collection**.

```
match /globalClients/{clientId} {
  allow read: if hasProfile() || isSystemManager();
}
```

`hasProfile()` ne vérifie pas la boutique. **N'importe quel membre d'une boutique
lit la fiche de n'importe quel client du réseau**, y compris ceux enregistrés par
une autre boutique.

**Ce n'est pas un défaut, c'est une décision**, et le commentaire des règles la
défend : « LA FICHE CLIENT EST COMMUNE À TOUTES LES BOUTIQUES, sa PROPRIÉTÉ ne
l'est pas. » Restreindre la lecture à la boutique d'origine laissait l'autre sans
issue — elle voyait un client qu'elle ne pouvait pas corriger, et finissait par en
créer une seconde fiche. **C'est le chemin qui a produit les 175 grappes de
doublons purgées le 2026-10-12.**

Donc : votre règle « aucune information de A vers B » et la conception du produit
se heurtent **sur cette collection, et sur elle seule**. Il faut trancher.

### Les trois issues

| | Ce que l'assistant fait | Prix |
|---|---|---|
| **(a) Isolation stricte** | Filtre `registeredStoreId == maBoutique` **dans la requête** | On perd la question n° 2, la plus rentable du lot — et on rouvre le chemin des doublons |
| **(b) Existence oui, détail non** ⭐ | Pour un client d'une autre boutique : le code et le nom, rien d'autre. Détail complet pour les siens | Un peu de code dans l'outil, et un test |
| **(c) Statu quo** | L'assistant rend la fiche comme l'écran la rend déjà | Ne satisfait pas la consigne telle qu'énoncée |

**Recommandation : (b).** Elle respecte ce que la consigne protège réellement —
aucun montant, aucun historique, aucune relation commerciale de A ne parvient à
B — tout en gardant le bénéfice anti-doublon pour lequel la collection a été
ouverte. Un code client et un nom ne sont pas « les données de la boutique A » :
c'est l'identité d'un agent, et elle est commune par construction.

### Ce que cela impose, quelle que soit l'issue

1. **Le filtre part dans la requête, pas après la lecture** (§3 de la feuille de
   route). Filtrer après coup, c'est avoir déjà lu, déjà payé, et déjà risqué de
   le rendre au modèle.
2. **C'est le seul endroit du lot où le prompt n'a pas de filet.** Partout
   ailleurs, si le modèle déraille, la base refuse. Ici elle accepterait. La
   consigne doit donc vivre **dans le code de l'outil**, et porter son propre
   test — pas dans le prompt, qui peut être contourné par un texte habile.
3. **Un test de cloisonnement nommé** : deux boutiques, un client enregistré par
   la première, l'assistant de la seconde interrogé. Il entre dans
   `tests/firestore/` aux côtés de `globalClients.rules.test.js`.

---

## 3. Le reste du cloisonnement : déjà tenu

| Collection | Qui lit | Verdict |
|---|---|---|
| `clients/{storeId}/drafts`, `/history`, `/networkBalances`, `/sessions` | `isStoreMember(storeId)` | ✅ strict |
| `stores/{storeId}` | `isStoreMember(storeId)` | ✅ strict |
| `collectionGroup('history')`, `('drafts')` | `isSystemManager()` seul | ✅ hors de portée d'une boutique |
| `collectionGroup('networkBalances')` | `isDealer() \|\| isSystemManager()` | ✅ hors de portée |
| `storeCollaborations` | les deux boutiques concernées | ⚠ §4 |
| `internalDebts` + `settlements` | boutique débitrice et créancière | ⚠ §4 |

**Les trois collections de groupe réservées au gérant et au dealer tombent toutes
seules** : une boutique se verra refuser par la base. C'est le test du Lot 1, et
il est désormais le test du périmètre lui-même.

---

## 4. Les deux partages inhérents

`storeCollaborations` et `internalDebts` font **exister** une boutique dans les
données d'une autre : une dette entre A et B est lisible par A et par B. Ce n'est
pas une fuite, c'est l'objet même de la fonctionnalité — on ne peut pas devoir de
l'argent à quelqu'un d'anonyme.

**À décider avant le Lot 2** : l'assistant parle-t-il des dettes internes ?

- **Si oui**, il nommera forcément l'autre boutique, et la consigne « aucune
  information de A vers B » doit admettre cette exception explicitement.
- **Si non** (le plus simple pour commencer), ces deux collections sortent du
  catalogue d'outils, et la consigne reste absolue.

Recommandation : **non au premier lot**. Une dette interne est rare, elle a son
écran, et l'exclure garde la règle de cloisonnement énonçable en une phrase —
ce qui compte pour une règle qu'on devra tenir dans la durée.

---

## 5. Le chiffre d'affaires de la boutique

`chiffreAffaires()` est hors de portée (§0). Un CA de boutique doit donc être
recalculé depuis `clients/{storeId}/history`.

⚠ **Le risque est la divergence**, que le §3 interdit nommément : « le chiffre
rendu égale celui de l'écran, parce qu'il est calculé par la même fonction ». Si
l'outil refait sa propre somme, il produira tôt ou tard un nombre différent de
celui du tableau de bord.

**La parade** : réutiliser la logique de `useDashboardData` / `useTodayTransactions`,
en l'extrayant dans un module **pur** que l'écran et l'outil appellent tous les
deux. C'est exactement la règle de découpage du §2 de la feuille de route — tout
ce qui décide est pur — et c'est l'occasion de l'appliquer.

---

## 6. ⚠ Les notions voisines que le modèle va confondre

Réponse à la question 3 du §12. **Chaque ligne entre nommément dans le prompt du
Lot 3, avec un test.** Ce ne sont pas des hypothèses : toutes viennent de
confusions **déjà commises sur ce dépôt**, par des humains.

### 6.1 Ne jamais additionner ce qui est affiché

`specs/ROADMAP.md` consigne que des termes réconciliateurs vivent **hors** des
totaux affichés, sous le filet, et que le test `[ER-11]` fige ce fait « pour que
personne ne le *corrige* en additionnant ce qu'il voit ».

**Un modèle fera exactement ça** : c'est son comportement par défaut devant une
colonne de nombres. L'interdit doit être écrit et testé.

### 6.2 Une opération annulée ou supprimée ne compte pas

Le service de CA soustrait `'Annulée'` et `'Supprimée'`, et traite les
intersections type × statut **en boucle** — parce que recopiées à la main, elles
avaient divergé (« ronde de correction 2 »). Si le modèle recompte lui-même, il
refait le bug. Vaut pour le CA boutique du §5.

### 6.3 Une créance n'est pas un règlement

Un brouillon non soldé est une créance ; une tranche de `settlements` est un
paiement reçu. Les additionner produit un nombre qui ne désigne rien.

### 6.4 Un ravitaillement n'est pas une vente

Deux commits de la branche courante corrigent la confusion côté dealer (« le float
du dealer n'est plus du chiffre d'affaires », « une ligne dealer annulable double
comptait le CA »). Vue de la boutique, la règle tient : un ravitaillement est une
**entrée de stock**, pas du chiffre d'affaires.

### 6.5 « Ravitaillement », « demande », « opération partenaire »

S6 a renommé « demande » en « ravitaillement » mais a **refusé trois fois** de le
faire, chaque fois pour une raison différente — notamment un badge qui additionne
ravitaillements **et** retours, et qui dit donc « opérations en attente ». Le
prompt doit suivre ces exceptions, sinon l'assistant réintroduira le mot que le
produit a délibérément écarté.

---

## 7. Ce qu'il reste à faire sur ce document

- [ ] **Trancher le §2** — c'est bloquant pour le Lot 2.
- [ ] **Trancher le §4** — dettes internes dans le catalogue, oui ou non.
- [ ] Confronter les huit questions à **trois boutiques**. Garder leurs mots :
      celles ci-dessus sont formulées en vocabulaire de produit, les vraies ne le
      seront pas.
- [ ] Faire **classer par fréquence** par les utilisateurs. L'ordre est une
      déduction, pas une mesure.
- [ ] Relever les questions auxquelles le produit **ne sait pas** répondre : ce
      sont des demandes de fonctionnalité déguisées, et elles n'entrent pas dans
      le catalogue d'outils.
- [ ] Mesurer le coût en jetons des questions retenues.
