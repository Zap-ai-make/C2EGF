// Configuration et constantes Firestore
export const FIRESTORE_CONFIG = {
  // Collections
  COLLECTIONS: {
    STORES: 'stores',
    USERS: 'users',
    CLIENTS: 'globalClients',
    DRAFTS: 'drafts',
    HISTORY: 'history',
    NETWORK_BALANCES: 'networkBalances',
    SESSIONS: 'sessions',
    AUDIT_LOGS: 'auditLogs'
  },

  // Limites et pagination
  LIMITS: {
    DEFAULT_PAGE_SIZE: 25,
    MAX_PAGE_SIZE: 100,
    MAX_BATCH_SIZE: 500,
    LISTENER_TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
  },

  // Cache
  CACHE: {
    TTL: 5 * 60 * 1000, // 5 minutes
    MAX_SIZE: 1000,
    INVALIDATION_PATTERNS: ['*_updated', '*_deleted', '*_created']
  },

  // Types de transactions
  TRANSACTION_TYPES: {
    DEPOT: 'Dépôt',
    RETRAIT: 'Retrait',
    CREDIT: 'Crédit'
  },

  // Statuts
  STATUS: {
    PENDING: 'Non Terminées',
    VALIDATED: 'Validée',
    REFUNDED: 'Remboursée',
    CANCELLED: 'Annulée'
  },

  // Règles de validation
  VALIDATION: {
    CLIENT: {
      NAME_MIN_LENGTH: 2,
      NAME_MAX_LENGTH: 50,
      PHONE_REGEX: /^[0-9+\-\s()/]{8,120}$/,
      REQUIRED_FIELDS: ['nom', 'prenom']
    },
    TRANSACTION: {
      REQUIRED_FIELDS: ['type', 'montant', 'clientId']
    }
  },

  // Messages d'erreur
  ERRORS: {
    NETWORK: 'Erreur de connexion réseau',
    PERMISSION_DENIED: 'Permissions insuffisantes',
    NOT_FOUND: 'Document non trouvé',
    QUOTA_EXCEEDED: 'Quota dépassé',
    TIMEOUT: 'Timeout de connexion',
    INVALID_DATA: 'Données invalides'
  }
}

