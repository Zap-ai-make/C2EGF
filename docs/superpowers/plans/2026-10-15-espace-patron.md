# Espace Patron — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au patron un espace de trois écrans sur son téléphone — le tableau des clients du réseau avec recherche, la page d'historique d'un client avec envoi WhatsApp, et les 84 boutiques avec leurs quatre soldes et le chiffre d'affaires.

**Architecture:** Le même portail, le même rôle `system_manager`, la même porte d'entrée. Neuf écrans de supervision sont supprimés et remplacés par deux onglets. Quatre des six capacités demandées existent déjà dans le dépôt et sont réutilisées sans réécriture ; la seule modification serveur est l'élargissement d'un garde de rôle.

**Tech Stack:** React 19, Vite, Tailwind v4, Firebase (Firestore, Cloud Functions gen2 Node 22), Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-10-15-espace-patron-design.md](../specs/2026-10-15-espace-patron-design.md)

## Global Constraints

- **Aucune écriture dans l'espace patron.** Ni création, ni modification, ni suppression, ni import Excel.
- **Aucune règle Firestore élargie.** Chaque lecture nécessaire est déjà autorisée à `isSystemManager()`. Si une tâche semble en demander une, c'est la tâche qui est fausse.
- **Zéro emoji dans l'interface, zéro couleur hors palette.** Jetons de `src/index.css` uniquement (`DESIGN.md`).
- **Numérotation des tests :** `tc-264` et suivants. Le dernier utilisé est `tc-263`.
- **Fuseau :** toute borne de journée passe par `getBusinessDayBounds` ([businessDate.js:88](../../../src/utils/businessDate.js#L88)), jamais `new Date()` tronqué en UTC.
- **`functions/` ne peut rien importer de `src/`** — les deux arbres sont déployés séparément.
- **Commandes :** `npm run test:unit`, `npm run test:components`, `npm run test:functions` (émulateur). En cas d'échec de démarrage des workers : ajouter `--pool=threads`.
- **Jamais de `git push`, jamais de déploiement.** Décision humaine (AGENTS.md).

## Review Focus

Cinq classes d'entrée que la spec implique sans qu'aucune tâche ne les exerce. Chacune reçoit son test dans la tâche qui possède le code.

1. **Une journée réellement sans opération.** Le CA doit afficher `0 FCFA`, pas « indisponible » — et l'inverse pour une panne. Confondre les deux est le piège central de cet écran. → Tâche 9.
2. **Un `clientId` inexistant dans l'URL de l'historique** (adresse tapée, fiche supprimée, signet périmé). La page doit le dire, pas planter. → Tâche 5.
3. **Une fiche d'avant la séparation des champs agent** — `codeAgent` et `numeroAgent` vides, la valeur dormant dans `orange`. Elle doit rester trouvable et affichable. → Tâche 4.
4. **Une boutique sans document `networkBalances`.** `null` n'est pas `0` : la ligne doit dire « inconnu » et la somme annoncer qu'elle est incomplète. → Tâche 8.
5. **Un `montant` non numérique dans `history`.** L'agrégation `sum()` l'ignore côté serveur : le CA serait sous-évalué sans que rien ne le signale. → Tâche 9.

---

### Task 1: `TableRow` — la cellule d'actions n'existe que si on peut agir

**Files:**
- Modify: `src/components/TableRow.jsx:37-54`
- Test: `tests/components/tc-264-ligne-client-lecture-seule.test.jsx`

**Interfaces:**
- Consomme : rien.
- Produit : `TableRow` rend **11** cellules quand `onEdit` est absent, **12** quand il est fourni. Les tâches 4 et 5 en dépendent pour aligner leurs en-têtes.

**Pourquoi cette tâche d'abord.** `TableRow` garde `onHistorique` derrière un `onHistorique &&` mais pas la cellule d'actions, dont le `onClick` fait `onEdit && onEdit(client)`. Chez le patron, « Modifier » s'afficherait et ne ferait rien — pire qu'absent, et un chemin d'écriture le jour où quelqu'un le câble.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TableRow from '../../src/components/TableRow.jsx'

/**
 * TC-264 — la ligne client ne propose que ce qu'elle peut faire.
 *
 * ⚠ LE DÉFAUT. `TableRow` gardait `onHistorique` derrière une condition, mais
 *   PAS la cellule d'actions : son bouton « Modifier » s'affichait toujours, et
 *   son `onClick` faisait `onEdit && onEdit(client)` — donc rien, sans le dire.
 *   L'espace patron est en lecture seule : un bouton qui a l'air d'écrire et
 *   n'écrit pas est pire qu'un bouton absent, et devient un chemin d'écriture
 *   le jour où quelqu'un le câble.
 */

const fiche = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', registeredStoreName: 'FADA',
  numeroIdentite: 'B 029', numeroPersonnel: '76548890', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga', agentCommercial: 'SORE', dateAjout: '04/02/2026',
}

const ligne = (props = {}) => render(
  <table><tbody><TableRow client={fiche} index={0} {...props} /></tbody></table>,
)

afterEach(cleanup)

describe('TC-264 — sans `onEdit`, aucune action', () => {
  it('[TC-264-01] le bouton Modifier est absent', () => {
    ligne()
    expect(screen.queryByRole('button', { name: /modifier/i })).toBeNull()
  })

  it('[TC-264-02] le bouton Supprimer est absent lui aussi', () => {
    ligne()
    expect(screen.queryByRole('button', { name: /supprimer/i })).toBeNull()
  })

  /** 11 colonnes d'en-tête chez le patron, donc 11 cellules. */
  it('[TC-264-03] la ligne rend 11 cellules', () => {
    const { container } = ligne()
    expect(container.querySelectorAll('td')).toHaveLength(11)
  })
})

describe('TC-264 — avec `onEdit`, le gérant ne perd rien', () => {
  it('[TC-264-04] le bouton Modifier est là et appelle `onEdit`', () => {
    const onEdit = vi.fn()
    ligne({ onEdit })
    screen.getByRole('button', { name: /modifier/i }).click()
    expect(onEdit).toHaveBeenCalledWith(fiche)
  })

  it('[TC-264-05] Supprimer reste présent et désactivé', () => {
    ligne({ onEdit: vi.fn() })
    expect(screen.getByRole('button', { name: /supprimer/i })).toBeDisabled()
  })

  it('[TC-264-06] la ligne rend 12 cellules', () => {
    const { container } = ligne({ onEdit: vi.fn() })
    expect(container.querySelectorAll('td')).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/components/tc-264-ligne-client-lecture-seule.test.jsx`

Expected: `[TC-264-01]`, `[TC-264-02]` et `[TC-264-03]` échouent — le bouton « Modifier » est trouvé et la ligne rend 12 cellules. Les trois derniers passent déjà : ils figent le comportement du gérant.

- [ ] **Step 3: Write minimal implementation**

Dans `src/components/TableRow.jsx`, mettre la cellule d'actions derrière le même garde que l'historique :

```jsx
      {onEdit && (
        <td className="px-4 py-3 text-center">
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => onEdit(client)}
              className="rounded bg-brand-500 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Modifier
            </button>
            <button
              type="button"
              disabled
              title="Suppression désactivée pour protéger la base clients commune"
              className="cursor-not-allowed rounded bg-gray-200 px-3 py-1 text-sm font-medium text-gray-500"
            >
              Supprimer
            </button>
          </div>
        </td>
      )}
```

Ajouter au-dessus le commentaire qui dit pourquoi :

```jsx
      {/* ⚠ LA CELLULE ENTIÈRE, PAS SEULEMENT SON CONTENU. Un `<td>` vide
          laisserait une douzième colonne sans en-tête chez le patron, et le
          tableau se décalerait d'une case. Et `onEdit &&` plutôt que
          `onEdit && onEdit(client)` dans le handler : un bouton qui s'affiche
          sans pouvoir agir est pire qu'un bouton absent. */}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/components/tc-264-ligne-client-lecture-seule.test.jsx`
Expected: 6 PASS.

Puis la non-régression du gérant : `npx vitest run --config vitest.config.js tests/components/tc-102-clients-table-caracterisation.test.jsx`
Expected: PASS — `ClientsTable` passe toujours `onEdit`.

- [ ] **Step 5: Commit**

```bash
git add src/components/TableRow.jsx tests/components/tc-264-ligne-client-lecture-seule.test.jsx
git commit -m "fix: un bouton qui a l air d ecrire et n ecrit pas est pire qu absent"
```

---

### Task 2: `subscribeToAllClients` — le chemin global, nommé

**Files:**
- Modify: `src/services/firestore.js` (juste après `subscribeToClients`, ligne 997)
- Test: `tests/unit/tc-265-abonnement-clients-reseau.test.js`

**Interfaces:**
- Consomme : rien.
- Produit : `firestoreService.subscribeToAllClients(callback) → unsubscribe`. La tâche 4 l'appelle.

**Ce qu'il ne fait pas, et pourquoi.** Aucun contrôle de rôle : ce service ne connaît que `this.activeStore` ([firestore.js:85](../../../src/services/firestore.js#L85)). Le rôle est tenu par le `RoleGuard` de la route et par les règles Firestore. Prétendre le vérifier ici donnerait une fausse impression de contrôle.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * TC-265 — l'abonnement global du patron, et la précondition du gérant intacte.
 *
 * ⚠ CE QUE CE TEST NE PROUVE PAS, ET IL FAUT LE SAVOIR. Il ne vérifie aucun
 *   rôle : ce service n'en connaît aucun. Le rôle est tenu par le `RoleGuard`
 *   de la route et par `firestore.rules`.
 *
 * ⚠ ET CE QU'IL FIGE VRAIMENT : que personne n'assouplisse `subscribeToClients`
 *   pour servir le patron. `requireActiveStore()` n'y filtre rien — la
 *   collection `globalClients` est à la RACINE — mais c'est la précondition
 *   juste pour les neuf écrans du gérant, dont le reste est bien cloisonné.
 */

const onSnapshot = vi.fn(() => vi.fn())
const collection = vi.fn((_db, path) => ({ path }))

vi.mock('firebase/firestore', () => ({
  collection: (...a) => collection(...a),
  onSnapshot: (...a) => onSnapshot(...a),
  doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(),
  where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  serverTimestamp: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), deleteDoc: vi.fn(), writeBatch: vi.fn(),
  getCountFromServer: vi.fn(), collectionGroup: vi.fn(), runTransaction: vi.fn(),
}))

vi.mock('../../src/config/firebase.js', () => ({ db: {}, auth: {}, functions: {} }))

const { default: firestoreService } = await import('../../src/services/firestore.js')

beforeEach(() => {
  onSnapshot.mockClear()
  collection.mockClear()
  firestoreService.setActiveStore(null)
})

describe('TC-265 — le patron s’abonne sans boutique active', () => {
  it('[TC-265-01] `subscribeToAllClients` ne lève pas sans boutique active', () => {
    expect(() => firestoreService.subscribeToAllClients(vi.fn())).not.toThrow()
  })

  it('[TC-265-02] il vise la racine `globalClients`', () => {
    firestoreService.subscribeToAllClients(vi.fn())
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  it('[TC-265-03] il rend la fonction de désabonnement', () => {
    const stop = vi.fn()
    onSnapshot.mockReturnValueOnce(stop)
    expect(firestoreService.subscribeToAllClients(vi.fn())).toBe(stop)
  })

  it('[TC-265-04] les documents arrivent avec leur identifiant', () => {
    const recu = vi.fn()
    firestoreService.subscribeToAllClients(recu)
    const [, surSuivant] = onSnapshot.mock.calls[0]
    surSuivant({ docs: [{ id: 'c1', data: () => ({ nom: 'OUEDRAOGO' }) }] })
    expect(recu).toHaveBeenCalledWith([{ id: 'c1', nom: 'OUEDRAOGO' }])
  })
})

describe('TC-265 — le chemin du gérant garde sa précondition', () => {
  it('[TC-265-05] `subscribeToClients` lève toujours sans boutique active', () => {
    expect(() => firestoreService.subscribeToClients(vi.fn()))
      .toThrow(/Boutique active introuvable/)
  })

  it('[TC-265-06] et il fonctionne avec une boutique active', () => {
    firestoreService.setActiveStore({ id: 's1', name: 'FADA' })
    expect(() => firestoreService.subscribeToClients(vi.fn())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-265-abonnement-clients-reseau.test.js`
Expected: `[TC-265-01]` à `[TC-265-04]` échouent avec `firestoreService.subscribeToAllClients is not a function`. `[TC-265-05]` et `[TC-265-06]` passent déjà.

- [ ] **Step 3: Write minimal implementation**

Dans `src/services/firestore.js`, après `subscribeToClients` :

```js
  /**
   * La base clients entière, sans exiger de boutique active.
   *
   * ⚠ POURQUOI UNE SECONDE FONCTION PLUTÔT QU'UN ASSOUPLISSEMENT.
   *   `requireActiveStore()` ne filtre RIEN sur cette collection :
   *   `resolveCollectionPath` renvoie le nom nu pour `CLIENTS`, `STORES` et
   *   `USERS`, donc `subscribeToClients` vise déjà la racine `globalClients`
   *   sans préfixe de boutique — et les règles l'autorisent à tout
   *   `hasProfile()`. Chaque gérant diffuse donc déjà la base entière.
   *
   *   Ce n'est donc pas une frontière de sécurité qu'on contourne ici. Mais
   *   c'est la PRÉCONDITION JUSTE pour les écrans du gérant : sans boutique
   *   active, le reste de leur application ne fonctionne pas, et échouer tôt
   *   avec un message clair vaut mieux qu'un écran à moitié chargé. L'assouplir
   *   pour servir un écran nouveau rendrait cette panne silencieuse pour tous
   *   les autres.
   *
   * ⚠ AUCUN CONTRÔLE DE RÔLE ICI. Ce service ne connaît pas le rôle — il ne
   *   porte que `this.activeStore`. L'autorisation est tenue par le `RoleGuard`
   *   de la route et par `firestore.rules`, et aucun des deux n'est
   *   contournable depuis le navigateur.
   */
  subscribeToAllClients(callback) {
    const collectionRef = this.collectionRef(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS)
    const observer = normalizeSubscriptionObserver(callback)

    return onSnapshot(collectionRef,
      (snapshot) => {
        try {
          observer.onNext(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
        } catch (error) {
          notifySubscriptionError(observer, error, 'All clients snapshot processing error')
        }
      },
      (error) => {
        notifySubscriptionError(observer, error, 'All clients subscription error')
      }
    )
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-265-abonnement-clients-reseau.test.js`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/firestore.js tests/unit/tc-265-abonnement-clients-reseau.test.js
git commit -m "feat: la base entiere, sans exiger une boutique que le patron n a pas"
```

---

### Task 3: Le shell patron — deux onglets, neuf écrans supprimés

**Files:**
- Modify: `src/constants/navigation.js:84-94`
- Modify: `src/layouts/AdminLayout.jsx` (remplacement complet du shell)
- Modify: `src/App.jsx:40-48` (imports) et `146-154` (routes)
- Delete: `src/pages/admin/AdminDashboard.jsx`, `AdminStores.jsx`, `AdminUsers.jsx`, `AdminDealer.jsx`, `AdminDealerInventory.jsx`, `AdminHistory.jsx`, `AdminReports.jsx`, `AdminProfile.jsx`
- Create: `src/pages/admin/PatronClients.jsx` (coquille, remplie en tâche 4)
- Create: `src/pages/admin/PatronBoutiques.jsx` (coquille, remplie en tâche 8)
- Test: `tests/components/tc-266-shell-patron.test.jsx`

**Interfaces:**
- Consomme : rien.
- Produit : les routes `/admin` → `PatronClients`, `/admin/boutiques` → `PatronBoutiques`, et une redirection vers `/admin` pour les huit anciennes adresses. `ADMIN_NAV_ITEMS` ne contient plus que deux entrées.

**Vérifié avant de supprimer :** `adminService.js` n'expose que des `list*`/`get*`/`normalize*`. Aucune de ces pages n'écrit. Supprimer ne retire aucune capacité.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-266 — le shell du patron : deux destinations, et les anciennes qui mènent
 * quelque part.
 *
 * ⚠ POURQUOI DES REDIRECTIONS PLUTÔT QUE DES 404. Un signet, un raccourci PWA
 *   ou un simple rechargement visent encore `/admin/reports`. La racine d'une
 *   application doit toujours mener quelque part — c'est le raisonnement déjà
 *   écrit dans App.jsx pour le tableau de bord boutique.
 */

vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: { Provider: ({ children }) => children },
  useAuth: () => ({ logout: vi.fn(), userProfile: { name: 'Le Patron', role: 'system_manager' } }),
}))

const { default: AdminLayout } = await import('../../src/layouts/AdminLayout.jsx')
const { ADMIN_NAV_ITEMS } = await import('../../src/constants/navigation.js')

afterEach(cleanup)

const shell = () => render(<MemoryRouter initialEntries={['/admin']}><AdminLayout /></MemoryRouter>)

describe('TC-266 — deux destinations, pas neuf', () => {
  it('[TC-266-01] la navigation ne déclare que Clients et Boutiques', () => {
    expect(ADMIN_NAV_ITEMS.map(i => i.path)).toEqual(['/admin', '/admin/boutiques'])
  })

  it('[TC-266-02] aucune entrée ne pointe vers un écran supprimé', () => {
    const partis = ['/admin/stores', '/admin/users', '/admin/dealer',
                    '/admin/dealer-inventory', '/admin/clients',
                    '/admin/history', '/admin/reports', '/admin/profile']
    const chemins = ADMIN_NAV_ITEMS.map(i => i.path)
    for (const p of partis) expect(chemins).not.toContain(p)
  })

  /** Le pouce atteint le bas de l'écran sans déplacer la main. */
  it('[TC-266-03] les onglets sont une barre, pas une barre latérale', () => {
    shell()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByLabelText(/barre latérale/i)).toBeNull()
  })

  it('[TC-266-04] aucun bouton hamburger', () => {
    shell()
    expect(screen.queryByLabelText(/ouvrir le menu/i)).toBeNull()
  })

  it('[TC-266-05] le nom et la déconnexion vivent dans le shell', () => {
    shell()
    expect(screen.getByText('Le Patron')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /déconnecter|quitter/i })).toBeInTheDocument()
  })
})

describe('TC-266 — les anciennes adresses mènent quelque part', () => {
  it('[TC-266-06] App.jsx redirige les huit anciennes vers /admin', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/App.jsx', 'utf8')
    const partis = ['stores', 'users', 'dealer', 'dealer-inventory',
                    'clients', 'history', 'reports', 'profile']
    for (const p of partis) {
      expect(source).toMatch(new RegExp(`path="/admin/${p}"[^>]*Navigate`, 's'))
    }
  })

  it('[TC-266-07] aucune page admin supprimée n’est encore importée', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/App.jsx', 'utf8')
    for (const nom of ['AdminDashboard', 'AdminStores', 'AdminUsers', 'AdminDealer',
                       'AdminHistory', 'AdminReports', 'AdminProfile']) {
      expect(source).not.toContain(nom)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/components/tc-266-shell-patron.test.jsx`
Expected: tout échoue — `ADMIN_NAV_ITEMS` a neuf entrées, le shell rend une barre latérale et un hamburger, `App.jsx` importe les pages supprimées.

- [ ] **Step 3: Write minimal implementation**

`src/constants/navigation.js`, remplacer `ADMIN_NAV_ITEMS` :

```js
// Deux destinations. La notion de « section » disparaît avec la barre latérale :
// on ne groupe pas deux entrées.
export const ADMIN_NAV_ITEMS = [
  { name: 'Clients', path: '/admin' },
  { name: 'Boutiques', path: '/admin/boutiques' },
]
```

`src/layouts/AdminLayout.jsx`, remplacer tout le fichier :

```jsx
import { NavLink, Outlet } from 'react-router-dom'
import { Users, Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ADMIN_NAV_ITEMS } from '../constants/navigation'
import { APP_NAME } from '../constants/branding'

/**
 * Le poste du patron — un en-tête, le contenu, deux onglets en pied.
 *
 * ⚠ LA BARRE LATÉRALE A ÉTÉ RETIRÉE, PAS REPLIÉE. Elle existait pour naviguer
 *   entre neuf destinations ; avec deux, elle coûte un bouton hamburger, un
 *   overlay et un geste avant d'atteindre quoi que ce soit. Les onglets en pied
 *   sont à portée du pouce, qui est la seule main disponible quand on consulte
 *   une fiche en parlant au téléphone.
 */

const ICONES = { '/admin': Users, '/admin/boutiques': Store }

function AdminLayout() {
  const { logout, userProfile } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-canvas" data-testid="admin-layout">
      <header className="flex flex-none items-center justify-between gap-3 bg-brand-500 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold leading-tight text-white">{APP_NAME}</p>
          {userProfile?.name && (
            <p className="truncate text-xs text-brand-200">{userProfile.name}</p>
          )}
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex-none rounded-lg border border-white/30 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Se déconnecter
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <nav role="tablist" aria-label="Navigation" className="grid flex-none grid-cols-2 border-t border-line bg-surface">
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icone = ICONES[item.path] ?? Users
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/admin'}
              role="tab"
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  isActive ? 'text-brand-400' : 'text-ink-muted'
                }`
              }
            >
              <Icone className="h-5 w-5" aria-hidden="true" />
              {item.name}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

export default AdminLayout
```

`src/pages/admin/PatronClients.jsx` — coquille :

```jsx
/** Rempli par la tâche 4. */
function PatronClients() {
  return <div data-testid="patron-clients" />
}

export default PatronClients
```

`src/pages/admin/PatronBoutiques.jsx` — coquille :

```jsx
/** Rempli par la tâche 8. */
function PatronBoutiques() {
  return <div data-testid="patron-boutiques" />
}

export default PatronBoutiques
```

`src/App.jsx`, remplacer les neuf imports admin par deux :

```jsx
const PatronClients = lazy(() => import('./pages/admin/PatronClients.jsx'))
const PatronBoutiques = lazy(() => import('./pages/admin/PatronBoutiques.jsx'))
```

et le bloc de routes admin :

```jsx
        <Route path="/admin" element={<PatronClients />} />
        <Route path="/admin/boutiques" element={<PatronBoutiques />} />
        {/* Les huit écrans de supervision sont supprimés. Leurs adresses
            redirigent plutôt que de tomber en 404 : un signet ou un raccourci
            PWA doit toujours mener quelque part. Même raisonnement qu'à la
            racine de l'espace boutique, plus haut dans ce fichier. */}
        {['stores', 'users', 'dealer', 'dealer-inventory', 'clients', 'history', 'reports', 'profile']
          .map((parti) => (
            <Route key={parti} path={`/admin/${parti}`} element={<Navigate to="/admin" replace />} />
          ))}
```

Puis supprimer les huit fichiers :

```bash
git rm src/pages/admin/AdminDashboard.jsx src/pages/admin/AdminStores.jsx \
       src/pages/admin/AdminUsers.jsx src/pages/admin/AdminDealer.jsx \
       src/pages/admin/AdminDealerInventory.jsx src/pages/admin/AdminHistory.jsx \
       src/pages/admin/AdminReports.jsx src/pages/admin/AdminProfile.jsx
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/components/tc-266-shell-patron.test.jsx`
Expected: 7 PASS.

Puis la suite complète des composants, parce que huit fichiers ont disparu :
Run: `npm run test:components`
Expected: PASS. Tout test qui importait une page supprimée doit être retiré avec elle — le signaler nommément dans le message de commit.

Run: `npm run lint`
Expected: propre. Les exports d'`adminService.js` devenus inutilisés sont signalés : les supprimer dans ce commit.

- [ ] **Step 5: Commit**

```bash
git add -A src/constants/navigation.js src/layouts/AdminLayout.jsx src/App.jsx \
          src/pages/admin/ src/services/adminService.js \
          tests/components/tc-266-shell-patron.test.jsx
git commit -m "refactor: neuf ecrans de supervision pour une question a laquelle aucun ne repond"
```

---

### Task 4: Le tableau du patron — 11 colonnes, nom figé, recherche réseau

**Files:**
- Modify: `src/pages/admin/PatronClients.jsx` (remplace la coquille)
- Test: `tests/components/tc-267-tableau-patron.test.jsx`

**Interfaces:**
- Consomme : `firestoreService.subscribeToAllClients` (tâche 2), `TableRow` sans `onEdit` (tâche 1).
- Produit : la route `/admin` rend le tableau et navigue vers `/admin/clients/:clientId/historique` au clic sur Historique. La tâche 5 sert cette route.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-267 — le tableau du patron : celui du gérant, en lecture seule, sur toute
 * la base.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

let recoit = null
const desabonner = vi.fn()
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: {
    subscribeToAllClients: (cb) => { recoit = cb; return desabonner },
  },
}))

const { default: PatronClients } = await import('../../src/pages/admin/PatronClients.jsx')

const fiche = (over = {}) => ({
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', registeredStoreName: 'FADA',
  numeroIdentite: 'B 029', numeroPersonnel: '76548890', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga', agentCommercial: 'SORE',
  dateAjout: '04/02/2026', ...over,
})

const ecran = () => render(<MemoryRouter><PatronClients /></MemoryRouter>)

beforeEach(() => { navigate.mockClear(); recoit = null })
afterEach(cleanup)

describe('TC-267 — ce que le tableau montre', () => {
  it('[TC-267-01] 11 en-têtes, et pas de colonne Actions', () => {
    ecran()
    recoit([fiche()])
    const entetes = screen.getAllByRole('columnheader')
    expect(entetes).toHaveLength(11)
    expect(entetes.map(e => e.textContent)).not.toContain('Actions')
  })

  it('[TC-267-02] aucun bouton Modifier : le patron n’écrit rien', () => {
    ecran()
    recoit([fiche()])
    expect(screen.queryByRole('button', { name: /modifier/i })).toBeNull()
  })

  it('[TC-267-03] ni export ni import Excel', () => {
    ecran()
    recoit([fiche()])
    expect(screen.queryByRole('button', { name: /export|import/i })).toBeNull()
  })

  /**
   * ⚠ REVIEW FOCUS 3 — une fiche d'avant la séparation des champs agent. Son
   *   code dort dans `orange` ; `champsAgent` le range à la lecture. La ligne
   *   doit s'afficher, et la recherche doit la trouver.
   */
  it('[TC-267-04] une fiche ancienne (code dans `orange`) s’affiche et se trouve', () => {
    ecran()
    recoit([fiche({ codeAgent: '', numeroAgent: '', orange: '6412887' })])
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '6412887' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
  })
})

describe('TC-267 — la recherche est celle de l’application', () => {
  it('[TC-267-05] un nom complet trouve, nom et prénom étant deux champs', () => {
    ecran()
    recoit([fiche(), fiche({ id: 'c2', nom: 'KABORE', prenom: 'Alimata', codeAgent: '6503112' })])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'ouedraogo salif' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
    expect(screen.queryByText('KABORE')).toBeNull()
  })

  it('[TC-267-06] un numéro espacé égale le même numéro collé', () => {
    ecran()
    recoit([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '70 11 22 33' } })
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
  })

  it('[TC-267-07] rien trouvé le dit', () => {
    ecran()
    recoit([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'zzzz' } })
    expect(screen.getByText(/rien trouvé|aucun/i)).toBeInTheDocument()
  })
})

describe('TC-267 — l’historique est une page', () => {
  it('[TC-267-08] le bouton navigue vers la page du client', () => {
    ecran()
    recoit([fiche()])
    fireEvent.click(screen.getByRole('button', { name: /historique de OUEDRAOGO/i }))
    expect(navigate).toHaveBeenCalledWith('/admin/clients/c1/historique')
  })
})

describe('TC-267 — le cycle de l’abonnement', () => {
  it('[TC-267-09] il se coupe au démontage', () => {
    const { unmount } = ecran()
    unmount()
    expect(desabonner).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/components/tc-267-tableau-patron.test.jsx`
Expected: tout échoue — `PatronClients` est une coquille vide.

- [ ] **Step 3: Write minimal implementation**

`src/pages/admin/PatronClients.jsx` :

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { TABLE_HEADERS } from '../../constants'
import { chercherClients } from '../../utils/rechercheClients.js'
import TableRow from '../../components/TableRow.jsx'

/**
 * Le tableau des clients du réseau — l'écran d'accueil du patron.
 *
 * ⚠ CE N'EST PAS `ClientsTable`, ET C'EST VOULU. Celui-ci prend `onEdit`,
 *   `onImportClients` et `onAddClient`, lit `activeStore` dans `AuthContext`
 *   pour construire sa carte de boutiques, et monte `useExcelOperations`. Le
 *   patron n'a pas d'`activeStore`, et son espace est en lecture : importer un
 *   fichier Excel est une écriture. Ce qui est partagé, c'est la LIGNE
 *   (`TableRow`) et les COLONNES (`TABLE_HEADERS`) — pas l'enveloppe.
 *
 * ⚠ `onEdit` N'EST PAS PASSÉ, et c'est ce qui retire la cellule d'actions
 *   (TableRow, tâche 1). Onze en-têtes, onze cellules.
 *
 * ⚠ AUCUNE PAGINATION. Le gérant en a une parce que son écran sert aussi à
 *   parcourir ; le patron, lui, CHERCHE. Une pagination le forcerait à deviner
 *   dans quelle page dort la fiche qu'il a au téléphone — et la recherche,
 *   elle, porte sur la base entière parce qu'elle est entièrement en mémoire.
 */
function PatronClients() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [terme, setTerme] = useState('')

  useEffect(() => firestoreService.subscribeToAllClients(setClients), [])

  const resultats = useMemo(
    () => (terme.trim() ? chercherClients(clients, terme).resultats : clients),
    [clients, terme],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="patron-clients">
      <div className="flex-none bg-brand-500 px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="search"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            aria-label="Chercher un client"
            placeholder="Code agent, numéro, nom…"
            className="min-h-13 w-full rounded-xl bg-surface py-3 pl-11 pr-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </div>
      </div>

      <p className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums">
        {terme.trim()
          ? `${resultats.length} ${resultats.length === 1 ? 'résultat' : 'résultats'}`
          : `${clients.length.toLocaleString('fr-FR')} fiches · tout le réseau`}
      </p>

      {resultats.length === 0 ? (
        <p className="px-6 py-12 text-center text-ink-muted">
          {terme.trim() ? 'Rien trouvé. Vérifie le code agent, ou cherche par nom.' : 'Chargement…'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {TABLE_HEADERS.map((header, i) => (
                  <th
                    key={header.key}
                    scope="col"
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-brand-200 bg-brand-100 px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-brand-500 ${
                      // La colonne Nom reste visible quand on fait défiler vers
                      // la droite : sans elle, dix colonnes de chiffres
                      // n'appartiennent plus à personne.
                      i === 1 ? 'left-0 z-20' : ''
                    } ${header.width}`}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultats.map((client, index) => (
                <TableRow
                  key={client.id}
                  client={client}
                  index={index}
                  onHistorique={(c) => navigate(`/admin/clients/${c.id}/historique`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PatronClients
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/components/tc-267-tableau-patron.test.jsx`
Expected: 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/PatronClients.jsx tests/components/tc-267-tableau-patron.test.jsx
git commit -m "feat: le tableau du reseau, en lecture, avec la recherche qui marche"
```

---

### Task 5: La page historique du client, et la moyenne des durées

**Files:**
- Create: `src/utils/delaiMoyen.js`
- Create: `src/pages/admin/PatronHistoriqueClient.jsx`
- Modify: `src/App.jsx` (ajouter la route `/admin/clients/:clientId/historique`)
- Test: `tests/unit/tc-268-delai-moyen.test.js`
- Test: `tests/components/tc-269-page-historique-patron.test.jsx`

**Interfaces:**
- Consomme : `useHistoriqueClient(clientId)` → `{ enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer }`, `firestoreService.subscribeToAllClients` (tâche 2).
- Produit : `delaiMoyen(lignes) → { jours: number|null, mesurees: number, total: number }`. La tâche 6 l'utilise pour le texte WhatsApp.

- [ ] **Step 1: Write the failing test (le calcul pur d'abord)**

```js
import { describe, it, expect } from 'vitest'
import { delaiMoyen } from '../../src/utils/delaiMoyen.js'

/**
 * TC-268 — « combien de temps il met », et sur combien d'opérations.
 *
 * ⚠ LA MOYENNE NE PORTE PAS SUR TOUT, ET L'ÉCRAN DOIT LE DIRE. `dureeDe` rend
 *   `null` dans deux cas qui ne sont pas des échecs : une opération validée d'un
 *   seul geste au formulaire n'a jamais attendu (pas de `validatedAt`), et une
 *   durée nulle signale une création-validation dans la même écriture serveur.
 *   Annoncer « paie en 9 j » sous un compteur de 24 opérations dont 6 seulement
 *   sont mesurées fait lire une statistique à la place d'une autre. D'où
 *   `mesurees` et `total`, rendus ensemble et jamais séparables.
 */

const JOUR = 24 * 60 * 60 * 1000
const op = (jours) => ({
  createdAt: new Date('2026-10-01T08:00:00Z'),
  validatedAt: new Date(new Date('2026-10-01T08:00:00Z').getTime() + jours * JOUR),
})
const directe = () => ({ createdAt: new Date('2026-10-01T08:00:00Z') })

describe('TC-268 — la moyenne et son effectif', () => {
  it('[TC-268-01] la moyenne de 2, 4 et 9 jours vaut 5', () => {
    expect(delaiMoyen([op(2), op(4), op(9)])).toEqual({ jours: 5, mesurees: 3, total: 3 })
  })

  it('[TC-268-02] les opérations sans `validatedAt` sont exclues du calcul', () => {
    expect(delaiMoyen([op(4), directe(), directe()]))
      .toEqual({ jours: 4, mesurees: 1, total: 3 })
  })

  it('[TC-268-03] une durée nulle ne compte pas comme un délai de zéro', () => {
    expect(delaiMoyen([op(6), op(0)])).toEqual({ jours: 6, mesurees: 1, total: 2 })
  })

  /** Aucune mesure n'est un résultat, pas une erreur — et ce n'est pas zéro. */
  it('[TC-268-04] sans aucune mesure, `jours` vaut null', () => {
    expect(delaiMoyen([directe(), directe()])).toEqual({ jours: null, mesurees: 0, total: 2 })
  })

  it('[TC-268-05] une liste vide ne prétend rien', () => {
    expect(delaiMoyen([])).toEqual({ jours: null, mesurees: 0, total: 0 })
  })

  it('[TC-268-06] une entrée absente ou nulle ne casse rien', () => {
    expect(delaiMoyen([null, undefined, op(3)])).toEqual({ jours: 3, mesurees: 1, total: 3 })
  })

  it('[TC-268-07] la moyenne est arrondie au jour', () => {
    expect(delaiMoyen([op(2), op(3)]).jours).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-268-delai-moyen.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/delaiMoyen.js"`.

- [ ] **Step 3: Write minimal implementation**

`src/utils/delaiMoyen.js` :

```js
import { dureeDe } from './attente.js'

const JOUR = 24 * 60 * 60 * 1000

/**
 * Combien de temps ce client met, en moyenne — et sur combien d'opérations.
 *
 * ⚠ `mesurees` ET `total` SORTENT AVEC LA MOYENNE, TOUJOURS. `dureeDe` ne
 *   mesure que les opérations qui ont réellement séjourné dans les non
 *   terminées : celles validées d'un geste au formulaire n'ont pas de
 *   `validatedAt`, et une durée nulle vient d'une création-validation dans la
 *   même écriture serveur. Rendre la moyenne seule laisserait l'écran annoncer
 *   « paie en 9 j » à côté de « 24 opérations » alors que six sont mesurées.
 *
 * ⚠ `jours: null` N'EST PAS ZÉRO. Aucune opération mesurable est un résultat
 *   honnête ; zéro jour voudrait dire « il rembourse instantanément ».
 *
 * PUR — aucune I/O, aucune horloge lue à l'intérieur : `dureeDe` travaille sur
 * deux horodatages déjà présents dans la ligne.
 */
export function delaiMoyen(lignes = []) {
  const liste = Array.isArray(lignes) ? lignes : []
  const durees = []

  for (const ligne of liste) {
    if (!ligne) continue
    const duree = dureeDe(ligne)
    if (duree) durees.push(duree.ms)
  }

  const jours = durees.length === 0
    ? null
    : Math.round(durees.reduce((somme, ms) => somme + ms, 0) / durees.length / JOUR)

  return { jours, mesurees: durees.length, total: liste.length }
}

export default delaiMoyen
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-268-delai-moyen.test.js`
Expected: 7 PASS.

- [ ] **Step 5: Write the page test**

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * TC-269 — l'historique d'un client est une PAGE, pas un panneau.
 *
 * Un panneau se ferme d'un geste accidentel et n'a pas d'adresse. Une page a un
 * retour, survit à une rotation d'écran, et se recharge.
 */

let etatHook = {
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
}
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({
  useHistoriqueClient: () => etatHook,
}))

let clients = []
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: { subscribeToAllClients: (cb) => { cb(clients); return vi.fn() } },
}))

const { default: PatronHistoriqueClient } = await import('../../src/pages/admin/PatronHistoriqueClient.jsx')

const page = (id = 'c1') => render(
  <MemoryRouter initialEntries={[`/admin/clients/${id}/historique`]}>
    <Routes>
      <Route path="/admin/clients/:clientId/historique" element={<PatronHistoriqueClient />} />
    </Routes>
  </MemoryRouter>,
)

const JOUR = 24 * 60 * 60 * 1000
const debut = new Date('2026-10-01T08:00:00Z')
const op = (jours) => ({
  id: 'h' + jours, montant: 500000, type: 'Ravitaillement', statut: 'Validée',
  storeName: 'FADA', createdAt: debut, validatedAt: new Date(debut.getTime() + jours * JOUR),
})

afterEach(cleanup)

describe('TC-269 — la fiche et le verdict', () => {
  it('[TC-269-01] le nom du client est affiché', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887' }]
    etatHook = { ...etatHook, lignes: [op(4)] }
    page()
    expect(screen.getByText(/OUEDRAOGO Salif/)).toBeInTheDocument()
  })

  it('[TC-269-02] le délai moyen dit sur combien d’opérations il porte', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [op(4), { id: 'h9', createdAt: debut }] }
    page()
    const bloc = screen.getByTestId('delai-moyen')
    expect(bloc).toHaveTextContent(/4\s*j/)
    expect(bloc).toHaveTextContent(/1 .* 2/)
  })

  /** Aucune mesure n'est un résultat, et l'écran ne doit pas écrire « 0 j ». */
  it('[TC-269-03] sans mesure, il le dit au lieu d’afficher zéro', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [{ id: 'h1', createdAt: debut }] }
    page()
    expect(screen.getByTestId('delai-moyen')).not.toHaveTextContent(/\b0\s*j\b/)
  })
})

/**
 * ⚠ REVIEW FOCUS 2 — une adresse qui désigne une fiche inexistante. Signet
 *   périmé, URL tapée, fiche supprimée entre-temps. La page doit le dire.
 */
describe('TC-269 — un client introuvable', () => {
  it('[TC-269-04] la page le dit et ne plante pas', () => {
    clients = [{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }]
    etatHook = { ...etatHook, lignes: [] }
    page('inconnu')
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })

  it('[TC-269-05] et elle offre le retour au tableau', () => {
    clients = []
    page('inconnu')
    expect(screen.getByRole('link', { name: /retour|tableau/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it to see it fail, implement the page, run it again**

Run: `npx vitest run --config vitest.config.js tests/components/tc-269-page-historique-patron.test.jsx`
Expected d'abord: FAIL — le module n'existe pas.

`src/pages/admin/PatronHistoriqueClient.jsx` :

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { delaiMoyen } from '../../utils/delaiMoyen.js'
import { champsAgent } from '../../utils/agentFields.js'
import LigneHistorique from '../../components/clients/LigneHistorique.jsx'

/**
 * L'historique d'un client, toutes boutiques — la page que le patron ouvre
 * pendant l'appel.
 *
 * ⚠ LA FICHE VIENT DE L'ABONNEMENT, PAS DE L'URL NI DE L'ÉTAT DE NAVIGATION.
 *   L'adresse ne porte qu'un identifiant. Passer l'objet par `state` du routeur
 *   le perdrait au rechargement, et refaire une lecture serait une requête de
 *   plus pour un document que le patron a DÉJÀ en mémoire : son écran d'accueil
 *   est abonné à la base entière.
 */
function PatronHistoriqueClient() {
  const { clientId } = useParams()
  const [clients, setClients] = useState([])
  useEffect(() => firestoreService.subscribeToAllClients(setClients), [])

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )

  const { lignes, etat, erreur, encore, chargerPlus, reessayer } = useHistoriqueClient(clientId)
  const delai = useMemo(() => delaiMoyen(lignes), [lignes])

  if (!client && clients.length > 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="mb-4 font-semibold text-ink">Fiche introuvable.</p>
        <p className="mb-6 text-sm text-ink-muted">
          Cette fiche n'existe plus, ou l'adresse est erronée.
        </p>
        <Link to="/admin" className="text-brand-400 underline">Retour au tableau</Link>
      </div>
    )
  }

  const agent = champsAgent(client ?? {})

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-3 bg-brand-500 px-3 py-3">
        <Link
          to="/admin"
          aria-label="Retour au tableau"
          className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-white/15 text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <p className="truncate font-bold text-white">
            {`${client?.nom ?? ''} ${client?.prenom ?? ''}`.trim() || 'Client'}
          </p>
          <p className="truncate text-xs text-brand-200 tabular-nums">
            {agent.codeAgent ? `Code ${agent.codeAgent}` : 'Sans code agent'}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ⚠ L'EFFECTIF EST DANS LE MÊME BLOC QUE LA MOYENNE. Les séparer
            laisserait l'écran annoncer « 4 j » à côté de « 24 opérations »
            alors que la mesure n'en couvre qu'une partie. */}
        <div
          data-testid="delai-moyen"
          className="mb-3 rounded-xl border border-brand-200 bg-surface px-4 py-3"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
            Temps mis avant remboursement
          </p>
          <p className="text-2xl font-bold tabular-nums text-ink">
            {delai.jours === null ? 'Jamais mesuré' : `${delai.jours} j en moyenne`}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
            {delai.jours === null
              ? `Aucune des ${delai.total} opérations n'a attendu de règlement.`
              : `Sur ${delai.mesurees} opération${delai.mesurees > 1 ? 's' : ''} mesurée${delai.mesurees > 1 ? 's' : ''} sur ${delai.total}.`}
          </p>
        </div>

        {etat === 'erreur' && (
          <div className="mb-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3">
            <p className="text-sm text-ink">{erreur}</p>
            <button type="button" onClick={reessayer} className="mt-2 text-sm font-semibold text-brand-400 underline">
              Réessayer
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {lignes.map((ligne) => (
            <LigneHistorique key={ligne.id} ligne={ligne} />
          ))}
        </ul>

        {encore && etat !== 'erreur' && (
          <button
            type="button"
            onClick={chargerPlus}
            className="mt-3 w-full rounded-xl border border-brand-200 bg-surface py-3 text-sm font-semibold text-ink"
          >
            Voir plus
          </button>
        )}
      </div>
    </div>
  )
}

export default PatronHistoriqueClient
```

Et la route, dans `src/App.jsx`, après `/admin/boutiques` :

```jsx
        <Route path="/admin/clients/:clientId/historique" element={<PatronHistoriqueClient />} />
```

> ⚠ Cette route doit être déclarée **avant** la redirection `/admin/clients` de la tâche 3, sinon la redirection l'absorbe. Vérifier que `[TC-269-01]` et `[TC-266-06]` passent tous les deux.

Run: `npx vitest run --config vitest.config.js tests/components/tc-269-page-historique-patron.test.jsx tests/components/tc-266-shell-patron.test.jsx`
Expected: PASS des deux fichiers.

- [ ] **Step 7: Commit**

```bash
git add src/utils/delaiMoyen.js src/pages/admin/PatronHistoriqueClient.jsx src/App.jsx \
        tests/unit/tc-268-delai-moyen.test.js tests/components/tc-269-page-historique-patron.test.jsx
git commit -m "feat: le temps mis, et sur combien d operations il est mesure"
```

---

### Task 6: L'envoi WhatsApp

**Files:**
- Create: `src/utils/ficheWhatsApp.js`
- Modify: `src/pages/admin/PatronHistoriqueClient.jsx` (bouton dans l'en-tête)
- Test: `tests/unit/tc-270-fiche-whatsapp.test.js`

**Interfaces:**
- Consomme : `delaiMoyen` (tâche 5).
- Produit : `texteFiche({ client, lignes, delai }) → string` et `lienWhatsApp(texte) → string`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { texteFiche, lienWhatsApp } from '../../src/utils/ficheWhatsApp.js'

/**
 * TC-270 — la fiche qui part sur WhatsApp.
 *
 * ⚠ CE BOUTON FAIT SORTIR LA FICHE DU CRM. C'est demandé et volontaire, mais à
 *   partir de ce geste la donnée vit dans une conversation que l'application ne
 *   contrôle plus. D'où deux règles tenues ici : le texte ne porte QUE ce que le
 *   patron a déjà sous les yeux, et aucun identifiant technique.
 */

const client = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga secteur 15', registeredStoreName: 'FADA',
}
const delai = { jours: 9, mesurees: 6, total: 24 }

describe('TC-270 — ce que le texte contient', () => {
  it('[TC-270-01] le nom, le code agent et la boutique', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toContain('OUEDRAOGO Salif')
    expect(t).toContain('6412887')
    expect(t).toContain('FADA')
  })

  it('[TC-270-02] le délai et son effectif, jamais le délai seul', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toMatch(/9 j/)
    expect(t).toMatch(/6 .*24/)
  })

  it('[TC-270-03] sans mesure, il ne dit pas « 0 j »', () => {
    const t = texteFiche({ client, lignes: [], delai: { jours: null, mesurees: 0, total: 3 } })
    expect(t).not.toMatch(/\b0 j\b/)
    expect(t).toMatch(/jamais mesuré/i)
  })

  /** ⚠ Un identifiant Firestore dans un message WhatsApp ne sert personne. */
  it('[TC-270-04] aucun identifiant technique ne fuit', () => {
    const t = texteFiche({ client, lignes: [{ id: 'h-abc123', montant: 1000 }], delai })
    expect(t).not.toContain('c1')
    expect(t).not.toContain('h-abc123')
  })

  it('[TC-270-05] le texte est du texte simple, sans balise', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).not.toMatch(/[<>]/)
  })
})

describe('TC-270 — le lien', () => {
  it('[TC-270-06] il vise wa.me et encode le texte', () => {
    expect(lienWhatsApp('a b&c')).toBe('https://wa.me/?text=a%20b%26c')
  })

  /**
   * ⚠ AUCUN NUMÉRO N'EST PRÉ-REMPLI. `wa.me` sans numéro ouvre le sélecteur de
   *   contacts. Pré-remplir celui du client supposerait qu'on lui envoie
   *   toujours sa propre fiche — alors qu'on la montre souvent à un gérant.
   */
  it('[TC-270-07] il ne porte aucun numéro de destinataire', () => {
    expect(lienWhatsApp('x')).not.toMatch(/wa\.me\/\d/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-270-fiche-whatsapp.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

`src/utils/ficheWhatsApp.js` :

```js
import { champsAgent } from './agentFields.js'
import { dureeDe } from './attente.js'
import { formaterAttente } from './attente.js'

const francs = (n) => Number(n ?? 0).toLocaleString('fr-FR')

/**
 * La fiche d'un client en texte simple, pour WhatsApp.
 *
 * ⚠ TEXTE SIMPLE, PAS DE MISE EN FORME. Le message est lu sur n'importe quel
 *   téléphone, dans n'importe quelle version de WhatsApp. Des balises ou du
 *   Markdown s'afficheraient tels quels.
 *
 * ⚠ AUCUN IDENTIFIANT TECHNIQUE. Ni l'identifiant Firestore du client, ni ceux
 *   des opérations : ils ne servent à personne dans une conversation, et ils
 *   racontent la structure de la base à qui reçoit le message.
 */
export function texteFiche({ client, lignes = [], delai }) {
  const agent = champsAgent(client ?? {})
  const dernieres = (Array.isArray(lignes) ? lignes : []).slice(0, 4)

  const situation = delai?.jours === null
    ? 'Jamais mesuré — aucune de ses opérations n\'a attendu de règlement.'
    : `Ramène l'argent en ${delai.jours} j en moyenne `
      + `(sur ${delai.mesurees} opération${delai.mesurees > 1 ? 's' : ''} mesurée${delai.mesurees > 1 ? 's' : ''} sur ${delai.total}).`

  return [
    'FICHE CLIENT — C2EGF',
    '--------------------',
    `${client?.nom ?? ''} ${client?.prenom ?? ''}`.trim(),
    agent.codeAgent ? `Code agent : ${agent.codeAgent}` : null,
    agent.numeroAgent ? `Numero agent : ${agent.numeroAgent}` : null,
    client?.localite ? `Localite : ${client.localite}` : null,
    client?.registeredStoreName ? `Boutique : ${client.registeredStoreName}` : null,
    '',
    situation,
    dernieres.length ? '' : null,
    dernieres.length ? 'DERNIERES OPERATIONS' : null,
    ...dernieres.map((o) => {
      const duree = dureeDe(o)
      return `- ${o.date ?? ''} ${o.type ?? ''} ${francs(o.montant)} FCFA`
        + (duree ? ` (${formaterAttente(duree.ms)})` : '')
    }),
  ].filter((l) => l !== null).join('\n')
}

/**
 * Le lien d'envoi.
 *
 * ⚠ SANS NUMÉRO DE DESTINATAIRE. `wa.me` sans numéro ouvre le sélecteur de
 *   contacts, et le patron choisit. Pré-remplir le numéro du client
 *   supposerait qu'on lui envoie toujours sa propre fiche — ce qui est faux
 *   quand il s'agit de la montrer à un gérant.
 */
export const lienWhatsApp = (texte) => `https://wa.me/?text=${encodeURIComponent(texte)}`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-270-fiche-whatsapp.test.js`
Expected: 7 PASS.

Ajouter ensuite le bouton dans l'en-tête de `PatronHistoriqueClient.jsx`, après le bloc `<div className="min-w-0">` :

```jsx
        <a
          href={lienWhatsApp(texteFiche({ client, lignes, delai }))}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex h-11 flex-none items-center gap-1.5 rounded-xl bg-success px-3 text-sm font-bold text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Envoyer
        </a>
```

avec `import { ChevronLeft, Send } from 'lucide-react'` et `import { texteFiche, lienWhatsApp } from '../../utils/ficheWhatsApp.js'`.

Run: `npx vitest run --config vitest.config.js tests/components/tc-269-page-historique-patron.test.jsx`
Expected: PASS — l'en-tête a gagné un lien, rien d'autre n'a bougé.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ficheWhatsApp.js src/pages/admin/PatronHistoriqueClient.jsx \
        tests/unit/tc-270-fiche-whatsapp.test.js
git commit -m "feat: la fiche part sur WhatsApp en texte lisible partout"
```

---

### Task 7: `listOutstandingDrafts` accepte le patron, et refuse toujours les autres

**Files:**
- Modify: `functions/src/dealerMetrics/listOutstandingDrafts.js:21-28`
- Test: `tests/unit/tc-213-outstanding-drafts-handler.test.js` (ajouts au bloc TC-213-B)

**Interfaces:**
- Consomme : rien.
- Produit : la callable accepte `role === 'system_manager'`. La tâche 8 l'appelle via `listArgentDehors()`.

- [ ] **Step 1: Write the failing test**

À ajouter dans `describe('TC-213-B — autorisation du callable', …)` :

```js
  /**
   * ⚠ LE GARDE S'ÉLARGIT, IL NE S'OUVRE PAS. L'écran Boutiques du patron a
   *   besoin de cet agrégat ; les règles l'autorisent déjà à lire `drafts` en
   *   collection-group, mais une lecture directe ferait descendre tous les
   *   brouillons du réseau sur un téléphone pour n'afficher que 84 sommes.
   *   D'où la callable — et d'où ces quatre tests, qui tiennent les deux sens.
   */
  it('[TC-213-B5] accepte un system_manager actif', async () => {
    const db = makeDb({ profile: { active: true, role: 'system_manager' } })
    const result = await listOutstandingDraftsHandler({ auth: { uid: 'patron-1' }, data: {} }, { db })
    expect(result).toMatchObject({ success: true, dehors: 5000 })
    expect(db.draftsGet).toHaveBeenCalledOnce()
  })

  it('[TC-213-B6] refuse toujours un member', async () => {
    const db = makeDb({ profile: { active: true, role: 'member' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('[TC-213-B7] refuse un system_manager désactivé', async () => {
    const db = makeDb({ profile: { active: false, role: 'system_manager' } })
    await expect(listOutstandingDraftsHandler({ auth: { uid: 'u1' }, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })

  it('[TC-213-B8] refuse toujours un appel sans authentification', async () => {
    const db = makeDb()
    await expect(listOutstandingDraftsHandler({ auth: null, data: {} }, { db }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(db.draftsGet).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-213-outstanding-drafts-handler.test.js`
Expected: `[TC-213-B5]` échoue avec `ROLE_FORBIDDEN`. `B6`, `B7` et `B8` passent déjà — ils figent ce qui ne doit pas bouger.

- [ ] **Step 3: Write minimal implementation**

Dans `functions/src/dealerMetrics/listOutstandingDrafts.js`, remplacer `validateDealerProfile` :

```js
// Les deux rôles qui ont besoin de cet agrégat, et aucun autre.
//   · dealer        — « mon argent dehors », son accueil ;
//   · system_manager — l'écran Boutiques du patron.
// Un `store_admin` ou un `member` lit déjà les brouillons de SA boutique par
// les règles ; cet agrégat porte sur tout le réseau.
const ROLES_AUTORISES = Object.freeze(['dealer', 'system_manager'])

const validateCallerProfile = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (!ROLES_AUTORISES.includes(profile.role)) {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Action réservée au dealer et au gérant du réseau.')
  }
}
```

et remplacer l'appel `validateDealerProfile(profile)` par `validateCallerProfile(profile)` dans le handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-213-outstanding-drafts-handler.test.js`
Expected: tout PASS.

Run: `npm run test:functions`
Expected: PASS — `tc-036-callable-wiring` vérifie le câblage, qui n'a pas changé.

- [ ] **Step 5: Commit**

```bash
git add functions/src/dealerMetrics/listOutstandingDrafts.js tests/unit/tc-213-outstanding-drafts-handler.test.js
git commit -m "feat: l agregat du reseau s ouvre au patron, et reste ferme aux autres"
```

---

### Task 8: L'écran Boutiques — 84 lignes, quatre soldes, tri et filtre réutilisés

**Files:**
- Modify: `src/pages/admin/PatronBoutiques.jsx` (remplace la coquille)
- Test: `tests/components/tc-271-boutiques-patron.test.jsx`

**Interfaces:**
- Consomme : `listNetworkCaisses()` → `{ caisses, total, sommeStock, sommeLiquidite, illisibles }`, `listArgentDehors()` → `{ parBoutique, depots, retraits, dehors, illisibles, horsReseau }`, `TRIS`/`trierCaisses`/`filtrerCaisses` de `caissesReseau.js`, la callable élargie en tâche 7.
- Produit : la route `/admin/boutiques`. La tâche 9 y ajoute la carte du CA.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-271 — les 84 boutiques, et les quatre chiffres que le patron demande.
 *
 * Les noms viennent du métier : « crédit · argent dehors » pour les dépôts non
 * terminés (le client DOIT à la boutique), « retrait · clients non payés » pour
 * les retraits non terminés (la boutique DOIT au client). C'est la distinction
 * qu'`argentDehors.js` écrit déjà.
 */

const listNetworkCaisses = vi.fn()
const listArgentDehors = vi.fn()
vi.mock('../../src/services/dealerService.js', () => ({
  listNetworkCaisses: (...a) => listNetworkCaisses(...a),
  listArgentDehors: (...a) => listArgentDehors(...a),
}))

const { default: PatronBoutiques } = await import('../../src/pages/admin/PatronBoutiques.jsx')

const caisse = (i) => ({ storeId: 's' + i, name: 'BOUTIQUE ' + i, stock: 1000 * i, liquidite: 500 * i })

beforeEach(() => {
  listNetworkCaisses.mockReset()
  listArgentDehors.mockReset()
  listNetworkCaisses.mockResolvedValue({
    caisses: [caisse(1), caisse(2)], total: 2,
    sommeStock: 3000, sommeLiquidite: 1500, illisibles: 0,
  })
  listArgentDehors.mockResolvedValue({
    parBoutique: [{ storeId: 's1', name: 'BOUTIQUE 1', depots: 70000, retraits: 20000, dehors: 50000 }],
    depots: 70000, retraits: 20000, dehors: 50000, illisibles: 0, horsReseau: 0,
  })
})
afterEach(cleanup)

describe('TC-271 — les quatre soldes, avec les mots du métier', () => {
  it('[TC-271-01] stock et espèces sont affichés', async () => {
    render(<PatronBoutiques />)
    expect(await screen.findByText(/BOUTIQUE 1/)).toBeInTheDocument()
    const ligne = screen.getByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/1\s?000/)
    expect(ligne).toHaveTextContent(/500/)
  })

  it('[TC-271-02] le crédit est nommé « argent dehors »', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/crédit/i)
    expect(ligne).toHaveTextContent(/argent dehors/i)
    expect(ligne).toHaveTextContent(/70\s?000/)
  })

  it('[TC-271-03] le retrait est nommé « clients non payés »', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/clients non payés/i)
    expect(ligne).toHaveTextContent(/20\s?000/)
  })

  /** Une boutique sans non terminée affiche zéro, pas un vide. */
  it('[TC-271-04] une boutique sans non terminée affiche 0', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s2')
    expect(ligne).toHaveTextContent(/0/)
  })
})

/**
 * ⚠ REVIEW FOCUS 4 — une boutique sans document `networkBalances`.
 *   `listNetworkCaisses` rend `null`, jamais `0`, et compte les `illisibles` :
 *   une caisse inconnue n'est pas une caisse vide, et la somme doit le dire.
 */
describe('TC-271 — une caisse inconnue n’est pas une caisse vide', () => {
  it('[TC-271-05] la ligne dit « inconnu » au lieu de 0', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [{ storeId: 's9', name: 'SANS SOLDE', stock: null, liquidite: null }],
      total: 1, sommeStock: 0, sommeLiquidite: 0, illisibles: 1,
    })
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s9')
    expect(ligne).toHaveTextContent(/inconnu/i)
  })

  it('[TC-271-06] la somme annonce qu’elle est incomplète', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [{ storeId: 's9', name: 'SANS SOLDE', stock: null, liquidite: null }],
      total: 1, sommeStock: 0, sommeLiquidite: 0, illisibles: 1,
    })
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('somme-caisses')).toHaveTextContent(/incomplèt|1 caisse/i)
  })
})

