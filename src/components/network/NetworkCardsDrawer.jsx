import { useMemo } from 'react'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { useTransactions } from '../../context/transactions.jsx'
import { activeProfile } from '../../config/activeClientProfile.js'
import { sommesEnAttente, totalCaisse } from '../../utils/caisse.js'
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
  const { pendingTransactions = [] } = useTransactions()
  const visibleCards = VISIBLE_NETWORK_CARDS
    .map(network => [network, networkData[network]])
    .filter(([, data]) => data)

  /**
   * Le total exact de la caisse, pose ici et nulle part ailleurs.
   *
   * POURQUOI DANS CETTE BANDE
   * Elle est la seule chose qui ne quitte jamais l'ecran, et elle repond deja a
   * « qu'est-ce que je tiens ? ». T repond a la meme question en comptant ce
   * qui est encore en route : c'est la ligne du bas de ce qui est au-dessus.
   * Le poser sur la page Transactions l'aurait rendu invisible depuis Clients
   * et Historique, et en faire une troisieme carte aurait double la hauteur de
   * la bande sur telephone. Une etiquette et un nombre, en vis-a-vis de
   * « Soldes » : la bande ne grandit pas d'un pixel.
   *
   * ADDITION LISIBLE A L'OEIL : les deux parts sont EXACTEMENT les deux cartes
   * affichees a cote. Le stock vient des reseaux du profil, la liquidite de la
   * carte `Liquidite` — qui est deja leur somme. Resommer les `liquidite` de
   * chaque reseau la compterait deux fois.
   */
  const total = useMemo(() => {
    const stock = activeProfile.networks.enabled
      .reduce((somme, reseau) => somme + (Number(networkData[reseau]?.stock) || 0), 0)
    const liquidite = Number(networkData.Liquidite?.liquidite) || 0
    const { depots, retraits } = sommesEnAttente(pendingTransactions)
    return totalCaisse({ stock, liquidite, depots, retraits })
  }, [networkData, pendingTransactions])

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
        {/* SUR TÉLÉPHONE, LE TOTAL NE COÛTE PAS UNE LIGNE.
            La bande est COLLANTE : chaque pixel qu'elle prend, elle le prend
            sur toutes les pages et pour toujours. En bloc empilé sous les
            cartes, le total la faisait passer de 233 à 278 px sur un 390 px
            — un tiers de l'écran confisqué.
            La rangée du libellé était vide à 90 % : le total s'y installe, et la
            bande ne grandit pas d'un pixel. `md:contents` dissout ce groupe sur
            grand écran, où les trois éléments reprennent leur rang par `order`. */}
        <div className="flex w-full items-center justify-between gap-3 md:contents">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-200 md:order-1 md:text-center">
            Soldes
          </span>

          <div
            className="flex shrink-0 items-baseline gap-2 md:order-3 md:flex-col md:items-start md:gap-0"
            data-testid="total-caisse"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-200">
              Total caisse
            </span>
            <span className="font-mono text-base font-bold tabular-nums text-white md:text-lg">
              {total.toLocaleString('fr-FR')}
              <span className="ml-1 text-[11px] font-semibold text-brand-200">FCFA</span>
            </span>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:order-2 md:w-auto md:min-w-[42rem] md:max-w-4xl">
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
