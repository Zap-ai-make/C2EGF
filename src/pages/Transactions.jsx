import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, PackagePlus, Eraser } from 'lucide-react'
import { useClients } from '../hooks/useClients'
import { useAuth } from '../context/AuthContext'
import TransactionForm from '../components/transactions/TransactionForm'
import RavitaillementPanel from '../components/transactions/RavitaillementPanel'
import ViderSoldesForm from '../components/transactions/ViderSoldesForm'
import TransactionTable from '../components/transactions/TransactionTable'
import DealerTransferForm from '../components/transactions/DealerTransferForm'
import CollaborationsPanel from '../components/transactions/CollaborationsPanel'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import PageHeader from '../components/ui/PageHeader'
import Dialog from '../components/ui/Dialog'
import { useTransactions } from '../context/transactions.jsx'
import { ravitaillementsEnCours } from '../utils/ravitaillement.js'
import { COLLABORATIONS_ENABLED } from '../constants/collaborationConstants'
import { STORE_TRANSACTION_VISIBILITY } from '../constants/storeWorkspace.js'
import { useIncomingCollaborationsCount } from '../hooks/useIncomingCollaborationsCount'

/**
 * Transactions — les modes visibles du profil, et c'est l'URL qui décide.
 *
 * POURQUOI L'URL PLUTÔT QU'UN useState
 * ────────────────────────────────────
 * Le mode vivait dans l'état local : rechargeable nulle part, partageable
 * nulle part, et surtout inatteignable depuis l'extérieur. Or le compteur de la
 * barre de navigation doit pouvoir DÉPOSER le gérant sur la file des
 * collaborations reçues, en un clic. Un état local ne s'adresse pas ; une URL,
 * si — `?tab=collaborations&sub=incoming`.
 *
 * Effet de bord bienvenu : la file qu'on consulte dix fois par jour se met en
 * favori, et le bouton « précédent » du navigateur redevient sensé.
 *
 * LE MODE INCONNU RETOMBE SUR LE PREMIER
 * ──────────────────────────────────────
 * Une adresse tapée de travers, ou un lien vers le module désactivé, ne doit
 * pas rendre un écran vide : `?tab=nimportequoi` affiche la transaction client,
 * comme une visite sans paramètre.
 */

const MODES = [
  'client',
  ...(STORE_TRANSACTION_VISIBILITY.dealerOperations ? ['dealer'] : []),
  ...(COLLABORATIONS_ENABLED && STORE_TRANSACTION_VISIBILITY.collaborations
    ? ['collaborations']
    : []),
]

const LIBELLES = {
  client: 'Transaction client',
  dealer: 'Opération dealer',
  collaborations: 'Collaborations',
}

