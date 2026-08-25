import { useMemo } from 'react'
import { useAllTransactions } from './useAllTransactions'

const toDate = (value) => {
  if (!value) return null
  const dateValue = typeof value?.toDate === 'function' ? value.toDate() : value
  const date = new Date(dateValue)
  return isNaN(date.getTime()) ? null : date
}

/**
 * Hook pour calculer les vraies statistiques d'activité de l'utilisateur
 * @param {Object} currentUser - Utilisateur actuel de Firebase Auth
 * @param {Object} userProfile - Profil utilisateur de Firestore
 * @returns {Object} Statistiques d'activité réelles
 */
export const useUserActivity = (currentUser, userProfile) => {
  const allTransactions = useAllTransactions()

  return useMemo(() => {
    if (!currentUser || !allTransactions) {
      return {
        monthlyLogins: 0,
        daysSinceRegistration: 0,
        totalTransactions: 0,
        accountStatus: 'Inactif'
      }
    }

    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    // 1. Calculer les jours depuis l'inscription
    const creationTime = userProfile?.createdAt || currentUser?.metadata?.creationTime
    let daysSinceRegistration = 0

    const creationDate = toDate(creationTime)
    if (creationDate) {
      try {
        const diffTime = Math.abs(now - creationDate)
        daysSinceRegistration = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      } catch {
        daysSinceRegistration = 0
      }
    }

    // 2. Compter les transactions de l'utilisateur
    const userTransactions = allTransactions.filter(transaction =>
      transaction.userEmail === currentUser.email
    )
    const totalTransactions = userTransactions.length

    // 3. Compter les transactions de ce mois pour estimer l'activité
    const monthlyTransactions = userTransactions.filter(transaction => {
      if (!transaction.date) return false
      try {
        // Parser la date française "DD/MM/YYYY HH:mm"
        const [datePart] = transaction.date.split(' ')
        const [day, month, year] = datePart.split('/')
        const transactionDate = new Date(year, month - 1, day)

        return transactionDate.getMonth() === currentMonth &&
               transactionDate.getFullYear() === currentYear
      } catch {
        return false
      }
    }).length

    // 4. Estimer les connexions du mois basé sur l'activité
    // Si l'utilisateur a fait des transactions, on estime qu'il s'est connecté
    const monthlyLogins = monthlyTransactions > 0 ? Math.min(monthlyTransactions, 30) : 0

    // 5. Déterminer le statut du compte
    let accountStatus = 'Inactif'
    const lastActivity = userProfile?.lastLogin || currentUser?.metadata?.lastSignInTime

    const lastActivityDate = toDate(lastActivity)
    if (lastActivityDate) {
      try {
        const daysSinceLastActivity = Math.floor((now - lastActivityDate) / (1000 * 60 * 60 * 24))

        if (daysSinceLastActivity <= 1) {
          accountStatus = 'Très actif'
        } else if (daysSinceLastActivity <= 7) {
          accountStatus = 'Actif'
        } else if (daysSinceLastActivity <= 30) {
          accountStatus = 'Peu actif'
        } else {
          accountStatus = 'Inactif'
        }
      } catch {
        accountStatus = 'Inconnu'
      }
    }

    return {
      monthlyLogins,
      daysSinceRegistration,
      totalTransactions,
      accountStatus,
      // Données supplémentaires pour debug
      userEmail: currentUser.email,
      hasTransactions: totalTransactions > 0
    }
  }, [currentUser, userProfile, allTransactions])
}
