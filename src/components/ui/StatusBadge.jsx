/**
 * StatusBadge — un statut se lit, il ne se devine pas à la couleur.
 *
 * Les six préréglages passent aux jetons de sens : `pending` attend, `rejected`
 * et `suspended` sont des échecs (`danger`), `confirmed` et `active` des succès.
 * Le texte porte toujours le statut en toutes lettres — la couleur ne fait que
 * l'appuyer (DESIGN.md §5).
 *
 * Défaut corrigé : `${cls}${customCls}` collait les deux chaînes sans espace.
 * Il était latent — l'une des deux est toujours vide, par construction du
 * ternaire au-dessus — mais c'était un piège armé pour le premier appelant qui
 * passerait `color` en même temps qu'un préréglage.
 */
const PRESETS = {
  pending:   'bg-pending-soft text-pending',
  confirmed: 'bg-success-soft text-success',
  rejected:  'bg-danger-soft text-danger',
  active:    'bg-success-soft text-success',
  inactive:  'bg-gray-100 text-gray-600',
  suspended: 'bg-danger-soft text-danger',
}

function StatusBadge({ status, label, color }) {
  const cls = color || PRESETS[status] || 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
      aria-label={label ?? status}
    >
      {label ?? status}
    </span>
  )
}

export default StatusBadge
