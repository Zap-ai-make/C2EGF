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

## 3. Le premier déploiement dans une nouvelle région échoue une fois

`majAnnuaireClients` et `reconstruireAnnuaireClients` (l'annuaire des clients,
`docs/rester-dans-le-quota-gratuit.md` §A1) sont les premières functions du
projet en `us-central1`, et `majAnnuaireClients` est son premier déclencheur
Firestore. Leur premier déploiement, en novembre 2026, a échoué deux fois, sans
rapport avec le code :

```
HTTP Error: 409, Could not create bucket gcf-v2-sources-594056712396-us-central1.
```

Chaque région a son bucket de sources. Les deux functions sont créées en
parallèle, ont voulu créer ce bucket en même temps, et l'une a perdu la course.
Au nouvel essai, le bucket existe.

```
Permission denied while using the Eventarc Service Agent. If you recently
started to use Eventarc, it may take a few minutes before all necessary
permissions are propagated to the Service Agent.
```

Le déploiement venait d'activer Eventarc et de créer son agent de service, dont
les droits mettent quelques minutes à se propager. Le CLI le dit lui-même :
« Retry the deployment in a few minutes ».

**Le remède : relancer la même commande quelques minutes plus tard.** Rien
d'autre à corriger.

Si l'erreur Eventarc revient encore au-delà d'une demi-heure, c'est que l'agent
n'a pas reçu son rôle. On le lui donne dans Cloud Shell (décision humaine) :

```bash
gcloud projects add-iam-policy-binding c2egf-b0b5a \
  --member="serviceAccount:service-594056712396@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/eventarc.serviceAgent"
```

---

## 4. Changer de région : le passage en us-central1 (lot C1)

Les callables quittent europe-west1 pour us-central1, à côté de la base
(`docs/rester-dans-le-quota-gratuit.md` §C1). Trois temps, dans cet ordre :

1. **Les deux régions.** `CALLABLE.region` vaut `['europe-west1', 'us-central1']`.
   Le bucket de sources d'us-central1 existe déjà (§3) : pas de 409 attendu.
   **Ne pas tout déployer d'un coup** (§5) : par groupes de huit au plus.
2. **Le front**, poussé seulement une fois les 26 callables en place dans les deux
   régions.
3. **Une semaine plus tard**, `CALLABLE.region` revient à `'us-central1'`. Les
   functions d'europe-west1 se suppriment sans rien démarrer :
   `firebase functions:delete <noms…> --region europe-west1 --force`.

---

## 5. Une région ne fait tourner qu'une vingtaine d'instances à la fois

```
Could not create or update Cloud Run service <nom>, Container Healthcheck failed.
Quota exceeded for total allowable CPU per project per region.
```

**Vécu le 2026-11-06 (lot C1, temps 1) :**
- `firebase deploy --only functions` : une vingtaine d'opérations réussies par
  région, toutes les autres en échec.
- Un groupe de six, juste après : 0 sur 6 en europe-west1, 1 sur 6 en us-central1.
  La région était encore pleine.
- Une sonde `curl -X OPTIONS` sur les 26 callables d'europe-west1 : les vingt
  premières répondent `204`, les six dernières `503 Rate exceeded`. Un quart d'heure
  plus tard, elles répondent de nouveau.

**Ce qu'on en déduit :** le quota compte les instances qui existent, inactives
comprises. Chacune vaut 1 vCPU et reste en vie jusqu'à ~15 min après sa dernière
requête. Le plafond de ce projet tourne autour de 20 vCPU par région ; la page des
quotas en donne la valeur, pas la consommation (elle affiche 0 %). Une mise à jour
démarre une instance par function, un appel à froid aussi. Une fois la région
pleine, toute function sans instance chaude répond `503`, production comprise.

**Ce que ça implique :**
- **Une mise à jour échouée ne casse pas la function** : l'ancienne révision continue
  de servir. Les `503` viennent de la région pleine et s'effacent en ~15 min.
- **Une sonde démarre des instances.** Ne sonder que les functions dont on a besoin,
  jamais les 26 d'un coup dans une région qui sert la production.
- **Le CLI ne saute pas les functions inchangées** ici (constaté sur le groupe de
  six) : `functions:<nom>` redéploie la function dans ses deux régions.

