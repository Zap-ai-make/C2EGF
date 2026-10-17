/**
 * ⚠ `min-h-11` — RONDE DE CORRECTION 2 DE LA TÂCHE 5 (R20). Ce composant sert
 *   deux écrans (`HistoriqueClientPanel.jsx`, `PatronHistoriqueClient.jsx`) ;
 *   `py-2` seul rendait son bouton à ~36 px, sous les 44 px de cible tactile.
 *   Même raisonnement que `ErrorState.jsx` : le défaut appartenait aux deux
 *   écrans qui le montent, la correction leur profite tous les deux.
 */
function LoadMoreButton({ loading, onClick }) {
  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex min-h-11 items-center rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        {loading ? 'Chargement…' : 'Charger plus'}
      </button>
    </div>
  )
}

export default LoadMoreButton
