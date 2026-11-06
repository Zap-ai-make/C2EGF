import { repartirValeurAgent } from '../../utils/agentFields.js'
import { useState, useEffect, useMemo, useCallback, useId } from 'react'
import { Lightbulb, AlertTriangle } from 'lucide-react'
import ClientSearch from './ClientSearch'
import ClientInfoDisplay from './ClientInfoDisplay'
import { useToast } from '../../hooks/useToast'
import { useTransactions } from '../../context/transactions.jsx'
import { stockDejaPris } from '../../utils/financialImpact.js'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import Toast from '../Toast'
import { NETWORK_OPTIONS, TRANSACTION_TYPES, MESSAGES } from '../../utils/constants.js'
import { EN_ATTENTE } from '../../services/fileEnvoi.js'
import logger from '../../utils/logger.js'
import { reconnaitreClient } from '../../utils/rechercheClients.js'
import {
  clientDeLaTransaction,
  evaluerTransaction,
  preparerTransaction,
  estValidationDirecte,
  reseauxDisponibles,
  normaliserLibelle,
} from '../../utils/preparationTransaction.js'
import Dialog from '../ui/Dialog'
import ClientForm from '../ClientForm'

function TransactionForm({ clients, embedded = false, onComplete, onCancel, onAddClient = null, annoncer = null }) {
  const { toasts, showToast, removeToast } = useToast()
  const { addTransaction, editingTransaction, clearEditTransaction, updateTransaction, saveReopenedCorrection } = useTransactions()
  const { validateAmount, getStock, getLiquidite, getFormattedStock } = useSimpleNetworkData()
  const [selectedClient, setSelectedClient] = useState(null)
  const [manualAgentCode, setManualAgentCode] = useState('')
  const [clientSearchResetToken, setClientSearchResetToken] = useState(0)
  const [amount, setAmount] = useState('')
  const [network, setNetwork] = useState('Orange')
  // Les libellés visibles RELIÉS à leur champ : sans ce lien, un lecteur
  // d'écran annonçait « zone d'édition, nombre » sur le montant (UI-03, TC-320).
  const idMontant = useId()
  const idReseau = useId()
  const [transactionType, setTransactionType] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState(null)
  // Le code tapé pour lequel on enregistre une fiche, ou null : la fenêtre est fermée.
  const [clientACreer, setClientACreer] = useState(null)


  // Remplir le formulaire si une transaction est en cours d'édition
  useEffect(() => {
    if (editingTransaction) {
      setSelectedClient(editingTransaction.client)
      setAmount(editingTransaction.montant.toString())
      setNetwork(editingTransaction.reseau)
      setTransactionType(editingTransaction.type)
    }
  }, [editingTransaction])

  // Auto-sélectionner un réseau disponible quand un client est sélectionné
  useEffect(() => {
    if (selectedClient) {
      const currentNetworkKey = network.toLowerCase()
      const isCurrentNetworkAvailable = selectedClient[currentNetworkKey] && selectedClient[currentNetworkKey].trim()

      if (!isCurrentNetworkAvailable) {
        // Trouver le premier réseau disponible
        const availableNetwork = NETWORK_OPTIONS.find(option => {
          const networkKey = option.toLowerCase()
          return selectedClient[networkKey] && selectedClient[networkKey].trim()
        })

        if (availableNetwork) {
          setNetwork(availableNetwork)
          showToast(`Réseau automatiquement sélectionné: ${availableNetwork}`, 'info')
        } else {
          // Aucun réseau disponible pour ce client - fallback gracieux
          console.warn('Aucun réseau disponible pour le client:', selectedClient)
          showToast(
            `Attention : ${selectedClient.nom} ${selectedClient.prenom} n'a aucun code réseau configuré. Veuillez configurer au moins un réseau pour ce client.`,
            'warning'
          )
          // Garder le réseau par défaut pour permettre la saisie mais désactiver la validation
          setNetwork('Orange') // réseau par défaut
        }
      }
    }
  }, [selectedClient, network, showToast])

  // ⚠ UN IDENTIFIANT TAPÉ EN ENTIER DÉSIGNE SA FICHE, même sans clic dans la
  //   liste. Avant, il partait sur un « Client Non enregistré » : code gardé,
  //   lien à la fiche perdu. Le code d'abord, le téléphone à défaut ; un
  //   téléphone partagé par deux fiches ne désigne personne, et il faut choisir.
  const reconnaissance = useMemo(
    () => (selectedClient ? null : reconnaitreClient(clients, manualAgentCode)),
    [clients, selectedClient, manualAgentCode],
  )
  const clientDesigne = selectedClient || reconnaissance?.client || null

  // Le client de la transaction : la fiche désignée, sinon le code tapé.
  const transactionClient = useMemo(
    () => clientDeLaTransaction({ client: clientDesigne, codeTape: manualAgentCode, reseau: network }),
    [clientDesigne, manualAgentCode, network],
  )

  // En modification, la ligne a déjà pris son stock : le contrôle ne le lui redemande
  // pas. Sans cela, corriger un dépôt à la baisse était refusé quand le stock était
  // à sec, alors que la correction en rend. Le serveur reste le garant.
  const controlerStock = useCallback((reseau, montant, type) => {
    const marge = editingTransaction && reseau === editingTransaction.reseau
      ? (editingTransaction.stockDejaPris ?? stockDejaPris(editingTransaction))
      : 0
    return validateAmount(reseau, montant, type, marge)
  }, [editingTransaction, validateAmount])

  // Ce que les boutons permettent, et pourquoi pas. Les règles vivent dans
  // preparationTransaction.js : l'assistant prépare avec les mêmes.
  const formValidation = useMemo(() => evaluerTransaction({
    client: transactionClient,
    ambigus: reconnaissance?.ambigus,
    montant: amount,
    type: transactionType,
    reseau: network,
    validateAmount: controlerStock,
    liquidite: getLiquidite(),
  }), [transactionClient, reconnaissance, amount, transactionType, network, controlerStock, getLiquidite])

  const handleSubmit = useCallback(async (statut) => {
    const isDirectValidation = estValidationDirecte(statut)
    if (!formValidation.isFormValid || isSubmitting || (isDirectValidation && !formValidation.actionStates.canValidate)) {
      if (!formValidation.isFormValid) {
        const reason = formValidation.stockValidation.message ||
          formValidation.networkValidation.message ||
          (isDirectValidation ? formValidation.actionStates.validateReason : formValidation.actionStates.nonTermineeReason) ||
          MESSAGES.ERRORS.FORM_INCOMPLETE
        showToast(reason, 'error')
      }
      else if (isDirectValidation && !formValidation.actionStates.canValidate) showToast(formValidation.actionStates.validateReason, 'error')
      return
    }

    setIsSubmitting(true)

    const preparation = preparerTransaction({
      client: transactionClient,
      reseau: network,
      montant: amount,
      type: transactionType,
      statut,
    })
    if (!preparation.ok) {
      showToast(preparation.raison, 'error')
      setIsSubmitting(false)
      return
    }

    setPendingConfirmation({
      transactionData: preparation.transactionData,
      isDirectValidation,
      details: preparation.details,
    })
    setIsSubmitting(false)
  }, [
    formValidation.isFormValid,
    formValidation.stockValidation.message,
    formValidation.networkValidation.message,
    formValidation.actionStates.canValidate,
    formValidation.actionStates.validateReason,
    formValidation.actionStates.nonTermineeReason,
    isSubmitting,
    transactionClient,
    network,
    amount,
    transactionType,
    showToast
  ])

  const confirmPendingSubmit = useCallback(async () => {
    if (!pendingConfirmation) return

    setIsSubmitting(true)

    try {
      if (editingTransaction) {
        // Une ligne venue de l'historique y RETOURNE : on enchaîne la
        // correction et la revalidation par le mode de règlement mémorisé, au
        // lieu de l'abandonner dans les non terminées où la caissière devrait
        // la retrouver et la revalider à la main.
        const issue = editingTransaction.reopenedFromHistoryId
          ? await saveReopenedCorrection(editingTransaction, pendingConfirmation.transactionData)
          : await updateTransaction(editingTransaction.id, pendingConfirmation.transactionData)
        clearEditTransaction()
        // Le formulaire se ferme juste après : son message partirait avec lui. La
        // page qui le porte le garde à l'écran.
        const dire = annoncer ?? showToast
        if (issue?.statut === EN_ATTENTE) dire(MESSAGES.EN_ATTENTE.MODIFICATION, 'info')
        else dire(
          editingTransaction.reopenedFromHistoryId
            ? MESSAGES.SUCCESS.TRANSACTION_CORRECTED
            : MESSAGES.SUCCESS.TRANSACTION_MODIFIED,
          'success',
        )
      } else {
        const issue = await addTransaction(pendingConfirmation.transactionData)
        if (issue?.statut === EN_ATTENTE) showToast(MESSAGES.EN_ATTENTE.TRANSACTION, 'info')
        else showToast(
          pendingConfirmation.isDirectValidation ? MESSAGES.SUCCESS.TRANSACTION_VALIDATED : MESSAGES.SUCCESS.TRANSACTION_SAVED,
          'success'
        )
      }

      setSelectedClient(null)
      setManualAgentCode('')
      setClientSearchResetToken(prev => prev + 1)
      setAmount('')
      setNetwork(NETWORK_OPTIONS[0])
      setTransactionType('')
      setPendingConfirmation(null)

      // La caisse reste ouverte entre deux clients : les champs sont vidés, pas
      // la fenêtre. Rouvrir la modale à chaque passage coûtait un geste par
      // client, toute la journée. En MODIFICATION c'est l'inverse : rien à
      // enchaîner, et un formulaire vide après une sauvegarde laisserait croire
      // qu'on peut encore agir sur la ligne qu'on vient de quitter.
      if (editingTransaction) onComplete?.()
    } catch (error) {
      showToast(error?.message || 'Erreur lors de la sauvegarde de la transaction', 'error')
      logger.user.error('Transaction save', error)
    } finally {
      setIsSubmitting(false)
    }
  }, [pendingConfirmation, editingTransaction, updateTransaction, saveReopenedCorrection, clearEditTransaction, showToast, annoncer, addTransaction, onComplete])

  const cancelPendingSubmit = useCallback(() => {
    setPendingConfirmation(null)
  }, [])

  /**
   * Enregistrer la fiche du client SANS quitter la transaction.
   *
   * La fiche part par le même chemin que l'onglet Clients (`onAddClient`, donc
   * le même contrôle de doublon côté serveur), puis devient le client de la
   * transaction. Un refus laisse la fenêtre ouverte : ClientForm affiche la
   * raison, et rien n'est choisi à la place de la caissière.
   */
  const enregistrerNouveauClient = useCallback(async (donnees) => {
    const cree = await onAddClient(donnees)
    setClientACreer(null)
    if (cree?.id) {
      setSelectedClient(cree)
      setManualAgentCode('')
      if (cree.enAttente) showToast(MESSAGES.EN_ATTENTE.CLIENT, 'info')
      else showToast(`Client enregistré : ${[cree.prenom, cree.nom].filter(Boolean).join(' ')}`, 'success')
    }
  }, [onAddClient, showToast])

  /** Le contrôle de doublon a trouvé la fiche : c'est elle, la cliente. */
  const choisirFicheExistante = useCallback((fiche) => {
    setClientACreer(null)
    setSelectedClient(fiche)
    setManualAgentCode('')
  }, [])

  /** Le code tapé pré-remplit le bon champ : sept chiffres → code, huit → numéro. */
  const valeursDeDepart = useMemo(() => {
    if (clientACreer === null) return null
    return /\d/.test(clientACreer) ? repartirValeurAgent(clientACreer) : { nom: clientACreer }
  }, [clientACreer])

  const handleCancel = useCallback(() => {
    clearEditTransaction()
    // Reset form
    setSelectedClient(null)
    setManualAgentCode('')
    setClientSearchResetToken(prev => prev + 1)
    setAmount('')
    setNetwork('Orange')
    setTransactionType('')
    showToast(MESSAGES.SUCCESS.MODIFICATION_CANCELLED, 'info')
    onCancel?.()
  }, [clearEditTransaction, showToast, onCancel])

  const nonTermineeDisabledReason = !formValidation.isFormValid || !formValidation.actionStates.canMarkAsNonTermine
    ? formValidation.actionStates.nonTermineeReason
    : ''
  const validateDisabledReason = !formValidation.isFormValid || !formValidation.actionStates.canValidate
    ? formValidation.actionStates.validateReason
    : ''

  return (
    <div className={embedded ? '' : 'rounded-lg bg-white p-6 shadow-md'}>
      {editingTransaction && (
        <div className="mb-4 rounded border border-brand-200 bg-brand-50 p-3">
          <h3 className="text-lg font-medium text-brand-600">
            Modification de la transaction
          </h3>
        </div>
      )}
      {/* Le filet qui enferme la saisie : il dit où commence et où finit ce que
          le gérant doit remplir, dans une modale où le fond de l'écran reste
          visible. Sans lui, les champs flottaient contre le bord du dialogue. */}
      <div className="space-y-4 rounded-lg border border-line p-5">
        {/* Recherche de client */}
        <div>
          <ClientSearch 
            clients={clients} 
            onClientSelect={setSelectedClient}
            selectedClient={selectedClient}
            onManualCodeChange={setManualAgentCode}
            onEnregistrerNouveau={onAddClient ? setClientACreer : null}
            resetToken={clientSearchResetToken}
          />
        </div>

        {/* Affichage des informations du client sélectionné */}
        <ClientInfoDisplay client={clientDesigne || (manualAgentCode.trim() && !reconnaissance?.ambigus ? {
          nom: 'Client',
          prenom: 'Non enregistré',
          orange: manualAgentCode.trim(),
          isManual: true
        } : null)} />

        {/* Montant */}
        <div>
          <label htmlFor={idMontant} className="block text-lg font-semibold text-gray-700 mb-1">
            Montant (FCFA) :
          </label>
          <input
            id={idMontant}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Saisir le montant"
            /* Aligné à droite et en chiffres à chasse fixe : un montant se lit
               par ses unités, et deux saisies successives doivent s'aligner
               colonne par colonne. C'est la convention de toute caisse.

               Mais un champ pleine largeur renvoyait les chiffres loin du
               libellé : on tapait à un bout de la ligne en lisant à l'autre.
               Le champ est donc borné — il reste assez large pour un montant à
               neuf chiffres, pas davantage. */
            className={`w-full max-w-xs px-3 py-2 border-2 rounded text-right font-mono text-lg tabular-nums focus:outline-none transition-colors ${
              formValidation.stockValidation.isValid
                ? 'border-line focus-visible:ring-2 focus-visible:ring-brand-400'
                : 'border-danger focus-visible:ring-2 focus-visible:ring-danger'
            }`}
          />

          {/* Indicateur de stock disponible avec alertes */}
          {network && ['depot', 'credit'].includes(normaliserLibelle(transactionType)) && (
            <div className="mt-2 space-y-1">
              <div className="text-sm text-gray-600">
                Stock disponible pour {network}: <span className="font-semibold">{getFormattedStock(network)} FCFA</span>
              </div>

              {/* Alertes de stock */}
              {(() => {
                const currentStock = getStock(network)
                if (currentStock <= 0) {
                  return (
                    <div className="flex items-center gap-2 rounded border border-danger/30 bg-danger-soft p-2 text-sm">
                      <div className="h-2 w-2 rounded-full bg-danger motion-safe:animate-pulse" />
                      <span className="font-medium text-danger">Stock épuisé</span>
                    </div>
                  )
                } else if (currentStock < 10000) {
                  return (
                    <div className="flex items-center gap-2 rounded border border-warn/30 bg-warn-soft p-2 text-sm">
                      <div className="h-2 w-2 rounded-full bg-warn motion-safe:animate-pulse" />
                      <span className="font-medium text-warn">Stock très faible</span>
                    </div>
                  )
                } else if (currentStock < 25000) {
                  return (
                    <div className="flex items-center gap-2 rounded border border-warn/30 bg-warn-soft p-2 text-sm">
                      <div className="h-2 w-2 rounded-full bg-warn" />
                      <span className="font-medium text-warn">Stock faible</span>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          )}

          {/* Message d'erreur de validation */}
          {!formValidation.stockValidation.isValid && (
            <div className="mt-1 text-sm text-danger">
              {formValidation.stockValidation.message}
            </div>
          )}
        </div>

        {/* Réseau — le SÉLECTEUR n'apparaît qu'à partir de deux réseaux.
            C2EGF n'en opère qu'un : demander à chaque saisie de choisir dans une
            liste d'un seul élément était un geste pour rien, et un geste de
            travers possible. Le réseau continue d'être porté par l'état et
            envoyé avec la transaction ; il vient du profil au lieu de la main.
            Les messages de validation, eux, restent affichés dans tous les cas :
            « ce client n'a pas de code Orange » doit se voir même sans liste. */}
        <div>
          {NETWORK_OPTIONS.length > 1 && (
          <>
          <label htmlFor={idReseau} className="block text-lg font-semibold text-gray-700 mb-1">
            Réseau :
          </label>
          <select
            id={idReseau}
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className={`w-full px-3 py-2 border-2 rounded focus:outline-none bg-white transition-colors ${
              formValidation.networkValidation.isValid
                ? 'border-line focus-visible:ring-2 focus-visible:ring-brand-400'
                : 'border-danger focus-visible:ring-2 focus-visible:ring-danger'
            }`}
          >
            {NETWORK_OPTIONS.map(option => {
              const networkKey = option.toLowerCase()
              const isDisabled = selectedClient && !selectedClient[networkKey]?.trim()

              return (
                <option
                  key={option}
                  value={option}
                  disabled={isDisabled}
                  className={isDisabled ? 'text-gray-400' : ''}
                >
                  {option} {isDisabled ? '(Non disponible)' : ''}
                </option>
              )
            })}
          </select>
          </>
          )}

          {/* Message d'erreur de validation réseau */}
          {!formValidation.networkValidation.isValid && (selectedClient || manualAgentCode.trim()) && (
            <div className="mt-2 space-y-2">
              <div className="text-sm text-danger">
                {formValidation.networkValidation.message}
              </div>

              {/* Suggestion de réseaux disponibles */}
              {reseauxDisponibles(selectedClient).length > 0 && (
                <div className="flex items-start gap-2 text-sm text-brand-400">
                  <Lightbulb aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Réseaux disponibles pour ce client : {reseauxDisponibles(selectedClient).join(', ')}</span>
                </div>
              )}

              {/* Message d'aide si aucun réseau disponible */}
              {selectedClient && reseauxDisponibles(selectedClient).length === 0 && (
                <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn-soft p-2 text-sm text-warn">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                  Ce client n'a aucun code réseau configuré.
                  <br />
                  Rendez-vous dans la section "Clients" pour ajouter au moins un code réseau à ce client.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nature de la transaction */}
        <div>
          <label className="block text-lg font-semibold text-gray-700 mb-1">
            Nature :
          </label>
          {/* Une boîte par nature, au lieu d'un bloc unique coupé d'un trait :
              chaque option devient une cible franche, et la sélection se lit
              sur la boîte elle-même. La teinte retenue (entrée / sortie) ne
              porte jamais seule l'information — le radio natif reste visible et
              coché (DESIGN.md §5). */}
          <div className="flex flex-col gap-3 md:flex-row">
            {TRANSACTION_TYPES.map((type) => {
              const actif = transactionType === type.value
              const nature = normaliserLibelle(type.value)
              const teinte = !actif
                ? 'border-line bg-surface hover:border-brand-200'
                : nature === 'depot' ? 'border-inflow bg-inflow-soft'
                : nature === 'retrait' ? 'border-outflow bg-outflow-soft'
                : 'border-pending bg-pending-soft'

              return (
                <label
                  key={type.value}
                  className={`flex flex-1 cursor-pointer items-center gap-3 rounded border-2 px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand-400 ${teinte}`}
                >
                  <input
                    type="radio"
                    name="transactionType"
                    value={type.value}
                    checked={actif}
                    onChange={(e) => setTransactionType(e.target.value)}
                    className="h-4 w-4 accent-brand-500 focus:outline-none"
                  />
                  <span className={`font-semibold ${actif ? 'text-ink' : 'text-gray-700'}`}>{type.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Boutons d'action */}
        {(nonTermineeDisabledReason || validateDisabledReason) && (
          <div className="rounded border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
            {validateDisabledReason || nonTermineeDisabledReason}
          </div>
        )}

        <div className="flex flex-wrap gap-4 pt-4">
          {editingTransaction ? (
            <>
              <button
                onClick={() => handleSubmit('Non Terminées')}
                disabled={!formValidation.isFormValid || isSubmitting}
                className={`px-6 py-2 rounded font-medium transition-colors ${
                  !formValidation.isFormValid || isSubmitting
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-brand-500 hover:bg-brand-600 text-white'
                }`}
              >
                {isSubmitting ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button
                onClick={handleCancel}
                className="rounded border border-line bg-surface px-6 py-2 font-medium text-ink transition-colors hover:bg-brand-50"
              >
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleSubmit('Non Terminées')}
                disabled={!formValidation.actionStates.canMarkAsNonTermine || !formValidation.isFormValid || isSubmitting}
                className={`px-6 py-2 rounded font-medium transition-colors ${
                  !formValidation.actionStates.canMarkAsNonTermine || !formValidation.isFormValid || isSubmitting
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'border border-line bg-surface text-ink hover:bg-brand-50'
                }`}
                title={
                  isSubmitting
                    ? 'Traitement en cours...'
                    : !formValidation.isFormValid
                    ? nonTermineeDisabledReason
                    : !formValidation.actionStates.canMarkAsNonTermine
                    ? nonTermineeDisabledReason
                    : 'Marquer la transaction comme non terminée'
                }
              >
                {isSubmitting ? 'Traitement...' : 'Non Terminées'}
              </button>

              <button
                onClick={() => handleSubmit('Validée')}
                disabled={!formValidation.actionStates.canValidate || !formValidation.isFormValid || isSubmitting}
                className={`px-6 py-2 rounded font-medium transition-colors ${
                  !formValidation.actionStates.canValidate || !formValidation.isFormValid || isSubmitting
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-brand-500 hover:bg-brand-600 text-white'
                }`}
                title={
                  isSubmitting
                    ? 'Validation en cours...'
                    : !formValidation.isFormValid
                    ? validateDisabledReason
                    : !formValidation.actionStates.canValidate
                    ? validateDisabledReason
                    : 'Valider la transaction immédiatement'
                }
              >
                {isSubmitting ? 'Validation...' : 'Valider'}
              </button>
            </>
          )}
        </div>
      </div>

      {pendingConfirmation && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-ink">Confirmer la transaction</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-700">
              <p><span className="font-semibold">Client:</span> {pendingConfirmation.details.clientName}</p>
              <p><span className="font-semibold">Nature:</span> {pendingConfirmation.details.type}</p>
              <p><span className="font-semibold">Montant:</span> {pendingConfirmation.details.amount} FCFA</p>
              <p><span className="font-semibold">Réseau:</span> {pendingConfirmation.details.network}</p>
              <p><span className="font-semibold">Statut:</span> {pendingConfirmation.details.statut}</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={cancelPendingSubmit}
                disabled={isSubmitting}
                className="rounded border border-line px-4 py-2 font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmPendingSubmit}
                disabled={isSubmitting}
                className="rounded bg-brand-500 px-4 py-2 font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400"
              >
                {isSubmitting ? 'Sauvegarde...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {onAddClient && (
        <Dialog
          open={clientACreer !== null}
          onClose={() => setClientACreer(null)}
          title="Enregistrer un client"
          description="Les champs marqués d'une étoile sont obligatoires"
          largeur="max-w-6xl"
          spacious
          testId="nouveau-client-dialog"
        >
          {clientACreer !== null && (
            <ClientForm
              embedded
              valeursDeDepart={valeursDeDepart}
              onSubmit={enregistrerNouveauClient}
              onOuvrirFiche={choisirFicheExistante}
            />
          )}
        </Dialog>
      )}

      {/* Toasts */}
      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default TransactionForm
