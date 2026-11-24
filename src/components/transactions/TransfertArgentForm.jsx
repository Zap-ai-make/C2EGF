import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTransactions } from '../../context/transactions.jsx'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { useToast } from '../../hooks/useToast'
import Toast from '../Toast'
import { MESSAGES, NETWORK_OPTIONS } from '../../utils/constants.js'
import logger from '../../utils/logger.js'
import { VASES } from '../../utils/ravitaillement.js'
import {
  SERVICES_TRANSFERT,
  estTransfertArgent,
  evaluerTransfertArgent,
  preparerTransfertArgent,
} from '../../utils/transfertArgent.js'

/**
 * Le formulaire des transferts d'argent : l'onglet « Western Union · Ria ·
 * MoneyGram » de la fenêtre « Enregistrer une transaction »
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 * Le client est une personne ordinaire, pas un agent : on tape son nom, sans
 * recherche. Un seul bouton, « Non Terminées » (décision de l'utilisateur) : la
 * ligne se ferme ensuite par « Envoyer au siège » ou « Encaisser ».
 *
 * Aucun choix coché d'office : un défaut silencieux serait une erreur que
 * personne ne verrait.
 */

const RESEAU = NETWORK_OPTIONS[0]
const OPERATIONS = [
  { cle: 'transfert', libelle: 'Transfert' },
  { cle: 'retrait', libelle: 'Retrait' },
]
const VIDE = { service: '', servicePrecise: '', operation: '', nomClient: '', telephone: '', codeTransfert: '', montant: '', balanceType: '' }

const depuisLigne = (ligne) => (ligne ? {
  service: ligne.service ?? '',
  servicePrecise: ligne.servicePrecise ?? '',
  operation: ligne.operation ?? '',
  nomClient: ligne.nomClient ?? '',
  telephone: ligne.telephone ?? '',
  codeTransfert: ligne.codeTransfert ?? '',
  montant: String(ligne.montant ?? ''),
  balanceType: ligne.balanceType ?? '',
} : VIDE)

const CHAMP = 'w-full rounded border-2 border-line px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'
const LIBELLE = 'block text-lg font-semibold text-gray-700 mb-1'

