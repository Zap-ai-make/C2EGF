import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AUTH_ROLES } from '../../constants/authMessages'
import { getDefaultRouteForRole } from '../../utils/roleRouting'
import AuthPage from './AuthPage'
import AuthAccessBlocked from './AuthAccessBlocked'
import FullPageSpinner from '../ui/FullPageSpinner.jsx'

/**
 * Guard générique par rôle.
 *
 * Ordre des gardes :
 *   1. loading              → spinner
 *   2. !currentUser         → AuthPage
 *   3. !userProfile         → AuthAccessBlocked (profil introuvable / compte inactif)
 *   4. rôle inconnu         → AuthAccessBlocked (rôle hors registre)
 *   5. rôle non autorisé    → Navigate vers l'espace du rôle réel
 *   6. store_admin sans boutique → AuthAccessBlocked
 *   7. autorisé             → children ou <Outlet /> (layout route)
 *
 * Modes d'usage :
 *   Wrapper :      <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}><Layout /></RoleGuard>
 *   Layout route : <Route element={<RoleGuard allowedRoles={[...]}><AdminLayout /></RoleGuard>}>
 *
 * children !== undefined ? children : <Outlet /> permet de respecter un enfant
 * React volontairement falsy (null) tout en activant Outlet quand aucun enfant
 * n'est passé (mode layout route pur).
 *
 * @param {{ allowedRoles: string[], children?: React.ReactNode }} props
 */
function RoleGuard({ allowedRoles, children }) {
  const { currentUser, userProfile, activeStore, loading, authError, logout, role } = useAuth()

  if (loading) {
    return (
      <FullPageSpinner />
    )
  }

  if (!currentUser) {
    return <AuthPage />
  }

  if (!userProfile) {
    return (
      <AuthAccessBlocked
        authError={authError}
        message="Ce compte n'est pas autorisé à accéder à l'application."
        logout={logout}
      />
    )
  }

  if (!role || !Object.values(AUTH_ROLES).includes(role)) {
    return (
      <AuthAccessBlocked
        message="Ce compte possède un rôle non reconnu."
        logout={logout}
      />
    )
  }

  if (!allowedRoles.includes(role)) {
    const destination = getDefaultRouteForRole(role)
    if (destination) return <Navigate to={destination} replace />
    return (
      <AuthAccessBlocked
        message="Espace non disponible pour votre rôle."
        logout={logout}
      />
    )
  }

  // store_admin sans boutique active (résolution partielle ou boutique inactive)
  if (role === AUTH_ROLES.STORE_ADMIN && !activeStore) {
    return (
      <AuthAccessBlocked
        authError={authError}
        message="Ce compte n'est pas rattaché à une boutique active."
        logout={logout}
      />
    )
  }

  return children !== undefined ? children : <Outlet />
}

export default RoleGuard
