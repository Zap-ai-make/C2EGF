import { useCallback, useState } from 'react'
import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'
import { useWindowedRows } from '../../hooks/useWindowedRows.js'
import EmptyState from '../ui/EmptyState.jsx'
import { History } from 'lucide-react'
import StatusBadge from '../ui/StatusBadge.jsx'
import Dialog from '../ui/Dialog.jsx'
import ModificationsDialog from './ModificationsDialog.jsx'
import { STORE_HISTORY_CONFIG } from '../../constants/storeWorkspace.js'

/**
 * Les deux colonnes d'opérateur, affichées seulement si le profil le demande.
 *
 * Chez C2EGF toute la boutique opère sous un compte unique : « C2EGF SIEGE »
 * et son adresse se répétaient à l'identique sur chaque ligne, occupant deux
 * colonnes pleine largeur qui repoussaient les actions hors de l'écran.
 *
 * Rien n'est effacé pour autant : `operatorId`, `operatorName` et
 * `operatorEmail` restent écrits sur chaque transaction, l'export XLSM
 * continue de porter la colonne « Email utilisateur », et l'audit serveur
 * garde l'uid de l'auteur de chaque mouvement. Seul l'AFFICHAGE recule. Le
 * jour où chaque caissière aura son compte, `operatorColumns: true` les
 * rallume sans migration.
 */
const COLONNES_OPERATEUR = STORE_HISTORY_CONFIG.operatorColumns !== false

// Au-delà de ce nombre de lignes, on active le fenêtrage (virtualisation).
// En dessous, le rendu est strictement identique à l'historique (aucune régression).
const VIRTUALIZE_THRESHOLD = 60
// Hauteur de repli d'une ligne (px) tant que la mesure réelle n'est pas disponible.
const DEFAULT_ROW_HEIGHT = 49

/**
 * Le ton d'un statut. La pastille était `bg-success-soft` en dur : une opération
 * ANNULÉE s'affichait en vert, tout comme une opération validée. La couleur
 * affirmait le contraire du texte qu'elle entourait.
 */
const tonStatut = (statut) => {
  const s = String(statut || 'Validée').toLowerCase()
  if (s.includes('annul') || s.includes('rejet') || s.includes('échou') || s.includes('echou')) return 'rejected'
  if (s.includes('valid') || s.includes('termin')) return 'confirmed'
  return 'pending'
}

/**
 * Un règlement inachevé : des tranches encaissées, un reste à payer.
 * Ni supprimable ni réouvrable — les tranches déjà passées resteraient
 * orphelines, et rien ne sait les recoller.
 */
const reglementInacheve = (transaction) =>
  transaction?.settlementStatus === 'partial' || (Number(transaction?.remainingAmount) || 0) > 0

const RAISON_PARTIEL = 'Transaction partiellement réglée : corrigez-la par un remboursement.'

/**
 * Pourquoi un bouton est barré — ou `null` s'il ne l'est pas.
 *
 * Le serveur refuse déjà ces lignes ; on duplique la règle ici pour que le
 * refus se lise AVANT le clic, avec sa raison, plutôt qu'après sous forme de
 * message d'erreur. Une seule fonction sert l'attribut `disabled` ET
 * l'infobulle : les voir diverger est trop facile quand ils sont écrits à deux
 * endroits.
 *
 * Les deux boutons partagent aujourd'hui le même refus — mais pas la même
 * fonction, et c'est délibéré. L'absence de mode de règlement a bloqué la
 * réouverture le temps que la revalidation apprenne à rejouer les deux jambes
 * d'une validation directe ; d'autres asymétries viendront. Les garder
 * distinctes évite d'avoir à les redécoudre.
 */
const raisonNonSupprimable = (transaction) =>
  reglementInacheve(transaction) ? RAISON_PARTIEL : null

const raisonNonModifiable = (transaction) =>
  reglementInacheve(transaction) ? RAISON_PARTIEL : null