**Comment déployer :**
- **Le soir**, quand les boutiques ne travaillent plus.
- **Huit functions au plus par commande**, en guillemets (§1).
- **Si un groupe échoue sur ce quota**, ne rien relancer ni sonder pendant 20 min,
  puis relancer la même commande.
- **La vraie réponse : relever le quota**, gratuitement. Console Google Cloud > IAM
  et administration > Quotas et limites système, filtrer « Total CPU allocation, per
  project per region » (Cloud Run Admin API), cocher europe-west1 et us-central1,
  Modifier, demander 100. Décision et geste humains.
- **L'autre réponse : des instances plus petites** (lot C3,
  `docs/rester-dans-le-quota-gratuit.md`). À `cpu: 'gcf_gen1'`, une instance de
  256 Mio vaut 1/6 de vCPU : six fois plus d'instances dans le même quota.

---

## 6. Une callable dont la création a échoué reste fermée (403)

Vécu le 2026-11-07, sur les sept callables d'us-central1 que le quota (§5) avait fait
échouer à la création. Redéployées avec succès, elles répondaient toutes :

```
403 Forbidden — Your client does not have permission to get URL /<nom>
```

C'est le refus de Cloud Run, avant même le code : le service n'est pas ouvert au
public. Le CLI (15.13, `lib/deploy/functions/release/fabricator.js`) n'ouvre une
callable au public (`allUsers`, rôle `run.invoker`) **qu'à sa création**.
`updateV2Function` n'a pas de branche pour les callables. Si la création échoue
après que la function existe, chaque déploiement suivant est une mise à jour, et
l'accès public n'est jamais posé.

**Le remède, sans rien redéployer ni démarrer**, dans Cloud Shell (décision
humaine). Le service Cloud Run porte le nom de la function en minuscules :

```bash
gcloud run services add-iam-policy-binding <nom-en-minuscules> \
  --region=<region> --project=c2egf-b0b5a \
  --member=allUsers --role=roles/run.invoker
```

C'est exactement ce que le CLI fait à la création. L'authentification reste vérifiée
dans le code de chaque callable, comme pour toutes les autres.

---

## 7. Une callable neuve : `creerBoutique` (2026-11-10)

Le bouton « Nouvelle boutique » de l'écran Boutiques du patron l'appelle. Elle naît
en us-central1 seulement, à une instance et 1/6 de vCPU (`cpu: 'gcf_gen1'`) : elle
pèse presque rien sur le quota du §5.

1. **Un soir, seule** (§1, §5) :
   `npx firebase deploy --only "functions:creerBoutique"`.
2. **Une sonde, sur elle seule** :
   `curl -X OPTIONS https://us-central1-c2egf-b0b5a.cloudfunctions.net/creerBoutique -H "Origin: https://c2egf.vercel.app" -H "Access-Control-Request-Method: POST"`.
   `204` : prête. `403` : la création a buté sur le quota, le remède est au §6,
   avec le nom `creerboutique`.
3. **Le front ensuite.** Dans l'autre ordre, rien ne casse : le bouton répond que la
   création n'a pas abouti.

**Si la création échoue avec la function en place**, lire ses journaux. Elle crée
des comptes de connexion par l'Admin SDK, avec le compte de service par défaut des
functions. Celui-ci a en principe le rôle Éditeur, qui suffit. Si le journal dit `PERMISSION_DENIED` sur `firebaseauth.users.create`, il
faut lui donner le rôle « Administrateur Firebase Authentication ». C'est une
décision et un geste humains.

---

## 8. La liaison Oxygen : `genererCodeLiaison` et `pointEntreeOxygen` (2026-11-12)

Contrat : `C:\dev\oxygen\docs\contrats\liaison-agent.md`, version 3. Deux services,
tous deux en us-central1 seulement, à une instance et 1/6 de vCPU (§5, §7) :

- `genererCodeLiaison`, une callable. C'est le bouton « Code de liaison Oxygen »
  du panneau de l'agent ;
- `pointEntreeOxygen`, une route HTTP que seul le compte de service
  `oxygen-appel` peut appeler. Le serveur Oxygen (Supabase) l'appelle.

