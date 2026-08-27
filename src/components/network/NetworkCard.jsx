import { useState, useCallback, memo } from 'react'
import { NETWORK_CONFIG, formatAmountWithCurrency } from '../../constants/networkConfig'
import { useNetworkCards } from '../../hooks/useNetworkCards'
import { useAuth } from '../../context/AuthContext'

function NetworkCard({ network, stockAmount, liquiditeAmount }) {
  const config = NETWORK_CONFIG[network]
  const { updateStock, updateLiquidity } = useNetworkCards()
  const { userProfile } = useAuth()
  const canEdit = userProfile?.role === 'dealer'
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const isLiquiditeCard = network === 'Liquidite'
  const displayAmount = isLiquiditeCard ? liquiditeAmount : stockAmount
  const { amount, label } = config
    ? formatAmountWithCurrency(displayAmount, isLiquiditeCard)
    : { amount: '0', label: '' }

  const getStockStatus = () => {
    if (isLiquiditeCard) return 'normal'

    const stockValue = stockAmount || 0
    if (stockValue <= 0) return 'critical'
    if (stockValue < 10000) return 'low'
    if (stockValue < 25000) return 'warning'
    return 'normal'
  }

  const stockStatus = getStockStatus()
  const statusConfig = {
    critical: {
      ring: 'ring-1 ring-danger/50',
      dot: 'bg-danger',
      warning: true
    },
    low: {
      ring: 'ring-1 ring-warn/50',
      dot: 'bg-warn',
      warning: false
    },
    warning: {
      ring: 'ring-1 ring-warn/30',
      dot: 'bg-warn/70',
      warning: false
    },
    normal: {
      ring: 'ring-1 ring-white/10',
      dot: 'bg-success',
      warning: false
    }
  }

  const saveAmount = useCallback(async () => {
    const newAmount = parseFloat(editValue) || 0

    try {
      if (isLiquiditeCard) {
        await updateLiquidity(newAmount)
      } else {
        await updateStock(network, newAmount)
      }

      setIsEditing(false)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error?.message || 'Erreur lors de la sauvegarde du solde')
    }
  }, [editValue, isLiquiditeCard, network, updateStock, updateLiquidity])

  const startEditing = useCallback(() => {
    if (!canEdit) return
    setIsEditing(true)
    setErrorMessage('')
    setEditValue(displayAmount.toString())
  }, [canEdit, displayAmount])

  const handleInputChange = useCallback((e) => {
    setEditValue(e.target.value)
  }, [])

  const handleInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveAmount()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
      setEditValue(displayAmount.toString())
    }
  }, [saveAmount, displayAmount])

  const handleInputBlur = useCallback(() => {
    saveAmount()
  }, [saveAmount])

  const isValidAmount = useCallback((value) => {
    const num = parseFloat(value)
    return !isNaN(num) && num >= 0
  }, [])

  if (!config) return null

  const status = statusConfig[stockStatus]

  return (
    <div
      className={`
        flex min-h-[68px] items-center justify-between gap-4 rounded-lg
        bg-white/95 px-4 py-3 shadow-sm ${status.ring}
      `}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-ink">
              {config.name}
            </h3>
            {status.warning && (
              <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                Bas
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {label}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        {isEditing ? (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              value={editValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              className={`w-28 border-b-2 bg-transparent text-right text-xl font-black text-ink outline-none ${
                isValidAmount(editValue) ? 'border-line' : 'border-danger'
              }`}
              autoFocus
              min="0"
              step="1000"
              placeholder="Montant"
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={saveAmount}
              className="rounded bg-brand-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-600"
            >
              OK
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <p className="text-2xl font-black leading-none text-ink">
              {amount}
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={startEditing}
                className="rounded border border-line px-2.5 py-1 text-xs font-bold text-ink-muted hover:border-brand-400 hover:text-brand-500"
                aria-label={`Modifier ${config.name}`}
              >
                Modifier
              </button>
            )}
          </div>
        )}
        {(errorMessage || canEdit) && (
          <p className={`mt-1 text-[10px] font-medium ${errorMessage ? 'text-danger' : 'text-ink-muted'}`}>
            {errorMessage || 'Solde modifiable'}
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(NetworkCard)
