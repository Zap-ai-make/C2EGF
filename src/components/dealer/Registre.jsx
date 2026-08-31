import { TABLE_WRAP, TABLE_HEAD } from '../../constants/workspaceTheme'

/**
 * Le registre — le seul dessin de tableau de l'espace dealer.
 *
 * POURQUOI UN COMPOSANT, ET PAS TROIS TABLEAUX BIEN PEIGNÉS
 * ─────────────────────────────────────────────────────────
 * Les trois files du dealer — ravitaillements, retours, historique — montrent
 * la même chose : une boutique, un type, un montant, une date. Elles avaient
 * pourtant trois tableaux écrits à la main, avec trois jeux de filets gris de
 * trois densités, trois enveloppes différentes (ombre, bordure, anneau) et le
 * même fond vert clair d'en-tête, hors palette dans les trois.
 *
 * ⚠ Les classes remplacées ne sont volontairement PAS écrites en toutes
 *   lettres ci-dessus. Tailwind v4 extrait ses utilitaires du texte brut des
 *   fichiers, COMMENTAIRES COMPRIS : documenter ce qu'on vient de retirer
 *   suffit à le faire renaître dans le CSS livré. Ici, l'espace admin emploie
 *   encore ce vert, si bien que la règle serait émise de toute façon — mais
 *   c'est précisément le genre de dépendance qui disparaît sans prévenir, et
 *   le jour où elle disparaît le commentaire deviendrait la seule raison pour
 *   laquelle une couleur morte survit. `SkeletonList.jsx` documente le même
 *   piège pour l'animation de pulsation, où il avait mordu pour de bon.
 *
 * Le problème n'est pas qu'elles divergeaient : c'est qu'elles ne pouvaient PAS
 * converger. Aligner les montants à droite demandait la même retouche à six
 * endroits — trois en-têtes et trois corps — et il suffisait d'en oublier un
 * pour que la colonne se décale sans que rien ne le signale.
 *
 * L'ALIGNEMENT VIENT DE LA COLONNE, PAS DE LA CELLULE
 * ──────────────────────────────────────────────────
 * C'est le seul point réellement structurel ici. Une colonne déclare une fois
 * qu'elle porte des `nombres` ; l'en-tête ET les cellules en tirent leur
 * alignement et leurs chiffres tabulaires. Un montant aligné à droite sous un
 * intitulé aligné à gauche est le défaut classique des tableaux de chiffres, et
 * il devient ici inexprimable.
 *
 * CE QUE CE COMPOSANT NE FAIT PAS
 * ───────────────────────────────
 * Il ne charge rien, ne filtre rien, ne pagine rien et ne connaît aucun état
 * vide. Les trois écrans ont des vides DIFFÉRENTS — « rien encore » n'est pas
 * « rien qui corresponde » — et c'est à eux de le dire. Un composant qui aurait
 * avalé l'état vide aurait forcé un texte unique, donc faux deux fois sur trois.
 */

/**
 * @typedef {object} Colonne
 * @property {string}  cle      identifiant de la cellule dans la ligne
 * @property {string}  titre    intitulé affiché
 * @property {boolean} [nombre] chiffres tabulaires, alignés à droite (en-tête compris)
 * @property {boolean} [fin]    aligné à droite sans être un nombre (les actions)
 * @property {boolean} [discret] texte secondaire (les dates)
 */

const alignement = (colonne) => (colonne.nombre || colonne.fin ? 'text-right' : 'text-left')

function Registre({
  colonnes,
  lignes,
  cle,
  cellules,
  libelle,
  testId,
  testIdLigne,
}) {
  return (
    <div className={TABLE_WRAP} data-testid={testId}>
      <table className="min-w-full divide-y divide-line/60 text-sm">
        {libelle && <caption className="sr-only">{libelle}</caption>}
        <thead className={TABLE_HEAD}>
          <tr>
            {colonnes.map(colonne => (
              <th
                key={colonne.cle}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${alignement(colonne)}`}
              >
                {colonne.titre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/40">
          {lignes.map(ligne => {
            const contenu = cellules(ligne)
            return (
              <tr
                key={cle(ligne)}
                className="transition-colors hover:bg-brand-50"
                data-testid={testIdLigne ? testIdLigne(ligne) : undefined}
              >
                {colonnes.map(colonne => (
                  <td
                    key={colonne.cle}
                    className={`whitespace-nowrap px-4 py-3 ${alignement(colonne)} ${
                      colonne.nombre ? 'font-medium tabular-nums text-ink' : ''
                    } ${colonne.discret ? 'text-xs text-ink-muted' : ''}`}
                  >
                    {contenu[colonne.cle]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Le squelette du registre — DÉRIVÉ DES MÊMES COLONNES.
 *
 * `SkeletonTable` prenait un nombre de colonnes en argument, ce qui laissait
 * l'appelant se tromper : `DealerTransfers` en annonçait 5 pour un tableau de 5
 * (juste), `DealerHistory` 6 pour un tableau de 7 (faux). La page sautait donc
 * d'une colonne à l'arrivée des données. Ici l'argument n'existe plus : le
 * squelette lit la même liste que le tableau, il ne peut plus en différer.
 */
export function SqueletteRegistre({ colonnes, lignes = 5 }) {
  return (
    <div className={TABLE_WRAP} aria-busy="true" aria-label="Chargement…">
      <table className="min-w-full divide-y divide-line/60 text-sm">
        <thead className={TABLE_HEAD}>
          <tr>
            {colonnes.map(colonne => (
              <th
                key={colonne.cle}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${alignement(colonne)}`}
              >
                {colonne.titre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/40">
          {Array.from({ length: lignes }).map((_, i) => (
            <tr key={i} aria-hidden="true">
              {colonnes.map((colonne, j) => (
                <td key={colonne.cle} className="px-4 py-3">
                  <div
                    className={`h-4 rounded bg-gray-200 motion-safe:animate-pulse ${
                      colonne.nombre || colonne.fin ? 'ml-auto' : ''
                    }`}
                    style={{ width: `${55 + ((i + j) % 3) * 15}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default Registre
