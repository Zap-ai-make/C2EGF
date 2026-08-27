/**
 * FullPageSpinner — l'attente qui occupe tout l'écran, avant que l'application
 * sache qui vous êtes.
 *
 * Ce bloc était dupliqué mot pour mot entre App.jsx et RoleGuard.jsx, jusqu'au
 * `border-blue-600` — un bleu qui n'était pas celui de la marque, à l'écran le
 * plus vu de l'application puisqu'il précède tous les autres.
 *
 * Deux corrections d'accessibilité au passage : l'attente est annoncée
 * (`role="status"`, que les lecteurs d'écran signalent poliment), et le disque
 * qui tourne est masqué — c'est le texte qui porte l'information, pas lui. La
 * rotation passe sous `motion-safe:` : sans mouvement, il reste un disque, et
 * la phrase suffit.
 */
function FullPageSpinner({ label = 'Chargement…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div role="status" className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 h-16 w-16 rounded-full border-4 border-brand-200 border-t-brand-500 motion-safe:animate-spin"
        />
        <p className="text-ink-muted">{label}</p>
      </div>
    </div>
  )
}

export default FullPageSpinner
