import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { STORE_NAV_ITEMS } from '../constants/navigation'
import { useTheme } from '../context/ThemeContext.jsx'
import { useAuth } from '../context/AuthContext'
import { subscribeStorePendingCount } from '../services/storeAdminDealerService'
import { APP_NAME } from '../constants/branding'
import PWAInstallButton from './PWAInstallButton'

const DEALER_REQUESTS_PATH = '/dealer-requests'

function PendingBadge({ count }) {
  if (!count) return null
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[1.2rem]"
      aria-label={`${count} demande${count > 1 ? 's' : ''} en attente`}
      data-testid="store-pending-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * Barre de navigation de l'espace boutique.
 *
 * Elle portait sa propre logique de collage : un écouteur `scroll` qui passait
 * la barre en `fixed` au-delà de 200 px — le même écouteur, avec le même seuil
 * codé en dur, que celui de Layout. Deux abonnements pour un seul booléen, et
 * la barre des soldes qui disparaissait dessous puisqu'elle restait dans le
 * flux. Le collage est désormais assuré par `position: sticky` sur l'en-tête
 * complet, dans Layout : plus d'écouteur, plus de mesure de hauteur.
 *
 * La marque et le bouton d'installation sont rendus UNE fois, en dehors des
 * deux variantes responsives : seul le milieu bascule entre les liens du
 * bureau et le sélecteur du mobile.
 */
function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { themeClasses } = useTheme()
  const { currentUser, userProfile } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    setPendingCount(0)
    const unsub = subscribeStorePendingCount({
      currentUser,
      userProfile,
      onUpdate: setPendingCount,
    })
    return unsub
  }, [currentUser, userProfile])

  return (
    <nav className={`${themeClasses.navbar} w-full`}>
      <div className="flex w-full items-center gap-4 px-4">
        <span className="shrink-0 py-3 text-base font-bold tracking-tight text-white md:text-lg">
          {APP_NAME}
        </span>

        {/* Bureau : les destinations en clair */}
        <div className="hidden flex-1 justify-center md:flex">
          {STORE_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `inline-flex items-center px-4 py-3 font-medium text-white transition-colors duration-200 hover:bg-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${
                  isActive ? 'bg-black/30 border-b-2 border-white/50' : ''
                }`
              }
            >
              {item.name}
              {item.path === DEALER_REQUESTS_PATH && <PendingBadge count={pendingCount} />}
            </NavLink>
          ))}
        </div>

        {/* Mobile : le même jeu de destinations, replié */}
        <select
          className={`min-w-0 flex-1 rounded border border-white/20 px-3 py-2 ${themeClasses.navbar} text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:hidden`}
          onChange={(e) => navigate(e.target.value)}
          value={location.pathname}
          aria-label="Navigation principale"
        >
          <option value="" disabled>Sélectionner une page</option>
          {STORE_NAV_ITEMS.map((item) => (
            <option key={item.path} value={item.path}>
              {item.path === DEALER_REQUESTS_PATH && pendingCount > 0
                ? `${item.name} (${pendingCount > 99 ? '99+' : pendingCount})`
                : item.name}
            </option>
          ))}
        </select>

        <div className="shrink-0">
          <PWAInstallButton />
        </div>
      </div>
    </nav>
  )
}

export default NavBar
