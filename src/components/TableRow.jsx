import { memo } from 'react'
import { champsAgent } from '../utils/agentFields.js'

const TableRow = memo(({ client, index, onEdit }) => {
  // Une fiche d'avant la séparation n'a qu'un champ : il se range ici, à la
  // lecture, sans que la base soit réécrite (utils/agentFields.js).
  const agent = champsAgent(client)

  return (
    <tr className={index % 2 === 0 ? 'bg-surface' : 'bg-canvas'}>
      <td className="px-4 py-3 text-base">
        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {client.registeredStoreName || 'Ancienne base'}
        </span>
      </td>
      <td className="px-4 py-3 text-base">{client.nom}</td>
      <td className="px-4 py-3 text-base">{client.prenom}</td>
      <td className="px-4 py-3 text-base">{client.numeroIdentite}</td>
      <td className="px-4 py-3 text-base">{client.numeroPersonnel}</td>
      <td className="px-4 py-3 text-base tabular-nums">{agent.codeAgent}</td>
      <td className="px-4 py-3 text-base tabular-nums">{agent.numeroAgent}</td>
      <td className="px-4 py-3 text-base max-w-48 break-words">{client.localite}</td>
      <td className="px-4 py-3 text-base">{client.agentCommercial}</td>
      <td className="px-4 py-3 text-base">{client.dateAjout}</td>
      <td className="px-4 py-3 text-center">
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => onEdit && onEdit(client)}
            className="rounded bg-brand-500 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            Modifier
          </button>
          <button
            type="button"
            disabled
            title="Suppression désactivée pour protéger la base clients commune"
            className="cursor-not-allowed rounded bg-gray-200 px-3 py-1 text-sm font-medium text-gray-500"
          >
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  )
})

TableRow.displayName = 'TableRow'

export default TableRow
