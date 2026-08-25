export const DASHBOARD_COLORS = {
  blue: {
    background: 'from-blue-50 to-white',
    border: 'border-blue-100',
    iconBg: 'bg-blue-100',
    iconColor: 'bg-blue-500',
    title: 'text-blue-800',
    accent: 'text-blue-600',
    chart: '#3B82F6',
    chartAccent: '#1E40AF'
  },
  green: {
    background: 'from-green-50 to-white',
    border: 'border-green-100',
    iconBg: 'bg-green-100',
    iconColor: 'bg-green-500',
    title: 'text-green-800',
    accent: 'text-green-600',
    chart: '#10B981',
    chartAccent: '#059669'
  },
  orange: {
    background: 'from-orange-50 to-white',
    border: 'border-orange-100',
    iconBg: 'bg-orange-100',
    iconColor: 'bg-orange-500',
    title: 'text-orange-800',
    accent: 'text-orange-600',
    chart: '#F97316',
    chartAccent: '#EA580C'
  },
  purple: {
    background: 'from-purple-50 to-white',
    border: 'border-purple-100',
    iconBg: 'bg-purple-100',
    iconColor: 'bg-purple-500',
    title: 'text-purple-800',
    accent: 'text-purple-600',
    chart: '#8B5CF6',
    chartAccent: '#7C3AED'
  },
  emerald: {
    background: 'from-emerald-50 to-white',
    border: 'border-emerald-100',
    iconBg: 'bg-emerald-100',
    iconColor: 'bg-emerald-500',
    title: 'text-emerald-800',
    accent: 'text-emerald-600',
    chart: '#10B981',
    chartAccent: '#059669'
  },
  gray: {
    background: 'from-gray-50 to-white',
    border: 'border-gray-100',
    iconBg: 'bg-gray-100',
    iconColor: 'bg-gray-500',
    title: 'text-gray-800',
    accent: 'text-gray-600',
    chart: '#6B7280',
    chartAccent: '#374151'
  }
}

export const NETWORK_COLORS = {
  Orange: '#FB923C',
  Moov: '#3B82F6',
  Telecel: '#8B5CF6',
  Coris: '#EAB308',
  Sank: '#EF4444'
}

export const CHART_TEXT_COLORS = {
  primary: 'text-gray-700',
  secondary: 'text-gray-600',
  muted: 'text-gray-500'
}

export const getColorTheme = (colorName) => {
  return DASHBOARD_COLORS[colorName] || DASHBOARD_COLORS.gray
}

export const calculatePercentage = (value, total) => {
  return total > 0 ? ((value / total) * 100).toFixed(1) : 0
}