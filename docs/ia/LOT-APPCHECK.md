# Lot IA-0 — App Check, activation paresseuse pour AI Logic

```
Statut     : à faire
Périmètre  : condition d'entrée de l'assistant IA (Lot 0 de la feuille de route)
Dépend de  : aucune
Remplace   : docs/audit/consolidated/APP_CHECK_RECOMMANDATION.md (voir §1)
```

---

## Objectif

Permettre à Firebase AI Logic de servir l'assistant, sans qu'un incident reCAPTCHA
puisse empêcher une boutique de se connecter au CRM. Tant que la clé est absente,
l'application fonctionne exactement comme aujourd'hui.

**Périmètre de l'assistant** : espace boutique seul (`store_admin`, `member`).
Voir `QUESTIONS-DU-COMPTOIR.md` §0. Ce lot n'en dépend pas — App Check est une
condition d'entrée quel que soit le périmètre — mais il en hérite une bonne
nouvelle : l'`enforce` ne porte que sur AI Logic, donc **les espaces gérant et
dealer ne sont jamais exposés au risque du §1**, même en cas de panne reCAPTCHA.

---

## 1. L'arbitrage : deux documents du dépôt se contredisent

`docs/audit/consolidated/APP_CHECK_RECOMMANDATION.md` et le §7 de
`feuillederoute_assistant_ia.md` décrivent deux montages incompatibles :

| | Reco du dépôt | Feuille de route §7 |
|---|---|---|
| Où initialiser | `src/config/firebase.js`, derrière un flag → **au démarrage** | **Paresseuse**, à l'ouverture de l'assistant, nulle part ailleurs |
| Portée de l'`enforce` | Functions, **puis Firestore** | **AI Logic seul** ; les autres produits en surveillance |

**Ce qui tranche : la colonne de gauche a déjà cassé une production.** Le §7
raconte l'incident sur le projet d'origine — script reCAPTCHA injoignable
(`ERR_FAILED`, probablement une extension de navigateur), App Check initialisé au
démarrage, donc **plus personne ne peut se connecter**, Auth rendant
`auth/network-request-failed`, c'est-à-dire un écran qui accuse le réseau.
Invisible en local, où le SDK emploie un jeton de débogage et ne passe jamais par
reCAPTCHA.

