import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { STORE_NAV_ITEMS } from '../constants/navigation'
import { useTheme } from '../context/ThemeContext.jsx'
import { useAuth } from '../context/AuthContext'
import { subscribeStorePendingCount } from '../services/storeAdminDealerService'
import PWAInstallButton from './PWAInstallButton'

const DEALER_REQUESTS_PATH = '/dealer-requests'

function PendingBadge({ count }) {
  if (!count) return null
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[1.2rem]"
      aria-label={`${count} demande${count > 1 ? 's' : ''} en attente`}
      data-testid="store-pending-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { themeClasses } = useTheme()
  const { currentUser, userProfile } = useAuth()
  const [isSticky, setIsSticky] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const headerHeight = 200 // hauteur approximative du header

      setIsSticky(scrollTop >= headerHeight)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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
    <nav
      className={`${themeClasses.navbar} shadow-md w-full transition-all duration-300 z-50 ${
        isSticky
          ? 'fixed top-0 left-0 right-0 shadow-lg'
          : 'relative'
      }`}
    >
      <div className="w-full px-4">
        {/* Navigation desktop */}
        <div className="hidden md:flex justify-between items-center">
          <div className="flex-1"></div>
          <div className="flex justify-center space-x-1">
            {STORE_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `px-4 py-3 text-white font-medium transition-colors duration-200 hover:bg-black/20 inline-flex items-center ${
                    isActive ? 'bg-black/30 border-b-2 border-white/50' : ''
                  }`
                }
              >
                {item.name}
                {item.path === DEALER_REQUESTS_PATH && (
                  <PendingBadge count={pendingCount} />
                )}
              </NavLink>
            ))}
          </div>
          <div className="flex-1 flex justify-end">
            <PWAInstallButton />
          </div>
        </div>

        {/* Navigation mobile */}
        <div className="md:hidden flex items-center gap-2 py-2">
          <select
            className={`min-w-0 flex-1 py-3 px-4 ${themeClasses.navbar} text-white border border-white/20 rounded focus:outline-none`}
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
      </div>
    </nav>
  )
}

export default NavBar
