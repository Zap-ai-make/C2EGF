import { DEALER_REQUEST_STATUS_LABELS } from '../../constants/dealerConstants'

/**
 * Badge de statut d'une demande Dealer (pending / confirmed / rejected).
 *
 * Centralise trois copies auparavant identiques (DealerRequests,
 * StoreAdminDealerRequests, StoreAdminDealerRequestDetails). Libellés issus de
 * DEALER_REQUEST_STATUS_LABELS ; palette et testid conservés à l'identique des
 * copies d'origine pour ne rien changer à l'affichage ni aux tests.
 *
 * Distinct du StatusBadge générique (components/ui/StatusBadge.jsx), dont l'API
 * (status + label + color) et la palette (amber) diffèrent.
 */

const STATUS_STYLES = {
  pending:   'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected:  'bg-red-100 text-red-800',
}

function DealerRequestStatusBadge({ status }) {
  const label = DEALER_REQUEST_STATUS_LABELS[status] ?? 'Statut inconnu'
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
      aria-label={`Statut : ${label}`}
      data-testid={`status-badge-${status}`}
    >
      {label}
    </span>
  )
}

export default DealerRequestStatusBadge
