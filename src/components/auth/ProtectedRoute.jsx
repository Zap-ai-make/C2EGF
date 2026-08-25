import { AUTH_ROLES } from '../../constants/authMessages'
import RoleGuard from './RoleGuard'

/**
 * ProtectedRoute — alias de RoleGuard restreint à l'espace Boutique (store_admin).
 *
 * @dette-technique Les composants Boutique (Dashboard, Clients, etc.) utilisent encore
 * ProtectedRoute directement. Migrer progressivement vers
 * `<RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>` lors de la V3.
 */
function ProtectedRoute({ children }) {
  return (
    <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
      {children}
    </RoleGuard>
  )
}

export default ProtectedRoute
