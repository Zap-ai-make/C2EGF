/**
 * Squelettes de chargement — le seul jeu de l'application.
 *
 * Il y en avait deux. Celui-ci, consommé par onze écrans gérant et dealer, et
 * `LoadingSkeleton.jsx` — 128 lignes, quatre exports, UN seul consommateur
 * (`TransactionRowSkeleton`), et un damier `border-green-300` dans ses lignes
 * de tableau. Ses trois autres exports n'avaient aucun appelant. Il est
 * supprimé ; `SkeletonRow` ci-dessous prend sa place, et il existait déjà.
 *
 * Ces blocs sont décoratifs : ils n'annoncent rien qu'un lecteur d'écran doive
 * lire. C'est le conteneur qui porte `aria-busy` et le nom accessible ; les
 * lignes sont masquées de l'arbre d'accessibilité (DESIGN.md §8).
 *
 * `animate-pulse` passe sous `motion-safe:` — une animation ne s'impose jamais
 * à qui a demandé moins de mouvement (DESIGN.md §9).
 */

const BLOC = 'rounded bg-gray-200 motion-safe:animate-pulse'

export function SkeletonRow({ cols = 4 }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 ${BLOC}`} style={{ width: `${60 + (i % 3) * 20}%` }} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface" aria-busy="true" aria-label="Chargement…">
      <table className="min-w-full">
        <tbody className="divide-y divide-line/60">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" aria-busy="true" aria-label="Chargement…">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-canvas p-5" aria-hidden="true">
          <div className={`mb-3 h-3 w-20 ${BLOC}`} />
          <div className={`h-7 w-24 ${BLOC}`} />
        </div>
      ))}
    </div>
  )
}

export default SkeletonTable
