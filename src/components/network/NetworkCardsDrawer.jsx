import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { activeProfile } from '../../config/activeClientProfile.js'
import NetworkCard from './NetworkCard'

// Cartes de solde affichées = réseaux du profil client actif + la carte Liquidité
// (toujours présente). Ex. TAOFIC → ['Orange', 'Liquidite'] (identique à avant).
const VISIBLE_NETWORK_CARDS = [...activeProfile.networks.enabled, 'Liquidite']

/**
 * La barre des soldes — la seule chose qui ne quitte jamais l'écran avec la
 * navigation.
 *
 * Elle était en `slate-950`, un noir neutre froid sans rapport avec le marine
 * de la marque, et portait une pastille verte émeraude — dernier reste du vert
 * AKAYIS, qui ne signalait rien : ni un état, ni un seuil, juste une diode
 * décorative. Elle est retirée ; « Soldes » suffit à nommer la bande.
 *
 * Le contenu était centré dans un `max-w-6xl` alors que le contenu de la page,
 * lui, occupe toute la largeur : les deux bords gauches ne tombaient pas au
 * même endroit. Les cartes s'alignent désormais sur la navigation au-dessus.
 */
function NetworkCardsDrawer() {
  const { networkData } = useSimpleNetworkData()
  const visibleCards = VISIBLE_NETWORK_CARDS
    .map(network => [network, networkData[network]])
    .filter(([, data]) => data)

  return (
    <section
      data-network-cards
      className="border-b border-brand-400/30 bg-brand-600"
      aria-label="Soldes opérationnels"
    >
      <div className="flex w-full flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        <span className="shrink-0 text-center text-xs font-semibold uppercase tracking-[0.2em] text-brand-200 md:text-left">
          Soldes
        </span>

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
