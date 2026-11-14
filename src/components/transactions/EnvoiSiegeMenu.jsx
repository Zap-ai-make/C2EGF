import { useEffect, useId, useRef, useState } from 'react'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { NETWORK_OPTIONS } from '../../utils/constants.js'
import { getClientName } from '../../utils/helpers.js'
import { montantRetourPropose } from '../../utils/ravitaillement.js'
import { verifierEnvoiSiege } from '../../utils/rembSiege.js'

/**
 * Le menu « Envoyer au siège » d'un remboursement en attente.
 *
 * Pas de choix de méthode : l'envoi part toujours du stock (décision de
 * l'utilisateur, 2026-11-14). Le montant est pré-rempli comme le retour de
 * ravitaillement : tout le reste si le stock le contient, sinon ce qu'il
 * contient.
 *
 * Composant à part, monté seulement quand le menu s'ouvre : il lit le stock,
 * et le tableau des non terminées n'a pas besoin du contexte des réseaux pour
 * tout le reste.
 */

const RESEAU = NETWORK_OPTIONS[0]
const fcfa = (montant) => `${(Number(montant) || 0).toLocaleString('fr-FR')} FCFA`

export default function EnvoiSiegeMenu({ ligne, onEnvoyer }) {
  const { getStock } = useSimpleNetworkData()
  const stock = Number(getStock(RESEAU)) || 0
  const reste = Number(ligne?.resteAuSiege) || 0
  const idMontant = useId()
  const [montant, setMontant] = useState(() => montantRetourPropose({ reste, disponible: stock }))
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)
  // Le montant proposé suit le stock tant que la caissière ne l'a pas tapé.
  const montantTape = useRef(false)
  // ⚠ VERROU SYNCHRONE : deux clics dans le même instant seraient deux tranches,
  //   chacune avec son identifiant de file, et le stock partirait deux fois.
  const verrou = useRef(false)

  useEffect(() => {
    if (!montantTape.current) setMontant(montantRetourPropose({ reste, disponible: stock }))
  }, [reste, stock])

  const envoyer = async () => {
    if (verrou.current) return
    const verification = verifierEnvoiSiege({ ligne, montant, stock })
    if (!verification.ok) {
      setErreur(verification.raison)
      return
    }
    verrou.current = true
    setEnCours(true)
    try {
      await onEnvoyer(verification.valeur)
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }

  return (
    <>
      <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200">
        <p className="text-sm font-medium text-gray-700">Envoyer au siège</p>
      </div>
      <div className="px-4 pt-2 pb-1 border-b border-gray-100 space-y-0.5">
        <p className="text-xs text-gray-700 font-medium truncate">{getClientName(ligne?.client)}</p>
        <p className="text-[11px] font-medium tabular-nums text-warn">Reste à envoyer : {fcfa(reste)}</p>
        <p className="text-[11px] tabular-nums text-gray-500">Stock disponible : {fcfa(stock)}</p>
      </div>
      <div className="px-4 py-3">
        <label htmlFor={idMontant} className="mb-2 block text-xs text-gray-500">Montant (FCFA)</label>
        <input
          id={idMontant}
          type="number"
          min="1"
          value={montant}
          onChange={(e) => {
            montantTape.current = true
            setMontant(e.target.value)
            setErreur('')
          }}
          className="w-full rounded border border-line px-2 py-1 text-center text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
        {erreur && <p className="mt-1 text-xs text-danger">{erreur}</p>}
        <button
          type="button"
          onClick={envoyer}
          disabled={enCours}
          className="mt-3 w-full rounded bg-brand-500 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {enCours ? 'Envoi…' : 'Confirmer l’envoi'}
        </button>
      </div>
    </>
  )
}
