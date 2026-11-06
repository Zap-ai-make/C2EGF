import Dialog from './ui/Dialog'
import { CLIENT, REFUSEE, REGLEMENT, REMBOURSEMENT, SAISIE } from '../services/fileEnvoi.js'
import { getClientName } from '../utils/helpers.js'

const fcfa = (montant) => `${(Number(montant) || 0).toLocaleString('fr-FR')} FCFA`

/** Une opération de la file, dans les mots de la caissière. */
export function decrireOperation({ type, charge = {} }) {
  if (type === SAISIE) {
    const { type: nature, montant, client } = charge.transaction ?? {}
    return `${nature} de ${fcfa(montant)}${client ? ` — ${getClientName(client)}` : ''}`
  }
  if (type === REGLEMENT) return `Règlement de ${fcfa(charge.amount)} (${charge.paymentMethod})`
  if (type === REMBOURSEMENT) return `Remboursement de ${fcfa(charge.amount)} (${charge.paymentMethod})`
  if (type === CLIENT) {
    const { prenom, nom } = charge.donnees ?? {}
    return `Fiche client : ${[prenom, nom].filter(Boolean).join(' ')}`
  }
  return 'Opération inconnue'
}

/**
 * Tout ce qui attend le réseau, et ce que le serveur a refusé (lot G3c).
 *
 * ⚠ CE PANNEAU N'EST PAS UN DOUBLON DES LIGNES « REFUSÉE ». Une fiche client
 *   refusée n'a aucune ligne où apparaître, et un règlement refusé peut viser
 *   une ligne partie entre-temps. Sans lui, le bandeau les annoncerait pour
 *   toujours, sans rien à lire ni à retirer.
 */
export default function EnvoisListe({ open, onClose, operations, onRetirer }) {
  return (
    <Dialog open={open} onClose={onClose} title="Opérations en attente d’envoi" testId="envois-liste">
      {operations.length === 0 ? (
        <p className="text-sm text-ink-muted">Tout est parti.</p>
      ) : (
        <ul className="space-y-3">
          {operations.map((op) => (
            <li key={op.id} className="rounded border border-line p-3 text-sm" data-testid="envoi-ligne">
              <div className="font-medium text-ink">{decrireOperation(op)}</div>
              {op.etat === REFUSEE ? (
                <div className="mt-1 flex items-start justify-between gap-3">
                  <span className="text-danger">Refusée : {op.erreur?.message || 'le serveur n’a pas accepté cette opération.'}</span>
                  <button
                    type="button"
                    onClick={() => onRetirer(op.id)}
                    className="shrink-0 rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-danger hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    Retirer
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-warn">En attente d’envoi</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
