import { useContext, useState } from 'react'
import { ClientsContext } from '../context/ClientsContext.jsx'
import { useDashboardData } from '../hooks/useDashboardData.js'
import { useAllTransactions } from '../hooks/useAllTransactions.js'
import { useReseauStats } from '../hooks/useReseauStats.js'
import { SEUIL_DECROCHAGE_JOURS } from '../utils/reseauStats.js'
import { CARTE } from '../constants/dashboardTheme.js'
import Balance from '../components/dashboard/Balance'
import ReseauCards from '../components/dashboard/ReseauCards'
import FluxChart from '../components/dashboard/FluxChart'
import Commerciaux from '../components/dashboard/Commerciaux'
import LastClientsTable from '../components/dashboard/LastClientsTable'

/**
 * Tableau de bord — poste de pilotage d'un distributeur mobile money.
 *
 * L'écran répondait aux questions d'un commerce de détail : combien
 * d'inscriptions, quel est le « top client du jour », quelle est la
 * « répartition par réseau ». Aucune ne se pose chez un distributeur, qui
 * approvisionne un réseau fini d'agents connus nommément — et la répartition
 * par réseau était un camembert à une seule part, qui comptait en réalité les
 * codes agents renseignés.
 *
 * Quatre bandes, de l'exploitation immédiate au pilotage commercial :
 *
 *   1. LA BALANCE   puis-je approvisionner l'agent suivant ?
 *   2. LE RÉSEAU    mon portefeuille travaille-t-il ? qui décroche ?
 *                   sur combien de comptes repose mon volume ?
 *   3. LES FLUX     comment l'argent a circulé, et dans quel sens
 *   4. LE FICHIER   croissance du portefeuille et derniers enrôlements
 *
 * Aucune lecture Firestore supplémentaire : tout est calculé sur des données
 * déjà en mémoire.
 */

const entier = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0)

function Portefeuille({ total, ceMois, aujourdHui }) {
  const chiffres = [
    { libelle: 'Agents au portefeuille', valeur: total },
    { libelle: 'Enrôlés ce mois', valeur: ceMois },
    { libelle: "Enrôlés aujourd'hui", valeur: aujourdHui },
  ]

  return (
    <section aria-label="Croissance du portefeuille" className={CARTE}>
      <dl className="grid gap-6 sm:grid-cols-3">
        {chiffres.map(({ libelle, valeur }) => (
          <div key={libelle}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {libelle}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{entier(valeur)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Dashboard() {
  const { clients, loading } = useContext(ClientsContext)
  const allTransactions = useAllTransactions()
  const stats = useDashboardData(clients, allTransactions)

  // Règle de gestion, pas constante technique : elle appartient à qui pilote,
  // et se règle depuis la carte « Décrochages ».
  const [seuilDecrochage, setSeuilDecrochage] = useState(SEUIL_DECROCHAGE_JOURS)
  const reseau = useReseauStats(clients, { seuilDecrochage })

  const titre = (
    <div className="border-b-2 border-line pb-4">
      <h1 className="text-3xl font-bold text-ink">Tableau de bord</h1>
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-8">
        {titre}
        <div className="flex items-center justify-center py-12" role="status">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-brand-500 border-r-transparent" />
            <p className="mt-4 text-ink-muted">Chargement des données…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {titre}

      <Balance balance={reseau.balance} projection={reseau.projection} />

      <ReseauCards
        couverture={reseau.couverture}
        decrochages={reseau.decrochages}
        concentration={reseau.concentration}
        onSeuilChange={setSeuilDecrochage}
      />

      <FluxChart flux={reseau.flux} />

      <Portefeuille
        total={stats.totalClients}
        ceMois={stats.monthlyClients}
        aujourdHui={stats.dailyClients}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Commerciaux />
        <LastClientsTable clients={clients} />
      </div>
    </div>
  )
}

export default Dashboard
