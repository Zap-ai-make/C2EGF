import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

function callableError(error) {
  const mapped = new Error(error?.message || "L'opération financière a échoué.")
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
