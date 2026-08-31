import { useState, useEffect } from 'react'

/**
 * Bouton « œil » affichant la remarque de rejet d'une boutique dans un modal.
 * Composant autonome (gère son propre état d'ouverture) → réutilisable partout
 * où l'historique/les demandes Dealer sont affichés.
 *
 * Rend « — » quand il n'y a pas de remarque, pour rester alignable en cellule.
 *
 * @param {string} storeName  Nom de la boutique à l'origine de la remarque.
 * @param {string} reason     Texte de la remarque de rejet.
 * @param {string} [testId]   data-testid optionnel pour les tests.
 */
function RejectionRemarkButton({ storeName, reason, testId }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ⚠ `gray-300` mesurait 1,49:1 sur blanc — le tiret était pratiquement
  //   invisible. Et il n'est pas décoratif : dans une colonne « Remarque », il
  //   dit « rien à signaler », ce qui n'est pas la même chose que ne rien
  //   afficher. Seule ligne touchée hors des cinq fichiers du lot S5, parce que
  //   ce tiret se rend DANS ces écrans et compte dans leur contraste.
  if (!reason) return <span className="text-ink-muted">—</span>

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        aria-label={`Voir la remarque de rejet de ${storeName}`}
        data-testid={testId}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Voir
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remark-modal-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line/60 px-5 py-4">
              <div>
                <h2 id="remark-modal-title" className="text-base font-semibold text-gray-900">
                  Remarque de rejet
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">{storeName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label="Fermer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="whitespace-pre-wrap rounded-lg bg-danger-soft border border-danger/30 px-3 py-2 text-sm text-danger">
                {reason}
              </p>
            </div>
            <div className="flex justify-end border-t border-line/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default RejectionRemarkButton
