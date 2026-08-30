import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import DateFilter from '../components/historique/DateFilter'
import ClientSearch from '../components/historique/ClientSearch'
import HistoriqueTable from '../components/historique/HistoriqueTable'
import ActionButtons from '../components/historique/ActionButtons'
import DailyPagination from '../components/historique/DailyPagination'
import {
  ArchiveCollaborations,
  ArchiveDettes,
  ArchiveDealer,
} from '../components/historique/HistoriqueArchives'
import PageHeader from '../components/ui/PageHeader'
import { useHistoriqueFilters } from '../hooks/useHistoriqueFilters'
import { useAuth } from '../context/AuthContext'
import { COLLABORATIONS_ENABLED } from '../constants/collaborationConstants'

/**
 * Historique — quatre sources, un seul endroit où l'on relit.
 *
 * L'ONGLET « CLIENTS » N'A PAS BOUGÉ D'UN PIXEL
 * ─────────────────────────────────────────────
 * C'est l'écran le plus utilisé de l'application, et TC-116 fige son
 * comportement — jusqu'à ses ABSENCES : pas de « Voir plus », pas de taille de
 * page, ses pluriels, son apostrophe droite. Ce lot le déplace sous un onglet
 * et ne touche à rien d'autre. Le filet de sécurité existait avant le
 * déplacement, ce qui est tout l'intérêt d'un test de caractérisation.
 *
 * POURQUOI LE FILTRE N'EST PAS PARTAGÉ
 * ────────────────────────────────────
 * Le cahier décrit un filtre générique commun aux quatre onglets. Le filtre
 * actuel n'est pas générique : il cherche un CLIENT, notion qui n'existe ni pour
 * une dette ni pour un ravitaillement. Le partager voudrait dire soit le vider
 * de sa moitié utile, soit afficher un champ mort sur trois onglets sur quatre.
 * Il reste donc là où il a un sens, avec les transactions clients.
 *
 * L'URL DÉCIDE, COMME POUR TRANSACTIONS
 * ─────────────────────────────────────
 * Même mécanique, même raison : un onglet qu'on consulte se met en favori, et
 * le bouton « précédent » du navigateur reste sensé.
 */

const ONGLETS = [
  { cle: 'clients', libelle: 'Transactions clients' },
  { cle: 'dealer', libelle: 'Dealer' },
  ...(COLLABORATIONS_ENABLED
    ? [
      { cle: 'collaborations', libelle: 'Collaborations' },
      { cle: 'dettes', libelle: 'Dettes internes' },
    ]
    : []),
]

function Historique() {
  const { currentUser, userProfile } = useAuth()
  const [params, setParams] = useSearchParams()
  const storeId = userProfile?.storeId ?? null

  const demande = params.get('onglet')
  const onglet = ONGLETS.some((o) => o.cle === demande) ? demande : ONGLETS[0].cle

  const {
    filteredTransactions,
    allTransactions,
    applyDateFilter,
    applySearchFilter,
    handleSearchChange,
    resetToToday,
    resetFilters,
  } = useHistoriqueFilters()

  const allerA = useCallback(
    (cle) => setParams({ onglet: cle }, { replace: true }),
    [setParams],
  )

  const tabClass = (actif) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
      actif ? 'bg-brand-500 text-white' : 'border border-line bg-surface text-ink hover:bg-brand-50'
    }`

  return (
    <div>
      <PageHeader title="Historique" />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Sources de l’historique">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            type="button"
            role="tab"
            aria-selected={onglet === o.cle}
            className={tabClass(onglet === o.cle)}
            onClick={() => allerA(o.cle)}
            data-testid={`onglet-historique-${o.cle}`}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      {onglet === 'clients' && (
        <div className="space-y-6">
          {/* Section des filtres */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-end">
              <div className="lg:col-span-1">
                <DateFilter
                  onDateChange={applyDateFilter}
                  onResetToToday={resetToToday}
                />
              </div>

              <div className="lg:col-span-2">
                <ClientSearch
                  onSearch={applySearchFilter}
                  onSearchChange={handleSearchChange}
                />
              </div>
            </div>
          </div>

          {/* Navigation par jour */}
          <DailyPagination
            transactions={allTransactions}
            onDateSelect={applyDateFilter}
          />

          {/* Tableau des transactions */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <HistoriqueTable transactions={filteredTransactions} />

            <ActionButtons
              filteredTransactions={filteredTransactions}
              resetFilters={resetFilters}
            />
          </div>
        </div>
      )}

      {onglet !== 'clients' && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {onglet === 'dealer' && (
            <ArchiveDealer currentUser={currentUser} userProfile={userProfile} />
          )}
          {onglet === 'collaborations' && <ArchiveCollaborations storeId={storeId} />}
          {onglet === 'dettes' && <ArchiveDettes storeId={storeId} />}
        </div>
      )}
    </div>
  )
}

export default Historique
