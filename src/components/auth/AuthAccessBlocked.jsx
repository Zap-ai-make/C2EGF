/**
 * Composant partagé : état "Accès bloqué".
 * Utilisé par RoleGuard et RoleBasedRedirect pour éviter toute duplication
 * de la présentation des états bloqués.
 */
function AuthAccessBlocked({ message, authError, logout }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="max-w-md rounded-lg border border-line bg-surface p-6 text-center shadow-md">
        <h1 className="mb-3 text-xl font-bold text-ink">Accès bloqué</h1>
        <p className="mb-6 text-ink-muted">
          {authError || message || "Ce compte n'est pas autorisé à accéder à l'application."}
        </p>
        <button
          onClick={logout}
          className="rounded bg-brand-500 px-5 py-2 font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

export default AuthAccessBlocked
