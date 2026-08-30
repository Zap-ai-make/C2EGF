import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listNetworkCaisses } from '../../services/dealerService'
import { subscribeRetoursEnAttente } from '../../services/storeTransferService'
import { useDealerInventory } from '../../hooks/useDealerInventory'
import { rapprocherPosition } from '../../utils/positionDealer'
import PageHeader from '../../components/ui/PageHeader'
import ErrorState from '../../components/ui/ErrorState'
import PositionDealer from '../../components/dealer/PositionDealer'
import CaissesReseau from '../../components/dealer/CaissesReseau'
import { DEALER_NETWORK } from '../../constants/dealerConstants'

/**
 * L'accueil du dealer — ses deux questions du matin.
 *
 *   1. Combien de mon argent est dehors ?      → `PositionDealer`
 *   2. Quelle boutique est courte ?            → `CaissesReseau`
 *
 * CE QUI A DISPARU, ET POURQUOI
 * ─────────────────────────────
 * Quatre `StatCard` à émoji, et une table des huit dernières demandes.
 *
 * Les tuiles ne disaient rien d'utile, et deux d'entre elles disaient faux :
 * « Boutiques partenaires » affichait la longueur de la PREMIÈRE PAGE suivie
 * d'un « + » — soit « 20+ » en permanence sur un réseau de 84 boutiques — et
 * « Mes demandes récentes » comptait la longueur d'une tranche plafonnée à 8,
 * qui ne bougeait donc plus au-delà de huit demandes. Les deux autres
 * répétaient des compteurs que la barre latérale porte désormais en
 * permanence, sur les entrées où l'on agit (invariant de S3) : les répéter ici
 * ne faisait qu'ajouter un second endroit à tenir à jour.
 *
 * La table des demandes, elle, doublait l'écran « Ravitaillements » — même
 * données, huit lignes au lieu de vingt, et avec sa PROPRE table de libellés
 * qui disait « Ajout stock » là où le reste de l'espace dit « Ajout de stock ».
 * L'accueil renvoie à l'écran qui fait le travail ; il ne le refait pas en
 * moins bien.
 *
 * UNE SEULE REQUÊTE POUR LES 84 CAISSES
 * ─────────────────────────────────────
 * `listNetworkCaisses` (S2) ramène les 84 boutiques et leurs 84 soldes en deux
 * allers-retours, là où le motif précédent en faisait un par boutique. Le tri
 * et la recherche travaillent ensuite en mémoire sur cette liste complète :
 * aucune requête de plus, et surtout une recherche qui porte sur les 84 et non
 * sur les 20 affichées.
 */
function DealerDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { inventory } = useDealerInventory()

  const [reseau, setReseau] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [retours, setRetours] = useState({ nombre: 0, montant: 0, illisibles: 0 })

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      setReseau(await listNetworkCaisses())
    } catch (err) {
      setErreur(err.message)
      setReseau(null)
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  // Les retours en attente arrivent en temps réel : confirmer un retour depuis
  // l'écran voisin doit faire bouger le transit ici sans recharger la page.
  // La garde de rôle est la même que celle de l'ancien écran : un non-dealer
  // n'ouvre aucune écoute.
  const dealerUid = userProfile?.role === 'dealer' ? currentUser?.uid : null
  useEffect(
    () => subscribeRetoursEnAttente({ dealerUid, onUpdate: setRetours }),
    [dealerUid],
  )

  const caisses = reseau?.caisses ?? []

  // ⚠ Les retours au montant illisible comptent comme des caisses illisibles :
  //   ils invalident le rapprochement au même titre, puisqu'ils manquent au
  //   même total. Les compter à part laisserait passer un écart sans cause.
  const position = rapprocherPosition({
    flux: inventory?.flux,
    sommeStock: reseau?.sommeStock ?? 0,
    sommeLiquidite: reseau?.sommeLiquidite ?? 0,
    illisibles: (reseau?.illisibles ?? 0) + (retours.illisibles ?? 0),
    enTransit: retours.montant,
    caissesLues: Boolean(reseau),
  })

  const sousTitre = chargement
    ? 'Chargement du réseau…'
    : erreur
      ? 'Réseau indisponible'
      : `${reseau?.total ?? 0} boutique${(reseau?.total ?? 0) > 1 ? 's' : ''} en service · réseau ${DEALER_NETWORK}`

  return (
    <div data-testid="dealer-home" className="grid gap-6">
      <PageHeader
        title="Vue générale"
        subtitle={sousTitre}
        actions={
          <button
            type="button"
            onClick={charger}
            disabled={chargement}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {chargement ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      <PositionDealer
        position={position}
        retoursEnAttente={retours.nombre}
        loading={chargement}
      />

      {erreur ? (
        <ErrorState message={erreur} onRetry={charger} />
      ) : (
        <CaissesReseau
          caisses={caisses}
          illisibles={reseau?.illisibles ?? 0}
          loading={chargement}
          reseau={DEALER_NETWORK}
        />
      )}
    </div>
  )
}

export default DealerDashboard
