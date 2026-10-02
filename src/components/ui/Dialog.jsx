import { useEffect, useRef, useCallback, useId } from 'react'
import { X } from 'lucide-react'

/**
 * Dialog — la modale accessible qui manquait.
 *
 * POURQUOI UN COMPOSANT DE PLUS
 * ─────────────────────────────
 * Sept écrans posent déjà un `role="dialog"`, chacun avec son propre calque,
 * son propre `Escape`, son propre bouton de fermeture. Aucun ne PIÈGE LE FOCUS.
 * Sans piège, la tabulation sort de la modale et va parcourir la page derrière
 * le voile : le lecteur d'écran annonce des boutons invisibles, et l'on peut
 * déclencher une action qu'on ne voit pas. DESIGN.md §11 l'exige explicitement.
 *
 * Ce composant existe donc pour être le seul endroit où cette mécanique est
 * écrite — les dialogues des dettes l'utilisent, et les sept autres écrans
 * pourront y venir sans que ce lot les réécrive.
 *
 * CE QU'IL FAIT, ET QUE LES SEPT AUTRES NE FONT PAS
 * ────────────────────────────────────────────────
 *   • il déplace le focus DANS la modale à l'ouverture ;
 *   • il l'y retient, en bouclant de la dernière cible à la première ;
 *   • il le REND à l'élément qui l'avait, à la fermeture — sinon on repart en
 *     haut de la page, et au clavier on a tout perdu ;
 *   • il rend le fond inerte pour les technologies d'assistance.
 *
 * CE QU'IL NE FAIT PAS
 * ────────────────────
 * Fermer sur clic du voile. Ces dialogues-ci portent des montants d'argent : un
 * clic à côté effacerait une saisie sans confirmation. Fermer reste un geste
 * explicite — le bouton, ou Échap.
 */

const CIBLES_FOCUSABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * ⚠ `largeur` est OPTIONNELLE et vaut `max-w-md`, la valeur d'origine : les
 *   deux écrans qui posaient déjà un `Dialog` ne bougent pas d'un pixel. Elle
 *   existe parce qu'un dialogue de saisie (deux champs) et un dialogue de
 *   lecture (un tableau de quatre colonnes) n'ont pas la même largeur utile —
 *   à `max-w-md`, la dernière colonne du second sortait du cadre, et c'était
 *   celle qu'on venait chercher.
 */
function Dialog({ open, onClose, title, description, children, footer, testId, largeur = 'max-w-md', spacious = false }) {
  const panneau = useRef(null)
  const corps = useRef(null)
  const focusPrecedent = useRef(null)
  const restoreBackground = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  const cibles = useCallback(
    () => [...(panneau.current?.querySelectorAll(CIBLES_FOCUSABLES) ?? [])],
    [],
  )

  // Ouverture : on retient d'où l'on vient, et on entre.
  useEffect(() => {
    if (!open) return undefined
    focusPrecedent.current = document.activeElement
    // ⚠ On entre par le CONTENU, pas par la première cible du panneau.
    //   Dans l'ordre du DOM, la première cible est la croix de fermeture : elle
    //   est dans l'en-tête, au-dessus. Ouvrir « Déclarer un remboursement » pour
    //   poser le curseur sur « Fermer » oblige à tabuler avant de saisir, et
    //   place la sortie sous la touche Entrée. Le champ d'abord ; la croix reste
    //   dans le cycle, elle n'en est plus l'entrée.
    const premiere = corps.current?.querySelector(CIBLES_FOCUSABLES)
      ?? cibles()[0]
      ?? panneau.current
    premiere?.focus?.()
    return () => {
      restoreBackground.current?.()
      // Rendre le focus est la moitié du contrat : sans ça, refermer renvoie en
      // haut du document et le parcours au clavier est perdu.
      focusPrecedent.current?.focus?.()
    }
  }, [open, cibles])

  useEffect(() => {
    if (!open) return undefined
    const surTouche = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const liste = cibles()
      if (liste.length === 0) {
        e.preventDefault()
        return
      }
      const premier = liste[0]
      const dernier = liste[liste.length - 1]
      // Le piège : on ne laisse jamais la tabulation franchir les bords.
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault()
        dernier.focus()
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault()
        premier.focus()
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [open, onClose, cibles])

  useEffect(() => {
    if (!open || !panneau.current) return undefined
    const restored = []
    let activeBranch = panneau.current.parentElement

    while (activeBranch?.parentElement && activeBranch.parentElement !== document.documentElement) {
      for (const sibling of activeBranch.parentElement.children) {
        if (sibling === activeBranch) continue
        restored.push({
          element: sibling,
          inert: sibling.inert,
          inertAttribute: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.inert = true
        sibling.setAttribute('inert', '')
        sibling.setAttribute('aria-hidden', 'true')
      }
      activeBranch = activeBranch.parentElement
      if (activeBranch === document.body) break
    }

    const restore = () => {
      restored.forEach(({ element, inert, inertAttribute, ariaHidden }) => {
        element.inert = inert
        if (!inertAttribute) element.removeAttribute('inert')
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      })
    }
    restoreBackground.current = restore
    return () => {
      restore()
      if (restoreBackground.current === restore) restoreBackground.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-testid={testId}
        className={`max-h-full w-full ${largeur} overflow-y-auto rounded-xl border border-line bg-surface shadow-xl`}
      >
        <div className={`flex items-start justify-between gap-4 border-b border-line ${spacious ? 'px-7 py-5' : 'px-5 py-4'}`}>
          <div className="min-w-0">
            <h2 id={titleId} className={`${spacious ? 'text-2xl' : 'text-base'} font-semibold text-ink`}>{title}</h2>
            {description && <p id={descriptionId} className={`mt-0.5 ${spacious ? 'text-base' : 'text-sm'} text-ink-muted`}>{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            /* La croix est encadrée : posée nue, elle se lisait comme une
               décoration de l'en-tête plutôt que comme la sortie. Le cadre lui
               donne une cible franche, au doigt comme à l'œil. */
            className="-mr-1 rounded-md border border-line p-1.5 text-ink-muted transition-colors hover:bg-brand-50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <div ref={corps} className={spacious ? 'px-7 py-5' : 'px-5 py-4'}>{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-brand-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dialog
