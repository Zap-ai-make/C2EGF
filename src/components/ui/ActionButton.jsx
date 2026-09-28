const VARIANT_STYLES = {
  primaire: 'bg-brand-500 text-white hover:bg-brand-600',
  neutre: 'border border-line bg-surface text-ink hover:bg-brand-50',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/70',
}

function ActionButton({ variante = 'neutre', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_STYLES[variante]} ${className}`}
      {...props}
    />
  )
}

export default ActionButton
