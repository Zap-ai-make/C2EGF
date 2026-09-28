function RejectionReasonField({ value, onChange, description }) {
  return (
    <>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">
          Motif <span className="font-normal text-ink-muted">(3 à 500 caractères)</span>
        </span>
        <textarea
          rows={3}
          value={value}
          onChange={onChange}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
      </label>
      <p className="mt-1 text-xs text-ink-muted">{description}</p>
    </>
  )
}

export default RejectionReasonField