describe('TC-271 — 84 lignes se consultent avec tri et filtre', () => {
  it('[TC-271-07] le tri par défaut est le nom A → Z', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [caisse(2), caisse(1)], total: 2, sommeStock: 0, sommeLiquidite: 0, illisibles: 0,
    })
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    const noms = screen.getAllByTestId(/^boutique-/).map(n => n.getAttribute('data-testid'))
    expect(noms).toEqual(['boutique-s1', 'boutique-s2'])
  })

  it('[TC-271-08] le filtre par nom réduit la liste', async () => {
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    fireEvent.change(screen.getByLabelText(/filtrer les boutiques/i), { target: { value: 'BOUTIQUE 2' } })
    expect(screen.queryByTestId('boutique-s1')).toBeNull()
    expect(screen.getByTestId('boutique-s2')).toBeInTheDocument()
  })

  it('[TC-271-09] le total ne bouge pas quand on filtre', async () => {
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    const avant = screen.getByTestId('somme-caisses').textContent
    fireEvent.change(screen.getByLabelText(/filtrer les boutiques/i), { target: { value: 'BOUTIQUE 2' } })
    expect(screen.getByTestId('somme-caisses').textContent).toBe(avant)
  })
})

describe('TC-271 — quand l’agrégat échoue', () => {
  it('[TC-271-10] les soldes restent, le crédit dit « — »', async () => {
    listArgentDehors.mockRejectedValue(new Error('indisponible'))
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/1\s?000/)
    expect(ligne).toHaveTextContent('—')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/components/tc-271-boutiques-patron.test.jsx`
Expected: tout échoue — `PatronBoutiques` est une coquille.

- [ ] **Step 3: Write minimal implementation**

`src/pages/admin/PatronBoutiques.jsx` :

```jsx
import { useEffect, useMemo, useState } from 'react'
import { listNetworkCaisses, listArgentDehors } from '../../services/dealerService.js'
import { TRIS, TRI_DEFAUT, trierCaisses, filtrerCaisses } from '../../utils/caissesReseau.js'

/**
 * L'état des 84 boutiques — quatre chiffres par ligne, et rien de plus.
 *
 * ⚠ LES DEUX SOURCES SONT INDÉPENDANTES, ET L'ÉCRAN SURVIT À LA PERTE DE L'UNE.
 *   Les caisses viennent de deux requêtes Firestore ; le crédit et le retrait
 *   d'une callable. Si l'agrégat échoue, les soldes restent affichés et les deux
 *   autres cases disent « — ». Un écran à moitié chargé vaut mieux qu'un écran
 *   blanc quand la moitié qui reste est de l'argent.
 *
 * ⚠ 84 LIGNES, DONC TRI ET FILTRE — RÉUTILISÉS, PAS RÉÉCRITS.
 *   `caissesReseau.js` les porte déjà pour l'accueil dealer.
 */
const francs = (n) => Number(n).toLocaleString('fr-FR')

/** Un montant inconnu se dit, il ne s'arrondit pas à zéro. */
const montant = (v) => (v === null || v === undefined ? 'Inconnu' : francs(v))

function PatronBoutiques() {
  const [caisses, setCaisses] = useState(null)
  const [dehors, setDehors] = useState(null)
  const [dehorsEnEchec, setDehorsEnEchec] = useState(false)
  const [tri, setTri] = useState(TRI_DEFAUT)
  const [filtre, setFiltre] = useState('')

  useEffect(() => {
    let vivant = true
    listNetworkCaisses()
      .then((r) => { if (vivant) setCaisses(r) })
      .catch(() => { if (vivant) setCaisses({ caisses: [], total: 0, sommeStock: 0, sommeLiquidite: 0, illisibles: 0 }) })
    listArgentDehors()
      .then((r) => { if (vivant) setDehors(r) })
      .catch(() => { if (vivant) setDehorsEnEchec(true) })
    return () => { vivant = false }
  }, [])

  const parBoutique = useMemo(() => {
    const index = new Map()
    for (const l of dehors?.parBoutique ?? []) index.set(l.storeId, l)
    return index
  }, [dehors])

  const vues = useMemo(
    () => trierCaisses(filtrerCaisses(caisses?.caisses ?? [], filtre), tri),
    [caisses, filtre, tri],
  )

  if (!caisses) return <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none gap-2 bg-canvas px-3 pb-1 pt-3">
        <input
          type="search"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          aria-label="Filtrer les boutiques"
          placeholder="Nom de boutique…"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-brand-200 bg-surface px-3 text-sm text-ink"
        />
        <select
          value={tri}
          onChange={(e) => setTri(e.target.value)}
          aria-label="Trier les boutiques"
          className="min-h-11 max-w-[48%] rounded-xl border border-brand-200 bg-surface px-2 text-sm text-ink"
        >
          {TRIS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      <p
        data-testid="somme-caisses"
        className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums"
      >
        {`Caisses · ${francs(caisses.sommeStock + caisses.sommeLiquidite)} FCFA sur ${caisses.total}`}
        {caisses.illisibles > 0
          && ` — incomplète, ${caisses.illisibles} caisse${caisses.illisibles > 1 ? 's' : ''} illisible${caisses.illisibles > 1 ? 's' : ''}`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-2">
          {vues.map((c) => {
            const d = parBoutique.get(c.storeId)
            const indispo = dehorsEnEchec || !dehors
            return (
              <div
                key={c.storeId}
                data-testid={`boutique-${c.storeId}`}
                className="rounded-xl border border-brand-200 bg-surface px-3 py-2.5"
              >
                <p className="font-bold text-ink">{c.name ?? c.storeId}</p>
                <dl className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                  <div className="rounded-lg border-l-[3px] border-l-[--color-net-orange] bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Stock</dt>
                    <dd className="font-bold tabular-nums text-ink">{montant(c.stock)}</dd>
                  </div>
                  <div className="rounded-lg border-l-[3px] border-l-brand-400 bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Espèces</dt>
                    <dd className="font-bold tabular-nums text-ink">{montant(c.liquidite)}</dd>
                  </div>
                  <div className="rounded-lg border-l-[3px] border-l-warn bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Crédit · argent dehors</dt>
                    <dd className="font-bold tabular-nums text-warn">{indispo ? '—' : francs(d?.depots ?? 0)}</dd>
                  </div>
                  <div className="rounded-lg border-l-[3px] border-l-danger bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Retrait · clients non payés</dt>
                    <dd className="font-bold tabular-nums text-danger">{indispo ? '—' : francs(d?.retraits ?? 0)}</dd>
                  </div>
                </dl>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default PatronBoutiques
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/components/tc-271-boutiques-patron.test.jsx`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/PatronBoutiques.jsx tests/components/tc-271-boutiques-patron.test.jsx
git commit -m "feat: les 84 boutiques et leurs quatre soldes, avec les mots du metier"
```

---

### Task 9: Le chiffre d'affaires — index, agrégation, journalier et sélecteur de mois

**Files:**
- Modify: `firestore.indexes.json` (index composite `statut` + `createdAt`, périmètre collection-group)
- Create: `src/services/chiffreAffairesService.js`
- Modify: `src/pages/admin/PatronBoutiques.jsx` (carte du CA en tête)
- Test: `tests/unit/tc-272-chiffre-affaires.test.js`

**Interfaces:**
- Consomme : `getBusinessDayBounds` ([businessDate.js:88](../../../src/utils/businessDate.js#L88)).
- Produit : `bornesPeriode({ type, cle })` et `chiffreAffaires({ type, cle }) → { total: number|null, incomplet: boolean }`.

**Pourquoi l'index d'abord.** La requête d'agrégation filtre sur `statut` **et** sur une plage de `createdAt`. `createdAt` a déjà sa surcharge COLLECTION_GROUP dans les deux sens ; la paire exige un index composite. Sans lui, la requête échoue à chaque ouverture.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TC-272 — le chiffre d'affaires du réseau, journalier par défaut.
 *
 * ⚠ ZÉRO ET « INDISPONIBLE » SONT DEUX CHOSES, ET LES CONFONDRE EST LE PIÈGE
 *   CENTRAL DE CET ÉCRAN. Une journée sans opération vaut 0 FCFA — c'est une
 *   information, et le patron doit pouvoir la lire. Une requête qui échoue ne
 *   vaut pas 0 : afficher zéro ferait croire à une journée morte un jour où la
 *   boutique a travaillé.
 */

const getAggregateFromServer = vi.fn()
const sum = vi.fn((champ) => ({ champ }))
vi.mock('firebase/firestore', () => ({
  getAggregateFromServer: (...a) => getAggregateFromServer(...a),
  sum: (...a) => sum(...a),
  collectionGroup: vi.fn((_db, nom) => ({ nom })),
  query: vi.fn((base, ...c) => ({ base, c })),
  where: vi.fn((f, op, v) => ({ f, op, v })),
}))
vi.mock('../../src/config/firebase.js', () => ({ db: {} }))

const { chiffreAffaires, bornesPeriode } = await import('../../src/services/chiffreAffairesService.js')

beforeEach(() => { getAggregateFromServer.mockReset() })

describe('TC-272 — les bornes', () => {
  it('[TC-272-01] le jour passe par la journée d’exploitation', () => {
    const { debut, fin } = bornesPeriode({ type: 'jour', cle: '2026-10-15' })
    expect(debut).toBeInstanceOf(Date)
    expect(fin.getTime()).toBeGreaterThan(debut.getTime())
    expect(fin.getTime() - debut.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('[TC-272-02] le mois couvre tout le mois', () => {
    const { debut, fin } = bornesPeriode({ type: 'mois', cle: '2026-10' })
    expect(debut.getUTCMonth()).toBe(9)
    expect(fin.getUTCMonth()).toBe(10)
  })
})

describe('TC-272 — la somme', () => {
  it('[TC-272-03] elle agrège `montant` sur le groupe `history`', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 847300000 }) })
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(r).toEqual({ total: 847300000, incomplet: false })
    expect(sum).toHaveBeenCalledWith('montant')
  })

  /** ⚠ REVIEW FOCUS 1 — une journée réellement vide vaut 0, et se lit. */
  it('[TC-272-04] une journée sans opération vaut 0, pas null', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: 0, incomplet: false })
  })

  /** ⚠ Et une panne ne vaut PAS 0. */
  it('[TC-272-05] une requête en échec rend null', async () => {
    getAggregateFromServer.mockRejectedValue(new Error('index manquant'))
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: null, incomplet: false })
  })

  /**
   * ⚠ REVIEW FOCUS 5 — un `montant` non numérique. Firestore l'ignore
   *   silencieusement dans `sum()`. Le service ne peut pas le détecter seul,
   *   mais il NE DOIT PAS prétendre que la somme est complète : la valeur
   *   `null` rendue par l'agrégat signale exactement ce cas.
   */
  it('[TC-272-06] une somme non numérique est signalée, pas convertie', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: null }) })
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: null, incomplet: true })
  })

  it('[TC-272-07] les opérations annulées sont exclues par la requête', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 1 }) })
    const { where } = await import('firebase/firestore')
    await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    const appels = where.mock.calls.map(([f, op]) => `${f} ${op}`)
    expect(appels).toContain('statut not-in')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-272-chiffre-affaires.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation — l'index d'abord**

