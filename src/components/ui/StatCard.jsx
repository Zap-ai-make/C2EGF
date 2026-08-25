/**
 * StatCard — tuile KPI des espaces Gérant & Dealer.
 *
 * Alignée sur l'esthétique des cartes de l'espace Boutique (DashboardCard) :
 * dégradé léger `from-{couleur}-50 to-white`, coin `rounded-2xl`, accent coloré
 * discret, valeur en gris foncé. API inchangée pour ne pas réécrire les pages.
 */
function StatCard({ label, value, sub, color = 'blue', icon, loading = false, onClick }) {
  // Classes complètes (statiques) pour rester détectables par Tailwind JIT.
  const colorMap = {
    blue:   { grad: 'from-blue-50',   accent: 'text-blue-600',   iconBg: 'bg-blue-100' },
    green:  { grad: 'from-green-50',  accent: 'text-green-600',  iconBg: 'bg-green-100' },
    amber:  { grad: 'from-amber-50',  accent: 'text-amber-600',  iconBg: 'bg-amber-100' },
    red:    { grad: 'from-red-50',    accent: 'text-red-600',    iconBg: 'bg-red-100' },
    gray:   { grad: 'from-gray-50',   accent: 'text-gray-600',   iconBg: 'bg-gray-100' },
    indigo: { grad: 'from-indigo-50', accent: 'text-indigo-600', iconBg: 'bg-indigo-100' },
    teal:   { grad: 'from-teal-50',   accent: 'text-teal-600',   iconBg: 'bg-teal-100' },
  }

  const c = colorMap[color] ?? colorMap.blue

  return (
    <div
      className={`bg-gradient-to-br ${c.grad} to-white rounded-2xl border border-gray-100 shadow-sm p-5 transition-shadow ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs font-medium uppercase tracking-wide ${c.accent} truncate`}>{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-24 animate-pulse rounded bg-gray-200" />
          ) : (
            <p className="mt-1 text-2xl font-bold text-gray-900 truncate">{value ?? '—'}</p>
          )}
          {sub && !loading && (
            <p className="mt-1 text-xs text-gray-500 truncate">{sub}</p>
          )}
        </div>
        {icon && (
          <span className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-lg ${c.iconBg} text-xl`} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
    </div>
  )
}

export default StatCard
