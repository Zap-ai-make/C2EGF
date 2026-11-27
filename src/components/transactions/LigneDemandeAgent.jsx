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
 * l'agent a déjà dit combien et comment. Celui d'un crédit se lit sous la
 * ligne qu'il règle, remontée en tête (`LigneRemboursementAgent`, plus bas) ;
 * il n'arrive ici que si cette ligne n'est plus dans les non terminées, et le
 * dit : seul « Rejeter » aboutira.
 *
 * `enCours` : le geste qui part (`'nonTerminee' | 'valider' | 'rejeter' |
 * 'accepter'`), ou `null`. Tous se grisent ensemble : deux réponses à la même
 * demande n'ont pas de sens.
 *
 * `arrivee` : elle vient d'arriver (`vientDArriver`). Un cadre violet bat
 * autour de la ligne, et un point battant prend la place du téléphone — sans
 * décaler le texte. Le fond, lui, ne bouge pas : plus foncé, le vert d'un
 * dépôt n'y tiendrait que 3,6:1. Sans mouvement (réglage du système), le
 * cadre reste fixe.
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

const ARRIVEE = 'outline-2 -outline-offset-2 outline-agent motion-safe:animate-arrivee-demande'
const classesDeLigne = (arrivee) => `border-b border-agent-line bg-agent-soft${arrivee ? ` ${ARRIVEE}` : ''}`

/** Le téléphone de l'app Oxygen, ou, le temps de la pulsation, un point qui bat à sa place. */
function MarqueAgent({ arrivee }) {
  if (!arrivee) return <Smartphone className="h-3 w-3" aria-hidden="true" />
  return (
    <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-agent opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-agent" />
    </span>
  )
}

const heure = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

export default function LigneDemandeAgent({ demande, styles, maintenant, dejaSaisieMs, enCours, onRepondre, arrivee = false }) {
  const attente = attenteDe(demande, maintenant)
  const remboursement = demande.nature === 'remboursement'
  const gestes = demande.nature && demande.nature !== 'operation' ? GESTES_REMBOURSEMENT : GESTES_OPERATION
  return (
    <tr className={classesDeLigne(arrivee)} data-testid={`demande-agent-${demande.id}`}>
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
          <MarqueAgent arrivee={arrivee} />
          {remboursement ? 'Remboursement demandé par l’agent' : 'Demande de l’agent'}
        </div>
        {remboursement && (
          <div className="mt-0.5 text-xs font-medium text-ink-muted">Cette ligne n’est plus en attente.</div>
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

/**
 * Le remboursement demandé sur une ligne, juste sous elle (contrat v10
 * §11.3) : la ligne visée remonte en tête UNE fois, avec ses gestes, et
 * chaque demande en attente se lit dessous — une par mode, au plus deux.
 * Rien n'est répété de la ligne : ni l'agent, ni le type, ni le code.
 *
 * `encaisseLeMs` : une tranche est passée sur la ligne après la demande
 * (`encaisseApres`). Un signal, pas un blocage. `arrivee` : comme plus haut,
 * c'est la demande qui pulse, pas la ligne qu'elle règle.
 */
export function LigneRemboursementAgent({ demande, maintenant, encaisseLeMs, enCours, onRepondre, arrivee = false }) {
  const attente = attenteDe(demande, maintenant)
  return (
    <tr className={classesDeLigne(arrivee)} data-testid={`remboursement-agent-${demande.id}`}>
      <td className="relative border-l-4 border-l-agent px-4 pb-3 pt-7 text-base">
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
      <td colSpan={3} className="px-4 py-3 text-base">
        <div className="inline-flex items-center gap-1 text-xs font-bold text-agent">
          <MarqueAgent arrivee={arrivee} />
          Remboursement demandé par l’agent
        </div>
        {encaisseLeMs != null && (
          <div className="mt-0.5 text-xs font-semibold text-warn">Encaissé à {heure(encaisseLeMs)} ?</div>
        )}
      </td>
      <td className="px-4 py-3 text-right text-base font-medium tabular-nums text-ink">
        <span>{fcfa(demande.montant)} FCFA</span>
        {demande.mode && <div className="mt-0.5 text-xs font-medium text-ink-muted">en {demande.mode}</div>}
      </td>
      <td className="px-4 py-3 text-base">
        <div className="flex justify-center gap-2">
          {GESTES_REMBOURSEMENT.map(({ geste, libelle, classes }) => (
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
