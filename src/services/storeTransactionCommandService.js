import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

// Le statut 0 : la requête n'a pas abouti. Le SDK le dit « internal [0] », et
// c'est ce que liraient à l'écran les gestes qui ne passent pas par la file
// d'envoi (modifier, annuler, ravitailler) quand il n'y a pas de réseau.
const SANS_RESEAU = 'internal [0]'

function callableError(error) {
  const mapped = new Error(error?.message === SANS_RESEAU
    ? 'Cette opération demande une connexion internet.'
    : error?.message || "L'opération financière a échoué.")
  mapped.code = error?.details?.code || error?.code || ''
  return mapped
}

export async function runStoreTransactionCommand(payload) {
  try {
    const result = await httpsCallable(functions, 'storeTransactionCommand')(payload)
    return result.data
  } catch (error) {
    throw callableError(error)
  }
}
