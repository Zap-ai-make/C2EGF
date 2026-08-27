import { memo } from 'react'
import { Users, UserMinus, PieChart } from 'lucide-react'
import { CARTE } from '../../constants/dashboardTheme.js'

/**
 * L'état du réseau d'agents — les trois questions d'un distributeur.
 *
 *   Couverture     mon portefeuille travaille-t-il, ou dort-il ?
 *   Décrochages    qui a cessé de venir ?
 *   Concentration  quelle part de mon volume repose sur quelques comptes ?
 *
 * Ces trois cartes remplacent des indicateurs de commerce de détail — nombre
 * d'inscriptions, « top client du jour », « fidèles » — qui n'ont pas de sens
 * sur un réseau fini de comptes professionnels connus nommément.
 *
 * Le seuil de décrochage est AFFICHÉ et réglable, jamais enfoui dans le code :
 * c'est une règle de gestion, elle appartient à qui pilote.
 */

const entier = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0))
const pourcent = (p) => `${Math.round((Number(p) || 0) * 100)} %`
const decimal = (n) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })

const SEUILS_PROPOSES = [7, 15, 30, 45]

function Jauge({ part, ton = 'bg-brand-500' }) {
  return (
    <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-brand-100">
      <div className={ton} style={{ width: `${Math.min(1, Math.max(0, part)) * 100}%`, height: '100%' }} />
    </div>
  )
}

function EnTete({ icone, titre }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
      {icone}
      {titre}
    </h3>
  )
}

const ICONE = 'h-4 w-4 text-brand-400'

function ReseauCards({ couverture, decrochages, concentration, onSeuilChange }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ── Couverture ──────────────────────────────────────────────────── */}
      <section className={CARTE}>
        <EnTete icone={<Users aria-hidden="true" className={ICONE} />} titre="Couverture" />

        {couverture.totalAgents === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Aucun agent au portefeuille. Enregistrez un premier agent pour suivre l’activité
            du réseau.
          </p>
        ) : (
          <>
            <p className="mt-3 text-3xl font-bold tabular-nums text-ink">
              {entier(couverture.actifs)}
              <span className="text-lg font-semibold text-ink-muted">
                {' / '}
                {entier(couverture.totalAgents)}
              </span>
            </p>
            <p className="text-sm text-ink-muted">
              agents actifs sur {couverture.fenetreJours} jours — {pourcent(couverture.part)}
            </p>
            <Jauge part={couverture.part} />
            {couverture.actifs > 0 && (
              <p className="mt-3 text-sm text-ink-muted">
                <strong className="tabular-nums text-ink">
                  {decimal(couverture.passagesParAgent)}
                </strong>{' '}
                passages par agent actif
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Décrochages ─────────────────────────────────────────────────── */}
      <section className={CARTE}>
        <EnTete icone={<UserMinus aria-hidden="true" className={ICONE} />} titre="Décrochages" />

        <p className="mt-3 text-3xl font-bold tabular-nums text-ink">
          {entier(decrochages.total)}
          <span className="ml-2 text-base font-semibold text-ink-muted">
            {decrochages.total > 1 ? 'agents' : 'agent'}
          </span>
        </p>

        {decrochages.total === 0 ? (
          <p className="text-sm text-inflow">
            Aucun agent silencieux au-delà du seuil. Le réseau tourne.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            sans opération depuis plus de {decrochages.seuilJours} jours
          </p>
        )}

        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>Alerter après</span>
          <select
            value={decrochages.seuilJours}
            onChange={(e) => onSeuilChange?.(Number(e.target.value))}
            className="rounded border border-line bg-surface px-2 py-1 font-semibold tabular-nums text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {SEUILS_PROPOSES.map((j) => (
              <option key={j} value={j}>
                {j} jours
              </option>
            ))}
          </select>
        </label>

        {decrochages.total > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            {decrochages.decroches.slice(0, 3).map(({ agent, joursDeSilence }) => (
              <li key={agent.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-ink">
                  {`${agent.prenom || ''} ${agent.nom || ''}`.trim() || 'Agent sans nom'}
                </span>
                <span className="shrink-0 tabular-nums text-ink-muted">{joursDeSilence} j</span>
              </li>
            ))}
            {decrochages.total > 3 && (
              <li className="pt-1 text-ink-muted">
                et {entier(decrochages.total - 3)} autre
                {decrochages.total - 3 > 1 ? 's' : ''}
              </li>
            )}
          </ul>
        )}
      </section>

      {/* ── Concentration ───────────────────────────────────────────────── */}
      <section className={CARTE}>
        <EnTete icone={<PieChart aria-hidden="true" className={ICONE} />} titre="Concentration" />

        {concentration.volumeTotal === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Aucun volume traité sur {concentration.fenetreJours} jours.
          </p>
        ) : (
          <>
            <p className="mt-3 text-3xl font-bold tabular-nums text-ink">
              {pourcent(concentration.partTete)}
            </p>
            <p className="text-sm text-ink-muted">
              du volume sur {Math.min(concentration.topN, concentration.agentsComptes)} agents,
              sur {concentration.fenetreJours} jours
            </p>
            <Jauge
              part={concentration.partTete}
              ton={concentration.partTete >= 0.6 ? 'bg-warn' : 'bg-brand-500'}
            />
            {concentration.partTete >= 0.6 && (
              <p className="mt-3 text-sm text-warn">
                Dépendance élevée : le départ de ces comptes pèserait lourd.
              </p>
            )}
            <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              {concentration.tete.slice(0, 3).map((a) => (
                <li key={a.cle} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink">{a.nom}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    {entier(a.volume)} FCFA
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

export default memo(ReseauCards)
