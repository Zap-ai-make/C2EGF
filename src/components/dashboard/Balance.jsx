import { memo } from 'react'
import { ArrowRight, TriangleAlert, Scale } from 'lucide-react'

/**
 * La balance — position du fonds de roulement.
 *
 * C'est l'instrument central du tableau de bord, et il n'est pas décoratif.
 * Avec un réseau unique, stock électronique et espèces sont des vases
 * communicants EXACTS : un dépôt fait stock ↓ / liquidité ↑, un retrait
 * l'inverse (financialImpact.js). Leur somme ne bouge que sur ravitaillement
 * de la centrale.
 *
 * Autrement dit, C2EGF tient un marché de float pour son réseau, et son risque
 * d'exploitation est d'être à sec d'un côté quand un agent se présente de
 * l'autre. C'est la seule lecture qui reste signifiante quand « quel réseau ? »
 * n'a plus de sens — et c'est ce que le camembert à une part ne pouvait pas
 * montrer.
 *
 * Accessibilité : la proportion n'est jamais portée par la seule barre colorée.
 * Les deux montants et les deux pourcentages sont écrits, et la barre est
 * masquée de l'arbre d'accessibilité (DESIGN.md §5).
 */

const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0))
const pourcent = (p) => `${Math.round((Number(p) || 0) * 100)} %`

const heure = (date) =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function Balance({ balance, projection }) {
  const { stock, liquidite, fondsRoulement, partStock, deriveNette, reseau } = balance
  const vide = fondsRoulement <= 0
  const partLiquidite = 1 - partStock

  return (
    <section
      aria-labelledby="titre-balance"
      className="rounded-xl border border-line bg-surface p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 id="titre-balance" className="flex items-center gap-2 text-lg font-bold text-ink">
          <Scale aria-hidden="true" className="h-5 w-5 text-brand-500" />
          La balance
        </h2>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Fonds de roulement
          </p>
          <p className="text-xl font-bold tabular-nums text-ink">{fcfa(fondsRoulement)} FCFA</p>
        </div>
      </div>

      {vide ? (
        <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          Aucun fonds enregistré pour le moment. Les soldes apparaîtront dès le premier
          ravitaillement de la centrale.
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-net-orange"
                />
                Stock {reseau}
              </p>
              <p className="text-2xl font-bold tabular-nums text-ink sm:text-3xl">
                {fcfa(stock)} <span className="text-base font-semibold text-ink-muted">FCFA</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Liquidité
              </p>
              <p className="text-2xl font-bold tabular-nums text-ink sm:text-3xl">
                {fcfa(liquidite)} <span className="text-base font-semibold text-ink-muted">FCFA</span>
              </p>
            </div>
          </div>

          {/* La barre double les chiffres ; elle ne les remplace pas. */}
          <div
            aria-hidden="true"
            className="mt-3 flex h-3 overflow-hidden rounded-full bg-brand-100"
          >
            <div className="bg-brand-500" style={{ width: `${partStock * 100}%` }} />
            <div className="bg-brand-400" style={{ width: `${partLiquidite * 100}%` }} />
          </div>

          <div className="mt-2 flex justify-between text-sm font-semibold tabular-nums text-ink-muted">
            <span>{pourcent(partStock)}</span>
            <span>{pourcent(partLiquidite)}</span>
          </div>

          <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            {deriveNette === 0 ? (
              <p className="text-ink-muted">
                Aujourd’hui, le fonds n’a pas bougé d’un plateau à l’autre.
              </p>
            ) : (
              <p className="flex items-start gap-2 text-ink">
                <ArrowRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                <span>
                  Aujourd’hui,{' '}
                  <strong className="tabular-nums">{fcfa(Math.abs(deriveNette))} FCFA</strong>{' '}
                  sont passés{' '}
                  {deriveNette > 0 ? (
                    <>du stock vers la <strong>liquidité</strong></>
                  ) : (
                    <>de la liquidité vers le <strong>stock</strong></>
                  )}
                  .
                </span>
              </p>
            )}

            {projection?.dansLaJournee && (
              <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-2 text-warn">
                <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  À la cadence de ce matin,{' '}
                  {projection.vase === 'stock' ? `le stock ${reseau}` : 'la liquidité'} serait
                  épuisé vers <strong className="tabular-nums">{heure(projection.rupture)}</strong>.
                  Pensez au ravitaillement.
                </span>
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default memo(Balance)
