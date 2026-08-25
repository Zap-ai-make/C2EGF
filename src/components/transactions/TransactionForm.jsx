import { useState, useEffect, useMemo, useCallback } from 'react'
import ClientSearch from './ClientSearch'
import ClientInfoDisplay from './ClientInfoDisplay'
import { useToast } from '../../hooks/useToast'
import { useTransactions } from '../../context/transactions.jsx'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import Toast from '../Toast'
import { NETWORK_OPTIONS, TRANSACTION_TYPES, NETWORK_CODES, MESSAGES } from '../../utils/constants.js'
import { validateTransactionForm, validateTransactionAction } from '../../utils/helpers.js'
import logger from '../../utils/logger.js'
import { parseFcfaAmount } from '../../utils/fcfaAmount.js'

const normalizeLabel = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

function TransactionForm({ clients }) {
  const { toasts, showToast, removeToast } = useToast()
  const { addTransaction, editingTransaction, clearEditTransaction, updateTransaction } = useTransactions()
  const { validateAmount, getStock, getLiquidite, getFormattedStock } = useSimpleNetworkData()
  const [selectedClient, setSelectedClient] = useState(null)
  const [manualAgentCode, setManualAgentCode] = useState('')
  const [clientSearchResetToken, setClientSearchResetToken] = useState(0)
  const [amount, setAmount] = useState('')
  const [network, setNetwork] = useState('Orange')
  const [transactionType, setTransactionType] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState(null)


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
            `⚠️ Attention: ${selectedClient.nom} ${selectedClient.prenom} n'a aucun code réseau configuré. Veuillez configurer au moins un réseau pour ce client.`,
            'warning'
          )
          // Garder le réseau par défaut pour permettre la saisie mais désactiver la validation
          setNetwork('Orange') // réseau par défaut
        }
      }
    }
  }, [selectedClient, network, showToast])

  // Fonction pour vérifier si le client a des réseaux disponibles
  const getClientAvailableNetworks = (client) => {
    if (client?.isManual) return NETWORK_OPTIONS
    if (!client) return []

    return NETWORK_OPTIONS.filter(option => {
      const networkKey = option.toLowerCase()
      return client[networkKey] && client[networkKey].trim()
    })
  }

  // Fonction pour vérifier si la combinaison client/réseau est valide
  const isClientNetworkValid = (client, selectedNetwork) => {
    if (client?.isManual) return Boolean(client.orange?.trim())
    if (!client || !selectedNetwork) return false

    const networkKey = selectedNetwork.toLowerCase()
    return client[networkKey] && client[networkKey].trim()
  }

  // Validation complète du formulaire et des boutons d'action
  const formValidation = useMemo(() => {
    const manualCode = manualAgentCode.trim()
    const transactionClient = selectedClient || (manualCode ? {
      id: `manual-${network}-${manualCode}`,
      nom: 'Client',
      prenom: 'Non enregistré',
      orange: manualCode,
      isManual: true
    } : null)

    if (!transactionClient || !amount || !transactionType || !network) {
      return {
        isFormValid: false,
        stockValidation: { isValid: true, message: '' },
        networkValidation: { isValid: true, message: '' },
        actionStates: {
          canMarkAsNonTermine: false,
          canValidate: false,
          nonTermineeReason: 'Veuillez remplir tous les champs requis',
          validateReason: 'Veuillez remplir tous les champs requis'
        }
      }
    }

    // Validation de la combinaison client/réseau
    const isNetworkValid = isClientNetworkValid(transactionClient, network)
    const availableNetworks = getClientAvailableNetworks(transactionClient)

    const networkValidation = {
      isValid: isNetworkValid,
      message: isNetworkValid ? '' :
        availableNetworks.length > 0
          ? `Ce client n'a pas de code ${network}. Réseaux disponibles: ${availableNetworks.join(', ')}`
          : `Ce client n'a aucun code réseau configuré. Veuillez d'abord configurer au moins un réseau.`
    }

    const stockValidation = validateAmount(network, amount, transactionType)
    const basicFormValid = validateTransactionForm(transactionClient, amount, transactionType)
    const amountValue = parseFcfaAmount(amount) || 0
    const liquidityAvailable = getLiquidite()
    const normalizedType = normalizeLabel(transactionType)
    const isWithdrawal = normalizedType === 'retrait'
    const directValidation = {
      isValid: !isWithdrawal || amountValue <= liquidityAvailable,
      reason: isWithdrawal && amountValue > liquidityAvailable
        ? `Liquidité insuffisante. Disponible: ${liquidityAvailable.toLocaleString('fr-FR')} FCFA`
        : ''
    }

    // Utiliser la nouvelle logique de validation
    const hasStock = stockValidation.isValid && isNetworkValid
    const context = { hasStock, amount: amountValue }

    const nonTermineeValidation = validateTransactionAction(transactionType, 'nonTerminee', context)
    const validateValidation = validateTransactionAction(transactionType, 'valider', context)

    // Adapter les raisons en fonction des problèmes détectés
    const adaptReason = (originalReason) => {
      if (!isNetworkValid) {
        return networkValidation.message
      }
      return originalReason
    }

    return {
      isFormValid: basicFormValid && stockValidation.isValid && networkValidation.isValid,
      stockValidation,
      networkValidation,
      actionStates: {
        canMarkAsNonTermine: nonTermineeValidation.allowed && networkValidation.isValid,
        canValidate: validateValidation.allowed && networkValidation.isValid && directValidation.isValid,
        nonTermineeReason: adaptReason(nonTermineeValidation.reason || ''),
        validateReason: adaptReason(directValidation.reason || validateValidation.reason || '')
      }
    }
  }, [selectedClient, manualAgentCode, amount, transactionType, network, validateAmount, getLiquidite])

  const handleSubmit = useCallback(async (statut) => {
    const isDirectValidation = normalizeLabel(statut) === 'validee'
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

    // Récupérer le code spécifique du client pour le réseau sélectionné
    const manualCode = manualAgentCode.trim()
    const transactionClient = selectedClient || (manualCode ? {
      id: `manual-${network}-${manualCode}`,
      nom: 'Client',
      prenom: 'Non enregistré',
      orange: manualCode,
      isManual: true
    } : null)

    if (!transactionClient) {
      showToast('Veuillez sélectionner un client ou saisir un numéro/code agent', 'error')
      setIsSubmitting(false)
      return
    }

    const networkKey = network.toLowerCase()
    const clientCode = transactionClient[networkKey]?.trim() || NETWORK_CODES[network] || '000000'

    // Vérifier que le client a bien un code pour ce réseau
    if (!transactionClient[networkKey]?.trim()) {
      showToast(`${transactionClient.nom} ${transactionClient.prenom} n'a pas de code ${network}`, 'error')
      setIsSubmitting(false)
      return
    }

    const amountValue = parseFcfaAmount(amount)
    if (amountValue === null) {
      showToast('Le montant doit être un entier strictement positif en FCFA', 'error')
      setIsSubmitting(false)
      return
    }
    const clientName = `${transactionClient.prenom || ''} ${transactionClient.nom || ''}`.trim()
    const confirmationMessage = [
      'Confirmer cette transaction ?',
      '',
      `Client: ${clientName}`,
      `Nature: ${transactionType}`,
      `Montant: ${amountValue.toLocaleString('fr-FR')} FCFA`,
      `Réseau: ${network}`,
      `Statut: ${statut}`
    ].join('\n')

    void confirmationMessage

    const transactionData = {
      client: transactionClient,
      clientId: transactionClient.id,
      type: transactionType,
      reseau: network,
      code: clientCode,
      montant: amountValue,
      statut: statut
    }

    setPendingConfirmation({
      transactionData,
      isDirectValidation,
      details: {
        clientName,
        type: transactionType,
        amount: amountValue.toLocaleString('fr-FR'),
        network,
        statut
      }
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
    selectedClient,
    manualAgentCode,
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
        await updateTransaction(editingTransaction.id, pendingConfirmation.transactionData)
        clearEditTransaction()
        showToast(MESSAGES.SUCCESS.TRANSACTION_MODIFIED, 'success')
      } else {
        await addTransaction(pendingConfirmation.transactionData)
        showToast(
          pendingConfirmation.isDirectValidation ? MESSAGES.SUCCESS.TRANSACTION_VALIDATED : MESSAGES.SUCCESS.TRANSACTION_SAVED,
          'success'
        )
      }

      setSelectedClient(null)
      setManualAgentCode('')
      setClientSearchResetToken(prev => prev + 1)
      setAmount('')
      setNetwork('Orange')
      setTransactionType('')
      setPendingConfirmation(null)
    } catch (error) {
      showToast(error?.message || 'Erreur lors de la sauvegarde de la transaction', 'error')
      logger.user.error('Transaction save', error)
    } finally {
      setIsSubmitting(false)
    }
  }, [pendingConfirmation, editingTransaction, updateTransaction, clearEditTransaction, showToast, addTransaction])

  const cancelPendingSubmit = useCallback(() => {
    setPendingConfirmation(null)
  }, [])

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
  }, [clearEditTransaction, showToast])

  const nonTermineeDisabledReason = !formValidation.isFormValid || !formValidation.actionStates.canMarkAsNonTermine
    ? formValidation.actionStates.nonTermineeReason
    : ''
  const validateDisabledReason = !formValidation.isFormValid || !formValidation.actionStates.canValidate
    ? formValidation.actionStates.validateReason
    : ''

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {editingTransaction && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <h3 className="text-lg font-medium text-blue-800">
            Modification de la transaction
          </h3>
        </div>
      )}
      <div className="space-y-4">
        {/* Recherche de client */}
        <div>
          <ClientSearch 
            clients={clients} 
            onClientSelect={setSelectedClient}
            selectedClient={selectedClient}
            onManualCodeChange={setManualAgentCode}
            resetToken={clientSearchResetToken}
          />
        </div>

        {/* Affichage des informations du client sélectionné */}
        <ClientInfoDisplay client={selectedClient || (manualAgentCode.trim() ? {
          nom: 'Client',
          prenom: 'Non enregistré',
          orange: manualAgentCode.trim(),
          isManual: true
        } : null)} />

        {/* Montant */}
        <div>
          <label className="block text-lg font-semibold text-gray-700 mb-1">
            Montant (FCFA) :
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Saisir le montant"
            className={`w-full px-3 py-2 border-2 rounded focus:outline-none transition-colors ${
              formValidation.stockValidation.isValid
                ? 'border-gray-300 focus:border-green-500'
                : 'border-red-300 focus:border-red-500'
            }`}
          />

          {/* Indicateur de stock disponible avec alertes */}
          {network && ['depot', 'credit'].includes(normalizeLabel(transactionType)) && (
            <div className="mt-2 space-y-1">
              <div className="text-sm text-gray-600">
                Stock disponible pour {network}: <span className="font-semibold">{getFormattedStock(network)} FCFA</span>
              </div>

              {/* Alertes de stock */}
              {(() => {
                const currentStock = getStock(network)
                if (currentStock <= 0) {
                  return (
                    <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-sm">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-red-700 font-medium">Stock épuisé</span>
                    </div>
                  )
                } else if (currentStock < 10000) {
                  return (
                    <div className="flex items-center gap-2 p-2 bg-orange-50 border border-orange-200 rounded text-sm">
                      <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                      <span className="text-orange-700 font-medium">Stock très faible</span>
                    </div>
                  )
                } else if (currentStock < 25000) {
                  return (
                    <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full" />
                      <span className="text-yellow-700 font-medium">Stock faible</span>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          )}

          {/* Message d'erreur de validation */}
          {!formValidation.stockValidation.isValid && (
            <div className="mt-1 text-sm text-red-600">
              {formValidation.stockValidation.message}
            </div>
          )}
        </div>

        {/* Réseau */}
        <div>
          <label className="block text-lg font-semibold text-gray-700 mb-1">
            Réseau :
          </label>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className={`w-full px-3 py-2 border-2 rounded focus:outline-none bg-white transition-colors ${
              formValidation.networkValidation.isValid
                ? 'border-gray-300 focus:border-green-500'
                : 'border-red-300 focus:border-red-500'
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

          {/* Message d'erreur de validation réseau */}
          {!formValidation.networkValidation.isValid && (selectedClient || manualAgentCode.trim()) && (
            <div className="mt-2 space-y-2">
              <div className="text-sm text-red-600">
                {formValidation.networkValidation.message}
              </div>

              {/* Suggestion de réseaux disponibles */}
              {getClientAvailableNetworks(selectedClient).length > 0 && (
                <div className="text-sm text-blue-600">
                  💡 Réseaux disponibles pour ce client : {getClientAvailableNetworks(selectedClient).join(', ')}
                </div>
              )}

              {/* Message d'aide si aucun réseau disponible */}
              {selectedClient && getClientAvailableNetworks(selectedClient).length === 0 && (
                <div className="text-sm text-orange-600 bg-orange-50 p-2 rounded border border-orange-200">
                  ⚠️ Ce client n'a aucun code réseau configuré.
                  <br />
                  Rendez-vous dans la section "Clients" pour ajouter au moins un code réseau à ce client.
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
          <div className={`border-4 border-gray-300 rounded p-4 transition-colors ${
            normalizeLabel(transactionType) === 'depot' ? 'bg-green-50' :
            normalizeLabel(transactionType) === 'retrait' ? 'bg-blue-50' :
            normalizeLabel(transactionType) === 'credit' ? 'bg-red-50' :
            'bg-white'
          }`}>
          <div className="flex flex-wrap gap-8 md:flex-row flex-col">
            {TRANSACTION_TYPES.map((type, index) => (
              <div key={type.value} className="flex items-center">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="transactionType"
                    value={type.value}
                    checked={transactionType === type.value}
                    onChange={(e) => setTransactionType(e.target.value)}
                    className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                  />
                  <span className="text-gray-700">{type.label}</span>
                </label>
                {index < TRANSACTION_TYPES.length - 1 && (
                  <div className="ml-8 h-8 border-l border-gray-300"></div>
                )}
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* Boutons d'action */}
        {(nonTermineeDisabledReason || validateDisabledReason) && (
          <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
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
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {isSubmitting ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button
                onClick={handleCancel}
                className="px-6 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded font-medium transition-colors"
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
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-orange-500 hover:bg-orange-600 text-white'
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
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
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
            <h3 className="text-xl font-bold text-gray-900">Confirmer la transaction</h3>
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
                className="rounded border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmPendingSubmit}
                disabled={isSubmitting}
                className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
              >
                {isSubmitting ? 'Sauvegarde...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
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