/** Une rangée de boîtes à cocher : chaque option est une cible franche (DESIGN.md §5). */
function Choix({ legende, nom, options, valeur, onChange, desactivee = () => false }) {
  return (
    <fieldset>
      <legend className={LIBELLE}>{legende}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map(({ cle, libelle }) => {
          const actif = valeur === cle
          const figee = desactivee(cle)
          return (
            <label
              key={cle}
              className={`flex flex-1 items-center gap-3 rounded border-2 px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand-400 ${
                figee ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              } ${actif ? 'border-brand-500 bg-brand-50' : `border-line bg-surface ${figee ? '' : 'hover:border-brand-200'}`}`}
            >
              <input
                type="radio"
                name={nom}
                value={cle}
                checked={actif}
                disabled={figee}
                onChange={() => onChange(cle)}
                className="h-4 w-4 accent-brand-500 focus:outline-none"
              />
              <span className={`whitespace-nowrap font-semibold ${actif ? 'text-ink' : 'text-gray-700'}`}>{libelle}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function TransfertArgentForm({ onComplete, onCancel, annoncer = null }) {
  const { ajouterTransfertArgent, modifierTransfertArgent, editingTransaction, clearEditTransaction } = useTransactions()
  const { getStock, getNetworkLiquidite } = useSimpleNetworkData()
  const { toasts, showToast, removeToast } = useToast()
  const enModif = estTransfertArgent(editingTransaction) ? editingTransaction : null
  const [champs, setChamps] = useState(() => depuisLigne(enModif))
  const [aConfirmer, setAConfirmer] = useState(null)
  const [enCours, setEnCours] = useState(false)
  // ⚠ VERROU SYNCHRONE : deux clics sur « Confirmer » dans le même instant
  //   partiraient tous deux, chacun avec son identifiant de file.
  const verrou = useRef(false)
  const ids = { precise: useId(), nom: useId(), tel: useId(), code: useId(), montant: useId() }

  const fixer = (cle) => (valeur) => setChamps((avant) => ({ ...avant, [cle]: valeur }))
  const saisir = (cle) => (event) => fixer(cle)(event.target.value)

  // En modification, un retrait a déjà pris son montant dans sa réserve : il
  // compte dans ce qui est disponible, comme le serveur le rend avant de reprendre.
  const reserves = useMemo(() => {
    const disponibles = { stock: Number(getStock(RESEAU)) || 0, liquidite: Number(getNetworkLiquidite(RESEAU)) || 0 }
    if (enModif?.operation === 'retrait' && enModif.balanceType in disponibles) {
      disponibles[enModif.balanceType] += Number(enModif.montant) || 0
    }
    return disponibles
  }, [getStock, getNetworkLiquidite, enModif])

  const evaluation = evaluerTransfertArgent({ ...champs, ...reserves })
  const estRetrait = champs.operation === 'retrait'

  const demander = () => {
    const preparation = preparerTransfertArgent({ ...champs, ...reserves })
    if (!preparation.ok) {
      showToast(preparation.raison, 'error')
      return
    }
    setAConfirmer(preparation)
  }

  const confirmer = useCallback(async () => {
    if (!aConfirmer || verrou.current) return
    verrou.current = true
    setEnCours(true)
    try {
      if (enModif) {
        // Un champ facultatif vidé part vide : le serveur l'efface de la ligne.
        const { operation: _operation, ...retenus } = aConfirmer.transaction
        await modifierTransfertArgent(enModif.id, { servicePrecise: '', telephone: '', codeTransfert: '', ...retenus })
        clearEditTransaction()
        ;(annoncer ?? showToast)(MESSAGES.SUCCESS.TRANSACTION_MODIFIED, 'success')
        setAConfirmer(null)
        onComplete?.()
        return
      }
      await ajouterTransfertArgent(aConfirmer.transaction)
      showToast(MESSAGES.SUCCESS.TRANSACTION_SAVED, 'success')
      // La caisse reste ouverte entre deux clients : les champs se vident, pas la fenêtre.
      setChamps(VIDE)
      setAConfirmer(null)
    } catch (error) {
      showToast(error?.message || 'Erreur lors de la sauvegarde de la transaction', 'error')
      logger.user.error('Transfert d’argent', error)
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }, [aConfirmer, enModif, modifierTransfertArgent, ajouterTransfertArgent, clearEditTransaction, annoncer, showToast, onComplete])

  const annuler = () => {
    clearEditTransaction()
    onCancel?.()
  }

  const idTitre = useId()
  const desactive = !evaluation.ok || enCours

  return (
    <div>
      <div className="space-y-4 rounded-lg border border-line p-5">
        <Choix
          legende="Service :"
          nom="service"
          options={SERVICES_TRANSFERT.map((service) => ({ cle: service, libelle: service }))}
          valeur={champs.service}
          onChange={fixer('service')}
        />
        {champs.service === 'Autres' && (
          <div>
            <label htmlFor={ids.precise} className="block text-sm font-medium text-gray-700 mb-1">Précisez (facultatif)</label>
            <input id={ids.precise} type="text" maxLength={40} value={champs.servicePrecise} onChange={saisir('servicePrecise')} className={`${CHAMP} max-w-xs`} />
          </div>
        )}

        <Choix
          legende="Opération :"
          nom="operation"
          options={OPERATIONS}
          valeur={champs.operation}
          onChange={fixer('operation')}
          desactivee={(cle) => Boolean(enModif) && cle !== enModif.operation}
        />

        <div>
          <label htmlFor={ids.nom} className={LIBELLE}>Nom du client</label>
          <input id={ids.nom} type="text" maxLength={60} autoComplete="off" value={champs.nomClient} onChange={saisir('nomClient')} className={CHAMP} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.tel} className="block text-sm font-medium text-gray-700 mb-1">Téléphone (facultatif)</label>
            <input id={ids.tel} type="text" inputMode="numeric" autoComplete="off" value={champs.telephone} onChange={saisir('telephone')} className={`${CHAMP} font-mono tabular-nums`} />
          </div>
          <div>
            <label htmlFor={ids.code} className="block text-sm font-medium text-gray-700 mb-1">Code (facultatif)</label>
            <input id={ids.code} type="text" maxLength={30} autoComplete="off" value={champs.codeTransfert} onChange={saisir('codeTransfert')} className={`${CHAMP} font-mono`} />
          </div>
        </div>

        <div>
          <label htmlFor={ids.montant} className={LIBELLE}>Montant (FCFA)</label>
          {/* Aligné à droite en chiffres à chasse fixe, borné : la convention de caisse de TransactionForm. */}
          <input
            id={ids.montant}
            type="number"
            value={champs.montant}
            onChange={saisir('montant')}
            placeholder="Saisir le montant"
            className="w-full max-w-xs rounded border-2 border-line px-3 py-2 text-right font-mono text-lg tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </div>

        <Choix
          legende={estRetrait ? 'Payé en :' : 'Reçu en :'}
          nom="reserveTransfert"
          options={VASES.map(({ cle, libelle }) => ({ cle, libelle }))}
          valeur={champs.balanceType}
          onChange={fixer('balanceType')}
        />

        {!evaluation.ok && (
          <div className="rounded border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">{evaluation.raison}</div>
        )}

        <div className="flex flex-wrap gap-4 pt-4">
          <button
            type="button"
            onClick={demander}
            disabled={desactive}
            title={evaluation.ok ? 'Enregistrer en non terminée' : evaluation.raison}
            className={`rounded px-6 py-2 font-medium transition-colors ${
              desactive ? 'cursor-not-allowed bg-gray-200 text-gray-500' : 'bg-brand-500 text-white hover:bg-brand-600'
            }`}
          >
            {enModif ? 'Sauvegarder' : 'Non Terminées'}
          </button>
          {enModif && (
            <button
              type="button"
              onClick={annuler}
              className="rounded border border-line bg-surface px-6 py-2 font-medium text-ink transition-colors hover:bg-brand-50"
            >
              Annuler
            </button>
          )}
        </div>
      </div>

      {aConfirmer && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby={idTitre} className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 id={idTitre} className="text-xl font-bold text-ink">Confirmer la transaction</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-700">
              <p><span className="font-semibold">Service :</span> <span>{aConfirmer.details.service}</span></p>
              <p><span className="font-semibold">Opération :</span> {aConfirmer.details.operation}</p>
              <p><span className="font-semibold">Client :</span> <span>{aConfirmer.details.clientName}</span></p>
              <p><span className="font-semibold">Montant :</span> {aConfirmer.details.amount} FCFA</p>
              <p>{aConfirmer.details.reserve}</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setAConfirmer(null)}
                disabled={enCours}
                className="rounded border border-line px-4 py-2 font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmer}
                disabled={enCours}
                className="rounded bg-brand-500 px-4 py-2 font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400"
              >
                {enCours ? 'Sauvegarde...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} type={toast.type} duration={toast.duration} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  )
}

export default TransfertArgentForm
