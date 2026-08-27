/**
 * EmptyState — un écran vide invite à agir, il ne laisse pas un trou
 * (DESIGN.md §10).
 *
 * Deux défauts corrigés ici. Le message secondaire était en `text-gray-400` :
 * 2,65:1 sur blanc, sous le 4,5:1 exigé — l'explication du vide était la ligne
 * la moins lisible de l'écran. Et `action` existait sans qu'aucun appelant ne
 * la passe : le composant savait proposer une issue, personne ne lui en donnait.
 *
 * L'icône est décorative et masquée : le titre dit déjà ce qui est vide.
 */
function EmptyState({ icon: Icon, title = 'Aucun résultat', message, action }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center">
      {Icon && (
        <Icon className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden="true" strokeWidth={1.5} />
      )}
      <p className="text-base font-medium text-ink">{title}</p>
      {message && <p className="mt-1 text-sm text-ink-muted">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export default EmptyState
