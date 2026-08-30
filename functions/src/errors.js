/**
 * Codes d'erreur métier et leur correspondance HttpsError.
 * Les handlers lancent DealerRequestError ; index.js les convertit en HttpsError.
 */

export const HTTP_CODES = {
  UNAUTHENTICATED:          'unauthenticated',
  PROFILE_NOT_FOUND:        'permission-denied',
  PROFILE_INACTIVE:         'permission-denied',
  ROLE_FORBIDDEN:           'permission-denied',
  STORE_ID_REQUIRED:        'permission-denied',
  INVALID_REQUEST_ID:       'invalid-argument',
  REQUEST_NOT_FOUND:        'not-found',
  REQUEST_NOT_PENDING:      'failed-precondition',
  REQUEST_STORE_MISMATCH:   'permission-denied',
  INVALID_REQUEST_DATA:     'failed-precondition',
  INVALID_REJECTION_REASON: 'invalid-argument',
  BALANCE_NOT_FOUND:        'failed-precondition',
  INVALID_BALANCE_DATA:     'internal',
  BALANCE_OVERFLOW:         'failed-precondition',
  TRANSACTION_FAILED:       'internal',
  // Clôtures Dealer
  STORE_NOT_FOUND:              'not-found',
  STORE_INACTIVE:               'failed-precondition',
  INVALID_CLOSURE_DATA:         'invalid-argument',
  INVALID_CLOSURE_ID:           'invalid-argument',
  REASON_REQUIRED:              'invalid-argument',
  CLOSURE_ALREADY_EXISTS:       'failed-precondition',
  CLOSURE_NOT_FOUND:            'not-found',
  CLOSURE_STORE_MISMATCH:       'permission-denied',
  CLOSURE_NOT_PENDING:          'failed-precondition',
  // Règlements (settlements)
  SETTLEMENT_DRAFT_NOT_FOUND:   'not-found',
  SETTLEMENT_ALREADY_SETTLED:   'failed-precondition',
  SETTLEMENT_EXCEEDS_REMAINING: 'failed-precondition',
  REFUND_EXCEEDS_PAID:          'failed-precondition',
  INVALID_SETTLEMENT_AMOUNT:    'invalid-argument',
  INVALID_PAYMENT_METHOD:       'invalid-argument',
  SETTLEMENT_STORE_MISMATCH:    'permission-denied',
  SETTLEMENT_DATA_INVALID:      'invalid-argument',
  // Même clé d'idempotence, payload différent (montant ou méthode)
  IDEMPOTENCY_CONFLICT:         'failed-precondition',
  // Transferts boutique → dealer (retours de stock / liquidité)
  INVALID_TRANSFER_TYPE:        'invalid-argument',
  INVALID_TRANSFER_AMOUNT:      'invalid-argument',
  INVALID_TRANSFER_ID:          'invalid-argument',
  INVALID_TRANSFER_DATA:        'failed-precondition',
  TRANSFER_NOT_FOUND:           'not-found',
  TRANSFER_NOT_PENDING:         'failed-precondition',
  TRANSFER_DEALER_MISMATCH:     'permission-denied',
  INSUFFICIENT_STORE_BALANCE:   'failed-precondition',
  DEALER_NOT_FOUND:             'failed-precondition',
  MULTIPLE_DEALERS_ACTIVE:      'failed-precondition',
  // Approvisionnement de l'inventaire dealer
  INVALID_INVENTORY_RESOURCE:   'invalid-argument',
  INSUFFICIENT_DEALER_BALANCE:  'failed-precondition',
  // Dépôt partenaire (sous-dealer hors boîte)
  INVALID_PARTNER:              'invalid-argument',
  // Collaborations inter-boutiques
  // Le module entier est opt-in par profil : un client qui ne l'a pas souscrit
  // est refusé jusqu'au serveur, pas seulement masqué dans l'UI.
  COLLABORATIONS_DISABLED:       'failed-precondition',
  INVALID_COLLABORATION_ID:      'invalid-argument',
  INVALID_OPERATION_TYPE:        'invalid-argument',
  INVALID_COLLABORATION_AMOUNT:  'invalid-argument',
  INVALID_COLLABORATION_NETWORK: 'invalid-argument',
  INVALID_STORE_ID:              'invalid-argument',
  INVALID_CLIENT_ID:             'invalid-argument',
  SAME_STORE_COLLABORATION:      'invalid-argument',
  CLIENT_NOT_FOUND:              'not-found',
  SUPPLIER_STORE_NOT_FOUND:      'not-found',
  // Mono-réseau : toute boutique active opère le réseau, donc l'éligibilité d'une
  // fournisseuse se réduit à « elle existe et elle est active ». C'est l'analogue
  // du SUPPLIER_NOT_PROVIDER d'un profil multi-réseaux.
  SUPPLIER_STORE_INACTIVE:       'failed-precondition',
  INSUFFICIENT_SUPPLIER_BALANCE: 'failed-precondition',
  COLLABORATION_NOT_FOUND:       'not-found',
  COLLABORATION_NOT_PENDING:     'failed-precondition',
  COLLABORATION_STORE_MISMATCH:  'permission-denied',
  // Dettes internes et règlements par tranche
  INVALID_DEBT_ID:                 'invalid-argument',
  INVALID_SETTLEMENT_ID:           'invalid-argument',
  INVALID_SETTLEMENT_METHOD:       'invalid-argument',
  INVALID_IDEMPOTENCY_KEY:         'invalid-argument',
  INVALID_DEBT_DATA:               'failed-precondition',
  DEBT_NOT_FOUND:                  'not-found',
  DEBT_ALREADY_SETTLED:            'failed-precondition',
  DEBT_STORE_MISMATCH:             'permission-denied',
  SETTLEMENT_NOT_FOUND:            'not-found',
  SETTLEMENT_NOT_DECLARED:         'failed-precondition',
  SETTLEMENT_INSUFFICIENT_BALANCE: 'failed-precondition',
  // Compensation d'une dette contre la dette opposée
  INVALID_OPPOSITE_DEBT:           'invalid-argument',
  NOT_OPPOSITE_PAIR:               'failed-precondition',
  COMPENSATION_EXCEEDS_REMAINING:  'failed-precondition',
}

export class DealerRequestError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DealerRequestError'
    this.code = code
    this.httpCode = HTTP_CODES[code] ?? 'internal'
  }
}
