function ClientInfoDisplay({ client }) {
  if (!client) {
    return null
  }

  const formatAccounts = () => {
    const accounts = []
    if (client.orange) accounts.push(`Code agent: ${client.orange}`)
    
    return accounts.join(' | ')
  }

  return (
    <div className="mt-4 rounded border border-brand-200 bg-brand-50 p-4">
      <h3 className="font-bold text-lg text-gray-800 mb-2">
        {client.nom} {client.prenom}
        {client.isManual && (
          <span className="ml-2 rounded bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">
            Non enregistré
          </span>
        )}
      </h3>
      <p className="text-gray-700 mb-1">
        <span className="font-medium">Compte agent :</span> {formatAccounts()}
      </p>
      {client.numeroPersonnel && (
        <p className="text-gray-700">
          <span className="font-medium">Numéro personnel :</span> {client.numeroPersonnel}
        </p>
      )}
    </div>
  )
}

export default ClientInfoDisplay
