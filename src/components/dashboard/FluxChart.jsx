import { memo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowLeftRight } from 'lucide-react'
import { CARTE, DASHBOARD_COLORS } from '../../constants/dashboardTheme.js'

/**
 * Volume traité sur 14 jours, en barres divergentes.
 *
 * Remplace une courbe unique intitulée « Évolution du CA ». Deux corrections :
 *
 * 1. Ce n'est pas du chiffre d'affaires. La somme des montants qui transitent
 *    n'est pas le revenu d'un distributeur — son revenu, c'est la marge sur le
 *    float. L'écart est de l'ordre de 100×. L'axe s'appelle « volume traité ».
 *
 * 2. Une courbe unique additionne les deux sens et masque la DÉRIVE, qui est
 *    justement l'information : la journée a-t-elle poussé le fonds vers les
 *    espèces ou vers le stock ? Les dépôts montent, les retraits descendent, et
 *    l'écart au zéro se lit d'un coup d'œil.
 *
 * L'animation d'entrée est DÉSACTIVÉE. Ce tableau de bord est abonné au flux
 * Firestore : chaque instantané reçu provoque un rendu, et donc rejouait toute
 * l'animation des barres. Un graphe qui se redessine en boucle pendant qu'on le
 * lit ne sert pas le sujet (DESIGN.md §9).
 *
 * Les couleurs viennent des jetons sémantiques `inflow` / `outflow`, jamais
 * d'une palette décorative — et elles sont doublées par la légende écrite et
 * par la position au-dessus ou au-dessous de l'axe (DESIGN.md §5).
 */

const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(Math.abs(Math.round(Number(n) || 0)))

/** Abrège l'axe : 12 400 000 → « 12,4 M ». Les axes ne se lisent pas au franc près. */
const abrege = (n) => {
  const v = Math.abs(Number(n) || 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (v >= 1_000) return `${Math.round(v / 1_000)} k`
  return String(v)
}

function Infobulle({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const depots = payload.find((p) => p.dataKey === 'depots')?.value ?? 0
  const retraits = payload.find((p) => p.dataKey === 'retraitsNegatifs')?.value ?? 0

  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-sm shadow-lg">
      <p className="font-semibold text-ink">{label}</p>
      <p className="mt-1 text-inflow">Dépôts : {fcfa(depots)} FCFA</p>
      <p className="text-outflow">Retraits : {fcfa(retraits)} FCFA</p>
    </div>
  )
}

function FluxChart({ flux }) {
  const totalDepots = flux.reduce((s, p) => s + p.depots, 0)
  const totalRetraits = flux.reduce((s, p) => s + p.retraits, 0)
  const vide = totalDepots === 0 && totalRetraits === 0

  return (
    <section aria-labelledby="titre-flux" className={CARTE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="titre-flux" className="flex items-center gap-2 text-lg font-bold text-ink">
          <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-brand-500" />
          Volume traité — 14 jours
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-inflow" />
            Dépôts, vers la liquidité
          </span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-outflow" />
            Retraits, vers le stock
          </span>
        </div>
      </div>

      {vide ? (
        <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-12 text-center text-sm text-ink-muted">
          Aucune opération réglée sur les 14 derniers jours.
        </p>
      ) : (
        <>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flux} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} stackOffset="sign">
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="libelle"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: 'var(--color-ink-muted)' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={abrege}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fontSize: 12, fill: 'var(--color-ink-muted)' }}
                />
                <Tooltip content={<Infobulle />} cursor={{ fill: 'var(--color-brand-50)' }} />
                <ReferenceLine y={0} stroke="var(--color-ink-muted)" />
                <Bar
                  dataKey="depots"
                  name="Dépôts"
                  stackId="flux"
                  isAnimationActive={false}
                  fill={DASHBOARD_COLORS.inflow.chart}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="retraitsNegatifs"
                  name="Retraits"
                  stackId="flux"
                  isAnimationActive={false}
                  fill={DASHBOARD_COLORS.outflow.chart}
                  radius={[0, 0, 3, 3]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-ink-muted">Dépôts sur la période</dt>
              <dd className="font-semibold tabular-nums text-ink">{fcfa(totalDepots)} FCFA</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Retraits sur la période</dt>
              <dd className="font-semibold tabular-nums text-ink">{fcfa(totalRetraits)} FCFA</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Dérive nette</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {fcfa(totalDepots - totalRetraits)} FCFA vers{' '}
                {totalDepots >= totalRetraits ? 'la liquidité' : 'le stock'}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}

export default memo(FluxChart)
