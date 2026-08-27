import { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { PAYMENT_METHODS } from '../../utils/constants.js'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'
import { SkeletonRow } from '../ui/SkeletonList.jsx'
import EmptyState from '../ui/EmptyState.jsx'
import { ChevronLeft } from 'lucide-react'
import { ClipboardCheck } from 'lucide-react'
import OptimisticToast from '../ui/OptimisticToast.jsx'
import logger from '../../utils/logger.js'
import { generateIdempotencyKey } from '../../services/settlementService.js'

const TransactionTable = memo(function TransactionTable() {
  const { pendingTransactions, getActionButtons, getTransactionStyles, addPaymentTranche, addRefundTranche, startEditTransaction, loading } = useTransactions()
  const { themeClasses } = useTheme()

  // Déduplicateur pour éviter les erreurs de clés React
  const uniquePendingTransactions = useMemo(() => {
    const seen = new Set()
    return (pendingTransactions || []).filter(transaction => {
      if (seen.has(transaction.id)) {
        return false
      }
      seen.add(transaction.id)
      return true
    })
  }, [pendingTransactions])
  const [activeDropdown, setActiveDropdown] = useState(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [currentActionType, setCurrentActionType] = useState(null)
  const [processingActions, setProcessingActions] = useState(new Set())
  const [rollbackToast, setRollbackToast] = useState({ show: false, message: '', type: 'info' })
  const [dropdownStep, setDropdownStep] = useState(1)
  const [selectedMethod, setSelectedMethod] = useState(null)
  const [settlementAmount, setSettlementAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const _buttonRefs = useRef({})
  // Clés d'idempotence stables par action utilisateur.
  // Format de la clé ref : `${draftId}-${actionType}-${method}-${amount}`
  // La clé est générée au moment du premier Confirmer et réutilisée pour les retries.
  // Elle est supprimée après succès confirmé ou recréée si le payload change.
  const pendingKeyRef = useRef({})


  const handleActionClick = useCallback((transactionId, actionType, event) => {
    if ([...processingActions].some(key => key.startsWith(`${transactionId}-`))) {
      return
    }

    if (actionType === 'modifier') {
      const transaction = pendingTransactions.find(t => t.id === transactionId)
      if (transaction) {
        startEditTransaction(transaction)
        // Scroll vers le haut du formulaire
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } else if (actionType === 'payerPar' || actionType === 'rembourser' || actionType === 'encaisser') {
      if (activeDropdown === transactionId) {
        setActiveDropdown(null)
        setCurrentActionType(null)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
      } else {
        const button = event.currentTarget
        const rect = button.getBoundingClientRect()
        const position = {
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX - 50
        }
        setDropdownPosition(position)
        setActiveDropdown(transactionId)
        setCurrentActionType(actionType)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
      }
    }
  }, [pendingTransactions, startEditTransaction, activeDropdown, setActiveDropdown, setCurrentActionType, setDropdownPosition, processingActions])

  const handlePaymentMethodSelect = useCallback(async (transactionId, method, actionType, amount, idempotencyKey) => {
    const actionKey = `${transactionId}-${actionType}-${method}`
    if (processingActions.has(actionKey)) return

    setProcessingActions(prev => new Set(prev).add(actionKey))

    try {
      const transaction = pendingTransactions.find(t => t.id === transactionId)
      if (!transaction) return

      setActiveDropdown(null)
      setCurrentActionType(null)
      setDropdownStep(1)
      setSelectedMethod(null)
      setSettlementAmount('')
      setAmountError('')

      if (actionType === 'rembourser') {
        await addRefundTranche(transactionId, amount, method, idempotencyKey)
      } else {
        await addPaymentTranche(transactionId, amount, method, idempotencyKey)
      }

      // Succès : supprimer la clé (la prochaine action génèrera une nouvelle clé)
      const fingerprint = `${transactionId}-${actionType}-${method}-${amount}`
      delete pendingKeyRef.current[fingerprint]
    } catch (error) {
      logger.user.error('Settlement error', error)

      setRollbackToast({
        show: true,
        message: error?.message || 'Erreur de synchronisation — opération non enregistrée',
        type: 'rollback'
      })

      setTimeout(() => {
        setRollbackToast({ show: false, message: '', type: 'info' })
      }, 4000)
      // En cas d'erreur réseau incertaine, la clé est conservée dans pendingKeyRef
      // pour qu'un retry utilise exactement la même clé (idempotence client).
    } finally {
      setProcessingActions(prev => {
        const newSet = new Set(prev)
        newSet.delete(actionKey)
        return newSet
      })
    }
  }, [processingActions, pendingTransactions, addPaymentTranche, addRefundTranche, setActiveDropdown, setCurrentActionType])


  const handleMethodChosen = useCallback((method) => {
    const transaction = pendingTransactions.find(t => t.id === activeDropdown)
    const defaultAmount = transaction
      ? String(transaction.remainingAmount ?? transaction.montant)
      : ''
    setSelectedMethod(method)
    setSettlementAmount(defaultAmount)
    setAmountError('')
    setDropdownStep(2)
  }, [pendingTransactions, activeDropdown])

  const handleConfirmPayment = useCallback(async () => {
    const amount = parseInt(settlementAmount, 10)
    if (!amount || amount < 500) {
      setAmountError('Montant invalide (minimum 500 FCFA, entier)')
      return
    }
    const transaction = pendingTransactions.find(t => t.id === activeDropdown)

    // Validation du maximum selon le type d'action
    if (currentActionType !== 'rembourser') {
      // Paiement : max = remainingAmount (ou montant pour ancien draft)
      const maxPayment = transaction ? (transaction.remainingAmount ?? transaction.montant) : Infinity
      if (amount > maxPayment) {
        setAmountError(`Maximum : ${maxPayment.toLocaleString('fr-FR')} FCFA (reste dû)`)
        return
      }
    } else {
      // Remboursement : max = paidAmount - refundedAmount (net payé)
      if (transaction && transaction.paidAmount != null) {
        const netPaid = (transaction.paidAmount ?? 0) - (transaction.refundedAmount ?? 0)
        if (amount > netPaid) {
          setAmountError(`Maximum remboursable : ${netPaid.toLocaleString('fr-FR')} FCFA`)
          return
        }
        if (netPaid <= 0) {
          setAmountError('Aucun montant remboursable (net payé = 0)')
          return
        }
      }
    }

    // Clé d'idempotence stable : générée une fois par (draftId, actionType, method, amount)
    // et réutilisée pour les retries de cette même action.
    const fingerprint = `${activeDropdown}-${currentActionType}-${selectedMethod}-${amount}`
    if (!pendingKeyRef.current[fingerprint]) {
      pendingKeyRef.current[fingerprint] = generateIdempotencyKey()
    }
    const idempotencyKey = pendingKeyRef.current[fingerprint]

    await handlePaymentMethodSelect(activeDropdown, selectedMethod, currentActionType, amount, idempotencyKey)
  }, [settlementAmount, selectedMethod, activeDropdown, currentActionType, pendingTransactions, handlePaymentMethodSelect])

  // Fermer le dropdown quand on clique ailleurs
  useEffect(() => {
    if (!activeDropdown) return
    
    const handleClickOutside = (event) => {
      // Ne pas fermer si on clique sur un bouton qui ouvre le dropdown
      if (event.target.closest('.dropdown-trigger')) return
      
      if (!event.target.closest('.dropdown-container')) {
        setActiveDropdown(null)
        setCurrentActionType(null)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
      }
    }
    
    // Délai pour éviter la fermeture immédiate
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)
    
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [activeDropdown])

  return (
    <div className="mt-8">
      <h2 className={`text-xl font-bold ${themeClasses.text} mb-4`}>
        Non Terminées
      </h2>

      <div className={`bg-white rounded-lg border ${themeClasses.tableBorder}`}>
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr className={`${themeClasses.tableHeader} border-b`}>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Date & heure
                </th>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Client
                </th>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Type
                </th>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Réseau
                </th>
                <th className={`px-4 py-3 text-right text-base font-medium ${themeClasses.text}`}>
                  Montant
                </th>
                <th className={`px-4 py-3 text-center text-base font-medium ${themeClasses.text}`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Afficher des squelettes pendant le chargement
                Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonRow key={`skeleton-${index}`} cols={6} />
                ))
              ) : uniquePendingTransactions.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-4">
                    <EmptyState
                      icon={ClipboardCheck}
                      title="Aucune transaction en attente"
                      message="Les opérations enregistrées comme non terminées apparaîtront ici."
                    />
                  </td>
                </tr>
              ) : (
                uniquePendingTransactions.map((transaction) => {
                  const actions = getActionButtons(transaction)
                  const styles = getTransactionStyles(transaction.type)
                  const isProcessingTransaction = [...processingActions].some(key => key.startsWith(`${transaction.id}-`))

                  return (
                    <tr 
                      key={transaction.id}
                      className="border-b border-line/60 transition-colors hover:bg-brand-50/60"
                    >
                      <td className="px-4 py-3 text-base">
                        {formatTransactionDateTime(transaction)}
                      </td>
                      <td className="px-4 py-3 text-base font-medium">
                        {getClientName(transaction.client)}
                      </td>
                      <td className={`px-4 py-3 text-base font-medium ${styles.textColor}`}>
                        {transaction.type}
                      </td>
                      <td className="px-4 py-3 text-base">
                        {transaction.reseau} ({transaction.code})
                      </td>
                      <td className={`px-4 py-3 text-right text-base font-medium tabular-nums ${styles.textColor}`}>
                        <span>{(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA</span>
                        {transaction.settlementStatus === 'partial' && transaction.remainingAmount != null && (
                          <div className="mt-0.5 text-xs font-normal tabular-nums text-warn">
                            Reste : {Number(transaction.remainingAmount).toLocaleString('fr-FR')} FCFA
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-base">
                        <div className="flex gap-2 justify-center">
                          {actions.modifier && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'modifier', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                            >
                              Modifier
                            </button>
                          )}

                          {actions.encaisser && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'encaisser', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Encaisser
                            </button>
                          )}

                          {actions.payerPar && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'payerPar', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Payer par
                            </button>
                          )}

                          {actions.rembourser && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'rembourser', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Rembourser
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* Dropdown modal — 2 étapes */}
      {activeDropdown && createPortal(
        <div
          className="fixed bg-white border border-gray-300 rounded-lg shadow-lg dropdown-container"
          onClick={(e) => e.stopPropagation()}
          style={{
            top: Math.max(10, Math.min(dropdownPosition.top, window.innerHeight - 300)),
            left: Math.max(10, Math.min(dropdownPosition.left, window.innerWidth - 240)),
            zIndex: 9999,
            minWidth: '220px'
          }}
        >
          {dropdownStep === 1 ? (
            <>
              {/* Étape 1 : sélection de la méthode */}
              <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200">
                <p className="text-sm font-medium text-gray-700">Sélectionner méthode</p>
              </div>
              <div className="py-1">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    onClick={() => handleMethodChosen(method)}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    {method}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Étape 2 : saisie du montant */}
              {(() => {
                const t = pendingTransactions.find(tx => tx.id === activeDropdown)
                return (
                  <>
                    <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200 flex items-center gap-2">
                      <button
                        onClick={() => { setDropdownStep(1); setAmountError('') }}
                        className="rounded text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                        aria-label="Retour"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <p className="text-sm font-medium text-gray-700">{selectedMethod}</p>
                    </div>
                    {t && (
                      <div className="px-4 pt-2 pb-1 border-b border-gray-100 space-y-0.5">
                        <p className="text-xs text-gray-700 font-medium truncate">{getClientName(t.client)}</p>
                        <p className="text-[11px] text-gray-400">{t.type}{t.reseau ? ` · ${t.reseau}` : ''}</p>
                        {/* Résumé financier */}
                        <div className="pt-1 space-y-0.5">
                          <p className="text-[11px] text-gray-500">
                            Total : {(Number(t.montant) || 0).toLocaleString('fr-FR')} FCFA
                          </p>
                          {t.settlementStatus === 'partial' && t.paidAmount != null && (
                            <>
                              <p className="text-[11px] tabular-nums text-inflow">
                                Payé : {Number(t.paidAmount).toLocaleString('fr-FR')} FCFA
                              </p>
                              {(t.refundedAmount ?? 0) > 0 && (
                                <p className="text-[11px] tabular-nums text-outflow">
                                  Remboursé : {Number(t.refundedAmount).toLocaleString('fr-FR')} FCFA
                                </p>
                              )}
                              {currentActionType !== 'rembourser' ? (
                                <p className="text-[11px] font-medium tabular-nums text-warn">
                                  Reste dû : {Number(t.remainingAmount).toLocaleString('fr-FR')} FCFA
                                </p>
                              ) : (
                                <p className="text-[11px] font-medium tabular-nums text-inflow">
                                  Remboursable : {Math.max(0, (t.paidAmount ?? 0) - (t.refundedAmount ?? 0)).toLocaleString('fr-FR')} FCFA
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

              <div className="px-4 py-3">
                <p className="text-xs text-gray-500 mb-2">Montant (FCFA)</p>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const current = parseInt(settlementAmount, 10) || 0
                      const next = Math.max(500, current - 500)
                      setSettlementAmount(String(next))
                      setAmountError('')
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 text-lg font-bold select-none"
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={settlementAmount}
                    onChange={(e) => {
                      setSettlementAmount(e.target.value)
                      setAmountError('')
                    }}
                    className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-center text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  />

                  <button
                    onClick={() => {
                      const current = parseInt(settlementAmount, 10) || 0
                      setSettlementAmount(String(current + 500))
                      setAmountError('')
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 text-lg font-bold select-none"
                  >
                    +
                  </button>
                </div>

                {amountError && (
                  <p className="mt-1 text-xs text-danger">{amountError}</p>
                )}

                <button
                  onClick={handleConfirmPayment}
                  disabled={[...processingActions].some(k => k.startsWith(`${activeDropdown}-`))}
                  className="mt-3 w-full rounded bg-brand-500 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {[...processingActions].some(k => k.startsWith(`${activeDropdown}-`)) ? 'Traitement...' : 'Confirmer'}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Toast pour les rollbacks */}
      <OptimisticToast
        message={rollbackToast.message}
        type={rollbackToast.type}
        isVisible={rollbackToast.show}
        onClose={() => setRollbackToast({ show: false, message: '', type: 'info' })}
        autoClose={true}
      />
    </div>
  )
})

export default TransactionTable
