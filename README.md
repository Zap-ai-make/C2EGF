# AKAYIS CRM

Application CRM complète pour la gestion des clients et transactions de AKAYIS.

## 🚀 Fonctionnalités

- **Gestion Clients** : Ajout, modification, recherche de clients
- **Transactions** : Suivi des transactions avec historique complet
- **Dashboard** : Statistiques et graphiques en temps réel
- **Thème sombre par défaut** : interface sobre et stable
- **PWA** : Installation sur mobile et desktop + mode hors ligne
- **Multi-réseaux** : Support Orange, Moov, MTN, Telecel
- **Export Excel** : Export des données clients et transactions

## 📱 Progressive Web App (PWA)

L'application peut être installée sur n'importe quel appareil :
- **Desktop** : Chrome, Edge, Firefox
- **Mobile** : Android, iOS
- **Mode hors ligne** : Fonctionne même sans connexion internet

## 🛠️ Technologies

- **Frontend** : React 19 + Vite
- **Styling** : Tailwind CSS v4
- **Backend** : Firebase (Auth + Firestore)
- **PWA** : Workbox via vite-plugin-pwa
- **Charts** : Recharts
- **Export** : SheetJS (xlsx)

## 📦 Installation

### Prérequis
- Node.js 20+
- npm ou yarn
- Compte Firebase

### Setup

1. **Cloner le projet**
```bash
git clone <votre-repo>
cd akayis-crm
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Configuration Firebase**

Créer un fichier `.env` à la racine :
```env
VITE_CLIENT_ID=identifiant_client_unique
VITE_FIRESTORE_USE_CLIENT_NAMESPACE=true
VITE_FIREBASE_API_KEY=votre_api_key
VITE_FIREBASE_AUTH_DOMAIN=votre_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=votre_project_id
VITE_FIREBASE_STORAGE_BUCKET=votre_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=votre_sender_id
VITE_FIREBASE_APP_ID=votre_app_id
```

4. **Lancer en dev**
```bash
npm run dev
```

L'app sera disponible sur `http://localhost:5173`

## 🏗️ Build & Déploiement

### Build local
```bash
npm run build
```

Le dossier `dist/` contient les fichiers prêts pour production.

### Preview du build
```bash
npm run preview
```

### Déploiement sur Vercel (recommandé)

1. Créer un compte sur [vercel.com](https://vercel.com)
2. Connecter votre repo GitHub
3. Configurer les variables d'environnement dans Vercel
4. Déployer automatiquement à chaque push

## 📂 Structure du projet

```
akayis-crm/
├── public/              # Assets statiques
│   ├── pwa-*.png       # Icônes PWA AKAYIS
│   ├── akayis-logo.*   # Logo complet AKAYIS
│   ├── akayis-mark.svg # Marque/icône AKAYIS
│   └── akayis-bg.*     # Image de fond thème AKAYIS
├── src/
│   ├── components/     # Composants React
│   ├── config/         # Configuration (Firebase)
│   ├── constants/      # Constantes (thèmes, navigation)
│   ├── context/        # Contexts React (Theme)
│   ├── pages/          # Pages principales
│   └── utils/          # Utilitaires
├── .env                # Variables (ne pas commit!)
├── vercel.json         # Config Vercel
└── vite.config.js      # Config Vite + PWA
```

## 🎨 Thèmes

4 thèmes préinstallés + personnalisé (sauvegardés en localStorage)

## 🔒 Sécurité

- Variables d'environnement pour toutes les clés API
- Authentification Firebase
- Rules Firestore pour sécuriser la base

## 📝 Notes personnelles

- Le `.env` n'est JAMAIS commité (dans .gitignore)
- Les icônes PWA sont dans `public/pwa-*.png`
- Le Service Worker est géré auto par vite-plugin-pwa
- Firebase Persistence activée pour mode offline

## 🐛 Debugging

### PWA ne s'installe pas
1. Vérifier HTTPS (ou localhost)
2. DevTools → Application → Manifest
3. Vérifier icônes accessibles

### Variables d'environnement non trouvées
- Vérifier que `.env` existe
- Toutes les variables doivent commencer par `VITE_`
- Rebuild après modification

## 📄 Licence

Propriété de AKAYIS
