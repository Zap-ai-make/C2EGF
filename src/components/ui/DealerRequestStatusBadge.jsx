import { DEALER_REQUEST_STATUS_LABELS } from '../../constants/dealerConstants'

/**
 * Badge de statut d'une demande Dealer (pending / confirmed / rejected).
 *
 * Centralise trois copies auparavant identiques (DealerRequests,
 * StoreAdminDealerRequests, StoreAdminDealerRequestDetails). Libellés issus de
 * DEALER_REQUEST_STATUS_LABELS ; palette et testid conservés à l'identique des
 * copies d'origine pour ne rien changer à l'affichage ni aux tests.
 *
 * Reste distinct du StatusBadge générique (components/ui/StatusBadge.jsx) : leur
 * API diffère (celui-ci dérive son libellé d'un dictionnaire métier, et porte un
 * nom accessible « Statut : … » plus un testid). Leurs PALETTES, elles, sont
 * désormais les mêmes — deux badges affichant « En attente » à deux endroits de
 * l'application ne peuvent pas être de deux couleurs. Toute évolution de l'une
 * se reporte sur l'autre.
 *
 * `pending` était ambre. Le jeton `pending` existe et dit exactement cela : en
 * attente, ni succès ni échec. L'ambre reste réservé aux SEUILS (`warn`).
 */

const STATUS_STYLES = {
  pending:   'bg-pending-soft text-pending',
  confirmed: 'bg-success-soft text-success',
  rejected:  'bg-danger-soft text-danger',
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
