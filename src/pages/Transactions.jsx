import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClients } from '../hooks/useClients'
import { useAuth } from '../context/AuthContext'
import TransactionForm from '../components/transactions/TransactionForm'
import TransactionTable from '../components/transactions/TransactionTable'
import DealerTransferForm from '../components/transactions/DealerTransferForm'
import CollaborationsPanel from '../components/transactions/CollaborationsPanel'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import PageHeader from '../components/ui/PageHeader'
import { COLLABORATIONS_ENABLED } from '../constants/collaborationConstants'
import { useIncomingCollaborationsCount } from '../hooks/useIncomingCollaborationsCount'

/**
 * Transactions — trois modes, et c'est l'URL qui décide.
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

const MODES = ['client', 'dealer', ...(COLLABORATIONS_ENABLED ? ['collaborations'] : [])]

const LIBELLES = {
  client: 'Transaction client',
  dealer: 'Opération dealer',
  collaborations: 'Collaborations',
}

function Transactions() {
  const { clients } = useClients()
  const { userProfile } = useAuth()
  const [params, setParams] = useSearchParams()
  const storeId = userProfile?.storeId ?? null
  const compteurRecues = useIncomingCollaborationsCount(storeId)

  const demande = params.get('tab')
  const mode = MODES.includes(demande) ? demande : MODES[0]
  const sousOnglet = params.get('sub') === 'incoming' ? 'incoming' : 'outgoing'

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
      <PageHeader title="Transactions" />

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
      </div>

      {mode === 'client' && (
        <div className="space-y-8">
          <ErrorBoundary>
            <TransactionForm clients={clients} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TransactionTable />
          </ErrorBoundary>
        </div>
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
    </div>
  )
}

export default Transactions
