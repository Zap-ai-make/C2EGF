/**
 * Logging sécurisé pour les erreurs inattendues dans les Cloud Functions.
 *
 * Garanties :
 *   - Ne lève jamais, quelle que soit la valeur de error ou de context.
 *   - N'inclut jamais : message, stack, cause, config, request, response,
 *     token, chemin local, objet Error, payload complet.
 *   - Résiste aux getters hostiles et aux Proxies hostiles.
 *   - La sortie contient exactement 7 clés (allow-list stricte).
 *
 * writeSafeErrorLog(logWriter, payload) :
 *   - N'appelle jamais logger.error (génère une stack synthétique).
 *   - Utilise logWriter({ severity: 'ERROR', ...payload }) — injectable pour tests.
 *   - Ne lève jamais.
 */

// ── Helpers internes ─────────────────────────────────────────────────────────

function safeRead(source, key) {
  try {
    return source?.[key]
  } catch {
    return undefined
  }
}

function safeStringOrNull(value) {
  try {
    if (typeof value !== 'string') return null
    // Limite arbitraire : une action/uid/storeId légitime ne dépasse pas 500 chars.
    if (value.length > 500) return null
    return value
  } catch {
    return null
  }
}

function safeGetErrorType(error) {
  try {
    // null doit être distingué d'un objet ordinaire.
    if (error === null) return 'null'

    const primitiveType = typeof error

    // Primitives non-objet : string, number, boolean, symbol, bigint, undefined.
    if (primitiveType !== 'object' && primitiveType !== 'function') {
      return primitiveType
    }

    // Objets et fonctions : utiliser Object.prototype.toString pour éviter
    // d'accéder à .constructor, .name ou toute propriété de l'objet.
    // Encadré dans try/catch car un Proxy avec Symbol.toStringTag hostile peut lever.
    try {
      const tag = Object.prototype.toString.call(error)
      if (
        typeof tag === 'string' &&
        tag.startsWith('[object ') &&
        tag.endsWith(']')
      ) {
        return tag.slice(8, -1)
      }
    } catch {
      // Continuer vers le fallback.
    }

    return primitiveType === 'function' ? 'Function' : 'Object'
  } catch {
    return 'Unknown'
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

export function buildSafeUnexpectedErrorLog(context = {}) {
  try {
    return {
      action:       safeStringOrNull(safeRead(context, 'action')),
      requestId:    safeStringOrNull(safeRead(context, 'requestId')),
      actorUid:     safeStringOrNull(safeRead(context, 'actorUid')),
      actorStoreId: safeStringOrNull(safeRead(context, 'actorStoreId')),
      result:       'error',
      errorCode:    'UNEXPECTED_INTERNAL_ERROR',
      errorType:    safeGetErrorType(safeRead(context, 'error')),
    }
  } catch {
    return {
      action:       null,
      requestId:    null,
      actorUid:     null,
      actorStoreId: null,
      result:       'error',
      errorCode:    'UNEXPECTED_INTERNAL_ERROR',
      errorType:    'Unknown',
    }
  }
}

export function writeSafeErrorLog(logWriter, payload) {
  try {
    logWriter({ severity: 'ERROR', ...payload })
  } catch {
    // Le logging ne doit jamais interrompre le callable.
  }
}

/**
 * Journalise un événement d'audit métier CONTRÔLÉ (non une erreur inattendue).
 *
 * À la différence de writeSafeErrorLog, l'appelant fournit ici des champs déjà
 * connus et sûrs (identifiants, montants d'un conflit financier…) : c'est un log
 * serveur légitime pour le diagnostic, jamais renvoyé au client. Ne lève jamais.
 *
 * @param {function} logWriter - Écrivain de log injectable (défaut appelant).
 * @param {object} payload - Champs déjà sûrs à consigner (severity par défaut WARNING).
 */
export function writeSafeAuditLog(logWriter, payload) {
  try {
    logWriter({ severity: 'WARNING', ...payload })
  } catch {
    // Le logging ne doit jamais interrompre le callable.
  }
}
