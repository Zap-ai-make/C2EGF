import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import CorbeilleTable from '../components/historique/CorbeilleTable'
import PageHeader from '../components/ui/PageHeader'
import { useHistoriqueFilters } from '../hooks/useHistoriqueFilters'
import { useAuth } from '../context/AuthContext'
import { COLLABORATIONS_ENABLED } from '../constants/collaborationConstants'
import { STORE_HISTORY_CONFIG } from '../constants/storeWorkspace.js'
import { useTransactions } from '../context/transactions.jsx'

/**
 * Historique — les sources visibles du profil, un seul endroit où l'on relit.
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
 * Le cahier décrit un filtre générique commun aux onglets. Le filtre
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
  ...(STORE_HISTORY_CONFIG.dealer
    ? [{ cle: 'dealer', libelle: STORE_HISTORY_CONFIG.dealerLabel }]
    : []),
  ...(COLLABORATIONS_ENABLED && STORE_HISTORY_CONFIG.collaborations
    ? [
      { cle: 'collaborations', libelle: 'Collaborations' },
    ]
    : []),
  ...(COLLABORATIONS_ENABLED && STORE_HISTORY_CONFIG.internalDebts
    ? [{ cle: 'dettes', libelle: 'Dettes internes' }]
    : []),
  // La corbeille ferme la marche, et ce n'est pas un hasard : on y va quand
  // quelque chose a mal tourné, pas dans le cours normal de la journée.
  // Inconditionnelle — toute boutique peut supprimer, donc toute boutique doit
  // pouvoir relire ce qu'elle a supprimé.
  { cle: 'corbeille', libelle: 'Corbeille' },
]

/** `AAAA-MM-JJ` → `JJ/MM/AAAA`, comme les dates de l'historique. */
const jourAffiche = (cle) => cle.split('-').reverse().join('/')

/**
 * Ce que montrent les onglets qui lisent l'historique, et jusqu'où (lot G1).
 *
 * L'historique ne contient que la journée en cours, plus la période qu'on a
 * choisie. Il faut le dire : sans cette phrase, un historique d'une journée se
 * lirait comme des données perdues. Elle remplace les boutons « Charger … »,
 * qui relisaient cent lignes à chaque clic (docs/rester-dans-le-quota-gratuit.md
 * §G).
 */
const PHRASES_PAR_ONGLET = {
  clients: {
    jour: 'Seule la journée en cours est chargée. Choisissez des dates pour relire les jours précédents.',
    periode: (du, au) => (du === au ? `Le ${du}, et la journée en cours.` : `Du ${du} au ${au}, et la journée en cours.`),
  },
  dealer: {
    jour: 'Mouvements de la journée en cours. Les livraisons encore dues sont toutes affichées, même plus anciennes.',
    periode: (du, au) => `Mouvements ${du === au ? `du ${du}` : `du ${du} au ${au}`} et de la journée en cours. Les livraisons encore dues sont toutes affichées.`,
  },
  corbeille: {
    jour: 'Lignes supprimées aujourd\u2019hui. Choisissez des dates pour relire celles d\u2019autres jours.',
    periode: (du, au) => `Lignes supprimées aujourd\u2019hui, et celles saisies ${du === au ? `le ${du}` : `du ${du} au ${au}`}.`,
  },
}

function PeriodeAffichee({ onglet, periode, enChargement, erreur }) {
  const phrases = PHRASES_PAR_ONGLET[onglet]
  if (!phrases) return null
  return (
    <div className="space-y-1 text-sm" data-testid="periode-affichee">
      {erreur && <p role="alert" className="text-danger">{erreur}</p>}
      <p role="status" className="text-ink-muted">
        {enChargement
          ? 'Lecture de la période…'
          : periode
            ? phrases.periode(jourAffiche(periode.from), jourAffiche(periode.to))
            : phrases.jour}
      </p>
    </div>
  )
}

function Historique() {
  const { currentUser, userProfile } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const storeId = userProfile?.storeId ?? null
  const {
    reopenTransaction,
    periode = null,
    periodeEnChargement = false,
    erreurPeriode = null,
    chargerPeriode,
    revenirAuJour,
  } = useTransactions()

  const demande = params.get('onglet')
  const onglet = ONGLETS.some((o) => o.cle === demande) ? demande : ONGLETS[0].cle

  const {
    filteredTransactions,
    corbeille,
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

  /**
   * Garnir le formulaire avec une transaction validée, puis y emmener le gérant.
   *
   * Le formulaire vit sur /transactions. Rien ne bouge avant qu'il ne confirme : la
   * ligne reste dans l'historique, et les soldes sont intacts.
   */
  const rouvrirPuisCorriger = useCallback(
    async (transaction) => {
      await reopenTransaction(transaction)
      navigate('/transactions')
    },
    [navigate, reopenTransaction],
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

          <PeriodeAffichee
            onglet="clients"
            periode={periode}
            enChargement={periodeEnChargement}
            erreur={erreurPeriode}
          />

          {/* Navigation par jour */}
          <DailyPagination
            transactions={allTransactions}
            onDateSelect={applyDateFilter}
          />

          {/* Tableau des transactions */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <HistoriqueTable
              transactions={filteredTransactions}
              onReopen={rouvrirPuisCorriger}
            />


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
          {onglet === 'corbeille' && <CorbeilleTable transactions={corbeille} />}
        </div>
      )}

      {/* Ces deux onglets lisent l'historique du contexte : la journée, plus la
          période choisie ici ou sur l'onglet clients. Le filtre de date ne trie
          pas leurs lignes, il dit seulement quels jours relire. */}
      {(onglet === 'dealer' || onglet === 'corbeille') && (
        <div className="mt-4 grid grid-cols-1 items-end gap-4 rounded-lg bg-white p-6 shadow-md lg:grid-cols-3">
          <DateFilter onDateChange={chargerPeriode} onResetToToday={revenirAuJour} />
          <div className="lg:col-span-2">
            <PeriodeAffichee
              onglet={onglet}
              periode={periode}
              enChargement={periodeEnChargement}
              erreur={erreurPeriode}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default Historique