Chaque geste ci-dessous est humain, et l'ordre compte.

1. **Créer le compte de service AVANT le déploiement.** Dans la console Google Cloud
   de `c2egf-b0b5a`, ouvrir IAM, puis Comptes de service, et créer `oxygen-appel`
   **sans aucun rôle**. Le déploiement lui donne le droit d'appeler
   `pointEntreeOxygen`, et rien d'autre. S'il n'existe pas encore, le
   déploiement de cette function échoue.
   Vérifier au passage que l'onglet « Clés » de ce compte permet
   « Ajouter une clé ». Si une règle d'organisation l'interdit, s'arrêter : le
   contrat prévoit alors une signature HMAC, qu'il faudra coder.
2. **Les règles et l'index, d'abord :**
   `npx firebase deploy --only "firestore:rules,firestore:indexes" --project production`.
   - Les règles ferment les trois collections `liaisonsOxygen`,
     `codesLiaisonOxygen` et `journalLiaisonsOxygen`. Seul le patron lit le
     journal.
   - L'index ajouté est `history` : `clientId` + `updatedAt` (TC-379). Sa
     construction prend quelques minutes.
   - Si le CLI propose de SUPPRIMER des index absents du fichier, répondre non et
     s'arrêter.
3. **Les deux functions, un soir, seules** (§1, §2, §5) :
   ```
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
   npx firebase deploy --only "functions:genererCodeLiaison,functions:pointEntreeOxygen" --project production
   ```
4. **Deux sondes, pas plus** (chaque sonde occupe une instance) :
   - `curl -X OPTIONS https://us-central1-c2egf-b0b5a.cloudfunctions.net/genererCodeLiaison -H "Origin: https://c2egf.vercel.app" -H "Access-Control-Request-Method: POST"`
     doit répondre `204`. Un `403` renvoie au §6, avec le service `generercodeliaison`.
   - `curl -s -o /dev/null -w "%{http_code}" -X POST https://us-central1-c2egf-b0b5a.cloudfunctions.net/pointEntreeOxygen -H "Content-Type: application/json" -d "{\"action\":\"rechercher\",\"identifiant\":\"0000000\"}"`
     doit répondre **`403`**. Ici, 403 est la bonne réponse : sans jeton, Google
     refuse. Un `200` voudrait dire que la route est publique, et il faudrait la
     supprimer aussitôt.
   - Dans Cloud Shell, `gcloud run services get-iam-policy pointentreeoxygen --region=us-central1`
     ne doit montrer qu'un seul membre :
     `serviceAccount:oxygen-appel@c2egf-b0b5a.iam.gserviceaccount.com`, avec le
     rôle `roles/run.invoker`. S'il manque, l'ajouter avec la commande ci-dessous :
     ```
     gcloud run services add-iam-policy-binding pointentreeoxygen --region=us-central1 --member=serviceAccount:oxygen-appel@c2egf-b0b5a.iam.gserviceaccount.com --role=roles/run.invoker
     ```
5. **La clé, et l'adresse pour Oxygen.**
   - Créer la clé JSON depuis l'onglet « Clés » du compte `oxygen-appel`. La
     coller dans le coffre Supabase sous le nom `CLE_SERVICE_C2EGF`, puis
     effacer le fichier téléchargé.
   - La clé ne passe par aucune conversation, avec aucun agent.
   - La renouveler tous les 90 jours : créer la nouvelle, la poser, puis
     supprimer l'ancienne.
   - L'adresse à donner à la session Oxygen s'obtient avec
     `gcloud run services describe pointentreeoxygen --region=us-central1 --format="value(status.url)"`.
     Elle se termine par `.run.app` et sert aussi d'audience du jeton.
   - Le premier appel avec jeton (`200`) se fait avec la session Oxygen.
6. **Le front en dernier.** Si on pousse le front avant, rien ne casse : le bouton
   répond « Code non obtenu ».

**Ce que coûte la liaison** :
- générer un code : environ 3 lectures ;
- `rechercher` : 1 à 3 lectures ;
- `relier` : environ 6 lectures ;
- une page d'activité : environ 5 lectures, plus les lignes rendues.
Aucune écoute permanente.

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
