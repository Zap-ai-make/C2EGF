# Audit avant déploiement — 2026-10-14

> **Question posée** : peut-on déployer les 188 commits d'écart avec `main` sans
> surprise ? **Réponse : oui.** Les quatre défauts ci-dessous concernent la
> *chaîne de vérification*, pas le code livré — mais trois d'entre eux font
> qu'une exécution verte, aujourd'hui, ne prouve pas ce qu'elle a l'air de
> prouver.

| | |
|---|---|
| Branche | `codex/fix-historique-firebase-date`, 188 commits devant `main` |
| Écart | 462 fichiers, +65 266 / −6 683 |
| Projet | `c2egf-b0b5a` (production) |
| Arbre | propre, aucune modification non commitée |

## Verdict en une page

| Contrôle | Résultat |
|---|---|
| `check:generated` (règles + config générées) | **vert** — aucune dérive de profil |
| `check:secrets` | **vert** — aucune signature à haute confiance dans les fichiers suivis |
| `eslint .` | **vert** — silencieux |
| Tests unitaires | **2 958** sur 109 fichiers ⚠ *voir D2* |
| Tests composants | **564** sur 43 fichiers |
| Règles Firestore | **435** sur 20 fichiers ⚠ *voir D3* |
| Intégration (auth + firestore) | **42** sur 2 fichiers |
| Cloud Functions (émulateur) | **450** sur 19 fichiers |
| **Total** | **4 449 tests, 193 fichiers, 0 échec** |
| `npm run build` | **vert** — 67 entrées précachées, 2 531 Kio |
| Functions déployées vs dépôt | **26 / 26**, aucune dérive |
| Index Firestore déployés vs dépôt | **27 / 27** composites, **3 / 3** `fieldOverrides` identiques |

---

## D1 — La porte de qualité ne peut pas passer au vert aujourd'hui

**Gravité : important** (bloque la vérification, pas le produit) · **prouvé**

`npm run quality:check` enchaîne sept étapes avec `&&`. La troisième est
`npm audit --omit=dev --audit-level=high`, qui **sort en code 1** :

```
4 high severity vulnerabilities      →  npm audit exit = 1
```

La chaîne s'arrête là. **`lint`, `test:unit`, `test:components` et `build`
ne sont jamais exécutés.** La commande que le dépôt présente comme sa porte de
qualité ne teste donc plus rien depuis que cet avis est publié, et elle est
rouge quoi qu'on fasse au code.

> ⚠ Le piège qui m'a eu aussi : `npm run quality:check | tail` renvoie le code de
> sortie de `tail`, soit 0. La porte paraît verte dans un terminal alors qu'elle
> a abandonné à la troisième étape.

**Ce qu'il faut faire.** Traiter D4 (les avis sont tous corrigeables sans casse),
ce qui remet la chaîne en marche. Si l'on veut que la porte reste exécutable même
avec un avis ouvert, séparer l'audit de dépendances des étapes de code — un avis
amont ne devrait pas empêcher de savoir si les tests passent.

---

## D2 — Sept fichiers de tests n'ont pas tourné, et le compte-rendu affichait « passed »

**Gravité : important** · **prouvé, et c'est le plus insidieux du lot**

En exécutant les étapes que D1 empêche d'atteindre, la suite unitaire a rendu :

```
Test Files  102 passed (102)
     Tests  2684 passed (2684)
    Errors  7 errors
```

Les deux premières lignes se lisent comme un succès complet. En réalité **sept
fichiers n'ont jamais été chargés** : le pool `forks` de vitest n'a pas réussi à
démarrer ses processus (`Timeout waiting for worker to respond`), et ces fichiers
sont comptés en « erreurs », pas en échecs — donc absents du total.

Les sept, relancés avec `--pool=threads`, passent : **274 tests**, dont
`tc-028-app-integration` et `tc-200-dealer-ecrans-caracterisation`. Le vrai total
unitaire est **2 958**, pas 2 684.

**Pourquoi ça compte.** Un rapport qui dit « 102 passed » juste au-dessus de
« 7 errors » sera lu comme vert par n'importe qui de pressé. Le jour où ces sept
fichiers contiendront une régression, elle passera.

**Ce qu'il faut faire.** Basculer la configuration vitest sur `pool: 'threads'`,
ou ajouter `--pool=threads` aux scripts `test:unit` / `test:components`. Le
défaut ne s'est jamais produit avec ce pool au cours de cet audit, et s'est
produit **deux fois** avec `forks`.