/**
 * `onReopen` est une PROP, alors que la suppression passe par le contexte.
 * L'asymétrie est voulue : rouvrir a une conséquence de navigation — le
 * formulaire vit sur /transactions, pas ici —, et ce tableau n'a pas à
 * connaître les routes de l'application. `Historique.jsx` est déjà couplé au
 * routeur par `useSearchParams` ; lui confier le déplacement n'ajoute rien à sa
 * charge, là où `useNavigate()` ici rendrait le tableau immontable sans
 * routeur. TC-091 le monte précisément comme une unité nue.
 */
function HistoriqueTable({ transactions = [], onReopen }) {
  const { getTransactionStyles, trashTransaction } = useTransactions()
  const { themeClasses } = useTheme()
  const [aSupprimer, setASupprimer] = useState(null)
  const [journalOuvert, setJournalOuvert] = useState(null)
  const [enCours, setEnCours] = useState(false)
  const allTransactions = transactions

  const rouvrir = useCallback(async (transaction) => {
    if (!onReopen) return
    setEnCours(true)
    try {
      await onReopen(transaction)
    } catch {
      // L'erreur est déjà posée dans le contexte, qui l'affiche. Rien à
      // ajouter ici, mais il faut relâcher le verrou.
    } finally {
      setEnCours(false)
    }
  }, [onReopen])

  const confirmerSuppression = useCallback(async () => {
    if (!aSupprimer) return
    setEnCours(true)
    try {
      await trashTransaction(aSupprimer.id)
      setASupprimer(null)
    } catch {
      // Idem : l'erreur remonte par le contexte. On garde le modal ouvert pour
      // que le gérant voie que son geste n'a pas abouti.
    } finally {
      setEnCours(false)
    }
  }, [aSupprimer, trashTransaction])

  const headers = [
    'Date & heure',
    'Client',
    'Type',
    // « Réseau » retiré : une seule valeur possible, répétée sur chaque ligne.
    'Code',
    'Montant',
    'Statut',
    ...(COLONNES_OPERATEUR ? ['Utilisateur', 'Email utilisateur'] : []),
    'Actions'
  ]

  const borderClass = themeClasses.tableBorder
  const isVirtualized = allTransactions.length > VIRTUALIZE_THRESHOLD

  const { containerRef, rowRef, onScroll, startIndex, endIndex, topPad, bottomPad } =
    useWindowedRows({ itemCount: allTransactions.length, defaultRowHeight: DEFAULT_ROW_HEIGHT })

  // Une seule définition du markup de ligne, partagée par les deux branches.
  const renderRow = (transaction, index, ref) => {
    const styles = getTransactionStyles(transaction.type)
    return (
      <tr
        ref={ref}
        key={transaction.id || `${transaction.clientId || 'transaction'}-${transaction.date || index}-${index}`}
        className="border-b border-line/60 transition-colors hover:bg-brand-50/60"
      >
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {formatTransactionDateTime(transaction)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {getClientName(transaction.client)}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-base font-medium ${styles.textColor}`}>
          {transaction.type || '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.code || '-'}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-right text-base font-medium tabular-nums ${styles.textColor}`}>
          {transaction.montant ? `${(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA` :
           transaction.amount ? `${transaction.amount} FCFA` : '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          <StatusBadge status={tonStatut(transaction.statut)} label={transaction.statut || 'Validée'} />
        </td>
        {COLONNES_OPERATEUR && (
          <>
            <td className="whitespace-nowrap px-4 py-3 text-base">
              {transaction.operatorName || transaction.userName || '-'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-base">
              {transaction.operatorEmail || transaction.userEmail || '-'}
            </td>
          </>
        )}
        <td className="whitespace-nowrap px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            {/* « Modification » n'apparaît que si le journal n'est pas vide :
                un bouton présent sur chaque ligne obligerait à cliquer pour
                découvrir qu'il n'y a rien à voir. */}
            {Array.isArray(transaction.modifications) && transaction.modifications.length > 0 && (
              <button
                type="button"
                onClick={() => setJournalOuvert(transaction)}
                data-testid="ouvrir-modifications"
                className="rounded border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Modification
                <span className="ml-1 tabular-nums">({transaction.modifications.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => rouvrir(transaction)}
              disabled={enCours || Boolean(raisonNonModifiable(transaction))}
              title={raisonNonModifiable(transaction) || undefined}
              data-testid="modifier-historique"
              className="rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Modifier
            </button>

            <button
              type="button"
              onClick={() => setASupprimer(transaction)}
              disabled={enCours || Boolean(raisonNonSupprimable(transaction))}
              title={raisonNonSupprimable(transaction) || undefined}
              data-testid="supprimer-historique"
              className="rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Supprimer
            </button>
          </div>
        </td>
      </tr>
    )
  }

  // Lignes à rendre : toute la liste (court) ou la seule fenêtre visible (long).
  const visibleRows = isVirtualized
    ? allTransactions.slice(startIndex, endIndex)
    : allTransactions

  if (allTransactions.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={History}
          title="Aucune transaction dans l'historique"
          message="Aucune opération ne correspond à la période et aux filtres choisis."
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div
        ref={containerRef}
        onScroll={isVirtualized ? onScroll : undefined}
        className={`overflow-x-auto ${isVirtualized ? 'overflow-y-auto max-h-[70vh]' : ''} rounded-lg border ${borderClass}`}
      >
        <table className="w-full border-collapse min-w-max">
          <thead className={isVirtualized ? 'sticky top-0 z-10' : ''}>
            <tr className={themeClasses.tableHeader}>
              {headers.map((header, index) => (
                <th
                  key={index}
                  // Une colonne de montants s'aligne à droite, en-tête compris :
                  // sinon le titre flotte au-dessus de chiffres qui, eux, se
                  // comparent bord à bord.
                  className={`whitespace-nowrap px-4 py-3 text-base font-medium ${themeClasses.text} ${
                    header === 'Montant' || header === 'Actions' ? 'text-right' : 'text-left'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              <>
                {isVirtualized && topPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: topPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
                {visibleRows.map((transaction, i) =>
                  renderRow(transaction, startIndex + i, isVirtualized && i === 0 ? rowRef : undefined)
                )}
                {isVirtualized && bottomPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: bottomPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* La suppression rend un montant aux soldes et sort la ligne de
          l'historique : elle mérite une confirmation qui dit ce qu'elle fait,
          pas un « Êtes-vous sûr ? » qui n'informe personne. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onClose={() => setASupprimer(null)}
        title="Supprimer cette transaction ?"
        testId="confirmer-suppression-historique"
        footer={(
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setASupprimer(null)}
              className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmerSuppression}
              disabled={enCours}
              data-testid="confirmer-supprimer"
              className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {enCours ? 'Suppression…' : 'Supprimer'}
            </button>
          </div>
        )}
      >
        {aSupprimer && (
          <div className="space-y-3 text-sm text-ink">
            <p>
              <span className="font-medium">{getClientName(aSupprimer.client)}</span>
              {' · '}{aSupprimer.type}
              {' · '}
              <span className="font-mono tabular-nums">
                {(Number(aSupprimer.montant) || 0).toLocaleString('fr-FR')} FCFA
              </span>
            </p>
            <p className="text-ink-muted">
              Le montant sera rendu aux soldes et la ligne ira dans la corbeille,
              où elle restera lisible. Elle ne pourra pas être restaurée.
            </p>
          </div>
        )}
      </Dialog>

      <ModificationsDialog
        transaction={journalOuvert}
        open={Boolean(journalOuvert)}
        onClose={() => setJournalOuvert(null)}
      />
    </div>
  )
}

export default HistoriqueTable
