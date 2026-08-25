import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { useContext, useMemo } from 'react'
import { ClientsContext } from '../../../context/ClientsContext.jsx'

function NetworkChart() {
  const { clients } = useContext(ClientsContext)

  // Mémoriser les calculs pour optimiser les performances
  const data = useMemo(() => {
    // Logique selon le cahier des charges - répartition des réseaux
    const networkCounts = {
      Orange: 0,
    }

    clients.forEach(client => {
      if (client.orange) networkCounts.Orange++
    })

    return [
      { name: 'Orange', value: networkCounts.Orange, color: '#FB923C' }
    ].filter(item => item.value > 0) // Filtrer les réseaux sans clients
  }, [clients])

  const CustomLegend = ({ payload }) => {
    return (
      <div className="flex flex-col space-y-2 text-sm">
        {payload.map((entry, index) => {
          const networkData = data.find(d => d.name === entry.value)
          return (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center">
                <div
                  className="w-4 h-4 rounded mr-2"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-gray-700">{entry.value}</span>
              </div>
              <span className="text-gray-600 text-xs ml-2">
                {networkData ? networkData.value : 0} clients
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-lg">
          <p className="text-white font-semibold">{data.name}</p>
          <p className="text-gray-300">
            <span className="text-blue-400">{data.value}</span> clients
          </p>
          <p className="text-gray-400 text-sm">
            {data.value > 0 ? `${((data.value / clients.length) * 100).toFixed(1)}% du total` : 'Aucun client'}
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="bg-gradient-to-br from-green-50 to-white rounded-xl shadow-sm border border-green-100 p-6 h-64">
      <div className="flex items-center space-x-3 mb-4">
        <div className="h-8 w-8 bg-green-100 rounded-lg flex items-center justify-center">
          <div className="h-4 w-4 bg-green-500 rounded-sm"></div>
        </div>
        <h3 className="text-green-800 text-lg font-semibold">Répartition par réseau</h3>
      </div>
      <div className="flex items-center justify-between" style={{ height: 'calc(100% - 60px)' }}>
        <ResponsiveContainer width="60%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="w-40%">
          <CustomLegend payload={data.map((item) => ({
            value: item.name,
            color: item.color
          }))} />
        </div>
      </div>
    </div>
  )
}

export default NetworkChart
