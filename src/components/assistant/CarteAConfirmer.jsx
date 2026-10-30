import { Fragment } from 'react'

/**
 * La carte à confirmer : ce que l'assistant a préparé, dans les mots de l'écran.
 *
 * Fichier à part pour que le banc d'essai la monte sans le panneau, donc sans
 * le modèle ni les contextes.
 */
export function CarteAConfirmer({ carte, onConfirmer, onEcarter }) {
  return (
    <div
      role="group"
      aria-label={`À confirmer : ${carte.titre}`}
      data-testid="carte-operation"
      className={`my-2 rounded-xl border-2 bg-white px-3 py-3 ${carte.danger ? 'border-danger/40' : 'border-brand-300'}`}
    >
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">À confirmer</p>
      <p className="m-0 mt-0.5 font-semibold text-slate-900">{carte.titre}</p>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {carte.lignes.map((ligne) => (
          <Fragment key={ligne.libelle}>
            <dt className="text-slate-500">{ligne.libelle}</dt>
            <dd className="m-0 text-right font-medium tabular-nums text-slate-900">{ligne.valeur}</dd>
          </Fragment>
        ))}
      </dl>
      {carte.avertissement && (
        <p className="m-0 mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">{carte.avertissement}</p>
      )}
      {carte.erreur && (
        <p role="alert" className="m-0 mt-2 text-danger">{carte.erreur}</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        {/* « Écarter », et non « Annuler » : « Annuler » est le nom d'un geste
            qui AGIT sur une transaction. Celui-ci ne fait rien partir. */}
        <button
          type="button"
          onClick={onEcarter}
          disabled={carte.envoi}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          Écarter
        </button>
        <button
          type="button"
          onClick={onConfirmer}
          disabled={carte.envoi}
          className={`rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            carte.danger ? 'bg-danger hover:opacity-90' : 'bg-brand-600 hover:bg-brand-700'
          }`}
        >
          {carte.envoi ? 'Enregistrement…' : carte.genre === 'annulation' ? 'Annuler la transaction' : 'Confirmer'}
        </button>
      </div>
    </div>
  )
}

export default CarteAConfirmer
