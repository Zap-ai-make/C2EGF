import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { ClientsProvider } from './context/ClientsContext.jsx'
import { TransactionsProvider } from './context/transactions.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { NetworkConfigProvider } from './context/NetworkConfigContext.jsx'
import { AUTH_ROLES } from './constants/authMessages'
import { getDefaultRouteForRole } from './utils/roleRouting'
import RoleGuard from './components/auth/RoleGuard.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'
import FullPageSpinner from './components/ui/FullPageSpinner.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import { APP_FULL_NAME } from './constants/branding'

// Layouts
import Layout from './components/Layout'
import AdminLayout from './layouts/AdminLayout.jsx'
import DealerLayout from './layouts/DealerLayout.jsx'

import { INTERNAL_DEBTS_PATH } from './constants/navigation'
import { COLLABORATIONS_ENABLED } from './constants/collaborationConstants'
import { STORE_NAVIGATION_VISIBILITY } from './constants/storeWorkspace.js'

import { useAuth } from './context/AuthContext.jsx'
import AuthPage from './components/auth/AuthPage.jsx'
import AuthAccessBlocked from './components/auth/AuthAccessBlocked.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Clients = lazy(() => import('./pages/Clients.jsx'))
const Transactions = lazy(() => import('./pages/Transactions.jsx'))
const Historique = lazy(() => import('./pages/Historique.jsx'))
const Formulaire = lazy(() => import('./pages/Formulaire.jsx'))
const Profil = lazy(() => import('./pages/Profil.jsx'))
const StoreAdminDealerRequests = lazy(() => import('./pages/store/StoreAdminDealerRequests.jsx'))
const StoreInternalDebts = lazy(() => import('./pages/store/StoreInternalDebts.jsx'))
const StoreAdminDealerRequestDetails = lazy(() => import('./pages/store/StoreAdminDealerRequestDetails.jsx'))
const StoreAdminClosures = lazy(() => import('./pages/store/StoreAdminClosures.jsx'))

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'))
const AdminStores = lazy(() => import('./pages/admin/AdminStores.jsx'))
const AdminProfile = lazy(() => import('./pages/admin/AdminProfile.jsx'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'))
const AdminDealer = lazy(() => import('./pages/admin/AdminDealer.jsx'))
const AdminDealerInventory = lazy(() => import('./pages/admin/AdminDealerInventory.jsx'))
const AdminClients = lazy(() => import('./pages/admin/AdminClients.jsx'))
const AdminHistory = lazy(() => import('./pages/admin/AdminHistory.jsx'))
const AdminReports = lazy(() => import('./pages/admin/AdminReports.jsx'))

const DealerDashboard = lazy(() => import('./pages/dealer/DealerDashboard.jsx'))
const DealerStores = lazy(() => import('./pages/dealer/DealerStores.jsx'))
const DealerRequests = lazy(() => import('./pages/dealer/DealerRequests.jsx'))
const NewDealerRequest = lazy(() => import('./pages/dealer/NewDealerRequest.jsx'))
const DealerTransfers = lazy(() => import('./pages/dealer/DealerTransfers.jsx'))
const DealerHistory = lazy(() => import('./pages/dealer/DealerHistory.jsx'))
const DealerProfile = lazy(() => import('./pages/dealer/DealerProfile.jsx'))

/**
 * Gère les routes inconnues (wildcard *) en appliquant les mêmes
 * exigences d'authentification que RoleGuard.
 */
function RoleBasedRedirect() {
  const { currentUser, userProfile, loading, authError, logout, role } = useAuth()

  if (loading) {
    return (
      <FullPageSpinner />
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
      <Suspense fallback={<FullPageSpinner />}>
      <Routes>
      {/* ── Espace Boutique (store_admin) ────────────────────────────────── */}
      <Route
        element={
          <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
            <Layout />
          </RoleGuard>
        }
      >
        {/* MASQUER L'ENTRÉE DE MENU NE SUFFISAIT PAS.
            La redirection d'après-connexion visait bien /transactions, mais
            `/` servait toujours le tableau de bord : un signet, le raccourci
            PWA, ou un simple rechargement sur la racine y ramenait le gérant
            sans jamais consulter son rôle. On redirige plutôt que de retirer
            la route — la racine d'une application doit toujours mener quelque
            part, et `getDefaultRouteForRole` sait déjà où. */}
        <Route
          path="/"
          element={STORE_NAVIGATION_VISIBILITY.dashboard
            ? <Dashboard />
            : <Navigate to={getDefaultRouteForRole(AUTH_ROLES.STORE_ADMIN)} replace />}
        />
        <Route path="/clients" element={<Clients />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/historique" element={<Historique />} />
        <Route path="/formulaire" element={<Formulaire />} />
        <Route path="/profil" element={<Profil />} />
        <Route path="/dealer-requests" element={<StoreAdminDealerRequests />} />
        {/* La route n'existe PAS quand le module est desactive, exactement comme
            son entree de menu : un gerant ne doit jamais atteindre une page que
            son profil n'autorise pas, meme en tapant l'adresse. */}
        {COLLABORATIONS_ENABLED && (
          <Route path={INTERNAL_DEBTS_PATH} element={<StoreInternalDebts />} />
        )}
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
      </Suspense>
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
