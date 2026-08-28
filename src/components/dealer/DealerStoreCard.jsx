import { useNavigate } from 'react-router-dom'
import { formatCurrency } from '../../utils/formatCurrency'
import { DEALER_REQUEST_TYPES } from '../../constants/dealerConstants'

function DealerStoreCard({ store, balances, balanceError, isLoading }) {
  const navigate = useNavigate()

  const orange = balances?.Orange
  const stock = orange?.stock ?? null
  const liquidite = orange?.liquidite ?? null

  function openRequest(requestType) {
    navigate(
      `/dealer/requests/new?storeId=${encodeURIComponent(store.id)}&type=${encodeURIComponent(requestType)}`
    )
  }

  return (
    <article
      className="bg-white rounded-lg shadow p-5 flex flex-col gap-4"
      aria-label={`Boutique ${store.name}`}
      data-testid={`store-card-${store.id}`}
    >
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-800">{store.name}</h3>
        </div>
        <span className="flex-shrink-0 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
          Active
        </span>
      </div>

      {/* Soldes Orange */}
      <div className="flex gap-3">
        <div className="flex-1 rounded bg-orange-50 p-3">
          <p className="text-xs text-orange-600 font-medium mb-1">Stock Orange</p>
          {isLoading ? (
            <div className="h-5 w-24 motion-safe:animate-pulse rounded bg-orange-200" aria-busy="true" />
          ) : (
            <p className="text-sm font-semibold text-orange-800" data-testid={`stock-${store.id}`}>
              {balanceError ? 'Solde indisponible' : formatCurrency(stock)}
            </p>
          )}
        </div>
        <div className="flex-1 rounded bg-blue-50 p-3">
          <p className="text-xs text-blue-600 font-medium mb-1">Liquidité Orange</p>
          {isLoading ? (
            <div className="h-5 w-24 motion-safe:animate-pulse rounded bg-blue-200" aria-busy="true" />
          ) : (
            <p className="text-sm font-semibold text-blue-800" data-testid={`liquidite-${store.id}`}>
              {balanceError ? 'Solde indisponible' : formatCurrency(liquidite)}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => openRequest(DEALER_REQUEST_TYPES.STOCK_ADD)}
          className="flex-1 rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 transition-colors"
          aria-label={`Ajouter stock pour ${store.name}`}
          data-testid={`btn-stock-${store.id}`}
        >
          Ajouter stock
        </button>
        <button
          type="button"
          onClick={() => openRequest(DEALER_REQUEST_TYPES.LIQUIDITY_ADD)}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
          aria-label={`Ajouter liquidité pour ${store.name}`}
          data-testid={`btn-liquidite-${store.id}`}
        >
          Ajouter liquidité
        </button>
      </div>
    </article>
  )
}

export default DealerStoreCard