---

## D3 — Les tests de règles échouent sous charge, et désignent une fausse faille

**Gravité : moyen** · **prouvé par trois exécutions**

La suite `test:firestore` a d'abord rendu un échec sur
`storeDealerTransfers — dealer destinataire lit son transfert → allow`. Relancée,
elle a rendu deux échecs **différents** : `[BOR-04] dealer ne SUPPRIME pas un
draft` et `[BOR-05] dealer ne lit pas les règlements d'un draft`.

Tous meurent sur `Test timed out in 5000ms` ou `Hook timed out in 10000ms` —
jamais sur une assertion. Des tests fautifs ne changent pas de nom d'une
exécution à l'autre ; des délais, si.

Relancée avec `--testTimeout=30000 --hookTimeout=40000` : **435 / 435**.

> ⚠ **La conséquence est pire que le symptôme.** Ces tests portent le
> cloisonnement entre boutiques et les bornes du dealer. Un échec intermittent à
> cet endroit fait chercher une faille de sécurité qui n'existe pas — et, la
> fois suivante, fait hausser les épaules devant un échec qui serait réel.

**Ce qu'il faut faire.** Relever les délais par défaut dans
`vitest.firestore.config.js`. Un aller-retour vers l'émulateur n'a aucune raison
de tenir en 5 secondes sur une machine partagée. *(Le même correctif a déjà été
appliqué au `beforeEach` de `tc-256` pour la même raison, commit `25bc579`.)*

---

## D4 — Quatre avis de sécurité sur les dépendances des Cloud Functions

**Gravité : faible en exposition réelle, mais bloquant pour D1** · **atteignabilité vérifiée une par une**

| Avis | Gravité | Chemin | Atteignable ici ? |
|---|---|---|---|
| `websocket-driver` ≤ 0.7.4 | **critique** | `firebase-admin` → `@firebase/database-compat` → `faye-websocket` | **Non.** Aucun usage de Realtime Database dans `functions/src` — aucun websocket n'est jamais ouvert. |
| `proxy-addr` 1.1.0–2.0.7 | **critique** | usurpation d'IP via sous-réseau IPv6 mappé IPv4 | **Non.** Aucune décision ne dépend de l'IP cliente : ni `req.ip`, ni `trust proxy`, ni `x-forwarded-for`, ni `rawRequest` dans `functions/src`. |
| `@grpc/grpc-js` 1.14.0–1.14.4 | haute | contexte d'auth et fuite de messages d'erreur **côté serveur gRPC** | **Non.** Les functions sont des *clients* gRPC de Firestore. Tous les exports sont des `onCall` ; aucun `onRequest`, aucun serveur gRPC. |
| `@fastify/busboy` ≤ 3.2.1 | haute | déni de service et injection CRLF sur du **multipart** | **Non.** Aucun endpoint HTTP brut, aucun traitement multipart. |

**Les quatre ont un correctif sans rupture** (`fixAvailable: true`). Il n'y a donc
aucune raison de les laisser ouverts : ils ne protègent rien et ils bloquent D1.

### Et l'avis du paquet racine — celui qui fait échouer la porte

L'avis `@grpc/grpc-js ≤ 1.13.5` remonte par `firebase` (SDK client). Le correctif
proposé par npm est un piège :

```
fix available via `npm audit fix --force`
Will install firebase@9.14.0, which is a breaking change
```

**Ne pas l'appliquer** : cela ferait reculer le SDK de plusieurs versions
majeures.

Vérification faite : **le code vulnérable n'arrive pas dans le navigateur.** Les
trois seules occurrences de « grpc » dans `dist/assets/index-*.js` forment le mot
`grpcFlowControlWindow`, un nom d'option WebChannel du SDK Firestore web — pas la
bibliothèque gRPC, qui n'est utilisée que dans les builds Node.

Un seul consommateur Node du SDK client existe : `scripts/testClientLogin.mjs`,
un outil d'exploitation, jamais déployé.

---

## Ce qui est en ligne correspond exactement au dépôt

Vérifié contre le projet `c2egf-b0b5a` :

- **26 fonctions déployées, 26 exportées** par `functions/src/index.js`. Aucune
  en ligne qui ne soit plus au dépôt, aucune au dépôt qui ne soit pas en ligne.
