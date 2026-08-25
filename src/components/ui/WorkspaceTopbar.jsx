import { getRoleAccent } from '../../constants/workspaceTheme'
import { APP_NAME } from '../../constants/branding'

/**
 * Bandeau de marque slim en haut du contenu des espaces Gérant & Dealer.
 * Rappelle la présence de marque du header Boutique sans en manger la hauteur.
 *
 * - Fine barre d'accent de rôle tout en haut (bleu = Gérant, vert = Dealer).
 * - Wordmark AKAYIS + label de rôle.
 * - `actions` optionnel (ex. bouton remonté depuis la page).
 *
 * @param {'admin'|'dealer'} role
 * @param {React.ReactNode} [actions]
 */
function WorkspaceTopbar({ role = 'dealer', actions }) {
  const accent = getRoleAccent(role)

  return (
    <div className="mb-6 hidden overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm lg:block">
      <div className={`h-1 ${accent.bar}`} aria-hidden="true" />
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-black tracking-tight text-green-900">{APP_NAME}</span>
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
            {accent.label}
          </span>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export default WorkspaceTopbar
