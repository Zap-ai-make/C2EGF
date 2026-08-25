import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { useContext, useMemo } from 'react'
import { ClientsContext } from '../../../context/ClientsContext.jsx'

function AgentsChart() {
  const { clients } = useContext(ClientsContext)

  // Mémoriser les calculs pour optimiser les performances
  const data = useMemo(() => {
    // Compter le nombre de clients par agent commercial
    const agentCounts = {}
    clients.forEach(client => {
      if (client.agentCommercial && client.agentCommercial.trim()) {
        const agent = client.agentCommercial.trim()
        agentCounts[agent] = (agentCounts[agent] || 0) + 1
      }
    })

    // Convertir en données pour le graphique et trier par nombre de clients (descendant)
    return Object.entries(agentCounts)
      .map(([agent, count]) => ({ agent, clients: count }))
      .sort((a, b) => b.clients - a.clients)
      .slice(0, 5) // Top 5 agents
  }, [clients])

  return (
    <div className="bg-gradient-to-br from-orange-50 to-white rounded-xl shadow-sm border border-orange-100 p-6 h-64">
      <div className="flex items-center space-x-3 mb-4">
        <div className="h-8 w-8 bg-orange-100 rounded-lg flex items-center justify-center">
          <div className="h-4 w-4 bg-orange-500 rounded-sm"></div>
        </div>
        <h3 className="text-orange-800 text-lg font-semibold">Top agents</h3>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-orange-500 text-sm">Aucun agent commercial</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="agent"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#EA580C', fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#EA580C', fontSize: 12 }}
            />
            <Bar dataKey="clients" fill="#F97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default AgentsChart