Dans `firestore.indexes.json`, ajouter à `indexes` :

```json
    {
      "collectionGroup": "history",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "statut", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
```

Puis `src/services/chiffreAffairesService.js` :

```js
import { collectionGroup, getAggregateFromServer, query, sum, where } from 'firebase/firestore'
import { db } from '../config/firebase.js'
import { getBusinessDayBounds } from '../utils/businessDate.js'

/**
 * Le chiffre d'affaires du réseau, sur une journée ou un mois.
 *
 * ⚠ UNE AGRÉGATION, PAS UNE LECTURE. `getAggregateFromServer` est facturée
 *   environ une lecture par millier de documents parcourus. Descendre les
 *   opérations du réseau pour les additionner dans le navigateur coûterait une
 *   lecture par document — et ferait transiter l'historique entier.
 *
 * ⚠ AUCUNE CLOUD FUNCTION. Les règles autorisent déjà le patron à lire
 *   `history` en collection-group, et `createdAt` porte déjà sa surcharge
 *   d'index COLLECTION_GROUP dans les deux sens. Seule la paire
 *   `statut` + `createdAt` demande un index composite.
 */

// Les statuts qui ne comptent pas comme du volume. Même règle que
// `compteCommeVolume` dans reseauStats.js : une annulée n'a jamais eu lieu, et
// une non terminée n'a pas encore bougé d'argent.
const STATUTS_EXCLUS = Object.freeze(['Annulée', 'Annulee', 'Non Terminées', 'Non Terminees'])

/**
 * Les bornes d'une période.
 *
 * ⚠ LA JOURNÉE D'EXPLOITATION, PAS LA JOURNÉE UTC. `getBusinessDayBounds` lit
 *   le fuseau du profil client. Les deux coïncident pour C2EGF (le Burkina est
 *   à UTC+0), mais le profil porte le fuseau précisément pour qu'une autre
 *   instance du produit n'hérite pas d'un découpage faux.
 */
export function bornesPeriode({ type, cle }) {
  if (type === 'mois') {
    const [annee, mois] = String(cle).split('-').map(Number)
    return {
      debut: new Date(Date.UTC(annee, mois - 1, 1)),
      fin: new Date(Date.UTC(annee, mois, 1)),
    }
  }
  // `getBusinessDayBounds` rend deja deux `Date` : les re-envelopper
  // masquerait une erreur de type si sa signature changeait.
  const { start, end } = getBusinessDayBounds(cle)
  return { debut: start, fin: end }
}

/**
 * @returns {Promise<{total: number|null, incomplet: boolean}>}
 *   `total: null` + `incomplet: false` → la requête a échoué.
 *   `total: null` + `incomplet: true`  → la requête a répondu, mais la somme
 *     n'est pas un nombre : des montants non numériques dorment dans la base et
 *     l'agrégat les a ignorés. L'écran ne doit surtout pas afficher 0.
 *   `total: 0` → une vraie journée sans opération, et c'est une information.
 */
export async function chiffreAffaires({ type, cle }) {
  const { debut, fin } = bornesPeriode({ type, cle })

  try {
    const instantane = await getAggregateFromServer(
      query(
        collectionGroup(db, 'history'),
        where('statut', 'not-in', STATUTS_EXCLUS),
        where('createdAt', '>=', debut),
        where('createdAt', '<', fin),
      ),
      { total: sum('montant') },
    )

    const total = instantane.data()?.total
    if (typeof total !== 'number' || !Number.isFinite(total)) {
      return { total: null, incomplet: true }
    }
    return { total, incomplet: false }
  } catch (erreur) {
    console.error('[chiffreAffaires] agrégat indisponible', erreur)
    return { total: null, incomplet: false }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.js tests/unit/tc-272-chiffre-affaires.test.js`