Le montage retenu prend **l'activation de la feuille de route** et **la discipline
de déploiement de la reco du dépôt**, qui est meilleure (fenêtre de mesure,
critères d'acceptation, rollback testé — absents du §7).

**Ce que la reco du dépôt garde de valable, et qui est repris ici :** son constat
de départ. Firestore et les `onCall` authentifient l'utilisateur, pas
l'application. App Check reste une défense en profondeur souhaitable pour tout le
trafic — mais c'est un **chantier distinct**, à mener après celui-ci, une fois la
mesure faite. Il ne doit pas être le prix d'entrée de l'assistant.

---

## 2. Ce qui est à faire

### 2.1 Console Firebase

- Clé **reCAPTCHA Enterprise** pour le domaine Vercel de production.
- Enregistrer l'app web dans App Check, **tous les produits en surveillance**.
- Jeton de débogage enregistré pour le développement local et la CI.

### 2.2 Code client — un module neuf, pas `firebase.js`

Nouveau fichier `src/config/appCheck.js`, exportant une fonction appelée
**uniquement** à l'ouverture du panneau assistant. `src/config/firebase.js`
**n'est pas modifié** : c'est le cœur de l'arbitrage.

Six gardes, chacune pour une panne nommée :

| Garde | Pourquoi |
|---|---|
| Paresseuse — appelée à l'ouverture de l'assistant, nulle part ailleurs | La panne du §7 |
| Idempotente — deux `initializeAppCheck` sur la même app lèvent | Le panneau s'ouvre vingt fois par jour |
| Jamais si `runtime.useEmulators` | Pas de service App Check en émulateur : `test:firestore`, `test:integration`, `test:functions` échoueraient pour une raison étrangère à ce qu'ils testent |
| Jamais sans `VITE_FIREBASE_APPCHECK_KEY` | Clé absente → l'app tourne comme avant, seul l'assistant se tait |
| `isTokenAutoRefreshEnabled: true` | Une session ouverte la journée au comptoir verrait ses appels refusés au bout d'une heure |
| Erreur brute en `console.error`, toujours | §8 : un échec App Check se déguise en `fetch` raté, donc en « réseau coupé », dit à quelqu'un dont tout le reste fonctionne |

Le garde « jamais côté serveur » du §7 est **sans objet ici** : C2EGF est une SPA
Vite, il n'y a pas de rendu serveur.

### 2.3 CSP — les quatre directives

À l'écriture de ce lot, aucune des quatre n'autorisait reCAPTCHA dans
`vercel.json`, et `frame-src` était **absente**, donc retombait sur
`default-src 'self'`. **Posée depuis** : `vercel.json` porte la valeur
ci-dessous (vérifié le 2 novembre 2026, audit DOC-03).

La valeur :

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self';
script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://www.google.com https://www.gstatic.com;
font-src 'self' data:;
connect-src 'self' https://*.googleapis.com https://*.firebaseio.com
  wss://*.firebaseio.com https://*.cloudfunctions.net
  https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/;
frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/;
worker-src 'self' blob:; manifest-src 'self'
```

(à écrire sur une seule ligne dans `vercel.json`)

⚠ **Les chemins `/recaptcha/`, pas les domaines nus** (corrigé le 30 octobre 2026).
La première version de ce document ouvrait `www.google.com` et `www.gstatic.com`
en entier à `script-src`. Ces domaines servent des points JSONP qui exécutent ce
qu'on leur fait rappeler : la CSP ne protégeait plus contre une injection de
script. reCAPTCHA n'a besoin que de ses chemins ; `tc-211` le vérifie. Si la
fenêtre de mesure montre un script bloqué hors de ces chemins, l'ajouter
**nommément**, jamais en rouvrant le domaine.

⚠ **Le jeton de débogage ne se lit qu'en développement.** `appCheck.js` ne lit
`VITE_APPCHECK_DEBUG_TOKEN` que sous `import.meta.env.DEV`, et aucun code ne passe
`import.meta.env` entier (Vite recopierait alors tout le `.env` dans le bundle).
Le placer de préférence dans `.env.development.local`, que Vite ne charge pas pour
un build de production.

Trois remarques :

- **`connect-src` est celle qu'on oublie**, et le §7 l'a payée deux allers-retours :
  le script se charge, le cadre s'affiche, et l'appel qui *rapporte* le jeton part
  dans le mur.
- **L'appel au modèle est déjà couvert** : AI Logic sort sur `*.googleapis.com`,
  déjà présent.
- `frame-ancestors 'none'` et `X-Frame-Options: DENY` **restent inchangés** : ils
  disent qui peut nous encadrer, pas qui nous encadrons.

⚠ **À vérifier pendant la fenêtre de mesure, pas à supposer :** certaines
intégrations reCAPTCHA réclament `'unsafe-eval'` dans `script-src`. Ne l'ajouter
que si la console le prouve, et le consigner ici si c'est le cas.

### 2.4 Ce qui n'est PAS dans ce lot

- `Permissions-Policy: camera=(), microphone=(), geolocation=()` reste tel quel.
  C'est une liste **vide** : la fonctionnalité est refusée à toutes les origines, y
  compris la nôtre. Photo et voix (Lot 8) sont donc impossibles avant de passer à
  `camera=(self), microphone=(self)`. **À faire dans le lot photo/voix, pas ici** —
  ouvrir un droit matériel avant d'en avoir l'usage est une permission qu'on oublie
  d'avoir donnée.
  *Mise à jour du 30 octobre 2026 :* la dictée de l'assistant (lot C) a ouvert
  `microphone=(self)`, à notre origine seulement. La caméra reste fermée jusqu'à
  ce qu'un écran s'en serve ; TC-211 fige les deux.
- L'`enforce` sur Firestore et Functions. Chantier suivant.

---

## 3. Critères d'acceptation

- [ ] Clé absente de l'environnement : l'application entière fonctionne, connexion
      comprise ; seul l'assistant refuse de répondre.
- [ ] `npm run quality:check` passe sans modification.
- [ ] `npm run quality:check:emulators` passe : App Check n'est jamais initialisé
      sous émulateur.
- [ ] Sur le domaine déployé, l'assistant obtient un jeton : le réseau montre
      l'appel qui le rapporte, pas un blocage CSP.
- [ ] Panneau ouvert puis fermé vingt fois : aucune erreur d'initialisation double.
- [ ] Fenêtre de mesure d'au moins trois jours, AI Logic en surveillance :
      100 % du trafic légitime vu comme vérifié.
- [ ] Rollback testé : repasser en non-enforce dans la console, effet immédiat,
      aucun redéploiement.
- [ ] Simulation de panne : reCAPTCHA bloqué dans le navigateur → l'assistant se
      tait **et la caisse continue d'ouvrir**. C'est le critère qui valide
      l'arbitrage du §1.

---

## 4. Notes techniques

- **Les `firestore.rules` ne bougent pas.** Elles sont générées
  (`scripts/generate-rules.mjs`) et App Check ne s'y configure pas : l'`enforce`
  est un réglage de console.
- **Variable** : `VITE_FIREBASE_APPCHECK_KEY`, à ajouter à la liste de
  `validateEnvironmentVariables` **en optionnelle** — surtout pas en requise, ce
  qui ferait lever `firebase.js` au démarrage et reproduirait la panne par un
  autre chemin.
- **Backend du modèle** : prendre celui adossé au compte Google Cloud du projet
  (déjà en Blaze pour les Functions), **jamais** « Gemini Developer » et sa
  cagnotte prépayée — §8 : `[429] Your prepayment credits are depleted`, qui
  s'épuise sans prévenir.
