# Le signal à Oxygen quand une demande se ferme (contrat v9, §10)

## Pourquoi

L'utilisateur veut que l'agent voie à l'instant la réponse de la caissière. Aujourd'hui l'app Oxygen relit `etatDemande` toutes les 10 secondes : jusqu'à 10 secondes de retard, et un appel à `pointEntreeOxygen` à chaque tour.

Le contrat v9 (Oxygen, `docs/contrats/demande-operation.md` §10, commit 24742d1) ajoute un signal : le CRM prévient le serveur Oxygen qu'une demande vient de se fermer, et Oxygen réveille le téléphone de l'agent. Le signal ne porte rien ; l'app relit l'état chez nous, qui seul fait foi. Une fois le signal en service des deux côtés, l'app ne relit plus que toutes les 30 secondes : trois fois moins d'appels chez nous.

## Décidé par l'utilisateur (2026-11-20)

- Le signal part de `storeTransactionCommand`, sans écran ni front à changer.
- Il part avec le compte de service sous lequel tourne déjà la function : pas de compte dédié, pas de droit à changer. Un faux signal ne fait que relire une app.

## Convenu avec Oxygen (contrat §10.1)

- **Quand** : après l'écriture, quand `acceptAgentRequest` ou `rejectAgentRequest` ferme une demande. Pas pour une annulation par l'agent.
- **Comment** : un seul appel, jamais rejoué, 3 secondes au plus. Il ne fait jamais échouer la validation de la caissière ; un échec donne une ligne de journal, rien d'autre.
- **Requête** : `POST https://flwbscqezuhmshjnrakr.supabase.co/functions/v1/liaison`, corps `{"action":"signal","demande":"<id>"}`, rien d'autre.
- **Identité** : `Authorization: Bearer <jeton d'identité Google>` du compte de service, audience exactement l'URL ci-dessus.
- **Réponses** : 200 `{ok:true}`, 401 `{ok:false,raison:"identite"}`, 400 `{ok:false,raison:"invalide"}`. Tant qu'Oxygen n'a pas mis l'action en ligne, la réponse est 400, sans effet.

## Comment

- Un module `functions/src/oxygen/signal.js` envoie le signal. Il prend le jeton au serveur de métadonnées de Google (`instance/service-accounts/default/identity?format=full&audience=…`, en-tête `Metadata-Flavor: Google`). C'est ce que fait `google-auth-library` (`getIdTokenClient`), sans ajouter de dépendance : la librairie n'est là que par `firebase-admin`. Un seul délai de 3 s couvre le jeton et l'envoi. Une réponse autre que 2xx ou un délai dépassé lève une erreur.
- Sur un projet `demo-*` (émulateurs, tests), rien ne part.
- Le handler attend le signal **après** la transaction. Ne pas l'attendre ne marcherait pas : Cloud Run coupe le processeur une fois la réponse rendue, et le signal se perdrait. La caissière n'en souffre pas : sa carte disparaît dès l'écriture, car son écran n'écoute que les demandes `en_attente`.
- Pas de signal pour un rejeu du même geste (`idempotent: true`) : le premier appel l'a déjà envoyé. Pas de signal non plus quand la validation échoue (solde insuffisant, demande annulée) : la transaction lève avant.
- L'échec du signal se rattrape dans le handler : une ligne `WARNING` `OXYGEN_SIGNAL_ECHEC` au journal, avec l'identifiant de la demande et la cause (statut HTTP ou nom de l'erreur), jamais le jeton.

## Approches écartées

- **Envoyer sans attendre** : le signal se perdrait le plus souvent, Cloud Run gelant l'instance après la réponse.
- **Un déclencheur Firestore sur les demandes** : une function de plus, avec Eventarc, sur le quota gratuit, et une seconde de retard en plus.
- **Un compte de service dédié** : il faudrait changer le compte sous lequel tourne `storeTransactionCommand`, avec ses droits Firestore, pour un signal qui ne porte rien.

## Mise en service, sur décision de l'utilisateur

1. L'utilisateur confirme l'adresse du compte de service de `storeTransactionCommand` (console Cloud Run, onglet Sécurité), puis on la donne à Oxygen.
2. Oxygen met en ligne l'action `signal`.
3. L'utilisateur déploie `storeTransactionCommand`. Pas de front.
