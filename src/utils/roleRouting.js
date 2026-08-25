import { AUTH_ROLES } from '../constants/authMessages'

/**
 * Retourne la route par défaut pour un rôle donné.
 * Source de vérité unique pour les redirections par rôle :
 * RoleGuard (rôle non autorisé) et RoleBasedRedirect (wildcard *).
 *
 * @param {string|null|undefined} role
 * @returns {string|null} chemin absolu ou null si rôle inconnu
 */
export const getDefaultRouteForRole = (role) => {
  switch (role) {
    case AUTH_ROLES.STORE_ADMIN:    return '/'
    case AUTH_ROLES.SYSTEM_MANAGER: return '/admin'
    case AUTH_ROLES.DEALER:         return '/dealer'
    default:                         return null
  }
}
