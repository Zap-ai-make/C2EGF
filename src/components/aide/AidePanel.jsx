import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Dialog from '../ui/Dialog.jsx'
import { FICHES, TITRES_GROUPES, groupesOrdonnes } from '../../content/aideFiches.js'

/**
 * Le panneau d'aide — douze gestes, un par fiche.
 *
 * UN PANNEAU, PAS UN ONGLET
 * ─────────────────────────
 * `navigation.js` porte déjà la règle : la rangée ne contient que des
 * DESTINATIONS, et « Profil » en a été sorti parce que le compte n'en est pas
 * une. L'aide non plus : c'est un recours, pas un endroit où l'on travaille.
 * Un treizième onglet aurait aussi coûté le formulaire à moitié rempli que la
 * caissière abandonne en y allant — or c'est précisément quand elle est au
 * milieu d'une saisie qu'elle se bloque.
 *
 * LES FICHES SONT REPLIÉES
 * ────────────────────────
 * Douze fiches dépliées font un mur de texte qu'on referme. Repliées, elles
 * font une liste de douze questions qu'on parcourt des yeux en cinq secondes —
 * et une seule s'ouvre à la fois, pour que la réponse lue soit la seule chose à
 * l'écran.
 *
 * ⚠ DES BOUTONS, PAS `<details>`. `Dialog` piège le focus sur une liste de
 *   sélecteurs qui ignore `summary` : au clavier, la tabulation aurait sauté
 *   toutes les fiches. Un `<button>` y entre sans toucher au piège.
 */

/**
 * Rend un texte en transformant `{{Valider}}` en la forme du bouton réel, et
 * `**ainsi**` en emphase.
 *
 * POURQUOI UNE EMPHASE PLUTÔT QUE DES MAJUSCULES
 * ─────────────────────────────────────────────
 * Le premier jet écrivait « l'argent a DÉJÀ changé de main ». Dans une interface,
 * la capitale CRIE — et elle se lit moins vite, parce qu'elle efface la forme
 * des mots, ces montants et ces creux sur lesquels l'œil s'appuie. C'est un
 * coût qu'on fait payer exactement au lecteur le moins à l'aise, celui pour qui
 * ces fiches sont écrites.
 *
 * Découpage plutôt que `dangerouslySetInnerHTML` : le contenu est statique
 * aujourd'hui, mais il est destiné à être corrigé par des mains qui ne pensent
 * pas au balisage, et une porte ouverte sur l'injection ne se referme jamais.
 */
function Texte({ children }) {
  const morceaux = useMemo(
    () => String(children || '').split(/(\{\{[^}]+\}\}|\*\*[^*]+\*\*)/g),
    [children],
  )

  return (
    <>
      {morceaux.map((morceau, index) => {
        if (morceau.startsWith('{{')) {
          return (
            <span
              key={index}
              className="mx-0.5 inline-block whitespace-nowrap rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[0.92em] font-semibold text-ink"
            >
              {morceau.slice(2, -2)}
            </span>
          )
        }
        if (morceau.startsWith('**')) {
          return <strong key={index} className="font-semibold text-ink">{morceau.slice(2, -2)}</strong>
        }
        return <span key={index}>{morceau}</span>
      })}
    </>
  )
}

function Fiche({ fiche, ouverte, onBascule }) {
  const idContenu = `aide-fiche-${fiche.id}`

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <h4 className="m-0">
        <button
          type="button"
          onClick={onBascule}
          aria-expanded={ouverte}
          aria-controls={idContenu}
          data-testid={`aide-fiche-${fiche.id}`}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
        >
          <span className="mt-0.5 shrink-0 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-brand-700">
            {fiche.id}
          </span>
          <span className="flex-1 text-sm font-semibold text-ink">
            <Texte>{fiche.titre}</Texte>
          </span>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted">
            {ouverte ? '−' : '+'}
          </span>
        </button>
      </h4>

      {ouverte && (
        <div id={idContenu} className="space-y-3 border-t border-line px-4 pb-4 pt-3 text-sm text-ink">
          {fiche.texte && <p className="m-0"><Texte>{fiche.texte}</Texte></p>}

          {fiche.etapes && (
            <ol className="m-0 list-decimal space-y-2 pl-5 marker:text-ink-muted">
              {fiche.etapes.map((etape, index) => (
                <li key={index}><Texte>{etape}</Texte></li>
              ))}
            </ol>
          )}

          {fiche.formule && (
            <p className="m-0 overflow-x-auto whitespace-nowrap rounded border border-line bg-surface-2 px-3 py-2 font-mono text-xs">
              {fiche.formule}
            </p>
          )}

          {fiche.texteFin && <p className="m-0"><Texte>{fiche.texteFin}</Texte></p>}

          {fiche.retenir && (
            <div className="rounded bg-surface-2 px-3 py-2.5">
              <p className="m-0 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-ink-muted">
                {fiche.retenir.titre}
              </p>
              <p className="m-0 mt-1 text-ink-muted"><Texte>{fiche.retenir.texte}</Texte></p>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function AidePanel({ open, onClose }) {
  const { pathname } = useLocation()
  const [ouverte, setOuverte] = useState(null)

  // Le groupe de l'endroit où l'on se tient passe devant. Une caissière bloquée
  // dans l'historique ne doit pas faire défiler sept fiches de saisie d'abord.
  const groupes = useMemo(() => {
    return groupesOrdonnes(pathname).map((cle) => ({
      cle,
      ...TITRES_GROUPES[cle],
      fiches: FICHES.filter((fiche) => fiche.groupe === cle),
    }))
  }, [pathname])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Aide"
      description="Les gestes du quotidien, un par fiche. Ouvre celle qui te bloque."
      testId="panneau-aide"
      largeur="max-w-2xl"
      spacious
    >
      <div className="space-y-5">
        {groupes.map((groupe) => (
          <section key={groupe.cle} data-testid={`aide-groupe-${groupe.cle}`}>
            <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-1.5">
              <h3 className="m-0 text-sm font-bold text-ink">{groupe.titre}</h3>
              <span className="text-xs text-ink-muted">{groupe.ou}</span>
            </div>

            <ul className="m-0 list-none space-y-2 p-0">
              {groupe.fiches.map((fiche) => (
                <Fiche
                  key={fiche.id}
                  fiche={fiche}
                  ouverte={ouverte === fiche.id}
                  // Une seule ouverte à la fois : la réponse qu'on lit reste la
                  // seule chose à l'écran.
                  onBascule={() => setOuverte((courante) => (courante === fiche.id ? null : fiche.id))}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export default AidePanel
