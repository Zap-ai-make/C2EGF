const PRESETS = {
  pending:   'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected:  'bg-red-100 text-red-800',
  active:    'bg-green-100 text-green-800',
  inactive:  'bg-gray-100 text-gray-600',
  suspended: 'bg-red-100 text-red-800',
}

function StatusBadge({ status, label, color }) {
  const cls = color ? '' : (PRESETS[status] ?? 'bg-gray-100 text-gray-700')
  const customCls = color || ''
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}${customCls}`}
      aria-label={label ?? status}
    >
      {label ?? status}
    </span>
  )
}

export default StatusBadge
