# Adaptation nouveau client

> ## ⚠ DOCUMENT PÉRIMÉ — ne pas suivre
>
> Ce fichier décrit l'ancienne méthode d'adaptation, **fichier par fichier**.
> Elle n'a plus cours : la marque et les options client dérivent désormais d'un
> **profil déclaratif** (`config/clients/<id>.js`), et un nouveau client ne
> modifie **aucun fichier front**.
>
> Références à jour : `docs/adaptation-nouveau-client.md` §4 et
> `docs/client-profiles.md`. Point d'entrée : `AGENTS.md`.
>
> Conservé pour trace historique, et parce que ses sections « Isolation client »,
> « Points sensibles » et « Nouveau projet Firebase » restent instructives.

Cette copie vient du depot GitHub source `Web-Lab-Dev/AKAYIS`.

## Stack du projet

- React 19 + Vite
- Tailwind CSS v4
- Firebase Auth + Firestore
- PWA via vite-plugin-pwa
- Export Excel via xlsx

## Commandes

```bash
npm install
npm run dev
npm run build
```

## Configuration obligatoire

Creer un fichier `.env` a partir de `.env.example`, puis renseigner le projet Firebase du nouveau client :

```env
VITE_CLIENT_ID=identifiant_client_unique
VITE_FIRESTORE_USE_CLIENT_NAMESPACE=true
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Les variables Firebase ne doivent pas etre committees dans `vercel.json`. Les renseigner uniquement dans le dashboard Vercel du client.

## Isolation client / base de donnees

- Creer un projet Firebase dedie par client.
- Donner un `VITE_CLIENT_ID` stable, en minuscules si possible, par exemple `client_acme`.
- Par defaut, Firestore ecrit sous `clients/{VITE_CLIENT_ID}/...` pour isoler les collections (`users`, `clients`, `drafts`, `history`, etc.).
- Les cles `localStorage` utilisent aussi `VITE_CLIENT_ID`, donc deux clients ouverts dans le meme navigateur ne partagent pas les donnees locales.
- Garder `VITE_FIRESTORE_USE_CLIENT_NAMESPACE=true` sauf migration volontaire vers des collections racine.
- Publier le fichier `firestore.rules` mis a jour dans le projet Firebase du client.

## Fichiers a personnaliser en priorite

- `package.json` et `package-lock.json` : nom du projet.
- `index.html` : titre, description, nom PWA Apple.
- `vite.config.js` : nom PWA, short name, description, cache/service worker.
- `README.md` : documentation client.
- `public/pwa-*.png` : icones PWA AKAYIS.
- `public/akayis-logo.*` : logo complet AKAYIS.
- `public/akayis-mark.svg` : marque/icône AKAYIS.
- `public/akayis-bg.*` : image de fond/theme AKAYIS.
- `src/components/Layout.jsx` : nom visible dans l'application.
- `src/components/auth/AuthSidebar.jsx` : nom visible cote authentification.
- `src/constants/themes.js` : cle de stockage du theme.
- `src/constants/index.js` : cles localStorage et listes reseaux.
- `src/context/NetworkConfigContext.jsx` : donnees reseaux et cle de stockage.
- `src/constants/networkConfig.js` : reseaux, couleurs et libelles.
- `src/utils/constants.js` : options reseaux et moyens de paiement.
- `src/utils/excelUtils.js` : nom par defaut des exports.

## Points sensibles

- Ne jamais reutiliser les anciennes cles d'un autre client.
- Creer un nouveau projet Firebase par client.
- Revoir `firestore.rules` avant production.
- Remplacer les variables Firebase dans Vercel, pas seulement dans `.env`.
- Adapter les reseaux partout, car ils sont utilises dans les formulaires, tableaux, graphiques et exports.

## Verification des references client

Lancer :

```bash
rg -n "ancien_nom|ancienne_marque|ancien_domaine" .
```

Puis remplacer au minimum les occurrences dans :

- `index.html`
- `README.md`
- `vite.config.js`
- `package.json`
- `package-lock.json`
- `vercel.json`
- `src/components/Layout.jsx`
- `src/components/auth/AuthSidebar.jsx`
- `src/constants/index.js`
- `src/constants/themes.js`
- `src/context/NetworkConfigContext.jsx`
- `src/utils/excelUtils.js`
