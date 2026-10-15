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
 *
 * ⚠ CONTRAT DE DÉFILEMENT : `<main>` ne défile PAS (`overflow-hidden`), parce
 *   que l'en-tête et les onglets doivent rester fixes au pouce — c'est l'argument
 *   même de ce lot. Chaque page montée dans l'`<Outlet>` ci-dessous est donc
 *   responsable de son propre conteneur défilant (`min-h-0 flex-1 overflow-auto`
 *   ou équivalent) et de ses propres marges internes. Ajouter `overflow-y-auto`
 *   ici créerait un double défilement dès qu'une page pose le sien — ne le fais
 *   pas. Le brief de la tâche 4 (`PatronClients`) prévoit déjà ce conteneur
 *   (`min-h-0 flex-1 overflow-auto`) ; la coquille actuelle n'en a pas besoin,
 *   un `<div>` vide n'a rien à faire défiler.
 *
 * ⚠ PAS DE MOTIF ARIA ONGLETS (`role="tablist"`/`role="tab"`). Les deux vrais
 *   tablists du dépôt (`CollaborationsPanel.jsx`, `Historique.jsx`) associent
 *   toujours `role="tab"` à `aria-selected`, un panneau et une navigation au
 *   clavier par flèches. En poser la moitié ici promettrait aux lecteurs
 *   d'écran une navigation qui n'existe pas. Ce sont des liens de routage : un
 *   simple `<nav>` nommé, avec des `NavLink` qui annoncent déjà la destination
 *   active via `aria-current="page"`.
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
          className="flex min-h-11 flex-none items-center rounded-lg border border-white/30 px-4 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Se déconnecter
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <nav aria-label="Navigation patron" className="grid flex-none grid-cols-2 border-t border-line bg-surface">
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icone = ICONES[item.path] ?? Users
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/admin'}
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
