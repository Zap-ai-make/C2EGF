import { useCallback, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import { runStoreTransactionCommand } from '../../services/storeTransactionCommandService'
import { parseFcfaAmount } from '../../utils/fcfaAmount.js'
import { formatCurrency } from '../../utils/formatCurrency'

/**
 * Ravitaillement — la centrale réapprovisionne la boutique.
 *
 * POURQUOI DEUX VASES ET PAS UN MONTANT SEUL
 * ──────────────────────────────────────────
 * Stock électronique et liquidité sont deux réserves distinctes, et une
 * transaction client ne fait que déplacer de l'une vers l'autre. Le
 * ravitaillement est la seule opération qui en remplit une : dire laquelle
 * n'est pas un détail de saisie, c'est l'information principale. D'où deux
 * grandes cibles plutôt qu'un menu déroulant — le geste est binaire et
 * fréquent, il mérite d'être visible et atteignable au pouce.
 *
 * Le réseau n'est pas demandé : le serveur le résout depuis le profil de la
 * boutique. Un champ de plus ici n'apporterait rien tant que C2EGF n'opère
 * qu'Orange, et un réseau choisi par le navigateur ne serait de toute façon
 * pas honoré (storeTransactionCommand.js, action `replenish`).
 */

const VASES = [
  { cle: 'stock', libelle: 'Stock' },
  { cle: 'liquidite', libelle: 'Espèce' },
]

const NOTE_MAX = 280

function RavitaillementForm({ onComplete, onCancel }) {
  const { showToast } = useToast()
  const [montant, setMontant] = useState('')
  const [vase, setVase] = useState('stock')
  const [note, setNote] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  // Verrou synchrone : un double-clic ne doit pas créditer deux fois, et
  // setEnvoiEnCours ne prend effet qu'au rendu suivant.
  const verrou = useRef(false)

  const validation = useMemo(() => {
    const valeur = parseFcfaAmount(montant)
    if (valeur === null) return { ok: false, raison: 'Montant invalide (entier supérieur à 0).' }
    return { ok: true, raison: '', valeur }
  }, [montant])

  const envoyer = useCallback(async (event) => {
    event.preventDefault()
    if (!validation.ok || verrou.current) return
    verrou.current = true
    setEnvoiEnCours(true)
    try {
      await runStoreTransactionCommand({
        action: 'replenish',
        amount: validation.valeur,
        balanceType: vase,
        note: note.trim() || undefined,
      })
      const nomVase = VASES.find((v) => v.cle === vase)?.libelle ?? vase
      showToast(`Ravitaillement enregistré : ${formatCurrency(validation.valeur)} en ${nomVase.toLowerCase()}.`, 'success')
      onComplete?.()
    } catch (err) {
      showToast(err?.message || "Le ravitaillement n'a pas pu être enregistré.", 'error')
    } finally {
      setEnvoiEnCours(false)
      verrou.current = false
    }
  }, [validation, vase, note, showToast, onComplete])

  const montantInvalide = !validation.ok && montant !== ''

  return (
    <form onSubmit={envoyer} className="space-y-5">
      <div>
        <label htmlFor="ravitaillement-montant" className="mb-1 block text-sm font-semibold text-ink">
          Montant (FCFA)
        </label>
        <input
          id="ravitaillement-montant"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={montant}
          onChange={(event) => setMontant(event.target.value)}
          placeholder="Saisir le montant reçu"
          autoFocus
          aria-describedby={montantInvalide ? 'ravitaillement-montant-erreur' : undefined}
          aria-invalid={montantInvalide || undefined}
          className={`w-full rounded border-2 px-3 py-2 tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
            montantInvalide ? 'border-danger' : 'border-line'
          }`}
        />
        {montantInvalide && (
          <p id="ravitaillement-montant-erreur" className="mt-1 text-sm text-danger">
            {validation.raison}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ravitaillement-note" className="mb-1 block text-sm font-semibold text-ink">
          Note <span className="font-normal text-ink-muted">(facultative)</span>
        </label>
        <input
          id="ravitaillement-note"
          type="text"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          className="w-full rounded border-2 border-line px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Réserve ravitaillée</legend>
        <div className="flex flex-wrap gap-3">
          {VASES.map((option) => (
            <label
              key={option.cle}
              className={`flex-1 min-w-36 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand-400 ${
                vase === option.cle ? 'border-brand-400 bg-brand-50' : 'border-line hover:border-brand-200'
              }`}
            >
              <input
                type="radio"
                name="ravitaillement-vase"
                value={option.cle}
                checked={vase === option.cle}
                onChange={() => setVase(option.cle)}
                className="sr-only"
              />
              {/* La sélection ne peut pas tenir à la seule teinte (DESIGN.md §5) :
                  le radio natif est en sr-only, donc l'œil n'aurait que la
                  couleur. La pastille cochée porte la même information en forme. */}
              <span className="flex items-center justify-between gap-2">
                <span className="block text-sm font-semibold text-ink">{option.libelle}</span>
                {vase === option.cle && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={envoiEnCours}
          className="rounded border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={!validation.ok || envoiEnCours}
          data-testid="valider-ravitaillement"
          className={`rounded px-5 py-2 text-sm font-semibold transition-colors ${
            !validation.ok || envoiEnCours
              ? 'cursor-not-allowed bg-gray-200 text-gray-500'
              : 'bg-brand-500 text-white hover:bg-brand-600'
          }`}
        >
          {envoiEnCours ? 'Enregistrement…' : 'Ravitailler'}
        </button>
      </div>
    </form>
  )
}

export default RavitaillementForm