function Transactions() {
  const { clients } = useClients()
  const { userProfile } = useAuth()
  const {
    pendingTransactions = [],
    completedTransactions = [],
    editingTransaction,
    clearEditTransaction,
  } = useTransactions()
  const [params, setParams] = useSearchParams()
  const [formulaireOuvert, setFormulaireOuvert] = useState(false)
  const [ravitaillementOuvert, setRavitaillementOuvert] = useState(false)
  const [viderOuvert, setViderOuvert] = useState(false)
  const storeId = userProfile?.storeId ?? null
  const compteurRecues = useIncomingCollaborationsCount(
    storeId,
    STORE_TRANSACTION_VISIBILITY.collaborations,
  )

  // Le badge dit « tu dois encore quelque chose à quelqu'un ». Il tient parce
  // qu'il redescend réellement à zéro : il n'y a pas de commission entre
  // franchises de la même entreprise, donc le reste dû d'une livraison atteint
  // zéro exactement. Un compteur qui ne redescend jamais n'est plus lu.
  const ravitaillementsDus = useMemo(
    () => ravitaillementsEnCours(completedTransactions).length,
    [completedTransactions],
  )

  const demande = params.get('tab')
  const mode = MODES.includes(demande) ? demande : MODES[0]
  const sousOnglet = params.get('sub') === 'incoming' ? 'incoming' : 'outgoing'

  const transactionsEnAttente = useMemo(() => {
    const vues = new Set()
    return pendingTransactions.filter((transaction) => {
      if (vues.has(transaction.id)) return false
      vues.add(transaction.id)
      return true
    })
  }, [pendingTransactions])

  useEffect(() => {
    if (editingTransaction) setFormulaireOuvert(true)
  }, [editingTransaction])

  const fermerFormulaire = useCallback(() => {
    clearEditTransaction?.()
    setFormulaireOuvert(false)
  }, [clearEditTransaction])

  // `replace` : basculer d'onglet n'est pas une navigation qu'on veut retrouver
  // dans l'historique du navigateur à chaque clic.
  const allerA = useCallback((prochainMode, prochainSous) => {
    const suivant = { tab: prochainMode }
    if (prochainMode === 'collaborations') suivant.sub = prochainSous ?? sousOnglet
    setParams(suivant, { replace: true })
  }, [setParams, sousOnglet])

  const tabClass = (actif) =>
    `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
      actif ? 'bg-brand-500 text-white' : 'border border-line bg-surface text-ink hover:bg-brand-50'
    }`

  return (
    <div>
      <PageHeader
        title="Transactions"
        actions={mode === 'client' ? (
          <button
            type="button"
            onClick={() => setFormulaireOuvert(true)}
            className="inline-flex items-center gap-2 rounded bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            Enregistrer une transaction
          </button>
        ) : undefined}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {MODES.map((cle) => (
          <button
            key={cle}
            type="button"
            className={tabClass(mode === cle)}
            onClick={() => allerA(cle)}
            data-testid={`onglet-${cle}`}
          >
            {LIBELLES[cle]}
            {cle === 'client' && transactionsEnAttente.length > 0 && (
              <span
                className={`inline-flex min-w-[1.2rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  mode === cle ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-700'
                }`}
                aria-label={`${transactionsEnAttente.length} transaction${transactionsEnAttente.length > 1 ? 's' : ''} non terminée${transactionsEnAttente.length > 1 ? 's' : ''}`}
              >
                {transactionsEnAttente.length > 99 ? '99+' : transactionsEnAttente.length}
              </span>
            )}
            {cle === 'collaborations' && compteurRecues > 0 && (
              <span
                className={`inline-flex min-w-[1.2rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  mode === cle ? 'bg-white text-brand-600' : 'bg-danger text-white'
                }`}
                aria-label={`${compteurRecues} collaboration${compteurRecues > 1 ? 's' : ''} reçue${compteurRecues > 1 ? 's' : ''} en attente`}
                data-testid="badge-onglet-collaborations"
              >
                {compteurRecues > 99 ? '99+' : compteurRecues}
              </span>
            )}
          </button>
        ))}

        {/* Le ravitaillement n'est pas un mode d'affichage mais un geste : il
            vit dans la même rangée pour rester sous la main, séparé par la
            marge et distingué par le trait plutôt que par le remplissage. */}
        <button
          type="button"
          onClick={() => setRavitaillementOuvert(true)}
          data-testid="ouvrir-ravitaillement"
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-brand-500 bg-surface px-4 py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <PackagePlus className="h-4 w-4" aria-hidden="true" />
          Ravitaillement
          {ravitaillementsDus > 0 && (
            <span
              className="inline-flex min-w-[1.2rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-brand-100 text-brand-700"
              aria-label={`${ravitaillementsDus} ravitaillement${ravitaillementsDus > 1 ? 's' : ''} à rendre`}
              data-testid="badge-ravitaillement"
            >
              {ravitaillementsDus > 99 ? '99+' : ravitaillementsDus}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setViderOuvert(true)}
          data-testid="ouvrir-vider-soldes"
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
          Vider les soldes
        </button>
      </div>

      {mode === 'client' && (
        <ErrorBoundary>
          <TransactionTable />
        </ErrorBoundary>
      )}

      {mode === 'dealer' && (
        <ErrorBoundary>
          <DealerTransferForm />
        </ErrorBoundary>
      )}

      {mode === 'collaborations' && (
        <ErrorBoundary>
          <CollaborationsPanel
            storeId={storeId}
            clients={clients}
            sousOnglet={sousOnglet}
            onChangeSousOnglet={(prochain) => allerA('collaborations', prochain)}
            compteurRecues={compteurRecues}
          />
        </ErrorBoundary>
      )}

      {/* Le bouton ouvrait directement la saisie : la boutique pouvait
          déclarer ce qu'elle recevait, jamais ce qu'elle rendait. La liste vient
          donc devant, et la saisie derrière un bouton — on ouvre cet écran dix
          fois pour rendre, une fois pour déclarer. */}
      <ErrorBoundary>
        <RavitaillementPanel
          open={ravitaillementOuvert}
          onClose={() => setRavitaillementOuvert(false)}
        />
      </ErrorBoundary>

      <Dialog
        open={viderOuvert}
        onClose={() => setViderOuvert(false)}
        title="Vider les soldes"
        description="La boutique repart de zéro."
        testId="vider-soldes-dialog"
      >
        <ErrorBoundary>
          <ViderSoldesForm
            onComplete={() => setViderOuvert(false)}
            onCancel={() => setViderOuvert(false)}
          />
        </ErrorBoundary>
      </Dialog>

      <Dialog
        open={formulaireOuvert}
        onClose={fermerFormulaire}
        title={editingTransaction ? 'Modifier la transaction' : 'Enregistrer une transaction'}
        /* `max-w-5xl` étirait la saisie sur toute la largeur de l'écran : le
           montant, aligné à droite, finissait à un demi-mètre du libellé qui
           l'annonce. Une saisie de quatre champs n'a pas besoin de cette place. */
        largeur="max-w-xl"
        spacious
        testId="transaction-dialog"
      >
        <ErrorBoundary>
          <TransactionForm
            clients={clients}
            embedded
            onComplete={fermerFormulaire}
            onCancel={fermerFormulaire}
          />
        </ErrorBoundary>
      </Dialog>
    </div>
  )
}

export default Transactions
