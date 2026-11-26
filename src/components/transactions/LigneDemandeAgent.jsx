import { Smartphone } from 'lucide-react'
import { attenteDe } from '../../utils/attente.js'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'

/**
 * Une demande d'agent dans les Non Terminées (maquette B, choisie le
 * 2026-11-17) : toute la ligne en violet pâle, et « Demande de l'agent » sous
 * le sens. Elle se lit comme les opérations de la caissière — mêmes colonnes,
 * même minuteur — mais elle n'en est pas encore une.
 *
 * Trois gestes, à la place de Modifier / Encaisser / Annuler :
 *   — Non terminée : acceptée, il reste à régler ; elle redevient une ligne
 *     ordinaire, avec ses gestes habituels ;
 *   — Valider : acceptée et réglée tout de suite ;
 *   — Rejeter : d'un geste, sans motif (règle 10 du contrat).
 *
 * Un REMBOURSEMENT (contrat v10 §11.3) n'en a que deux, Accepter et Rejeter :
 * l'agent a déjà dit combien et comment. Celui d'un crédit porte la marque
 * « Remboursement demandé par l’agent » et le reste de la ligne qu'il règle,
 * `cible` — qui reste à sa place dans le tableau, avec ses gestes. Partie
 * entre-temps, la demande le dit ; seul « Rejeter » aboutira.
 *
 * `enCours` : le geste qui part (`'nonTerminee' | 'valider' | 'rejeter' |
 * 'accepter'`), ou `null`. Tous se grisent ensemble : deux réponses à la même
 * demande n'ont pas de sens.
 */
const REJETER = { geste: 'rejeter', libelle: 'Rejeter', classes: 'border-line bg-surface text-danger hover:border-danger' }
const PLEIN = 'border-brand-500 bg-brand-500 font-semibold text-white hover:bg-brand-600'
const GESTES_OPERATION = [
  { geste: 'nonTerminee', libelle: 'Non terminée', classes: 'border-line bg-surface text-ink hover:bg-brand-50' },
  { geste: 'valider', libelle: 'Valider', classes: PLEIN },
  REJETER,
]
const GESTES_REMBOURSEMENT = [{ geste: 'accepter', libelle: 'Accepter', classes: PLEIN }, REJETER]

const fcfa = (n) => (Number(n) || 0).toLocaleString('fr-FR')

const heure = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

export default function LigneDemandeAgent({ demande, cible = null, styles, maintenant, dejaSaisieMs, enCours, onRepondre }) {
  const attente = attenteDe(demande, maintenant)
  const remboursement = demande.nature === 'remboursement'
  const gestes = demande.nature && demande.nature !== 'operation' ? GESTES_REMBOURSEMENT : GESTES_OPERATION
  return (
    <tr className="border-b border-agent-line bg-agent-soft" data-testid={`demande-agent-${demande.id}`}>
      <td className="relative px-4 pb-3 pt-7 text-base">
        {attente && (
          <span
            className={`absolute left-3 top-1 z-10 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold leading-none tabular-nums shadow-sm ${
              attente.enRetard ? 'border-warn bg-warn text-white' : 'border-line bg-surface text-ink-muted'
            }`}
          >
            {attente.texte}
          </span>
        )}
        {formatTransactionDateTime(demande)}
      </td>
      <td className="px-4 py-3 text-base font-medium">{getClientName(demande.client)}</td>
      <td className="px-4 py-3 text-base">
        <div className={`font-medium ${styles.textColor}`}>{demande.type}</div>
        <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-agent">
          <Smartphone className="h-3 w-3" aria-hidden="true" />
          {remboursement ? 'Remboursement demandé par l’agent' : 'Demande de l’agent'}
        </div>
        {remboursement && (
          <div className="mt-0.5 text-xs font-medium text-ink-muted tabular-nums">
            {cible
              ? `Reste : ${fcfa(cible.remainingAmount ?? cible.montant)} sur ${fcfa(cible.originalAmount ?? cible.montant)} FCFA`
              : 'Cette ligne n’est plus en attente.'}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-base">{demande.code || '-'}</td>
      <td className={`px-4 py-3 text-right text-base font-medium tabular-nums ${styles.textColor}`}>
        <span>{fcfa(demande.montant)} FCFA</span>
        {demande.mode && <div className="mt-0.5 text-xs font-medium text-ink-muted">en {demande.mode}</div>}
        {dejaSaisieMs != null && (
          <div className="mt-0.5 text-xs font-semibold text-warn">Déjà saisi à {heure(dejaSaisieMs)} ?</div>
        )}
      </td>
      <td className="px-4 py-3 text-base">
        <div className="flex justify-center gap-2">
          {gestes.map(({ geste, libelle, classes }) => (
            <button
              key={geste}
              type="button"
              onClick={() => onRepondre(demande, geste)}
              disabled={enCours != null}
              aria-label={enCours === geste ? libelle : undefined}
              className={`rounded border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink-muted ${classes}`}
            >
              {enCours === geste ? '…' : libelle}
            </button>
          ))}
        </div>
      </td>
    </tr>
  )
}
