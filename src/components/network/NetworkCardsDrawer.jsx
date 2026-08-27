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
      {/* Troisième bande, même axe que les deux autres : le groupe « Soldes +
          cartes » est centré. Il s'ouvrait auparavant contre le bord gauche
          pendant que la marque, elle, occupait le milieu. */}
      <div className="flex w-full flex-col items-center gap-3 px-4 py-3.5 md:flex-row md:justify-center md:gap-5">
        <span className="shrink-0 text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-200">
          Soldes
        </span>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:w-auto md:min-w-[42rem] md:max-w-4xl">
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
