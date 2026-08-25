# Administration SaaS

## Seed des 6 boutiques

1. Copier `admin/store-seed.example.json` vers `admin/store-seed.json`.
2. Remplacer les noms et emails des 6 boutiques.
3. Configurer `GOOGLE_APPLICATION_CREDENTIALS` vers un service account Firebase Admin.
4. Installer les dépendances admin si nécessaire: `npm install firebase-admin`.
5. Lancer `npm run seed:stores`.

Le script crée/complète `stores/{storeId}` et `users/{uid}` avec le rôle `store_admin`, puis affiche un lien de réinitialisation de mot de passe pour chaque boutique.

## Suppression des comptes existants

La suppression est séparée et commence toujours par un dry-run:

```bash
npm run accounts:delete:dry-run
```

Après vérification de la liste affichée:

```bash
npm run accounts:delete
```

Cette commande supprime les comptes Firebase Auth et les profils `users/{uid}` correspondants.
