import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useNavigate } from 'react-router-dom'
import ChangePasswordModal from '../components/auth/ChangePasswordModal'
import { formatDate, getAvatarInitial } from '../utils/authHelpers'
import { AUTH_LABELS, AUTH_ROLE_LABELS } from '../constants/authMessages'
import { AUTH_STYLES } from '../constants/authStyles'
import { useUserActivity } from '../hooks/useUserActivity'
import PageHeader from '../components/ui/PageHeader'

function Profil() {
  const { currentUser, userProfile, activeStore, logout } = useAuth()
  const { themeClasses } = useTheme()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Utiliser les données Firebase Auth comme fallback
  const displayName = activeStore?.name || userProfile?.storeName || userProfile?.name || currentUser?.email?.split('@')[0] || 'Boutique'
  const displayEmail = userProfile?.email || currentUser?.email || 'Non renseigné'
  const userId = currentUser?.uid || 'Non disponible'
  const isEmailVerified = currentUser?.emailVerified || false
  const creationTime = userProfile?.createdAt || currentUser?.metadata?.creationTime || null
  const lastSignInTime = userProfile?.lastLogin || currentUser?.metadata?.lastSignInTime || null

  // Calculer les vraies statistiques d'activité
  const userActivity = useUserActivity(currentUser, userProfile)

  const handleLogout = useCallback(async () => {
    try {
      setLoading(true)
      await logout()
      navigate('/')
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error)
    } finally {
      setLoading(false)
      setShowLogoutConfirm(false)
    }
  }, [logout, navigate])

  const getRoleLabel = useCallback((role) => AUTH_ROLE_LABELS[role] || 'Utilisateur', [])

  return (
    <div className="max-w-4xl mx-auto">
      {/* Le titre de l'écran porte le mot de la navigation — « Profil » — et les
          deux actions de compte. Elles étaient serrées contre l'identité, dans
          une rangée qui se disputait la largeur avec l'avatar et le nom. */}
      <PageHeader
        title="Profil"
        actions={
          <>
            <button
              onClick={() => setShowChangePassword(true)}
              className={AUTH_STYLES.button.primary}
            >
              {AUTH_LABELS.CHANGE_PASSWORD}
            </button>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md transition-colors"
            >
              {AUTH_LABELS.SIGN_OUT}
            </button>
          </>
        }
      />

      <div className="space-y-6">
        {/* Identité du compte */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-4">
            <div className={`w-16 h-16 ${themeClasses.accent} rounded-full flex items-center justify-center text-white text-2xl font-bold`}>
              {getAvatarInitial(displayName, displayEmail)}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-ink">
                {displayName}
              </h2>
              <p className="text-gray-600">{displayEmail}</p>
              <p className="text-sm text-gray-500">
                Boutique: {activeStore?.name || userProfile?.storeName || 'Non rattachée'}
              </p>
              <p className="text-sm text-gray-500">
                Rôle: {getRoleLabel(userProfile?.role)}
              </p>
            </div>
          </div>
        </div>

        {/* Informations du compte */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className={`text-xl font-bold ${themeClasses.text} mb-6`}>
            Informations du compte
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nom de la boutique
              </label>
              <div className="p-3 bg-gray-50 rounded-md border">
                {displayName}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Adresse email
              </label>
              <div className="p-3 bg-gray-50 rounded-md border">
                {displayEmail}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ID Utilisateur
              </label>
              <div className="p-3 bg-gray-50 rounded-md border font-mono text-sm">
                {userId}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Statut du compte
              </label>
              <div className="p-3 bg-gray-50 rounded-md border">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isEmailVerified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {isEmailVerified ? 'Email vérifié' : 'Email non vérifié'}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date de création
              </label>
              <div className="p-3 bg-gray-50 rounded-md border">
                {formatDate(creationTime)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dernière connexion
              </label>
              <div className="p-3 bg-gray-50 rounded-md border">
                {formatDate(lastSignInTime)}
              </div>
            </div>
          </div>
        </div>

        {/* Statistiques rapides */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className={`text-xl font-bold ${themeClasses.text} mb-6`}>
            Activité
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`${themeClasses.tableHeader} p-4 rounded-lg`}>
              <div className="text-center">
                <div className={`text-2xl font-bold ${themeClasses.text}`}>
                  {userActivity.monthlyLogins}
                </div>
                <div className="text-sm text-gray-600">Connexions ce mois</div>
              </div>
            </div>

            <div className={`${themeClasses.tableHeader} p-4 rounded-lg`}>
              <div className="text-center">
                <div className={`text-2xl font-bold ${themeClasses.text}`}>
                  {userActivity.daysSinceRegistration}
                </div>
                <div className="text-sm text-gray-600">Jours depuis l'inscription</div>
              </div>
            </div>

            <div className={`${themeClasses.tableHeader} p-4 rounded-lg`}>
              <div className="text-center">
                <div className={`text-2xl font-bold ${themeClasses.text}`}>
                  {userActivity.accountStatus}
                </div>
                <div className="text-sm text-gray-600">Statut du compte</div>
              </div>
            </div>
          </div>

          {/* Statistiques supplémentaires */}
          {userActivity.totalTransactions > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`${themeClasses.tableAccent} p-4 rounded-lg`}>
                  <div className="text-center">
                    <div className={`text-xl font-bold ${themeClasses.text}`}>
                      {userActivity.totalTransactions}
                    </div>
                    <div className="text-sm text-gray-600">Transactions effectuées</div>
                  </div>
                </div>

                <div className={`${themeClasses.tableAccent} p-4 rounded-lg`}>
                  <div className="text-center">
                    <div className={`text-xl font-bold ${themeClasses.text}`}>
                      {userActivity.hasTransactions ? 'Oui' : 'Non'}
                    </div>
                    <div className="text-sm text-gray-600">Activité récente</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmation de déconnexion */}
      {showLogoutConfirm && (
        <div className={AUTH_STYLES.modal.overlay}>
          <div className={AUTH_STYLES.modal.container}>
            <h3 className={AUTH_STYLES.modal.title}>
              {AUTH_LABELS.CONFIRM_LOGOUT}
            </h3>
            <p className={`${AUTH_STYLES.text.body} ${AUTH_STYLES.spacing.modal}`}>
              Êtes-vous sûr de vouloir vous déconnecter ? Vous devrez vous reconnecter pour accéder à l'application.
            </p>
            <div className={AUTH_STYLES.modal.footer}>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className={`flex-1 ${AUTH_STYLES.button.tertiary}`}
              >
                {AUTH_LABELS.CANCEL}
              </button>
              <button
                onClick={handleLogout}
                disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50"
              >
                {loading ? AUTH_LABELS.LOADING_LOGOUT : AUTH_LABELS.SIGN_OUT}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de changement de mot de passe */}
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  )
}

export default Profil
