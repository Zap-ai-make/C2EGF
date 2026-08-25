import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ClientsProvider } from './context/ClientsContext.jsx'
import { TransactionsProvider } from './context/transactions.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { NetworkConfigProvider } from './context/NetworkConfigContext.jsx'
import { AUTH_ROLES } from './constants/authMessages'
import { getDefaultRouteForRole } from './utils/roleRouting'
import RoleGuard from './components/auth/RoleGuard.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import { APP_FULL_NAME } from './constants/branding'

// Layouts
import Layout from './components/Layout'
import AdminLayout from './layouts/AdminLayout.jsx'
import DealerLayout from './layouts/DealerLayout.jsx'

// Pages Boutique (store_admin)
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Transactions from './pages/Transactions'
import Historique from './pages/Historique'
import Formulaire from './pages/Formulaire'
import Profil from './pages/Profil'
import StoreAdminDealerRequests from './pages/store/StoreAdminDealerRequests.jsx'
import StoreAdminDealerRequestDetails from './pages/store/StoreAdminDealerRequestDetails.jsx'

// Pages Admin (system_manager)
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminStores from './pages/admin/AdminStores.jsx'
import AdminProfile from './pages/admin/AdminProfile.jsx'
import AdminUsers from './pages/admin/AdminUsers.jsx'
import AdminDealer from './pages/admin/AdminDealer.jsx'
import AdminDealerInventory from './pages/admin/AdminDealerInventory.jsx'
import AdminClients from './pages/admin/AdminClients.jsx'
import AdminHistory from './pages/admin/AdminHistory.jsx'
import AdminReports from './pages/admin/AdminReports.jsx'

// Pages Dealer
import DealerDashboard from './pages/dealer/DealerDashboard.jsx'
import DealerStores from './pages/dealer/DealerStores.jsx'
import DealerRequests from './pages/dealer/DealerRequests.jsx'
import NewDealerRequest from './pages/dealer/NewDealerRequest.jsx'
import DealerTransfers from './pages/dealer/DealerTransfers.jsx'
import DealerHistory from './pages/dealer/DealerHistory.jsx'
import DealerProfile from './pages/dealer/DealerProfile.jsx'

// Pages Boutique — extensions V2
import StoreAdminClosures from './pages/store/StoreAdminClosures.jsx'

import { useAuth } from './context/AuthContext.jsx'
import AuthPage from './components/auth/AuthPage.jsx'
import AuthAccessBlocked from './components/auth/AuthAccessBlocked.jsx'

/**
 * Gère les routes inconnues (wildcard *) en appliquant les mêmes
 * exigences d'authentification que RoleGuard.
 */
function RoleBasedRedirect() {
  const { currentUser, userProfile, loading, authError, logout, role } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    )
  }

  if (!currentUser) return <AuthPage />

  if (!userProfile) {
    return (
      <AuthAccessBlocked
        authError={authError}
        message="Ce compte n'est pas autorisé à accéder à l'application."
        logout={logout}
      />
    )
  }

  const destination = getDefaultRouteForRole(role)
  if (destination) return <Navigate to={destination} replace />

  // Rôle connu mais sans destination (ne devrait pas survenir)
  return (
    <AuthAccessBlocked
      message="Ce compte possède un rôle non reconnu."
      logout={logout}
    />
  )
}

export function AppContent() {
  return (
    <>
      <OfflineBanner />
      <Routes>
      {/* ── Espace Boutique (store_admin) ────────────────────────────────── */}
      <Route
        element={
          <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
            <Layout />
          </RoleGuard>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/historique" element={<Historique />} />
        <Route path="/formulaire" element={<Formulaire />} />
        <Route path="/profil" element={<Profil />} />
        <Route path="/dealer-requests" element={<StoreAdminDealerRequests />} />
        <Route path="/dealer-requests/:requestId" element={<StoreAdminDealerRequestDetails />} />
        <Route path="/store/closures" element={<StoreAdminClosures />} />
      </Route>

      {/* ── Espace Admin (system_manager) ────────────────────────────────── */}
      <Route
        element={
          <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
            <AdminLayout />
          </RoleGuard>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/stores" element={<AdminStores />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/dealer" element={<AdminDealer />} />
        <Route path="/admin/dealer-inventory" element={<AdminDealerInventory />} />
        <Route path="/admin/clients" element={<AdminClients />} />
        <Route path="/admin/history" element={<AdminHistory />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/profile" element={<AdminProfile />} />
      </Route>

      {/* ── Espace Dealer ─────────────────────────────────────────────────── */}
      <Route
        element={
          <RoleGuard allowedRoles={[AUTH_ROLES.DEALER]}>
            <DealerLayout />
          </RoleGuard>
        }
      >
        <Route path="/dealer" element={<DealerDashboard />} />
        <Route path="/dealer/stores" element={<DealerStores />} />
        <Route path="/dealer/requests" element={<DealerRequests />} />
        <Route path="/dealer/requests/new" element={<NewDealerRequest />} />
        <Route path="/dealer/transfers" element={<DealerTransfers />} />
        <Route path="/dealer/history" element={<DealerHistory />} />
        <Route path="/dealer/profile" element={<DealerProfile />} />
      </Route>

      {/* ── Fallback ──────────────────────────────────────────────────────── */}
      <Route path="*" element={<RoleBasedRedirect />} />
    </Routes>
    </>
  )
}

function App() {
  useEffect(() => {
    document.title = APP_FULL_NAME
  }, [])

  return (
    <Router>
      <AuthProvider>
        <ThemeProvider>
          <NetworkConfigProvider>
            <ClientsProvider>
              <TransactionsProvider>
                <ErrorBoundary>
                  <AppContent />
                </ErrorBoundary>
              </TransactionsProvider>
            </ClientsProvider>
          </NetworkConfigProvider>
        </ThemeProvider>
      </AuthProvider>
    </Router>
  )
}

export default App
