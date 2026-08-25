import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { activeProfile } from '../../config/activeClientProfile.js'
import NetworkCard from './NetworkCard'

// Cartes de solde affichées = réseaux du profil client actif + la carte Liquidité
// (toujours présente). Ex. TAOFIC → ['Orange', 'Liquidite'] (identique à avant).
const VISIBLE_NETWORK_CARDS = [...activeProfile.networks.enabled, 'Liquidite']

function NetworkCardsDrawer() {
  const { networkData } = useSimpleNetworkData()
  const visibleCards = VISIBLE_NETWORK_CARDS
    .map(network => [network, networkData[network]])
    .filter(([, data]) => data)

  return (
    <section
      data-network-cards
      className="border-b border-slate-800 bg-slate-950 shadow-md"
      aria-label="Soldes opérationnels"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-center">
        <div className="flex shrink-0 items-center justify-center gap-2 text-slate-300 md:justify-start">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Soldes
          </span>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:max-w-3xl">
          {visibleCards.map(([network, data]) => (
            <NetworkCard
              key={network}
              network={network}
              stockAmount={data.stock}
              liquiditeAmount={data.liquidite}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default NetworkCardsDrawer
