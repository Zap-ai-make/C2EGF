import { getColorTheme } from '../../constants/dashboardTheme'
import CardHeader from './CardHeader'

function DashboardCard({
  title,
  colorName = 'gray',
  children,
  className = '',
  headerClassName = '',
  height = 'h-64',
  hover = false
}) {
  const colors = getColorTheme(colorName)

  const hoverClass = hover ? 'hover:shadow-md transition-all duration-200' : ''

  return (
    <div className={`bg-gradient-to-br ${colors.background} rounded-xl shadow-sm border ${colors.border} p-6 ${height} ${hoverClass} ${className}`}>
      {title && (
        <CardHeader
          title={title}
          colorName={colorName}
          className={headerClassName}
        />
      )}
      {children}
    </div>
  )
}

export default DashboardCard