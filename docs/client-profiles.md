# Produit pilote & profils clients

> Objectif : **un seul logiciel standard**, paramétrable par client. Toute la variation
> entre clients est de la **donnée (un profil)**, jamais du code dupliqué. On améliore
> une fois sur `main`, on déploie partout.
>
> État : **Phase 0** (fondations). Les fichiers de profil existent mais ne sont encore
> câblés à aucune couche. Voir « Plan par phases » en bas.

## 1. Le modèle en une phrase

Un **codebase unique** (branche `main` = le produit). Chaque client = **un profil**
(`config/clients/<id>.js`) + **un projet Firebase**. Le profil active/désactive des
fonctionnalités qui existent toutes dans le code.

Politique **opt-out** : le profil pilote (`_pilot.js`) a **tout activé** ; un client
hérite et **désactive** ce qu'il n'utilise pas.

## 2. Les fichiers

| Fichier | Rôle |
|---|---|
| `config/clients/_pilot.js` | Le standard, tout activé. Référence. Rarement modifié. |
| `config/clients/taofic-ajagbe.js` | Profil du client actuel = **comportement exact d'aujourd'hui**. |
| `config/clients/index.js` | `PROFILES` + `resolveProfile(clientId)`. Point d'entrée unique. |

Sélection du profil actif par identifiant client (front : `VITE_CLIENT_ID` ; functions /
scripts : `CLIENT_ID` ; génération de règles : `--client`). Complémentaire de
`src/config/clientIsolation.js`, qui namespace déjà les données sous `clients/{CLIENT_ID}/…`.

**Normalisation** : `resolveProfile` normalise l'identifiant avec les mêmes règles que
`clientIsolation` (minuscules, non-alphanumérique → `_`) — donc `taofic-ajagbe`,
`taofic_ajagbe` et `TAOFIC AJAGBE` résolvent le même profil. Les clés du registre `PROFILES`
sont normalisées. Le placeholder `nouveau_client` (client non encore profilé) pointe sur le
pilote. Côté front, `src/config/activeClientProfile.js` résout en mode **tolérant** (repli sur
le pilote + avertissement si l'id est inconnu, pour ne jamais casser l'app au chargement) ;
la résolution **stricte** (qui lève) est réservée à la génération de règles / au déploiement.

## 3. Axes de variation (schéma du profil)

| Champ | Varie | Couche(s) qui en dérive(nt) |
|---|---|---|
| `branding` | nom / thème / PWA | Front |
| `networks.enabled` | 1 → 5 réseaux boutique | Front + **Règles** + **Functions** |
| `transactions.types` | avec / sans `Crédit` | Front + **Règles** |
| `transactions.paymentMethods` | 2 → 6 méthodes | Front + **Functions** |
| `cashier.canEditBalances` | édition soldes par la boutique on/off | **Règles** + Front |
| `dealer.enabled` / `dealer.networks` | dealer absent / mono / multi-réseaux | Front + **Règles** + **Functions** |
| `collaborations.enabled` | collaborations inter-boutiques + dettes internes on/off | Front + **Functions** |
| `regional.timezone` | fuseau horaire d'affichage des dates | Front |

> `collaborations.enabled` est **indépendant du nombre de réseaux** : une boutique sollicite une
> consœur parce qu'elle est à court de **stock**, pas parce qu'il lui manque une SIM. Un client
> mono-réseau en a donc autant besoin qu'un multi-réseaux. Ne pas le déduire de
> `networks.enabled.length`.

Ajouter un axe = ajouter un champ **nommé et commenté** dans `_pilot.js` (défaut le plus
riche), puis le faire dériver dans les couches.

## 4. Enforcement strict (décision validée)

Une fonctionnalité désactivée chez un client est bloquée **jusqu'au serveur**, pas
seulement masquée dans l'UI. Deux artefacts sont **générés depuis le profil** (bloc balisé
+ test anti-dérive) ; le déploiement les régénère pour le client cible :

| Couche | Généré | Script |
|---|---|---|
| Règles | bloc `profileDealerNetworks()` dans `firestore.rules` | `scripts/generate-rules.mjs --client <id>` |
| Functions | `functions/src/config/dealerProfile.js` (`DEALER_NETWORKS`) | `scripts/generate-functions-config.mjs --client <id>` |
| Functions | `functions/src/config/storeProfile.js` (`STORE_NETWORKS`, `COLLABORATIONS_ENABLED`, `DEBT_SETTLEMENT_METHODS`) | idem — le même script écrit les deux |

