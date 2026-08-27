/**
 * PageHeader — le titre d'un écran, et le seul.
 *
 * Un écran porte exactement un `h1`, avec le même dessin partout. Les cinq
 * écrans de la boutique en avaient chacun un différent : `text-3xl` souligné
 * `border-b-2 border-green-500` pour Transactions et Historique, `text-2xl`
 * souligné `border-current` pour la liste des clients, un bloc `border-line`
 * fait main pour le tableau de bord. Quatre traitements pour un seul rôle.
 *
 * Le filet sous le titre est parti avec eux : il ne disait rien que l'espace ne
 * dise déjà, et un filet sous chaque titre est précisément le tic « journal »
 * que DESIGN.md §1 range parmi les réflexes par défaut.
 *
 * Les couleurs passent aux jetons — `gray-900` → `ink`, `gray-500` →
 * `ink-muted`. Ce composant sert aussi les espaces gérant et dealer, hors du
 * lot en cours : l'écart y est d'un gris à un autre (ink-muted est même un peu
 * plus contrasté), jamais un changement de dessin.
 */
function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

export default PageHeader
