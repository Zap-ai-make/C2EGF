import { getStorageKey } from '../config/clientIsolation'

export const MONTHS = {
  'Janvier': '01',
  'Février': '02', 
  'Mars': '03',
  'Avril': '04',
  'Mai': '05',
  'Juin': '06',
  'Juillet': '07',
  'Août': '08',
  'Septembre': '09',
  'Octobre': '10',
  'Novembre': '11',
  'Décembre': '12'
}

export const MONTH_OPTIONS = [
  'Tous les mois',
  ...Object.keys(MONTHS)
]

export const EXCEL_HEADERS = [
  'Boutique',
  'Nom',
  'Prénom',
  'Numéro d\'identité',
  'Numéro personnel',
  'Numéro agent / Code agent',
  'Localité',
  'Agent commercial',
  'Date d\'ajout'
]

export const TABLE_HEADERS = [
  { key: 'registeredStoreName', label: 'Boutique', width: 'min-w-36' },
  { key: 'nom', label: 'Nom', width: 'min-w-32' },
  { key: 'prenom', label: 'Prénom', width: 'min-w-32' },
  { key: 'numeroIdentite', label: 'Numéro d\'identité', width: 'min-w-40' },
  { key: 'numeroPersonnel', label: 'Numéro personnel', width: 'min-w-36' },
  { key: 'orange', label: 'Numéro agent / Code agent', width: 'min-w-44' },
  { key: 'localite', label: 'Localité', width: 'min-w-48' },
  { key: 'agentCommercial', label: 'Agent commercial', width: 'min-w-40' },
  { key: 'dateAjout', label: 'Date d\'ajout', width: 'min-w-32' }
]

export const STORAGE_KEYS = {
  CLIENTS: getStorageKey('clients'),
  PENDING_TRANSACTIONS: getStorageKey('pending_transactions'),
  COMPLETED_TRANSACTIONS: getStorageKey('completed_transactions')
}

export const TOAST_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
}

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100]
}
