import { getColorTheme } from '../../constants/dashboardTheme'

function CardHeader({ title, colorName = 'gray', className = '' }) {
  const colors = getColorTheme(colorName)

  return (
    <div className={`flex items-center space-x-3 mb-4 ${className}`}>
      <div className={`h-8 w-8 ${colors.iconBg} rounded-lg flex items-center justify-center`}>
        <div className={`h-4 w-4 ${colors.iconColor} rounded-sm`}></div>
      </div>
      <h3 className={`${colors.title} text-lg font-semibold`}>{title}</h3>
    </div>
  )
}

export default CardHeader