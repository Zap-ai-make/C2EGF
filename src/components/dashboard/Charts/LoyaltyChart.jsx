import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { useMemo } from 'react'
import { useAllTransactions } from '../../../hooks/useAllTransactions.js'
import { useTodayTransactions } from '../../../hooks/useTodayTransactions.js'

function LoyaltyChart() {
  const allTransactions = useAllTransactions()
  const todayTransactions = useTodayTransactions(allTransactions)

  // Mémoriser le calcul des données pour optimiser les performances
  const data = useMemo(() => {
    // Compter les transactions par client aujourd'hui
    const clientTransactionCounts = {}
    todayTransactions.forEach(transaction => {
      if (transaction.client && transaction.client.nom && transaction.client.prenom) {
        const clientKey = `${transaction.client.prenom} ${transaction.client.nom}`
        clientTransactionCounts[clientKey] = (clientTransactionCounts[clientKey] || 0) + 1
      }
    })

    // Convertir en données pour le graphique et prendre les 5 premiers
    return Object.entries(clientTransactionCounts)
      .map(([client, count]) => ({
        client: client.length > 15 ? client.substring(0, 12) + '...' : client,
        transactions: count
      }))
      .sort((a, b) => b.transactions - a.transactions)
      .slice(0, 5)
  }, [todayTransactions])

  return (
    <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl shadow-sm border border-purple-100 p-6 h-64">
      <div className="flex items-center space-x-3 mb-4">
        <div className="h-8 w-8 bg-purple-100 rounded-lg flex items-center justify-center">
          <div className="h-4 w-4 bg-purple-500 rounded-sm"></div>
        </div>
        <h3 className="text-purple-800 text-lg font-semibold">Fidèles clients (aujourd'hui)</h3>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-purple-500 text-sm">Aucune transaction aujourd'hui</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="client"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#7C3AED', fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#7C3AED', fontSize: 12 }}
            />
            <Bar dataKey="transactions" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default LoyaltyChart