# Diagnostic d'un compte bloque

Quand un seul compte ne se connecte pas alors que les autres fonctionnent, verifier son rattachement Auth/Firestore:

```bash
npm run account:diagnose -- --email=boutique@example.com
```

Le script lit seulement les donnees suivantes:

- le compte Firebase Auth;
- le document `users/{uid}`;
- la boutique `stores/{storeId}`.

Causes courantes:

- compte Firebase Auth desactive;
- profil Firestore absent;
- profil `active: false`;
- `storeId` absent dans le profil;
- boutique `stores/{storeId}` inexistante;
- boutique inactive.

Si `firebase-admin` n'est pas encore installe:

```bash
npm install firebase-admin
```

La variable `GOOGLE_APPLICATION_CREDENTIALS` doit pointer vers le JSON du service account Firebase Admin.
