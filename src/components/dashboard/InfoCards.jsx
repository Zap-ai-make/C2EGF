import DashboardCard from '../ui/DashboardCard'
import { getColorTheme } from '../../constants/dashboardTheme'

function InfoCards({ totalClients, monthlyClients, dailyClients, topClient }) {
  const cards = [
    {
      title: 'Total Clients',
      value: totalClients,
      subtitle: 'Clients enregistrés',
      color: 'blue'
    },
    {
      title: 'Clients ce mois',
      value: monthlyClients,
      subtitle: 'Nouveaux ce mois',
      color: 'green'
    },
    {
      title: 'Ajoutés aujourd\'hui',
      value: dailyClients,
      subtitle: 'Nouveaux aujourd\'hui',
      color: 'orange'
    },
    {
      title: 'Top client du jour',
      value: topClient || "Aucune transaction aujourd'hui",
      subtitle: 'Transaction la plus élevée',
      color: 'purple',
      isText: true
    }
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, index) => {
        const colors = getColorTheme(card.color)
        return (
          <DashboardCard
            key={index}
            colorName={card.color}
            height="auto"
            hover={true}
            className="min-h-[120px]"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-medium ${colors.accent} mb-0`}>{card.title}</h3>
              <div className={`h-8 w-8 ${colors.iconBg} rounded-lg flex items-center justify-center`}>
                <div className={`h-4 w-4 ${colors.iconColor} rounded-full`}></div>
              </div>
            </div>
            <div className={`${card.isText ? 'text-base' : 'text-3xl'} font-bold ${colors.title} ${card.isText ? 'leading-tight' : ''}`}>
              {card.value}
            </div>
            <p className={`text-xs ${colors.accent} mt-1`}>{card.subtitle}</p>
          </DashboardCard>
        )
      })}
    </div>
  )
}

export default InfoCards