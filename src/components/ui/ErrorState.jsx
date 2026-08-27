/**
 * ErrorState — l'erreur dit ce qui s'est passé et comment le corriger
 * (DESIGN.md §10, §12).
 *
 * Les rouges bruts passent au jeton `danger`, qui veut dire échec — distinct
 * d'`outflow`, qui veut dire « l'argent sort ». C'est la confusion que
 * l'application entretenait partout.
 */
function ErrorState({ message = 'Une erreur est survenue.', onRetry }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-6">
      <p className="font-medium text-danger">Erreur de chargement</p>
      <p className="mt-1 text-sm text-danger">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded bg-danger px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Réessayer
        </button>
      )}
    </div>
  )
}

export default ErrorState