Expected: 7 PASS.

- [ ] **Step 5: Add the card to the Boutiques screen, with its test**

Ajouter à `tests/components/tc-271-boutiques-patron.test.jsx` :

```jsx
describe('TC-271 — la carte du chiffre d’affaires', () => {
  it('[TC-271-11] le jour est le défaut', async () => {
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('ca-reseau')).toHaveTextContent(/aujourd/i)
  })

  it('[TC-271-12] une journée vide affiche 0 FCFA, pas « indisponible »', async () => {
    chiffreAffaires.mockResolvedValue({ total: 0, incomplet: false })
    render(<PatronBoutiques />)
    const carte = await screen.findByTestId('ca-reseau')
    expect(carte).toHaveTextContent('0')
    expect(carte).not.toHaveTextContent(/indisponible/i)
  })

  it('[TC-271-13] une panne dit « indisponible », jamais 0', async () => {
    chiffreAffaires.mockResolvedValue({ total: null, incomplet: false })
    render(<PatronBoutiques />)
    const carte = await screen.findByTestId('ca-reseau')
    expect(carte).toHaveTextContent(/indisponible/i)
    expect(carte).not.toHaveTextContent(/\b0\b/)
  })

  it('[TC-271-14] une somme incomplète le dit', async () => {
    chiffreAffaires.mockResolvedValue({ total: null, incomplet: true })
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('ca-reseau')).toHaveTextContent(/incomplet/i)
  })

  it('[TC-271-15] choisir un mois relance la requête sur ce mois', async () => {
    chiffreAffaires.mockResolvedValue({ total: 100, incomplet: false })
    render(<PatronBoutiques />)
    await screen.findByTestId('ca-reseau')
    fireEvent.change(screen.getByLabelText(/choisir un mois/i), { target: { value: '2026-09' } })
    await waitFor(() => {
      expect(chiffreAffaires).toHaveBeenCalledWith({ type: 'mois', cle: '2026-09' })
    })
  })
})
```

