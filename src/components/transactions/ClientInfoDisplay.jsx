import { champsAgent } from '../../utils/agentFields.js'

function ClientInfoDisplay({ client }) {
  if (!client) {
    return null
  }

  // Le code agent et le numéro agent sont deux choses : les afficher sous un
  // seul libellé « Code agent » revenait à nommer l'un par le nom de l'autre
  // une fois sur deux.
  const agent = champsAgent(client)

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
      {agent.codeAgent && (
        <p className="text-gray-700 mb-1">
          <span className="font-medium">Code agent :</span> {agent.codeAgent}
        </p>
      )}
      {agent.numeroAgent && (
        <p className="text-gray-700 mb-1">
          <span className="font-medium">Numéro agent :</span> {agent.numeroAgent}
        </p>
      )}
      {client.numeroPersonnel && (
        <p className="text-gray-700">
          <span className="font-medium">Numéro personnel :</span> {client.numeroPersonnel}
        </p>
      )}
    </div>
  )
}

export default ClientInfoDisplay
