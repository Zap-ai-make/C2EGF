import { parsefrenchDate } from '../../utils/helpers.js'

function LastClientsTable({ clients = [] }) {
  // Prendre les 5 derniers clients
  const lastClients = clients.slice(-5).reverse()

  const headers = [
    'Nom',
    'Prénom',
    'Numéro personnel',
    'Code agent',
    'Localité',
    'Commercial',
    'Date d\'ajout'
  ]

  const formatDate = (client) => {
    // Si le client a une date d'ajout, l'utiliser avec le bon parseur, sinon date actuelle
    if (client.dateAjout) {
      const date = parsefrenchDate(client.dateAjout)
      if (!date) return '-'
      return date.toLocaleDateString('fr-FR')
    }
    return new Date().toLocaleDateString('fr-FR')
  }

  return (
    <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl shadow-sm border border-gray-100">
      {/* En-tête avec design moderne */}
      <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white rounded-t-xl">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <div className="h-4 w-4 bg-blue-500 rounded-sm"></div>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Derniers clients enregistrés</h2>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
              {headers.map((header, index) => (
                <th
                  key={index}
                  className="px-4 py-4 text-left text-sm font-semibold text-blue-900 whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {lastClients.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <div className="h-6 w-6 bg-gray-400 rounded-full"></div>
                    </div>
                    <p className="text-gray-500 text-sm">Aucun client enregistré</p>
                  </div>
                </td>
              </tr>
            ) : (
              lastClients.map((client, index) => (
                <tr
                  key={client.id || `${client.nom || 'client'}-${client.prenom || ''}-${index}`}
                  className={`border-b border-gray-50 hover:bg-blue-50 transition-colors duration-150 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">
                    {client.nom || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">
                    {client.prenom || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700 font-mono">
                    {client.numeroPersonnel || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-orange-600 font-medium">
                    {client.orange || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">
                    {client.localite || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">
                    {client.agentCommercial || '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600">
                    <span className="bg-gray-100 px-2 py-1 rounded-md text-xs">
                      {formatDate(client)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LastClientsTable
