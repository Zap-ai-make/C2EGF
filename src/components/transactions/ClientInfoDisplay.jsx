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
    <div className="bg-green-100 border border-green-500 rounded p-4 mt-4">
      <h3 className="font-bold text-lg text-gray-800 mb-2">
        {client.nom} {client.prenom}
        {client.isManual && (
          <span className="ml-2 rounded bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
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
