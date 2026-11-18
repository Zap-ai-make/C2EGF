# Les numéros de la boutique : flotte et dealer

Demandé par l'utilisateur le 2026-11-17, à la demande de l'app Oxygen. Le contrat est dans `C:\dev\oxygen\docs\contrats\demande-operation.md`, §9, « Formes convenues avec C2EGF ».

## Pourquoi

Quand un agent choisit une boutique dans l'app Oxygen :

- l'app affiche le **numéro flotte**, le numéro d'appel de la boutique, avec un bouton « Appeler » ;
- pour un **retrait**, l'agent envoie ses unités à la boutique. Si « Lancer l'opération ici » est coché, l'app compose le code d'envoi vers le **numéro dealer**, la SIM Orange de la boutique qui reçoit la monnaie électronique.

Le CRM garde ces deux numéros dans la fiche de chaque boutique, et les rend à Oxygen par le point d'entrée privé.

## Décidé par l'utilisateur

- **La boutique saisit elle-même ses numéros**, depuis son écran Profil.
  - Seul le compte boutique (`store_admin`) peut le faire. Le patron et le dealer ne le peuvent pas.
  - Le risque a été présenté à l'utilisateur, qui l'a accepté. Le compte boutique est celui de la caisse : il pourrait mettre une autre SIM à la place du numéro dealer, et des unités envoyées à un mauvais numéro sont perdues pour l'agent.
  - Garde-fou retenu : chaque changement est inscrit au journal de la boutique, avec qui, quand, la valeur d'avant et celle d'après.

## Convenu avec Oxygen (2026-11-17)

- **Format** : 8 chiffres, sans espace ni indicatif. Un numéro absent n'est pas une erreur. Sa clé est omise, jamais `null` ni chaîne vide.
- **`listerBoutiques`** :
  - chaque boutique de `servies` et de `boutiques` porte en plus `flotte?: string` ;
  - aucun numéro dealer dans la liste : Oxygen la garde 24 h, et un numéro périmé ferait perdre des unités. **Remplacé le 2026-11-18, voir « Version 8 » ci-dessous.**
- **`demander`** :
  - l'objet `demande` porte en plus `dealer?: string`, le numéro dealer de la boutique pour le réseau de la demande ;
  - **seulement pour un retrait** : sur un dépôt, c'est la boutique qui envoie ;
  - il est lu sur la fiche de la boutique au moment de la réponse, rejeu compris ;
  - il n'est **jamais recopié** dans le document de la demande ;
  - `annuler`, `etatDemande` et `lireDemandes` ne le rendent pas : l'app ne compose que juste après la demande.

## Version 8 (2026-11-18, accord de l'utilisateur)

Le chantier sécurité des codes d'Oxygen (contrat §9.1) :
- **Rétention** : Oxygen retient le premier numéro dealer vu par boutique et par réseau.
- **Blocage** : un numéro qui change ensuite bloque le retrait chez cette boutique, pour tous les agents, jusqu'à un déblocage signé par l'utilisateur.

Ce qui change côté CRM :
- `listerBoutiques` avec `avecToutes: true` : chaque boutique de `boutiques` porte en plus `dealer?: { Orange: '76111111' }`, avec seulement les numéros conformes. Une boutique sans numéro n'a pas la clé. `servies` ne change pas.
- `demande.dealer` reste dans la réponse de `demander` tant que l'app v7 le lit. Oxygen préviendra quand il pourra partir.
- **Risque restant**, noté des deux côtés : le premier numéro retenu n'est vérifié par personne. La seconde barrière est le nom qu'Orange affiche avant le code secret, « ANSI SAWADOGO MORE C2EGF BURKINA » pour toutes les SIM dealer C2EGF, selon l'utilisateur.

### Côté patron (2026-11-18, accord de l'utilisateur, constat SEC-14 de l'audit)