avec, en tête du fichier :

```jsx
const chiffreAffaires = vi.fn().mockResolvedValue({ total: 847300000, incomplet: false })
vi.mock('../../src/services/chiffreAffairesService.js', () => ({
  chiffreAffaires: (...a) => chiffreAffaires(...a),
}))
```

Implémenter la carte dans `PatronBoutiques.jsx`. Les six derniers mois sont dérivés de la date du jour, jamais écrits en dur :

```jsx
import { businessDateKey } from '../../utils/businessDate.js'
import { chiffreAffaires } from '../../services/chiffreAffairesService.js'

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Les six derniers mois, du plus récent au plus ancien. */
const derniersMois = (aujourdhui = new Date()) => Array.from({ length: 6 }, (_, i) => {
  const d = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - i, 1))
  const m = d.getUTCMonth()
  return {
    cle: `${d.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}`,
    label: `${MOIS_FR[m].charAt(0).toUpperCase()}${MOIS_FR[m].slice(1)} ${d.getUTCFullYear()}`,
  }
})
```

Dans le composant, au-dessus des états existants :

```jsx
  const mois = useMemo(() => derniersMois(), [])
  const [periode, setPeriode] = useState({ type: 'jour', cle: businessDateKey() })
  const [ca, setCa] = useState(null)

  useEffect(() => {
    let vivant = true
    setCa(null)
    chiffreAffaires(periode).then((r) => { if (vivant) setCa(r) })
    return () => { vivant = false }
  }, [periode])
```

