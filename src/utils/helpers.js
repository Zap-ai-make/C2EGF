import { NETWORK_CODES, TRANSACTION_STYLES, FILTER_CONFIG } from './constants.js'
import { parseFcfaAmount } from './fcfaAmount.js'

/**
 * Extrait le nom complet du client
 * Gère les différents formats de client (string, object, null)
 */
export const getClientName = (client) => {
  if (typeof client === 'string') return client
  if (client && typeof client === 'object') {
    return `${client.prenom || ''} ${client.nom || ''}`.trim()
  }
  return 'Client inconnu'
}

/**
 * Obtient le code réseau pour un réseau donné
 */
export const getNetworkCode = (network) => {
  return NETWORK_CODES[network] || '000000'
}

/**
 * Crée une date formatée en français
 */
export const formatDateToFrench = (date = new Date()) => {
  return date.toLocaleString(
    FILTER_CONFIG.DATE_FORMAT.locale,
    FILTER_CONFIG.DATE_FORMAT.options
  )
}

const toDateValue = (value) => {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  return parsefrenchDate(value)
}

const hasTimePart = (value) => typeof value === 'string' && /\d{1,2}:\d{2}/.test(value)

export const formatTransactionDateTime = (transaction = {}) => {
  const preferredValue = hasTimePart(transaction.date)
    ? transaction.date
    : transaction.createdAt || transaction.validatedAt || transaction.updatedAt || transaction.date || transaction.dateTime

  const date = toDateValue(preferredValue)

  if (!date || isNaN(date.getTime())) {
    return '-'
  }

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Parse une date au format français "DD/MM/YYYY HH:mm"
 * Retourne un objet Date valide ou null en cas d'erreur
 */
export const parsefrenchDate = (dateString) => {
  if (!dateString) return null
  
  try {
    // Format français: "15/09/2025 14:30"
    const [datePart, timePart] = dateString.split(' ')
    
    if (datePart && datePart.includes('/')) {
      const [day, month, year] = datePart.split('/')
      const dayInt = parseInt(day, 10)
      const monthInt = parseInt(month, 10) - 1 // Les mois JS commencent à 0
      const yearInt = parseInt(year, 10)
      
      // Validation des valeurs
      if (isNaN(dayInt) || isNaN(monthInt) || isNaN(yearInt) ||
          dayInt < 1 || dayInt > 31 || monthInt < 0 || monthInt > 11 ||
          yearInt < 1900 || yearInt > 2100) {
        throw new Error('Date invalide')
      }
      
      let date = new Date(yearInt, monthInt, dayInt)
      
      // Ajouter l'heure si disponible
      if (timePart) {
        const [hours, minutes] = timePart.split(':')
        const hoursInt = parseInt(hours, 10)
        const minutesInt = parseInt(minutes, 10)
        
        if (!isNaN(hoursInt) && !isNaN(minutesInt)) {
          date.setHours(hoursInt, minutesInt, 0, 0)
        }
      }
      
      return date
    }
    
    // Tentative de parsing ISO ou autre format standard
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      throw new Error('Format de date non reconnu')
    }
    
    return date
  } catch (error) {
    console.warn('Error parsing date:', dateString, error.message)
    return null
  }
}

/**
 * Normalise une date (supprime les heures/minutes/secondes)
 */
export const normalizeDate = (dateString) => {
  if (!dateString) return null

  try {
    // Si c'est déjà au format ISO (YYYY-MM-DD), utiliser directement
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const date = new Date(dateString + 'T00:00:00')
      return new Date(date.getFullYear(), date.getMonth(), date.getDate())
    }

    // Utiliser parsefrenchDate qui gère tous les formats
    const date = parsefrenchDate(dateString)
    if (!date) return null
    // Normaliser en supprimant l'heure
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  } catch {
    // Ignorer les erreurs de normalisation de date
    return null
  }
}

/**
 * Vérifie si une transaction est du jour actuel
 */
export const isTransactionFromToday = (transaction) => {
  const today = new Date()
  const transactionDate = parsefrenchDate(transaction.date)
  if (!transactionDate) return false
  
  return (
    transactionDate.getDate() === today.getDate() &&
    transactionDate.getMonth() === today.getMonth() &&
    transactionDate.getFullYear() === today.getFullYear()
  )
}

/**
 * Obtient les styles CSS pour un type de transaction
 */
export const getTransactionStyles = (type) => {
  return TRANSACTION_STYLES[type] || TRANSACTION_STYLES.default
}

/**
 * Formate une heure à partir d'une date string
 */
export const formatTime = (dateString) => {
  try {
    const date = parsefrenchDate(dateString)
    if (!date) return '--:--'
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '--:--'
  }
}

/**
 * Valide un formulaire de transaction
 */
export const validateTransactionForm = (selectedClient, amount, transactionType) => {
  return selectedClient && parseFcfaAmount(amount) !== null && transactionType
}

/**
 * Détermine les actions disponibles pour une transaction
 */
