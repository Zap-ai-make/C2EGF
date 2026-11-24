import Dialog from './ui/Dialog'
import {
  ANNULATION,
  CLIENT,
  CORRECTION,
  MODIFICATION,
  RAVITAILLEMENT,
  REFUSEE,
  REGLEMENT,
  REMBOURSEMENT,
  REMB_SIEGE,
  RETOUR,
  SAISIE,
  TRANSFERT_ARGENT,
} from '../services/fileEnvoi.js'
import { getClientName } from '../utils/helpers.js'
import { libelleVase } from '../utils/ravitaillement.js'
import { TYPE_REMB_SIEGE } from '../utils/rembSiege.js'
import { libelleTransfert } from '../utils/transfertArgent.js'

/** Les quatre commandes du remboursement au siège, dans les mêmes mots que les autres. */
function decrireRembSiege({ commande = {}, avant = {} }) {
  if (commande.action === 'addSiegeRepayment') {
    const { montant, balanceType, client } = commande.transaction ?? {}
    return `${TYPE_REMB_SIEGE} de ${fcfa(montant)} en ${libelleVase(balanceType).toLowerCase()}${client ? ` — ${getClientName(client)}` : ''}`
  }
  if (commande.action === 'sendToSiege') return `Envoi au siège de ${fcfa(commande.amount)}`
  if (commande.action === 'updateSiegeRepayment') return `Correction : ${TYPE_REMB_SIEGE} de ${fcfa({ ...avant, ...commande.updates }.montant)}`
  if (commande.action === 'trashSiegeRepayment') return `Annulation : ${TYPE_REMB_SIEGE} de ${fcfa(avant.montant)}`
  return 'Opération inconnue'
}

/** Les quatre commandes d'un transfert d'argent. `avant` dit l'opération de la ligne visée. */
function decrireTransfert({ commande = {}, avant = {} }) {
  const nature = avant.operation === 'retrait' ? 'Retrait' : 'Transfert'
  if (commande.action === 'addMoneyTransfer') {
    const transaction = commande.transaction ?? {}
    return `${libelleTransfert(transaction)} de ${fcfa(transaction.montant)} en ${libelleVase(transaction.balanceType).toLowerCase()} — ${transaction.nomClient}`
  }
  if (commande.action === 'settleMoneyTransfer') {
    return avant.operation === 'retrait' ? `Encaissement de ${fcfa(commande.amount)}` : `Envoi au siège de ${fcfa(commande.amount)}`
  }
  if (commande.action === 'updateMoneyTransfer') return `Correction : ${nature} de ${fcfa({ ...avant, ...commande.updates }.montant)}`
  if (commande.action === 'trashMoneyTransfer') return `Annulation : ${nature} de ${fcfa(avant.montant)}`
  return 'Opération inconnue'
}

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
  if (type === RAVITAILLEMENT) {
    const { amount, balanceType, expediteur } = charge.commande ?? {}
    return `Ravitaillement de ${fcfa(amount)} en ${libelleVase(balanceType).toLowerCase()} — reçu de ${expediteur}`
  }
  if (type === RETOUR) {
    const { amount, balanceType } = charge.commande ?? {}
    return `Retour de ${fcfa(amount)} en ${libelleVase(balanceType).toLowerCase()}`
  }
  if (type === MODIFICATION || type === CORRECTION) {
    const { type: nature, montant } = { ...charge.avant, ...charge.updates }
    return `Correction : ${nature} de ${fcfa(montant)}`
  }
  if (type === ANNULATION) {
    const { type: nature, montant } = charge.avant ?? {}
    return `Annulation : ${nature ?? 'opération'} de ${fcfa(montant)}`
  }
  if (type === REMB_SIEGE) return decrireRembSiege(charge)
  if (type === TRANSFERT_ARGENT) return decrireTransfert(charge)
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
