import { memo, useContext, useMemo } from 'react'
import { Briefcase } from 'lucide-react'
import { ClientsContext } from '../../context/ClientsContext.jsx'
import { useAllTransactions } from '../../hooks/useAllTransactions.js'
import { calculerCommerciaux } from '../../utils/reseauStats.js'
import { CARTE } from '../../constants/dashboardTheme.js'

/**
 * Performance des commerciaux.
 *
 * Remplace le graphe « Top agents », qui portait deux défauts. Son nom d'abord :
 * il classait `client.agentCommercial`, c'est-à-dire les COMMERCIAUX de C2EGF,
 * pas les agents du réseau. Sa mesure ensuite : un décompte d'enrôlements,
 * aveugle à ce que ces comptes produisent une fois ouverts.
 *
 * Un tableau plutôt qu'un histogramme, parce qu'il y a trois grandeurs à
 * comparer par ligne — portefeuille, actifs, volume — et qu'un histogramme
 * n'en montre qu'une, au prix d'étiquettes pivotées illisibles.
 */

const entier = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0))
const pourcent = (p) => `${Math.round((Number(p) || 0) * 100)} %`

const abrege = (n) => {
  const v = Math.abs(Number(n) || 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (v >= 1_000) return `${Math.round(v / 1_000)} k`
  return entier(v)
}

function Commerciaux() {
  const { clients } = useContext(ClientsContext)
  const transactions = useAllTransactions()

  const lignes = useMemo(
    () => calculerCommerciaux(clients, transactions).slice(0, 6),
    [clients, transactions],
  )

  return (
    <section aria-labelledby="titre-commerciaux" className={CARTE}>
      <h2
        id="titre-commerciaux"
        className="flex items-center gap-2 text-lg font-bold text-ink"
      >
        <Briefcase aria-hidden="true" className="h-5 w-5 text-brand-500" />
        Commerciaux
      </h2>

      {lignes.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          Aucun commercial renseigné sur les fiches agents.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <th scope="col" className="pb-2 pr-3">Commercial</th>
                <th scope="col" className="pb-2 pr-3 text-right">Portefeuille</th>
                <th scope="col" className="pb-2 pr-3 text-right">Actifs 7 j</th>
                <th scope="col" className="pb-2 text-right">Volume 30 j</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((c) => (
                <tr key={c.nom} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3 font-medium text-ink">{c.nom}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                    {entier(c.portefeuille)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span className="text-ink">{entier(c.actifs)}</span>{' '}
                    <span className="text-ink-muted">({pourcent(c.tauxActivation)})</span>
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums text-ink">
                    {abrege(c.volume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default memo(Commerciaux)
