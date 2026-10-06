import { ArrowRight } from 'lucide-react'
import Dialog from '../ui/Dialog'
import { formatInstant, getClientName } from '../../utils/helpers.js'

/**
 * Le journal des corrections d'une transaction.
 *
 * CE QU'IL MONTRE, ET POURQUOI SI PEU
 * ───────────────────────────────────
 * Une ligne par correction de MONTANT, dans l'ordre où elles ont eu lieu. Pas
 * de diff de tous les champs : « 50 000 → 45 000 » se relit sans mode d'emploi,
 * là où un tableau de sept colonnes dont six inchangées demanderait au gérant
 * de chercher la seule qui a bougé. Le montant est le chiffre qui engage la
 * boutique ; c'est celui-là qu'on doit pouvoir justifier.
 *
 * L'ORDRE EST CHRONOLOGIQUE, PAS INVERSE
 * ──────────────────────────────────────
 * Contrairement à la corbeille et à l'historique, qui montrent le plus récent
 * en premier. Ici on lit une HISTOIRE : « saisi à 50 000, corrigé à 45 000,
 * puis à 47 000 ». La renverser obligerait à lire de bas en haut pour
 * comprendre l'enchaînement — et le montant actuel est déjà visible sur la
 * ligne d'où l'on vient.
 */
function ModificationsDialog({ transaction, open, onClose }) {
  const journal = Array.isArray(transaction?.modifications) ? transaction.modifications : []

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Modifications"
      description={transaction ? `${getClientName(transaction.client)} · ${transaction.type}` : undefined}
      largeur="max-w-lg"
      testId="modifications-dialog"
    >
      {journal.length === 0 ? (
        <p className="text-sm text-ink-muted">Cette transaction n’a jamais été corrigée.</p>
      ) : (
        <ol className="space-y-3" data-testid="journal-modifications">
          {journal.map((entree, index) => (
            <li
              key={`${entree.at?.seconds ?? index}-${index}`}
              className="rounded-lg border border-line px-4 py-3"
            >
              {/* Les deux montants se comparent chiffre à chiffre, donc même
                  police, même alignement, et la flèche entre les deux porte le
                  sens — pas la couleur seule. */}
              <div className="flex items-center gap-3 font-mono text-base tabular-nums">
                <span className="text-ink-muted line-through">
                  {(Number(entree.avant) || 0).toLocaleString('fr-FR')}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="font-semibold text-ink">
                  {(Number(entree.apres) || 0).toLocaleString('fr-FR')}
                </span>
                <span className="text-sm font-sans text-ink-muted">FCFA</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {formatInstant(entree.at)}
                {entree.byName ? ` · ${entree.byName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

export default ModificationsDialog