Le patron doit savoir qu'une boutique a changé son numéro dealer, et lequel : c'est lui qui débloquera le retrait chez Oxygen.
- **Écriture** : `updateStoreNumbers` écrit `numerosModifiesLe` (heure du serveur) sur la fiche à chaque changement réel, première saisie comprise.
- **Lecture** : `listNetworkCaisses` ajoute à chaque caisse `numeros: { flotte, dealer, modifiesLe }` (`null` s'ils manquent), lus sur la fiche que l'écoute partagée lit déjà. Aucune lecture de plus.
- **Affichage**, sous le nom de chaque boutique de la page Boutiques :
  - « Flotte 70 11 22 33 · Dealer Orange 76 44 55 66 · changés le 18/11 à 10:42 » ;
  - un changement de moins de 7 jours est écrit en orange (`warn`). La première saisie aussi : c'est elle qu'Oxygen retient sans vérification ;
  - une boutique sans numéro affiche « Numéros non saisis ».

## Comment

### Données

- Sur `stores/{id}` :
  - `flotte: '70123456'` ;
  - `dealer: { Orange: '76543210' }`, avec pour clés les réseaux de `STORE_NETWORKS` (Orange seul chez C2EGF).
- Un numéro vidé efface le champ.
- Les règles Firestore ne changent pas : aucun client n'écrit `stores`.

### Écriture

- Une nouvelle action, `updateStoreNumbers`, sur la callable existante `storeTransactionCommand`.
  - Pas de nouvelle function : le quota CPU de Cloud Run tient à peine la vingtaine actuelle.
- Ce que l'action vérifie :
  - un profil actif, de rôle `store_admin`, sur sa propre boutique ;
  - la donnée reçue : `{ flotte: string, dealer: { Orange: string } }`, où une chaîne vide efface ;
  - chaque numéro, qui doit faire exactement 8 chiffres.
- Refus :
  - un réseau inconnu ou un autre champ sont refusés ;
  - un numéro mal formé est refusé avec un message clair (« Numéro flotte : 8 chiffres. »).
- La même transaction met à jour la fiche et écrit une ligne dans `clients/{boutique}/auditLogs` : `{ action, uid, avant, apres, createdAt }`.
- Le geste passe par le réseau, jamais par la file d'envoi. Sans connexion, le bouton est grisé.

### Écran

Profil, sous « Informations du compte », une carte visible du seul compte boutique :

```
Numéros de la boutique
─────────────────────────────────────────────────────
Numéro flotte (pour appeler la boutique)
[ 70 12 34 56 ]

Numéro dealer Orange (reçoit la monnaie des agents)
[ 76 54 32 10 ]

L'app Oxygen les montre aux agents. Vide = rien n'est montré.
                                          [Enregistrer]
```

- **Lecture** : la carte lit la fiche de la boutique une fois, à l'ouverture, soit une lecture.
- **Saisie** :
  - les espaces tapés sont acceptés et retirés avant l'envoi ;
  - « Enregistrer » ne s'active que si quelque chose a changé ;
  - le bouton est grisé hors ligne.
- **Résultat** : « Enregistré. » en cas de succès, ou le message du serveur.

### Point d'entrée Oxygen

- `listerBoutiques` ajoute `flotte` aux boutiques qui en ont un. Pas de lecture en plus : la fiche est déjà lue.
- `demander` ajoute `dealer` à la `demande` rendue, pour un retrait :
  - pour une nouvelle demande, la fiche est déjà lue dans la transaction ;
  - pour un rejeu, la fiche est lue en plus, une lecture, et seulement pour un retrait.

## Hors du lot

- Rien pour le patron : ni saisie, ni affichage des numéros. Il pourra les voir plus tard si l'utilisateur le demande.
- Pas d'historique des numéros à l'écran. Le journal suffit.
- Pas de fiche d'aide : le formulaire se lit seul.

## Mise en service, sur décision de l'utilisateur

1. Déployer les functions `storeTransactionCommand` et `pointEntreeOxygen`.
2. Pousser le front. Un front sans sa function verrait « Commande inconnue. » à l'enregistrement.
3. Prévenir Oxygen, qui élargit alors son filtre et met l'app à jour.
