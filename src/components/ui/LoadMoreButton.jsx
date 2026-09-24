function LoadMoreButton({ loading, onClick }) {
  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        {loading ? 'Chargement…' : 'Charger plus'}
      </button>
    </div>
  )
}

export default LoadMoreButton
