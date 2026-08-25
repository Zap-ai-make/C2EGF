import { useContext } from 'react'
import { ClientsContext } from '../context/ClientsContext.jsx'

export function useClients() {
  const context = useContext(ClientsContext)
  if (context === undefined) {
    throw new Error('useClients must be used within a ClientsProvider')
  }
  return context
}