- **27 index composites**, identiques des deux côtés. **Aucune suppression ne
  sera proposée** au prochain `firebase deploy --only firestore:indexes`.
- **3 `fieldOverrides`** (`history.createdAt`, `history.clientId`,
  `drafts.clientId`), identiques.

### Une question ouverte de la relecture précédente, close par la preuve

La relecture de branche du 2026-10-14 n'avait pas pu trancher si l'agrégat de
groupe sur `clientId` **sans `orderBy`** exigeait son propre index : l'émulateur
Firestore n'applique aucune exigence d'index, donc le test ne pouvait pas le
dire. L'index a été ajouté par précaution (`Ruling R14`).

Il est désormais déployé, **et le panneau d'historique renvoie bien ses totaux en
production**. La question est close empiriquement : la configuration actuelle
fonctionne. *(Ce qui reste indéterminé — et sans conséquence — est de savoir si
l'index était strictement nécessaire ou seulement suffisant.)*

---

## Ce qui reste ouvert, et qui ne vient pas de ce lot

### App Check n'est toujours pas en place

`docs/audit/consolidated/APP_CHECK_RECOMMANDATION.md` le recommande depuis un
audit précédent. Vérifié : **aucun `initializeAppCheck` dans `src/`**.

Conséquence inchangée : les règles et les `onCall` authentifient
l'**utilisateur**, pas l'**application**. Un porteur de jeton Auth valide peut
appeler Firestore et les functions depuis un script. Ce n'est pas une régression
de cette branche, et le document existant explique pourquoi c'est un chantier
séparé — mais il reste la plus grosse pièce manquante de la défense en
profondeur.

### Les mineurs parqués de la relecture de branche

Consignés dans `.superpowers/sdd/2026-10-13-historique-client/progress.md`, non
repris ici. Un seul mérite d'être relu avant d'être invoqué : la justification
écrite pour le report du mineur « type inconnu coloré en *outflow* » est
**fausse** — le filtrage n'écarte que `ravitaillement` et `cloture`, pas tous les
types inconnus. Aucune régression aujourd'hui, mais ce raisonnement ne doit pas
servir de base à une décision future.

---

## Ordre de déploiement recommandé

Règles et index sont **déjà déployés et à jour** ; les 26 fonctions aussi,
`listClientHistory` comprise. Il ne reste donc, pour la branche :

1. **Le front** (le panneau d'historique, la colonne, la parité d'affichage) —
   déploiement Vercel habituel.
2. **Le push** de la branche, si souhaité : `git push origin codex/fix-historique-firebase-date`.

> **Rappel `AGENTS.md`** : un déploiement est une décision humaine, exécutée par
> un humain. Ce document donne l'état et l'ordre ; il n'autorise personne d'autre
> à lancer la commande.

---

## Méthode

Tout ce qui est affirmé ici a été exécuté, pas déduit. Les commandes :

```powershell
npm run check:generated
npm run check:secrets
npm audit --omit=dev --audit-level=high          # racine, puis dans functions/
npx eslint .
npx vitest run --pool=threads tests/unit
npx vitest run --config vitest.config.js --pool=threads tests/components
npm run build
npx firebase emulators:exec --only firestore --project demo-akayis-test `
  "npx vitest run --config vitest.firestore.config.js --testTimeout=30000 --hookTimeout=40000"
npx firebase emulators:exec --only auth,firestore --project demo-akayis-test `
  "npx vitest run --config vitest.integration.config.js --testTimeout=30000 --hookTimeout=40000"
npx firebase emulators:exec --only firestore --project demo-akayis-test `
  "npx vitest run --config vitest.functions.config.js --testTimeout=30000 --hookTimeout=40000"
firebase functions:list
firebase firestore:indexes
```

**Limite assumée.** Les exécutions ont eu lieu sur une machine qui faisait
tourner en parallèle la suite d'émulateurs et les tests Playwright d'un autre
projet. C'est ce qui a révélé D2 et D3 — et c'est une bonne nouvelle : ces deux
défauts existaient déjà, une machine au repos les aurait seulement cachés plus
longtemps.

**Non couvert.** L'état déployé des *règles* Firestore n'a pas été comparé octet
à octet au dépôt : le CLI n'expose pas le `ruleset` publié. `check:generated`
confirme que le fichier du dépôt est cohérent avec son profil, et les règles ont
été déployées le jour même.
