import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

/**
 * Toast — notification éphémère.
 *
 * Trois défauts d'accessibilité corrigés ici, tous présents depuis l'origine :
 *
 * 1. Le TYPE n'était porté que par la couleur de fond et un glyphe texte
 *    (✓ ✕ ⚠ ℹ). DESIGN.md §5 l'interdit : une information ne passe jamais par
 *    la seule couleur. Un libellé lu par les lecteurs d'écran double désormais
 *    l'icône.
 * 2. Rien n'annonçait l'apparition du message. Le conteneur porte maintenant
 *    `role="status"` — et `role="alert"` pour une erreur, qui interrompt.
 * 3. Le bouton de fermeture était un « ✕ » sans nom accessible : au clavier ou
 *    au lecteur d'écran, un bouton anonyme.
 *
 * Les glyphes texte laissent place à des icônes lucide, cohérentes avec le
 * reste du produit (DESIGN.md §8).
 */

const TYPES = {
  success: { surface: 'bg-success',   Icon: CheckCircle2,  label: 'Succès' },
  error:   { surface: 'bg-danger',    Icon: XCircle,       label: 'Erreur' },
  warning: { surface: 'bg-warn',      Icon: AlertTriangle, label: 'Avertissement' },
  info:    { surface: 'bg-brand-500', Icon: Info,          label: 'Information' },
}

function Toast({ message, type = 'info', duration = 4000, onClose }) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onClose(), 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  const { surface, Icon, label } = TYPES[type] ?? TYPES.info

  const dismiss = () => {
    setIsVisible(false)
    setTimeout(() => onClose(), 300)
  }

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`fixed top-4 right-4 z-50 max-w-sm rounded-lg p-4 text-white shadow-lg transition-all duration-300 ${surface} ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">
          <span className="sr-only">{label} : </span>
          <span>{message}</span>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer la notification"
          className="shrink-0 rounded transition-colors hover:text-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default Toast
