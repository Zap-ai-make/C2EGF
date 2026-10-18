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
 * ⚠ LA COQUILLE SE CALE SUR LA HAUTEUR VISIBLE, PAS SUR `100vh`. Elle portait
 *   `min-h-screen` ; sur un téléphone, `100vh` est la hauteur de l'écran SANS la
 *   barre d'adresse, donc la coquille dépassait d'une soixantaine de pixels et
 *   les onglets tombaient sous le pli — il fallait faire défiler la page entière
 *   pour atteindre le pouce qu'on prétendait servir. `100dvh` suit la barre
 *   d'adresse. Et c'est une HAUTEUR : un `min-height` laisserait la coquille
 *   grandir avec son contenu et repousserait le pied dehors malgré le `dvh`.
 *   Le repli `h-screen` reste pour les navigateurs sans `dvh` (Chrome < 108),
 *   où une déclaration isolée serait ignorée et `height` retomberait sur `auto`.
 *   Verrouillé par TC-266-10.
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
    <div
      className="flex h-screen supports-[height:100dvh]:h-[100dvh] flex-col bg-canvas"
      data-testid="admin-layout"
    >
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
