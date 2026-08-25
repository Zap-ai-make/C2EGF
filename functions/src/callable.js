import { HttpsError } from 'firebase-functions/v2/https'
import { write } from 'firebase-functions/logger'
import { DealerRequestError } from './errors.js'
import { buildSafeUnexpectedErrorLog, writeSafeErrorLog } from './logging.js'

export { HttpsError }

// logWriter est injectable pour les tests (défaut : write de firebase-functions/logger).
// write(entry) écrit directement l'objet JSON sans générer de stack synthétique,
// contrairement à logger.error() qui passe par entryFromArgs() et crée un new Error().
export function wrapCallable(handler, dependencies, logWriter = write) {
  return async (request) => {
    try {
      return await handler(request, dependencies)
    } catch (err) {
      // L'instanceof sur un Proxy hostile peut lever si getPrototypeOf est piégé.
      // On l'isole pour que toute erreur d'inspection retombe vers le HttpsError générique.
      let isBusinessError = false
      try { isBusinessError = err instanceof DealerRequestError } catch { /* erreur hostile */ }

      if (isBusinessError) {
        throw new HttpsError(err.httpCode, err.message, { code: err.code })
      }

      // Double protection : buildSafeUnexpectedErrorLog et writeSafeErrorLog ont
      // chacun leur propre try/catch, mais cette enveloppe externe garantit
      // qu'aucune erreur de logging ne peut jamais remplacer le HttpsError générique.
      try {
        const safeLog = buildSafeUnexpectedErrorLog({ action: 'wrapCallable', error: err })
        writeSafeErrorLog(logWriter, safeLog)
      } catch {
        // Le logging ne doit jamais modifier la réponse callable.
      }
      throw new HttpsError('internal', "Une erreur interne s'est produite.")
    }
  }
}