et la carte, premier enfant du conteneur :

```jsx
      {/* ⚠ ZÉRO ET « INDISPONIBLE » NE SE RESSEMBLENT PAS. Une journée sans
          opération vaut 0 FCFA, et c'est une information que le patron doit
          pouvoir lire. Une requête en échec n'est pas une journée morte :
          afficher 0 lui ferait croire que la boutique n'a pas travaillé. */}
      <div
        data-testid="ca-reseau"
        className="mx-3 mt-3 flex-none rounded-2xl bg-gradient-to-br from-brand-500 to-brand-400 px-4 py-4 text-white"
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-200">
          Chiffre d'affaires du réseau
        </p>
        <p className="mt-0.5 text-3xl font-bold leading-tight tabular-nums">
          {ca === null
            ? 'Chargement…'
            : ca.total === null
              ? (ca.incomplet ? 'Somme incomplète' : 'Chiffre indisponible')
              : `${francs(ca.total)} FCFA`}
        </p>
        <p className="mt-1 text-xs text-brand-200">
          {periode.type === 'jour'
            ? `Aujourd'hui · ${caisses.total} boutiques`
            : `${mois.find((m) => m.cle === periode.cle)?.label ?? periode.cle} · ${caisses.total} boutiques`}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setPeriode({ type: 'jour', cle: businessDateKey() })}
            aria-pressed={periode.type === 'jour'}
            className={`min-h-10 rounded-lg border px-3 text-sm font-semibold transition-colors ${
              periode.type === 'jour'
                ? 'border-white bg-surface text-brand-500'
                : 'border-white/30 text-white hover:bg-white/10'
            }`}
          >
            Aujourd'hui
          </button>
          <select
            aria-label="Choisir un mois"
            value={periode.type === 'mois' ? periode.cle : ''}
            onChange={(e) => e.target.value && setPeriode({ type: 'mois', cle: e.target.value })}
            className="min-h-10 rounded-lg border border-white/30 bg-transparent px-2 text-sm font-semibold text-white"
          >
            <option value="">Choisir un mois…</option>
            {mois.map((m) => (
              <option key={m.cle} value={m.cle} className="text-ink">{m.label}</option>
            ))}
          </select>
        </div>
      </div>
