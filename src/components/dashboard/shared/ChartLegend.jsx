import { CHART_TEXT_COLORS } from '../../../constants/dashboardTheme'

function ChartLegend({ data, valueFormatter, extraLabel = '' }) {
  return (
    <div className="flex flex-col space-y-2 text-sm">
      {data.map((entry, index) => (
        <div key={index} className="flex items-center justify-between">
          <div className="flex items-center">
            <div
              className="w-4 h-4 rounded mr-2"
              style={{ backgroundColor: entry.color }}
            />
            <span className={CHART_TEXT_COLORS.primary}>{entry.name}</span>
          </div>
          <span className={`${CHART_TEXT_COLORS.secondary} text-xs ml-2`}>
            {valueFormatter ? valueFormatter(entry.value) : entry.value}
            {extraLabel && ` ${extraLabel}`}
          </span>
        </div>
      ))}
    </div>
  )
}

export default ChartLegend