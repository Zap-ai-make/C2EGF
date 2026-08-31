import { formatCurrency } from '../../utils/formatCurrency'
import Dialog from '../ui/Dialog'
import Registre from './Registre'

/**
 * Le détail de l'argent dehors, boutique par boutique.
 *
 * POURQUOI UN CALQUE ET NON UN ÉCRAN
 * ──────────────────────────────────
 * C'est une réponse à une question qu'on vient de se poser en lisant un
 * chiffre — « chez qui ? » — et à laquelle on veut revenir en une touche. Une
 * page ferait perdre le contexte du rapprochement, qui est précisément ce
 * qu'on était en train de lire.
 *
 * ⚠ `Dialog` EST RÉUTILISÉ, ET CE N'EST PAS UNE ÉCONOMIE. Sept écrans du dépôt
 *   posent un `role="dialog"` fait main, et aucun ne piège le focus : la
 *   tabulation continue derrière le calque, sur un écran qu'on ne voit plus.
 *   `Dialog` le fait, gère Échap, rend le focus au déclencheur, et refuse de se
 *   fermer sur un clic au voile — ce dernier point volontairement, parce que
 *   ces calques portent des montants d'argent. Tenu par tc-123, douze tests.
 *
 * ⚠ AUCUNE LECTURE ICI. Les lignes viennent de l'agrégat déjà chargé par
 *   l'accueil : ouvrir ce détail ne coûte pas une requête de plus, et le
 *   chiffre du calque ne peut pas diverger de celui de la ligne qui l'ouvre.
 */

const COLONNES = [
  { cle: 'boutique', titre: 'Boutique' },
  { cle: 'depots', titre: 'Dépôts non terminés', nombre: true },
  { cle: 'retraits', titre: 'Retraits non terminés', nombre: true },
  { cle: 'dehors', titre: 'Dehors', nombre: true },
]

function DehorsParBoutique({ open, onClose, dehors }) {
  const lignes = dehors?.parBoutique ?? []

  const cellules = (b) => ({
    boutique: <span className="font-medium text-ink">{b.name ?? b.storeId}</span>,
    depots: formatCurrency(b.depots),
    retraits: formatCurrency(b.retraits),
    // Le solde net est ce qu'on vient chercher : il porte le poids, et le signe
    // se lit — un négatif veut dire que la boutique doit plus qu'on ne lui doit.
    dehors: (
      <span className={b.dehors < 0 ? 'font-semibold text-warn' : 'font-semibold text-ink'}>
        {formatCurrency(b.dehors)}
      </span>
    ),
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="L’argent dehors, boutique par boutique"
      description="Les transactions non terminées : ce que les clients doivent aux boutiques, moins ce que les boutiques doivent à leurs clients. Un règlement partiel n’est compté que pour son reste dû."
      testId="dialogue-dehors"
      largeur="max-w-3xl"
    >
      {lignes.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted" data-testid="dehors-vide">
          Aucune boutique n’a d’opération en cours. Tout ce qui a été engagé au
          comptoir a été réglé.
        </p>
      ) : (
        <>
          <Registre
            colonnes={COLONNES}
            lignes={lignes}
            cle={(b) => b.storeId}
            cellules={cellules}
            libelle="Argent dehors par boutique"
            testId="dehors-table"
            testIdLigne={(b) => `dehors-row-${b.storeId}`}
          />

          <p className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
            <span className="text-ink-muted">
              Total sur {lignes.length} boutique{lignes.length > 1 ? 's' : ''}
            </span>
            <span className="font-semibold tabular-nums text-ink" data-testid="dehors-total">
              {formatCurrency(dehors?.dehors)}
            </span>
          </p>
        </>
      )}

      {/* Un total incomplet ne s'annonce jamais complet — même règle que la
          liste des caisses. Deux causes distinctes, dites séparément : un
          montant qu'on n'a pas su lire, et une opération rattachée à une
          boutique qui n'est plus en service. */}
      {dehors?.illisibles > 0 && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn" role="status">
          {dehors.illisibles > 1
            ? `${dehors.illisibles} opérations n’ont pas pu être lues : elles n’entrent dans aucun total.`
            : '1 opération n’a pas pu être lue : elle n’entre dans aucun total.'}
        </p>
      )}
      {dehors?.horsReseau > 0 && (
        <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-ink-muted" role="status">
          {dehors.horsReseau > 1
            ? `${dehors.horsReseau} opérations appartiennent à des boutiques qui ne sont plus en service. Elles sont écartées du total, comme leurs caisses le sont.`
            : '1 opération appartient à une boutique qui n’est plus en service. Elle est écartée du total, comme sa caisse l’est.'}
        </p>
      )}
    </Dialog>
  )
}

export default DehorsParBoutique
