import { useState } from 'react'
import { useClients } from '../hooks/useClients'
import TransactionForm from '../components/transactions/TransactionForm'
import TransactionTable from '../components/transactions/TransactionTable'
import DealerTransferForm from '../components/transactions/DealerTransferForm'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import PageHeader from '../components/ui/PageHeader'

function Transactions() {
  const { clients } = useClients()
  const [mode, setMode] = useState('client') // 'client' | 'dealer'

  const tabClass = (active) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
      active ? 'bg-brand-500 text-white' : 'border border-line bg-surface text-ink hover:bg-brand-50'
    }`

  return (
    <div>
      <PageHeader title="Transactions" />

      {/* Basculeur de mode */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={tabClass(mode === 'client')} onClick={() => setMode('client')}>
          Transaction client
        </button>
        <button type="button" className={tabClass(mode === 'dealer')} onClick={() => setMode('dealer')}>
          Opération dealer
        </button>
      </div>

      {mode === 'client' ? (
        <div className="space-y-8">
          <ErrorBoundary>
            <TransactionForm clients={clients} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TransactionTable />
          </ErrorBoundary>
        </div>
      ) : (
        <ErrorBoundary>
          <DealerTransferForm />
        </ErrorBoundary>
      )}
    </div>
  )
}

export default Transactions
