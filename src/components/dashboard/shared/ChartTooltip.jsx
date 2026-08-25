import { CHART_TEXT_COLORS } from '../../../constants/dashboardTheme'

function ChartTooltip({ active, payload, labelFormatter, valueFormatter, extraInfo }) {
  if (!active || !payload || !payload.length) {
    return null
  }

  const data = payload[0].payload

  return (
    <div className="bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-lg">
      <p className="text-white font-semibold">
        {labelFormatter ? labelFormatter(data) : data.name}
      </p>
      <p className={`${CHART_TEXT_COLORS.primary} text-gray-300`}>
        <span className="text-blue-400">
          {valueFormatter ? valueFormatter(data.value) : data.value}
        </span>
        {extraInfo && ` ${extraInfo}`}
      </p>
      {data.percentage && (
        <p className={`${CHART_TEXT_COLORS.secondary} text-gray-400 text-sm`}>
          {data.percentage}% du total
        </p>
      )}
    </div>
  )
}

export default ChartTooltip