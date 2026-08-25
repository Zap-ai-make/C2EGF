function EmptyState({ title = 'Aucun résultat', message, action }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-12 text-center">
      <p className="text-base font-medium text-gray-500">{title}</p>
      {message && <p className="mt-1 text-sm text-gray-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
