import { AUTH_ROLES } from '../constants/authMessages'
import { STORE_NAVIGATION_VISIBILITY } from '../constants/storeWorkspace.js'

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
    // Déposer le gérant sur une page absente de sa propre navigation serait un
    // cul-de-sac : quand le profil masque le tableau de bord, l'arrivée suit.
    case AUTH_ROLES.STORE_ADMIN:    return STORE_NAVIGATION_VISIBILITY.dashboard ? '/' : '/transactions'
    case AUTH_ROLES.SYSTEM_MANAGER: return '/admin'
    case AUTH_ROLES.DEALER:         return '/dealer'
    default:                         return null
  }
}
