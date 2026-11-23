import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useNavigate } from 'react-router-dom'
import ChangePasswordModal from '../components/auth/ChangePasswordModal'
import { formatDate, getAvatarInitial } from '../utils/authHelpers'
import { AUTH_LABELS, AUTH_ROLES, AUTH_ROLE_LABELS } from '../constants/authMessages'
import { AUTH_STYLES } from '../constants/authStyles'
import PageHeader from '../components/ui/PageHeader'
import { useEnvois } from '../context/envoisContexte.js'
import NumerosBoutique from '../components/profil/NumerosBoutique.jsx'

function Profil() {
  const { currentUser, userProfile, activeStore, logout } = useAuth()
  const { themeClasses } = useTheme()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [loading, setLoading] = useState(false)
  // Une opération en attente reste sur l'appareil, rattachée à son compte (lot
  // G3c) : déconnecté, ce compte ne l'enverrait plus, et se reconnecter exige
  // justement le réseau qui manque.
  const enAttente = useEnvois()?.enAttente?.length ?? 0

  // Utiliser les données Firebase Auth comme fallback
  const displayName = activeStore?.name || userProfile?.storeName || userProfile?.name || currentUser?.email?.split('@')[0] || 'Boutique'
  const displayEmail = userProfile?.email || currentUser?.email || 'Non renseigné'
  const creationTime = userProfile?.createdAt || currentUser?.metadata?.creationTime || null
  const lastSignInTime = userProfile?.lastLogin || currentUser?.metadata?.lastSignInTime || null

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
              className="rounded-md bg-danger px-6 py-2 font-medium text-white transition-colors hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
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

        {/* Ce qui se règle, regroupé (demande de l'utilisateur, 2026-11-23) :
            les numéros que l'app Oxygen montre aux agents — la boutique seule
            les saisit (décidé le 2026-11-17). */}
        {userProfile?.role === AUTH_ROLES.STORE_ADMIN && activeStore?.id && (
          <section aria-labelledby="titre-configuration" className="bg-white rounded-lg shadow-md p-6 space-y-6">
            <h2 id="titre-configuration" className={`text-xl font-bold ${themeClasses.text}`}>
              Configuration
            </h2>
            <NumerosBoutique storeId={activeStore.id} sansCadre />
          </section>
        )}
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
            {/* La session est ce qui permet de démarrer sans internet : elle
                survit à l'extinction de la machine, mais une reconnexion exige
                le réseau (docs/rester-dans-le-quota-gratuit.md §G). */}
            <p role="note" className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              Sans connexion internet, vous ne pourrez pas vous reconnecter. Pour travailler hors ligne,
              restez connecté : la session tient même machine éteinte.
            </p>
            {enAttente > 0 && (
              <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" data-testid="deconnexion-bloquee">
                {enAttente > 1 ? `${enAttente} opérations attendent` : 'Une opération attend'} encore le réseau. Déconnecté,
                vous ne pourriez plus rien envoyer. Attendez que tout soit parti avant de vous déconnecter.
              </p>
            )}
            <div className={AUTH_STYLES.modal.footer}>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className={`flex-1 ${AUTH_STYLES.button.tertiary}`}
              >
                {AUTH_LABELS.CANCEL}
              </button>
              <button
                onClick={handleLogout}
                disabled={loading || enAttente > 0}
                className="flex-1 rounded-md bg-danger px-4 py-2 font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
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
