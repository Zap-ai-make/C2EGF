import { useEffect, useId, useRef, useState } from 'react'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { NETWORK_OPTIONS } from '../../utils/constants.js'
import { montantTranchePropose, verifierTrancheTransfert } from '../../utils/transfertArgent.js'

/**
 * Le menu d'une tranche de transfert d'argent : « Envoyer au siège » pour un
 * transfert, « Encaisser » pour un retrait
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 * Toujours en stock, sans choix de méthode (décision de l'utilisateur). Le
 * montant est pré-rempli avec tout le reste ; pour un envoi, plafonné au stock,
 * qu'il suit tant que la caissière ne l'a pas tapé. Frère d'`EnvoiSiegeMenu`,
 * qu'il laisse intact.
 */

const RESEAU = NETWORK_OPTIONS[0]
const fcfa = (montant) => `${(Number(montant) || 0).toLocaleString('fr-FR')} FCFA`

export default function TrancheTransfertMenu({ ligne, onValider }) {
  const { getStock } = useSimpleNetworkData()
  const stock = Number(getStock(RESEAU)) || 0
  const envoi = ligne?.operation !== 'retrait'
  const reste = Number(ligne?.resteATraiter) || 0
  const idMontant = useId()
  const propose = montantTranchePropose({ ligne, stock })
  const [montant, setMontant] = useState(propose)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)
  const montantTape = useRef(false)
  // ⚠ VERROU SYNCHRONE : deux clics dans le même instant seraient deux tranches,
  //   chacune avec son identifiant de file.
  const verrou = useRef(false)

  useEffect(() => {
    if (!montantTape.current) setMontant(propose)
  }, [propose])

  const valider = async () => {
    if (verrou.current) return
    const verification = verifierTrancheTransfert({ ligne, montant, stock })
    if (!verification.ok) {
      setErreur(verification.raison)
      return
    }
    verrou.current = true
    setEnCours(true)
    try {
      await onValider(verification.valeur)
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }

  return (
    <>
      <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200">
        <p className="text-sm font-medium text-gray-700">{envoi ? 'Envoyer au siège' : 'Encaisser'}</p>
      </div>
      <div className="px-4 pt-2 pb-1 border-b border-gray-100 space-y-0.5">
        <p className="text-xs text-gray-700 font-medium truncate">{ligne?.nomClient}</p>
        <p className="text-[11px] font-medium tabular-nums text-warn">Reste : {fcfa(reste)}</p>
        {envoi && <p className="text-[11px] tabular-nums text-gray-500">Stock disponible : {fcfa(stock)}</p>}
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
          onClick={valider}
          disabled={enCours}
          className="mt-3 w-full rounded bg-brand-500 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {enCours ? 'Envoi…' : envoi ? 'Confirmer l’envoi' : 'Confirmer l’encaissement'}
        </button>
      </div>
    </>
  )
}
