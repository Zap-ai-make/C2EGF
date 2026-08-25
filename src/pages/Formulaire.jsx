import { useNavigate } from 'react-router-dom'
import { useClients } from '../hooks/useClients'
import ClientForm from '../components/ClientForm'

function Formulaire() {
  const navigate = useNavigate()
  const { addClient } = useClients()

  const handleSubmit = async (newClient) => {
    await addClient(newClient)
    navigate('/clients')
  }

  return (
    <ClientForm onSubmit={handleSubmit} />
  )
}

export default Formulaire
