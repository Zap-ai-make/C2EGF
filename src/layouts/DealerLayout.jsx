import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DEALER_NAV_ITEMS } from '../constants/navigation'
import { subscribeDealerPendingCount } from '../services/dealerService'
import { subscribeIncomingTransfersCount } from '../services/storeTransferService'
import { BRAND, getRoleAccent } from '../constants/workspaceTheme'
import { APP_NAME } from '../constants/branding'
import DealerInventoryBar from '../components/dealer/DealerInventoryBar'

const ACCENT = getRoleAccent('dealer')

function PendingBadge({ count }) {
  if (!count) return null
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[1.2rem]"
      aria-label={`${count} demande${count > 1 ? 's' : ''} en attente`}
      data-testid="dealer-pending-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavItem({ item, badgeCount = 0, onClick }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/dealer'}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? BRAND.navActive : BRAND.navIdle
        }`
      }
    >
      {item.name}
      <PendingBadge count={badgeCount} />
    </NavLink>
  )
}

// Compteur de badge selon l'entrée de navigation.
function badgeFor(path, { pendingCount, transfersCount }) {
  if (path === '/dealer/requests') return pendingCount
  if (path === '/dealer/transfers') return transfersCount
  return 0
}

function DealerLayout() {
  const { logout, userProfile, currentUser } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [transfersCount, setTransfersCount] = useState(0)
  const [sidebarOpen, setSidebarOpen]   = useState(false)

  useEffect(() => {
    setPendingCount(0)
    const unsub = subscribeDealerPendingCount({
      currentUser,
      userProfile,
      onUpdate: setPendingCount,
    })
    return unsub
  }, [currentUser, userProfile])

  useEffect(() => {
    setTransfersCount(0)
    if (userProfile?.role !== 'dealer' || !currentUser?.uid) return undefined
    return subscribeIncomingTransfersCount({
      dealerUid: currentUser.uid,
      onUpdate: setTransfersCount,
    })
  }, [currentUser, userProfile])

  const counts = { pendingCount, transfersCount }

  return (
    <div className="min-h-screen bg-gray-50" data-testid="dealer-layout">
      {/* ── Sidebar desktop ──────────────────────────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-56 flex-col ${BRAND.sidebar} shadow-xl lg:flex`}>
        <div className={`h-1 ${ACCENT.bar}`} aria-hidden="true" />
        <div className={`flex h-16 flex-shrink-0 items-center gap-3 px-5 border-b ${BRAND.sidebarBorder}`}>
          <div>
            <p className="text-lg font-bold text-white leading-none">{APP_NAME}</p>
            <p className={`text-[11px] ${BRAND.sidebarMuted} leading-none mt-0.5`}>Espace Dealer</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5" aria-label="Navigation Dealer" data-testid="dealer-nav">
          {DEALER_NAV_ITEMS.map(item => (
            <NavItem key={item.path} item={item} badgeCount={badgeFor(item.path, counts)} onClick={() => {}} />
          ))}
        </nav>
        <div className={`flex-shrink-0 border-t ${BRAND.sidebarBorder} px-3 py-3`}>
          {userProfile?.name && (
            <p className={`mb-2 truncate px-3 text-xs ${BRAND.sidebarMuted}`}>{userProfile.name}</p>
          )}
          <button
            onClick={logout}
            className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* ── Sidebar mobile ───────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className={`absolute inset-y-0 left-0 w-64 flex flex-col ${BRAND.sidebar} shadow-xl`}>
            <div className={`flex h-16 flex-shrink-0 items-center justify-between px-5 border-b ${BRAND.sidebarBorder}`}>
              <p className="text-lg font-bold text-white">{APP_NAME} Dealer</p>
              <button
                onClick={() => setSidebarOpen(false)}
                className={`rounded p-1 text-green-200 hover:text-white focus:outline-none focus-visible:ring-2 ${ACCENT.ring}`}
                aria-label="Fermer le menu"
              >
                ✕
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5" aria-label="Navigation Dealer">
              {DEALER_NAV_ITEMS.map(item => (
                <NavItem key={item.path} item={item} badgeCount={badgeFor(item.path, counts)} onClick={() => setSidebarOpen(false)} />
              ))}
            </nav>
            <div className={`flex-shrink-0 border-t ${BRAND.sidebarBorder} px-3 py-3`}>
              {userProfile?.name && (
                <p className={`mb-2 truncate px-3 text-xs ${BRAND.sidebarMuted}`}>{userProfile.name}</p>
              )}
              <button onClick={logout} className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors">
                Se déconnecter
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Header mobile ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 shadow-sm lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          aria-label="Ouvrir le menu"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <p className="font-bold text-green-900">{APP_NAME} Dealer</p>
        {(pendingCount + transfersCount) > 0 && (
          <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
            {(pendingCount + transfersCount) > 99 ? '99+' : (pendingCount + transfersCount)}
          </span>
        )}
      </header>

      {/* ── Contenu principal ─────────────────────────────────────────────────── */}
      <div className="lg:pl-56">
        <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
          <DealerInventoryBar />
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DealerLayout
