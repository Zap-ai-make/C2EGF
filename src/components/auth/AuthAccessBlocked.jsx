/**
 * Composant partagé : état "Accès bloqué".
 * Utilisé par RoleGuard et RoleBasedRedirect pour éviter toute duplication
 * de la présentation des états bloqués.
 */
function AuthAccessBlocked({ message, authError, logout }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-md">
        <h1 className="mb-3 text-xl font-bold text-gray-800">Accès bloqué</h1>
        <p className="mb-6 text-gray-600">
          {authError || message || "Ce compte n'est pas autorisé à accéder à l'application."}
        </p>
        <button
          onClick={logout}
          className="rounded bg-red-600 px-5 py-2 font-medium text-white hover:bg-red-700"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

export default AuthAccessBlocked