`storeProfile.js` porte les axes **boutique** dont dépendent les collaborations et les dettes
internes. Il n'a **pas** de pendant côté règles : toutes les écritures de `storeCollaborations` et
`internalDebts` sont déjà `if false` (CF-only), donc un client qui n'a pas souscrit au module ne
peut rien y écrire de toute façon — l'enforcement qui compte est celui des callables.
`DEBT_SETTLEMENT_METHODS` = `transactions.paymentMethods` + `Banque` : une dette peut se solder par
virement bancaire, une transaction client non.

`--check` échoue en CI si un artefact ne correspond plus au profil. Comportement-préservant :
pour `taofic_ajagbe`, la génération reproduit le mono-réseau `['Orange']` (identique à l'historique).

**État (chantier dealer multi-réseaux)** : **complet — serveur + front**. Règles + functions
(`dealerRequests`, `closures`, `storeTransfers`) **et** le front (formulaires `NewDealerRequest`/
`DealerTransferForm` + inventaire `DealerInventoryBar`/`AdminDealerInventory`) portent le réseau par
l'opération (validé ∈ profil, `balances[network]`). Mono-réseau (TAOFIC) strictement préservé :
branches multi gardées par `IS_DEALER_MULTI_NETWORK` (code mort chez un client mono) + envoi `network`
**deploy-safe** (omis en mono pour les callables → compatible functions non redéployées).

### Dépendance `canEditBalances`
État actuel de TAOFIC = `false` : l'affordance d'édition est **masquée dans l'UI**, mais les
règles Firestore restent **permissives** (legacy V1, non encore durci). Le flag pilote donc
aujourd'hui uniquement le **masquage UI** (Phase 1).

`cashier.canEditBalances: false` **avec enforcement serveur strict** (Phase 3) implique de
router toutes les écritures de solde (y compris celles des flux de transaction) via des
**callables auditées** : une règle Firestore ne distingue pas le chemin de code, donc tant
qu'un writer client subsiste, la règle doit rester permissive. Passer TAOFIC à un enforcement
strict serait un **changement serveur délibéré** (hors « extraire sans changer »), à décider
séparément — ça fermerait au passage la faille networkBalances direct-write.

## 5. Commits & mise à jour de tous les clients

- **Zéro branche par client.** Une amélioration = un commit sur `main` (avec test de
  caractérisation). Un besoin « custom » devient un **nouveau flag** dans le pilote, pas un fork.
- **Release** = tag de version (`vX.Y.Z`), puis déploiement **par client** via un futur
  script `deploy-client --client <id>` : *profil → génère les règles → build front
  (`VITE_CLIENT_ID`) → déploie règles+functions+hosting sur SON projet → migration éventuelle*.
- **Déploiement échelonné (canary)** : un client (ou staging) d'abord, on vérifie, puis les autres.
- **CI multi-profils** : les tests tournent sur le pilote **et** chaque profil (au minimum :
  chaque profil génère des règles valides + invariants respectés).
- **Migrations de données** : par projet Firebase (outillage `scripts/`, gardé par projet).

## 6. Onboarder un nouveau client (runbook)

Étapes exactes, dans l'ordre, pour mettre le pilote en service chez un nouveau client. Chaque
étape est **reproductible** et **sans risque pour les clients existants** (projet Firebase séparé).

### A. Profil (code, commité sur `main`)
1. **Créer `config/clients/<id>.js`** : copier `_pilot.js` (tout activé) puis **désactiver** ce que
   le client n'utilise pas (réseaux, type `Crédit`, méthodes de règlement, `cashier.canEditBalances`,
   `dealer.networks`, `regional.timezone`, `branding`). `id` = identifiant **normalisé** (minuscules,
   non-alphanumérique → `_`) ; `firebaseProject` = id du projet Firebase.
