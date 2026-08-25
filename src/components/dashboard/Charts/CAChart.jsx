import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { useMemo } from 'react'
import { useAllTransactions } from '../../../hooks/useAllTransactions.js'
import { parsefrenchDate } from '../../../utils/helpers.js'
import DashboardCard from '../../ui/DashboardCard'
import { getColorTheme } from '../../../constants/dashboardTheme'

function CAChart() {
  const allTransactions = useAllTransactions()

  // Mémoriser les calculs pour optimiser les performances
  const data = useMemo(() => {
    // Logique selon le cahier des charges - évolution du CA sur 14 jours
    const last14Days = Array.from({ length: 14 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - i)
      return date.toDateString()
    }).reverse()

    return last14Days.map(day => {
      const dayTransactions = allTransactions.filter(transaction => {
        const transactionDate = parsefrenchDate(transaction.date)
        if (!transactionDate) return false
        return transactionDate.toDateString() === day && transaction.statut === "Validée"
      })

      const ca = dayTransactions.reduce((sum, transaction) =>
        sum + parseFloat(transaction.montant || 0), 0
      )

      const date = new Date(day)
      return {
        date: `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`,
        ca
      }
    })
  }, [allTransactions])

  const colors = getColorTheme('blue')

  return (
    <DashboardCard title="Évolution du CA (14 jours)" colorName="blue">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: colors.chartAccent, fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={50}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: colors.chartAccent, fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="ca"
            stroke={colors.chart}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </DashboardCard>
  )
}

export default CAChart