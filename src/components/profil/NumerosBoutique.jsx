import { useEffect, useId, useState } from 'react'
import { enregistrerNumerosBoutique, lireNumerosBoutique } from '../../services/numerosBoutiqueService.js'
import { useEnLigne } from '../../hooks/useEnLigne.js'

/**
 * Les numéros de la boutique, dans son Profil
 * (docs/superpowers/specs/2026-11-17-numeros-boutique-design.md).
 *
 * Décidé par l'utilisateur le 2026-11-17 : la boutique les saisit elle-même.
 * L'app Oxygen montre le numéro flotte aux agents, avec un bouton « Appeler »,
 * et compose vers le numéro dealer le code d'envoi d'un retrait.
 *
 * ⚠ ILLISIBLES, PAS DE FORMULAIRE. Des champs vides, enregistrés par-dessus,
 *   effaceraient les vrais numéros.
 */
const sansEspaces = (valeur) => valeur.replace(/\s+/g, '')

const CHAMP = 'w-full rounded border border-line px-3 py-2 font-mono tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

export default function NumerosBoutique({ storeId }) {
  const enLigne = useEnLigne()
  const idFlotte = useId()
  const idDealer = useId()
  // Ce que la fiche porte : la référence qui dit s'il y a quelque chose à enregistrer.
  const [reference, setReference] = useState(null)
  const [illisible, setIllisible] = useState(false)
  const [flotte, setFlotte] = useState('')
  const [dealerOrange, setDealerOrange] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let actif = true
    lireNumerosBoutique(storeId)
      .then((lus) => {
        if (!actif) return
        setReference(lus)
        setFlotte(lus.flotte)
        setDealerOrange(lus.dealerOrange)
      })
      .catch(() => { if (actif) setIllisible(true) })
    return () => { actif = false }
  }, [storeId])

  const change = reference !== null && (
    sansEspaces(flotte) !== reference.flotte || sansEspaces(dealerOrange) !== reference.dealerOrange
  )

  const enregistrer = async (event) => {
    event.preventDefault()
    setEnvoi(true)
    setMessage(null)
    try {
      const { numeros } = await enregistrerNumerosBoutique({ flotte, dealerOrange })
      const enregistres = { flotte: numeros?.flotte ?? '', dealerOrange: numeros?.dealer?.Orange ?? '' }
      setReference(enregistres)
      setFlotte(enregistres.flotte)
      setDealerOrange(enregistres.dealerOrange)
      setMessage({ texte: 'Enregistré.', erreur: false })
    } catch (error) {
      setMessage({ texte: error?.message || 'Numéros non enregistrés.', erreur: true })
    } finally {
      setEnvoi(false)
    }
  }

  const saisir = (fixer) => (event) => {
    fixer(event.target.value)
    setMessage(null)
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-ink mb-6">Numéros de la boutique</h2>
      {illisible ? (
        <p role="alert" className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          Numéros illisibles pour l’instant. Réessayez avec une connexion.
        </p>
      ) : reference === null ? (
        <p className="text-sm text-ink-muted">Lecture des numéros…</p>
      ) : (
        <form onSubmit={enregistrer} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor={idFlotte} className="block text-sm font-medium text-gray-700 mb-2">
                Numéro flotte (pour appeler la boutique)
              </label>
              <input id={idFlotte} type="text" inputMode="numeric" autoComplete="off" value={flotte} onChange={saisir(setFlotte)} className={CHAMP} />
            </div>
            <div>
              <label htmlFor={idDealer} className="block text-sm font-medium text-gray-700 mb-2">
                Numéro dealer Orange (reçoit la monnaie des agents)
              </label>
              <input id={idDealer} type="text" inputMode="numeric" autoComplete="off" value={dealerOrange} onChange={saisir(setDealerOrange)} className={CHAMP} />
            </div>
          </div>
          <p className="text-sm text-ink-muted">L’app Oxygen les montre aux agents. Vide = rien n’est montré.</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {message && (
              <p role={message.erreur ? 'alert' : 'status'} className={`text-sm font-medium ${message.erreur ? 'text-danger' : 'text-success'}`}>
                {message.texte}
              </p>
            )}
            <button
              type="submit"
              disabled={!change || !enLigne || envoi}
              aria-label="Enregistrer"
              className="rounded-md border border-brand-500 bg-brand-500 px-6 py-2 font-semibold text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink-muted"
            >
              {envoi ? '…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
