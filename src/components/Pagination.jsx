import { PAGINATION } from '../constants'

function Pagination({ 
  currentPage, 
  totalPages, 
  totalItems, 
  pageSize, 
  startIndex, 
  endIndex, 
  onPageChange, 
  onPageSizeChange, 
  hasNextPage, 
  hasPrevPage 
}) {
  const getVisiblePages = () => {
    const delta = 2
    const range = []
    const rangeWithDots = []

    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i)
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...')
    } else {
      rangeWithDots.push(1)
    }

    rangeWithDots.push(...range)

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages)
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages)
    }

    return rangeWithDots
  }

  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between bg-white px-4 py-3 border-t border-green-300">
      <div className="flex items-center gap-4">
        <p className="text-sm text-gray-700">
          Affichage de <span className="font-medium">{startIndex}</span> à{' '}
          <span className="font-medium">{endIndex}</span> sur{' '}
          <span className="font-medium">{totalItems}</span> résultats
        </p>
        
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Éléments par page:</label>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-green-500"
          >
            {PAGINATION.PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrevPage}
          className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Précédent
        </button>

        {getVisiblePages().map((page, index) => (
          <button
            key={index}
            onClick={() => typeof page === 'number' ? onPageChange(page) : null}
            disabled={page === '...'}
            className={`px-3 py-1 text-sm border border-gray-300 rounded ${
              page === currentPage 
                ? 'bg-green-500 text-white border-green-500' 
                : page === '...' 
                  ? 'cursor-default' 
                  : 'hover:bg-gray-50'
            }`}
          >
            {page}
          </button>
        ))}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
          className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Suivant
        </button>
      </div>
    </div>
  )
}

export default Pagination