# Recommandation — Firebase App Check (chantier séparé)

> Statut : **recommandation**, non implémenté. Volontairement hors du lot d'audit
> sécurité (corrections minimales, émulateur-only). À traiter comme un lot dédié
> avec plan client + tests émulateur avant tout `enforce` en production.

## Contexte

Les règles Firestore et les Cloud Functions (`onCall`) authentifient l'**utilisateur**
(Firebase Auth) mais ne vérifient pas que la requête provient bien de **l'application
légitime**. Un porteur de jeton Auth valide peut donc appeler Firestore/Functions
depuis n'importe quel client (script, curl, app tierce).

App Check ajoute une attestation d'**intégrité du client** (reCAPTCHA v3 / Enterprise
sur le web) en plus de l'authentification utilisateur. C'est une défense en profondeur,
pas un remplacement des règles ni des gardes serveur.

## Pourquoi c'est un chantier séparé (et pas dans ce lot)

- Activer `enforce` sans période de rodage **casse tous les clients** non attestés
  (y compris l'app en prod le temps que le token se propage) → risque direct client réel.
- Nécessite une clé reCAPTCHA (config console + secret) et un débogage token pour les
  environnements de dev/CI.
- Doit être testable en émulateur avant prod (l'émulateur supporte un mode debug).

## Plan de mise en œuvre proposé (par phases, réversible)

1. **Préparation** : créer une clé reCAPTCHA v3 (ou Enterprise) pour le domaine Vercel ;
   enregistrer l'app web dans App Check (console Firebase) en mode **non-enforce**.
2. **Instrumentation client** : `initializeAppCheck(app, { provider: ReCaptchaV3Provider(...),
   isTokenAutoRefreshEnabled: true })` dans `src/config/firebase.js`, derrière un flag ;
   gérer le **debug token** en dev (`FIREBASE_APPCHECK_DEBUG_TOKEN`).
3. **Monitoring** : laisser App Check en **mode mesure** (non-enforce) plusieurs jours ;
   observer dans la console le taux de requêtes vérifiées vs non vérifiées, sur Firestore
   ET Functions, pour s'assurer que 100 % du trafic légitime est attesté.
4. **Tests émulateur** : vérifier le parcours complet (login → transactions → dealer) avec
   App Check debug activé ; ajouter au moins un test qui échoue si un appel non attesté
   passe une fois l'enforce simulé.
5. **Enforce progressif** : activer l'`enforce` d'abord sur **Functions**, puis sur
   **Firestore**, en surveillant les erreurs client. Rollback = repasser en non-enforce
   (effet immédiat côté console, aucune redéploiement de règles requis).

## Critères d'acceptation avant `enforce` prod

- 100 % du trafic légitime observé comme « vérifié » pendant la fenêtre de monitoring.
- Parcours critiques testés en émulateur avec App Check debug.
- Procédure de rollback documentée et testée (retour non-enforce).
- Débogage token configuré pour CI/dev afin de ne pas casser les tests.

## Hors périmètre de cette reco

Ne pas activer l'`enforce` tant que les phases 3–4 ne sont pas validées. App Check ne
remplace pas : les règles Firestore, les gardes de rôle serveur, ni la piste d'audit.
