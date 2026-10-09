# Déployer les Cloud Functions

> **Un déploiement est une décision humaine, exécutée par un humain** (`AGENTS.md`).
> Ce document donne la commande ; il n'autorise personne d'autre à la lancer.

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase use production
firebase deploy --only "functions:storeTransactionCommand,functions:addTransactionPayment"
```

Les deux particularités de cette commande ont chacune coûté une session entière.
Elles sont écrites ici pour que la troisième n'ait pas lieu.

---

## 1. Les guillemets autour de `--only` ne sont pas facultatifs

Sous PowerShell, un argument non quoté contenant des virgules est lu comme un
**tableau**. Les commandes npm globales passent par un shim `.ps1` qui transmet
`$args` : le tableau y est aplati **en joignant avec des espaces**. La valeur
reçue devient donc `functions:a functions:b`, d'une seule pièce.

`parseFunctionSelector` y voit des deux-points surnuméraires et lit `"a
functions"` comme un **nom de codebase**. Aucun codebase ne porte ce nom,
`targetCodebases` renvoie une liste vide, et le CLI abandonne :

```
Error: No function matches given --only filters. Aborting deployment.
```

Le message accuse les fonctions alors qu'**aucune n'a été regardée** : l'abandon
survient avant la découverte. Inutile donc d'aller vérifier les exports,
`firebase.json` ou le code — commencer par le quoting.

> Un test via `cmd.exe` ne reproduit PAS le défaut : les virgules y survivent.
> Le shell y paraît innocent à tort.

---

## 2. La découverte n'a que dix secondes, et c'est trop peu à froid

Avant de déployer, le CLI charge `functions/src/index.js` dans un processus
séparé pour en extraire la liste des endpoints. Il lui accorde **10 secondes**.

Sur cette machine, à froid, l'import prend **~8 s** — et ~1 s une fois le cache
disque de l'OS chaud. La marge est donc nulle, et le déploiement tombe sur :

```
Error: User code failed to load. Cannot determine backend specification.
Timeout after 10000.
```

**Le code du dépôt n'y est pour rien** : mesuré module par module, nos 25
fichiers pèsent **59 ms**. Le reste est le coût de `firebase-admin` (~640 ms) et
`firebase-functions` (~335 ms), multiplié par la lenteur d'un premier accès
disque sous Windows.

`FUNCTIONS_DISCOVERY_TIMEOUT` est la soupape prévue par firebase-tools. **Elle
s'exprime en SECONDES** (le CLI la multiplie par 1000) : `120` et non `120000`.

---

## Ce qu'il n'y a PAS à déployer

- `firestore.rules` et `firestore.indexes.json` ne changent que si on les a
  modifiés. Les vérifier d'un `git diff` plutôt que de les redéployer par
  réflexe — et après toute modification du profil client, lancer
  `npm run check:generated`, qui dit si le bloc généré des règles a dérivé.
- L'écoute des ravitaillements encore dus (`subscribeToOpenReplenishments`)
  n'utilise **qu'un filtre d'égalité**, servi par l'index automatique de
  Firestore. Aucun index composite à déployer — et c'est pour cela qu'elle ne
  trie pas côté serveur (voir `src/services/historyService.js`).

## Ce qui est déjà neutralisé

`firebase.json` porte `"disallowLegacyRuntimeConfig": true`. Sans ce drapeau, le
CLI interroge `runtimeconfig.googleapis.com` à chaque déploiement — l'API de
l'ancien `functions.config()`, que ce dépôt n'utilise nulle part. L'appel ne
rapportait rien et faisait échouer le déploiement dès qu'il expirait, sur un
message sans rapport :

```
Error: An unexpected error has occurred.
```

---

## Quand ça échoue quand même

`firebase-debug.log`, à la racine, porte le détail de la **dernière** tentative.
Y chercher la dernière requête HTTP avant l'erreur : elle nomme presque toujours
la cause. Ne pas filtrer ce fichier à l'aveugle — c'est la fin du journal qui
porte le verdict, et un `Select-String` trop étroit l'avale.