export const getAvailableActions = (transactionType) => {
  const actions = {
    modifier: true,
    payerPar: false,
    rembourser: false,
    encaisser: false
  }

  // Logique claire par type de transaction
  switch (transactionType) {
    case 'Retrait':
      // Un retrait peut être payé par une méthode de paiement
      actions.payerPar = true
      break
    case 'Crédit':
      // Un crédit peut être remboursé par une méthode de paiement
      actions.rembourser = true
      break
    case 'Dépôt':
      // Un dépôt peut être encaissé par une méthode de paiement
      actions.encaisser = true
      break
    default:
      // Pas d'actions spéciales pour les autres types
      break
  }

  return actions
}

/**
 * Un draft est « en cours de règlement » dès qu'une Cloud Function y a écrit un
 * champ de comptabilité (première tranche encaissée / remboursée).
 *
 * Miroir applicatif du helper Firestore `draftIsSettling` (firestore.rules) : les
 * règles refusent désormais toute mutation de `type`/`montant`/`clientId` sur un tel
 * draft. On aligne l'UI pour ne pas proposer une action « Modifier » que le serveur
 * rejetterait — évite une erreur pour le caissier.
 */
export const isDraftSettling = (transaction) =>
  !!transaction && (
    transaction.settlementStatus != null ||
    transaction.paidAmount != null ||
    transaction.remainingAmount != null ||
    transaction.settlementSummary != null
  )

/**
 * Valide si une action est possible selon le type de transaction et le contexte
 */
export const validateTransactionAction = (transactionType, action, context = {}) => {
  const { hasStock = true } = context
  const normalizedType = String(transactionType || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const isDeposit = normalizedType === 'depot'
  const isWithdrawal = normalizedType === 'retrait'
  const isCredit = normalizedType === 'credit'

  // Règles de validation par action
  switch (action) {
    case 'valider':
      // Les crédits ne peuvent jamais être validés directement
      if (isCredit) {
        return {
          allowed: false,
          reason: 'Les crédits doivent être remboursés via une méthode de paiement'
        }
      }
      if (isDeposit && !hasStock) {
        return {
          allowed: false,
          reason: 'Stock insuffisant pour valider cette transaction'
        }
      }
      return { allowed: true }

    case 'nonTerminee':
      // Les crédits et dépôts nécessitent du stock
      if ((isCredit || isDeposit) && !hasStock) {
        return {
          allowed: false,
          reason: 'Stock insuffisant pour cette transaction'
        }
      }
      // Les retraits peuvent toujours être marqués comme non terminés
      return { allowed: true }

    case 'payerPar':
    case 'rembourser':
    case 'encaisser': {
      const availableActions = {
        payerPar: isWithdrawal,
        rembourser: isCredit,
        encaisser: isDeposit
      }
      return {
        allowed: availableActions[action] || false,
        reason: availableActions[action] ? '' : `Action non disponible pour ${transactionType}`
      }
    }

    default:
      return { allowed: false, reason: 'Action inconnue' }
  }
}

/**
 * Vérifie si une transaction correspond aux critères de recherche
 */
export const matchesSearchTerm = (transaction, searchTerm) => {
  if (!searchTerm) return true
  
  const searchLower = searchTerm.toLowerCase()
  
  // Recherche dans le nom du client
  const clientName = getClientName(transaction.client).toLowerCase()
  if (clientName.includes(searchLower)) return true
  
  // Recherche dans le code réseau
  if (transaction.code && transaction.code.toString().includes(searchLower)) return true
  
  // Recherche dans le réseau
  if (transaction.reseau && transaction.reseau.toLowerCase().includes(searchLower)) return true
  
  return false
}

/**
 * Vérifie si une transaction est dans une plage de dates
 */
export const matchesDateFilter = (transaction, filter, todayOnly = false) => {
  // Si on veut seulement les transactions du jour et qu'aucun filtre n'est appliqué
  if (todayOnly && !filter.from && !filter.to) {
    return isTransactionFromToday(transaction)
  }

  // Si un filtre de date est appliqué
  if (filter.from || filter.to) {
    // Normaliser la date de transaction (supprimer l'heure)
    const transactionDateFull = parsefrenchDate(transaction.date)
    if (!transactionDateFull) return false
    const transactionDate = new Date(transactionDateFull.getFullYear(), transactionDateFull.getMonth(), transactionDateFull.getDate())

    const fromDate = normalizeDate(filter.from)
    const toDate = normalizeDate(filter.to)

    if (fromDate && transactionDate < fromDate) return false
    if (toDate && transactionDate > toDate) return false

    return true
  }

  return true
}

/**
 * Crée les données d'export pour Excel
 */
export const createExportData = (transactions) => {
  return transactions.map((transaction, index) => ({
    'N°': index + 1,
    'Date & Heure': transaction.date || '',
    'Client': getClientName(transaction.client),
    'Type': transaction.type || '',
    'Réseau': transaction.reseau || '',
    'Code': transaction.code || '',
    'Montant (FCFA)': transaction.montant || 0,
    'Statut': transaction.statut || 'Validée',
    'Email utilisateur': transaction.userEmail || ''
  }))
}

/**
 * Génère un nom de fichier pour l'export
 */
export const generateExportFilename = (transactionCount) => {
  const now = new Date()
  const dateStr = now.toLocaleDateString('fr-FR').replace(/\//g, '-')
  return `Historique_${dateStr}_${transactionCount}_transactions.xlsx`
}

/**
 * Fonction de debounce pour optimiser les recherches
 */
export const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}
