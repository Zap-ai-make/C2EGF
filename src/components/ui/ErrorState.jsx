function ErrorState({ message = 'Une erreur est survenue.', onRetry }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6">
      <p className="font-medium text-red-700">Erreur de chargement</p>
      <p className="mt-1 text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Réessayer
        </button>
      )}
    </div>
  )
}

export default ErrorState
