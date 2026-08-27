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
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
      active ? 'bg-green-600 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
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
