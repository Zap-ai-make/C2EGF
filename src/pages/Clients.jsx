import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useClients } from '../hooks/useClients'
import ClientsTable from '../components/ClientsTable'
import ClientForm from '../components/ClientForm'

function Clients() {
  const { clients, deleteClient, editClient, addClient } = useClients()
  const [editingClient, setEditingClient] = useState(null)

  const handleDelete = (clientId) => {
    const client = clients.find(c => c.id === clientId)
    if (window.confirm(`Êtes-vous sûr de vouloir supprimer définitivement le client ${client?.nom} ${client?.prenom} ?`)) {
      deleteClient(clientId)
    }
  }

  const handleEdit = (client) => {
    setEditingClient(client)
  }

  const handleEditSubmit = async (updatedData) => {
    await editClient(editingClient.id, updatedData)
    setEditingClient(null)
  }

  const handleCancelEdit = () => {
    setEditingClient(null)
  }

  const handleImportClients = async (importedClients) => {
    // Ajouter chaque client importé sans l'ID généré automatiquement
    const results = await Promise.allSettled(importedClients.map(clientData => {
      const { id: _id, ...clientWithoutId } = clientData
      return addClient(clientWithoutId)
    }))

    const failedCount = results.filter(result => result.status === 'rejected').length
    if (failedCount > 0) {
      throw new Error(`${failedCount} client(s) non importé(s)`)
    }
  }

  if (editingClient) {
    return (
      <div>
        <div className="mb-4">
          <button
            onClick={handleCancelEdit}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Retour à la liste
          </button>
        </div>
        <ClientForm 
          onSubmit={handleEditSubmit}
          initialData={editingClient}
          title="Modifier le client"
        />
      </div>
    )
  }

  return (
    <ClientsTable
      clients={clients}
      onDelete={handleDelete}
      onEdit={handleEdit}
      onImportClients={handleImportClients}
      emptyAction={
        // L'issue proposée par l'état vide. Elle vit ICI et non dans le tableau :
        // seule la page connaît le routeur, et le tableau reste testable seul.
        <Link
          to="/formulaire"
          className="rounded bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Enregistrer un client
        </Link>
      }
    />
  )
}

export default Clients
