import { useState, useCallback, memo } from 'react'
import { Signal, Wallet } from 'lucide-react'
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

  const Icone = isLiquiditeCard ? Wallet : Signal
  const teinte = config.color

  return (
    /* Une carte de solde est ce que le gérant regarde en premier, toute la
       journée, sur les sept écrans. Elle était plate : une pastille, deux
       lignes de texte, un nombre. Quatre choses lui manquaient.

       1. UN POINT D'ENTRÉE. Le rail vertical et la vignette portent la couleur
          de l'opérateur — c'est une donnée d'identité, le seul usage auquel le
          jeton `net-*` a droit (DESIGN.md §5). L'icône double le sens sans le
          porter seule : le nom reste écrit en toutes lettres.
       2. UNE HIÉRARCHIE. Le montant est la seule chose vraiment grande, en
          chiffres tabulaires — ces deux nombres se comparent l'un à l'autre et
          changent toute la journée : ils doivent occuper la même largeur d'un
          instant au suivant. « FCFA » descend en exposant discret : l'unité ne
          se relit pas à chaque coup d'œil.
       3. UNE ÉLÉVATION. Ces cartes flottent sur la bande marine ; une ombre
          portée colorée les décolle au lieu de les poser à plat dessus.
       4. UN SEUIL VISIBLE. L'anneau prend la couleur de l'alerte quand le stock
          descend, et le badge « Bas » l'écrit. */
    <div
      data-testid={`carte-${network}`}
      className={`relative flex min-h-[76px] items-center gap-3.5 overflow-hidden rounded-xl bg-surface py-3 pl-5 pr-4 shadow-lg shadow-brand-600/25 transition-shadow ${status.ring}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: teinte }}
      />

      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: `${teinte}1f` }}
      >
        <Icone className="h-5 w-5" strokeWidth={2} style={{ color: teinte }} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-bold leading-tight text-ink">
            {config.name}
          </h3>
          {status.warning && (
            <span className="shrink-0 rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
              Bas
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {label}
        </p>
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
              className={`w-28 border-b-2 bg-transparent text-right text-xl font-black tabular-nums text-ink outline-none ${
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
              className="rounded bg-brand-500 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              OK
            </button>
          </div>
        ) : (
          <div className="flex items-baseline justify-end gap-2">
            <p className="text-[1.75rem] font-black leading-none tabular-nums text-ink">
              {amount}
            </p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              FCFA
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={startEditing}
                className="ml-1 self-center rounded border border-line px-2.5 py-1 text-xs font-bold text-ink-muted transition-colors hover:border-brand-400 hover:text-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label={`Modifier ${config.name}`}
              >
                Modifier
              </button>
            )}
          </div>
        )}
        {errorMessage && (
          <p className="mt-1 text-[10px] font-medium text-danger">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}

export default memo(NetworkCard)
