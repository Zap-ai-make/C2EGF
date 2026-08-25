import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { useMemo } from 'react'
import { useAllTransactions } from '../../hooks/useAllTransactions.js'
import { useTodayTransactions } from '../../hooks/useTodayTransactions.js'

const normalizeType = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

function TransactionsTodayChart() {
  const allTransactions = useAllTransactions()
  const todayTransactions = useTodayTransactions(allTransactions)

  const { depositCount, withdrawalCount } = useMemo(() => {
    return todayTransactions.reduce((counts, transaction) => {
      const type = normalizeType(transaction.type)
      if (type === 'depot') counts.depositCount += 1
      if (type === 'retrait') counts.withdrawalCount += 1
      return counts
    }, { depositCount: 0, withdrawalCount: 0 })
  }, [todayTransactions])

  const data = []

  if (depositCount > 0) {
    data.push({
      name: 'Dépôts',
      value: depositCount,
      color: '#10B981'
    })
  }

  if (withdrawalCount > 0) {
    data.push({
      name: 'Retraits',
      value: withdrawalCount,
      color: '#3B82F6'
    })
  }

  const CustomLegend = () => {
    return (
      <div className="flex flex-col space-y-2 text-sm">
        {data.map((entry, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center">
              <div
                className="w-4 h-4 rounded mr-2"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-700">{entry.name}</span>
            </div>
            <span className="text-gray-600 text-xs ml-2">
              {entry.value} transaction{entry.value > 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload
      const total = depositCount + withdrawalCount
      const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0
      return (
        <div className="bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-lg">
          <p className="text-white font-semibold">{item.name}</p>
          <p className="text-gray-300">
            <span className="text-blue-400">{item.value}</span> transaction{item.value > 1 ? 's' : ''}
          </p>
          <p className="text-gray-400 text-sm">
            {percentage}% du total
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl shadow-sm border border-emerald-100 p-6 h-64">
      <div className="flex items-center space-x-3 mb-4">
        <div className="h-8 w-8 bg-emerald-100 rounded-lg flex items-center justify-center">
          <div className="h-4 w-4 bg-emerald-500 rounded-sm"></div>
        </div>
        <h3 className="text-emerald-800 text-lg font-semibold">
          Transactions du jour
        </h3>
      </div>

      {depositCount === 0 && withdrawalCount === 0 ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-emerald-500 text-sm">Aucune transaction aujourd'hui</p>
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ height: 'calc(100% - 60px)' }}>
          <ResponsiveContainer width="60%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={60}
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
          <div className="w-[40%]">
            <CustomLegend />
          </div>
        </div>
      )}
    </div>
  )
}

export default TransactionsTodayChart