2. **L'enregistrer** dans `config/clients/index.js` → `PROFILES` (clé = `id` normalisé).
3. **Test de caractérisation** façon `tc-083` : figer les constantes attendues du nouveau profil
   (garantit qu'un futur changement ne dérive pas son comportement).

### B. Génération serveur (dérivée du profil)
4. `node scripts/generate-rules.mjs --client <id>` → régénère le bloc `profileDealerNetworks()`
   de `firestore.rules`.
5. `node scripts/generate-functions-config.mjs --client <id>` → régénère
   `functions/src/config/dealerProfile.js` (`DEALER_NETWORKS`).
6. Vérifier (`npm run test:unit` anti-dérive tc-084/085 + `npm run test:functions`) puis commiter.

> ⚠ Les artefacts générés (`firestore.rules`, `dealerProfile.js`) sont **partagés** : ils portent
> le profil du **dernier** client généré. Avant tout déploiement, **toujours** relancer les deux
> générateurs pour le client cible (le futur script `deploy-client` automatisera cet enchaînement).

### C. Projet Firebase & déploiement (utilisateur — jamais l'agent)
7. Créer le projet Firebase + app web ; remplir un **`.env` dédié** (clés API, project id,
   `VITE_CLIENT_ID=<id>`) ; ajouter l'alias dans `.firebaserc`.
8. **Adapter les garde-fous des scripts** (`assertFirebaseProject.mjs`, `assertResetProject.mjs`)
   pour référencer le nouveau projet — sinon aucun script admin ne tournera dessus (la prod du
   client actuel reste protégée). Détails : `docs/adaptation-nouveau-client.md` §5.
9. `npm run build` (avec le bon `VITE_CLIENT_ID`) puis déployer **règles + functions + hosting**
   sur SON projet. App Check recommandé.

### D. Provisioning (scripts existants — voir `docs/adaptation-nouveau-client.md` §6)
10. Boutiques (`seedStores`), comptes (`createTechnicalUser`), remise à zéro (`resetDataToZero`,
    4 verrous). Invariant serveur : **un seul dealer actif** dans tout le système.
11. **Mettre à jour le registre** (§7) : client, projet, version, date, particularités.

**Cas dealer multi-réseaux** : si `dealer.networks` compte **plusieurs** réseaux, le sélecteur de
réseau côté front (verrou 8, cf. `docs/adaptation-nouveau-client.md` §3) doit être câblé au
préalable — non requis pour un dealer mono-réseau.

## 7. Registre des clients

| Client (`id`) | Projet Firebase | Version déployée | Dernier déploiement | Particularités |
|---|---|---|---|---|
| `taofic_ajagbe` | `taofic-ajagbe` | _(à renseigner)_ | 2026-08-03 (règles durcies) | 1 réseau, sans Crédit, 2 méthodes, dealer mono-réseau, édition soldes masquée (UI), fuseau Africa/Ouagadougou |

_(Le registre est mis à jour à chaque déploiement client.)_

## 8. Principe de sûreté

**Extraire, ne pas changer.** À chaque phase, le profil `taofic-ajagbe` reproduit au bit
près le comportement déployé, prouvé par des tests de caractérisation. On rend configurable
ce qui était figé — on ne modifie jamais le runtime d'un client en production au passage.

## 9. Plan par phases

| Phase | Contenu | Déploiement | État |
|---|---|---|---|
| **0** | Schéma de profil + `_pilot` + `taofic_ajagbe` + résolveur | Aucun | ✅ Fait |
| **1** | Front : `NETWORK_OPTIONS`, `TRANSACTION_TYPES`, `PAYMENT_METHODS`, `VISIBLE_NETWORK_CARDS`, `DEALER_NETWORK` dérivent du profil (UI TAOFIC identique, prouvé par tc-083) | Front | ✅ Fait |
| **2** | Générateur `firestore.rules` depuis le profil (diff nul pour TAOFIC) | Aucun | ✅ Fait |
| **3** | Dealer multi-réseaux du profil (règles + functions + front) | Règles+functions, nouveau projet | ✅ Dealer multi-réseaux **complet** (serveur + front). **Reste hors dealer** : enforcement serveur `canEditBalances:false` + migration |
| **4** | Branding paramétré + script `deploy-client` + checklist onboarding | Front | 🔶 Checklist onboarding faite (§6). **Branding paramétré ✅** (`src/constants/branding.js` runtime + `vite.config.js` build-time dérivent de `profile.branding` ; défaut AKAYIS ⇒ TAOFIC identique, prouvé par tc-092). **Reste** : script `deploy-client` |

> Reste **non encore câblé** (rattaché à des phases dédiées, car touchant plusieurs couches) :
> le **masquage UI de l'édition des soldes** (`cashier.canEditBalances`, à traiter avec son
> enforcement Phase 3). Le **branding** (`branding`) est désormais câblé (runtime + build-time) ;
> il ne reste qu'à **remplacer les images de logo** par client (`public/akayis-*.svg|png` — actifs,
> pas du texte) lors de l'onboarding.
