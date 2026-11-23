import { useId, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useEnLigne } from '../../hooks/useEnLigne.js'
import { enregistrerTransfertsArgent } from '../../services/reglagesBoutiqueService.js'
import { TRANSFERT_ARGENT_ACTIF } from '../../utils/transfertArgent.js'

/**
 * L'option des transferts d'argent, dans la carte Configuration du Profil
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 * Décidé par l'utilisateur le 2026-11-23 : chaque boutique coche elle-même.
 * La case enregistre au clic, par le réseau : sans lui, elle reste dans son
 * état d'avant et le dit.
 */
export default function CaseTransfertsArgent() {
  const { activeStore, mettreAJourBoutique } = useAuth()
  const enLigne = useEnLigne()
  const idCase = useId()
  const idAide = useId()
  const [envoi, setEnvoi] = useState(false)
  const [message, setMessage] = useState(null)

  if (!TRANSFERT_ARGENT_ACTIF) return null
  const actif = activeStore?.transfertsArgent === true

  const basculer = async (event) => {
    const voulu = event.target.checked
    if (!enLigne) {
      setMessage({ texte: 'Connexion nécessaire.', erreur: true })
      return
    }
    setEnvoi(true)
    setMessage(null)
    try {
      const { transfertsArgent } = await enregistrerTransfertsArgent(voulu)
      mettreAJourBoutique({ transfertsArgent })
      setMessage({ texte: 'Enregistré.', erreur: false })
    } catch (error) {
      setMessage({ texte: error?.message || 'Réglage non enregistré.', erreur: true })
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section>
      <h3 className="text-lg mb-4 font-bold text-ink">Transferts d’argent</h3>
      <div className="flex items-start gap-3">
        <input
          id={idCase}
          type="checkbox"
          checked={actif}
          disabled={envoi}
          onChange={basculer}
          aria-describedby={idAide}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-wait"
        />
        <div>
          <label htmlFor={idCase} className="font-medium text-ink">
            Western Union, Ria, MoneyGram et autres
          </label>
          <p id={idAide} className="text-sm text-ink-muted">
            Ajoute un onglet dans « Enregistrer une transaction ».
          </p>
        </div>
      </div>
      {message && (
        <p role={message.erreur ? 'alert' : 'status'} className={`mt-3 text-sm font-medium ${message.erreur ? 'text-danger' : 'text-success'}`}>
          {message.texte}
        </p>
      )}
    </section>
  )
}