```

Run: `npx vitest run --config vitest.config.js tests/components/tc-271-boutiques-patron.test.jsx`
Expected: 15 PASS.

- [ ] **Step 6: Run the full gate**

```bash
npm run test:unit
npm run test:components
npm run lint
npm run build
```

Expected: tout PASS, lint propre, build passant.

> ⚠ Si `npm run quality:check` est lancé, vérifier son code de sortie **sans** le passer dans un pipe : `npm run quality:check | tail` renvoie le statut de `tail`, et la porte peut avoir abandonné à `npm audit` en affichant un faux vert (défaut D1 de l'audit du 2026-10-14).

- [ ] **Step 7: Commit**

```bash
git add firestore.indexes.json src/services/chiffreAffairesService.js \
        src/pages/admin/PatronBoutiques.jsx \
        tests/unit/tc-272-chiffre-affaires.test.js \
        tests/components/tc-271-boutiques-patron.test.jsx
git commit -m "feat: le chiffre d affaires du reseau, journalier, par agregation"
```

---

## Un engagement de la spec que ce plan NE tient PAS

La spec demandait, parmi les états de panne : *« la recherche hors-ligne
fonctionne et l'écran dit de quand datent les données »*. **La seconde moitié
n'est pas livrée, et c'est délibéré.**

- La **première** moitié est acquise sans rien écrire : la persistance est
  active, la recherche travaille sur la liste en mémoire, donc elle fonctionne
  hors réseau. La tâche 4 n'a aucun appel réseau dans son chemin de recherche.
- Le fait d'**être** hors-ligne est déjà dit : `OfflineBanner` est monté au
  niveau de `AppContent` ([App.jsx:98](../../../src/App.jsx#L98)), donc au-dessus
  de l'espace patron comme des autres.
- **De quand datent les données**, en revanche, n'existe nulle part. L'afficher
  demanderait de retenir l'horodatage du dernier instantané serveur et de le
  distinguer d'une lecture de cache — soit un état de plus à tenir juste, sur
  tous les écrans, pour une information que le bandeau rend déjà actionnable
  (« tu es hors-ligne »).

**J'ai donc rétréci l'engagement plutôt que de le taire.** Si le patron doit
vraiment lire la date de fraîcheur, c'est une tâche à part, à décider — pas un
détail à glisser dans la tâche 4.

---
## Déploiement — humain uniquement

**Un déploiement est une décision humaine, exécutée par un humain** (AGENTS.md). Rien dans ce plan ne le lance.

L'ordre compte :

```bash
# 1. L'INDEX D'ABORD. Sans lui, la requête de CA échoue à chaque ouverture.
#    Attendre « Enabled » dans la console Firebase avant l'étape 2.
firebase deploy --only firestore:indexes

# 2. La callable, pour son garde de rôle élargi.
firebase deploy --only "functions:listOutstandingDrafts"

# 3. L'application (Vercel, depuis la branche).
```

Les règles Firestore ne bougent pas.

> ⚠ `firebase use production` affiche « Error: An unexpected error has occurred. » **après** avoir réussi — c'est un ping de télémétrie GA4 enveloppé dans un `withTimeout(5000, …)`, pas un échec de la commande. Vérifier le projet actif plutôt que de relancer.
