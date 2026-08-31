import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

/**
 * Le message qui suit l'action, sur l'écran où elle atterrit.
 *
 * CE QUI MANQUAIT
 * ───────────────
 * « Confirmer » renvoyait le dealer sur la file des ravitaillements, sans un
 * mot. Rien ne distinguait un envoi parti d'un formulaire abandonné : il
 * fallait chercher sa propre ligne dans la liste pour savoir si le geste avait
 * abouti. Sur une action qui déplace de l'argent, l'absence de retour est le
 * défaut, pas la sobriété.
 *
 * ⚠ POURQUOI PAS UN TOAST. `useToast` vit dans l'état d'un écran ; il meurt à
 *   la navigation, et c'est précisément après la navigation qu'il faudrait le
 *   voir. Le message voyage donc dans l'état du routeur — il appartient à
 *   l'arrivée, pas au départ.
 *
 * LE MÊME MOT QUE LE BOUTON. Le bouton dit « Confirmer », le message dit
 * « confirmé ». Un bouton « Confirmer » suivi d'un « Opération réussie »
 * oblige à faire le rapprochement soi-même, et c'est exactement là qu'un doute
 * s'installe (DESIGN.md §12).
 *
 * Refermer efface l'état du routeur : sans cela, un simple retour arrière
 * réafficherait l'annonce d'un envoi fait il y a dix minutes.
 */
function MessageDeRetour() {
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const message = state?.message

  if (!message) return null

  return (
    <div
      role="status"
      data-testid="message-de-retour"
      className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-success/30 bg-success-soft px-4 py-3"
    >
      <p className="text-sm font-medium text-success">{message}</p>
      <button
        type="button"
        onClick={() => navigate(pathname, { replace: true, state: null })}
        aria-label="Fermer le message"
        className="-m-1 shrink-0 rounded p-1 text-success transition-colors hover:bg-success/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <X className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
      </button>
    </div>
  )
}

export default MessageDeRetour
