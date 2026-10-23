# Ce que coûte l'assistant sur C2EGF

> Chiffrage demandé après l'analyse de `feuillederoute_assistant_ia.md`. J'avais
> signalé le rôle lu en document (`get()` dans les règles) comme « à chiffrer ».
> **Mesuré : ce n'est pas le problème.** Le détail ci-dessous, et ce qui l'est.
>
> **Périmètre** : espace boutique seul (`store_admin`, `member`). Voir
> `QUESTIONS-DU-COMPTOIR.md` §0.

---

## 1. Le modèle de facturation, en trois faits

1. `get()`, `exists()` et `getAfter()` dans les règles **sont facturés comme des
   lectures de documents**.
2. Dans une même évaluation, **un même chemin n'est compté qu'une fois**. Nos
   fonctions appellent `profile()` jusqu'à quatre fois : ça coûte **un** document.
3. La limite d'accès documentaire est de **10 par requête**. Les chemins boutique
   en utilisent 2 : la marge est large et ce n'est pas un sujet.

---

## 2. La taxe de règles sur les chemins boutique

Documents distincts lus **par les règles**, à chaque évaluation :

| Chemin de lecture | Garde | Taxe |
|---|---|:--:|
| `globalClients` — recherche client | `hasProfile()` | **1** (`users/{uid}`) |
| `clients/{storeId}/drafts`, `/history`, `/networkBalances`, `/sessions` | `isStoreMember` | **2** (`users` + `stores`) |
| `stores/{storeId}` | `isStoreMember` | **2** |
| `dealerRequests` vus de la boutique | `isStoreAdmin` | **2** |

Le périmètre boutique n'atteint aucune requête de groupe : **1 ou 2, jamais plus.**

---

## 3. Deux questions chiffrées

Hypothèse : la taxe est payée **une fois par requête**, pas une fois par document
rendu. C'est le modèle documenté ; le §6 dit quoi faire si la mesure le dément.

### « Où on en est aujourd'hui ? »

| | lectures |
|---|---:|
| Taxe — 3 requêtes × 2 | 6 |
| Documents lus (transactions du jour, clients) | ~150 |
| **Total** | **~156** · taxe ≈ **4 %** |

### « Combien me doit [client] ? »

| | lectures |
|---|---:|
| Taxe — `globalClients` (1) + `drafts` (2) | 3 |
| Documents lus | ~50 |
| **Total** | **~53** · taxe ≈ **6 %** |

**La taxe de règles est négligeable dans ce périmètre.** Le passage du rôle en
*custom claim* ne se justifie donc pas par le coût — seulement par la latence, et
ce n'est pas pressant.

> 📌 Pour mémoire, si le périmètre s'élargissait un jour : côté **gérant**, la
> taxe vaut jusqu'à **100 % du calcul**, parce que `chiffreAffaires()` lance 12
> agrégations `getAggregateFromServer` qui sont elles-mêmes presque gratuites.
> C'est le seul cas défavorable du produit, et il est hors périmètre.

---

## 4. ⚠ L'échelle change tout : ce n'est pas un comptoir, c'est 84

La feuille de route est écrite depuis un produit mono-boutique. **C2EGF en compte
84** (`specs/ROADMAP.md`). Le coût ne se lit donc pas par question mais par flotte.

Hypothèse de travail — **à remplacer par une mesure** : 20 questions par boutique
et par jour.

```
84 boutiques × 20 questions × 30 jours = 50 400 questions par mois
```

| Poste | Volume mensuel | Ordre de grandeur |
|---|---|---|
| Taxe de règles | ~250 000 lectures | **centimes** |
| Documents lus | ~7,5 millions de lectures | **quelques dollars** |
| **Jetons du modèle** | ~50 000 appels, multi-tours | **le poste dominant** |

**Les lectures Firestore ne sont pas le sujet, même à 84 boutiques.** Les jetons
le sont, et l'écart se creuse avec le nombre de boutiques.

---

## 5. Pourquoi les plafonds du §3 sont des règles de facture

Les plafonds de la feuille de route — 50 lignes rendues, 200 documents lus par
collection, 5 tours d'outils — **ne sont pas des règles de base de données**.
Idem pour trois consignes qui paraissent cosmétiques :

- **retirer les champs d'audit** (`createdAt`, `updatedBy`…) : facturés à chaque
  ligne de chaque réponse ;
- **résoudre les identifiants en noms dans l'outil** : évite que le modèle
  recrache `clt_a8f3`, et supprime les lectures de résolution qu'il réclamerait ;
- **calculer dans l'outil** : envoyer au modèle les lignes à additionner coûte des
  milliers de jetons pour un résultat moins sûr.

**À instrumenter en premier** (le §11 de la feuille de route le liste comme non
fait sur le projet d'origine) : le nombre de jetons des questions les plus
fréquentes, **multiplié par 84**. Les lectures Firestore n'ont pas besoin d'être
suivies.

---

## 6. Ce qui reste à vérifier, et comment

- [ ] **L'hypothèse « une évaluation par requête »**. Relever les lectures
      facturées dans la console avant / après 100 questions identiques. Si le
      compteur grimpe avec les **documents rendus** et non les **requêtes**, le §3
      est à refaire.
- [ ] **Le vrai nombre de questions par boutique et par jour.** Les 20 ci-dessus
      sont une hypothèse, et c'est le facteur qui pilote tout le reste.
- [ ] **Le tarif de lecture réel en `europe-west1`.**
- [ ] **Le coût en jetons** des questions de `QUESTIONS-DU-COMPTOIR.md`.

---

## 7. Deux conséquences de périmètre, tombées du chiffrage

### 7.1 `chiffreAffaires()` est hors de portée — et c'est net

Il interroge `collectionGroup('history')`, dont la règle est
`allow read: if isSystemManager()`. **Une boutique se verra refuser par la base.**

Le resserrement du périmètre à l'espace boutique transforme ce qui était un
dilemme en simple limite : l'assistant n'appelle pas cette fonction. Reste à
décider s'il donne un CA **de la boutique**, recalculé depuis
`clients/{storeId}/history` — et avec quelle parade contre la divergence. Voir
`QUESTIONS-DU-COMPTOIR.md` §5.

### 7.2 Le cloisonnement a un trou, et il n'est pas d'ordre budgétaire

`globalClients` se lit avec `hasProfile()`, sans vérification de boutique :
**toute boutique lit la fiche de tout client du réseau.** C'est délibéré côté
produit, et ça entre en conflit avec la consigne « aucune information de A vers
B ». Traité en entier dans `QUESTIONS-DU-COMPTOIR.md` §2 — c'est le point
bloquant du dossier.
