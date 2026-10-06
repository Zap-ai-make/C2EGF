import { useState, useMemo } from 'react'
import { useTransactions } from '../context/transactions.jsx'
import { matchesSearchTerm, matchesDateFilter } from '../utils/helpers.js'
import { STORE_MOVEMENT_TYPES, estSupprimee } from '../utils/constants.js'

/** Horodatage de mise à la corbeille, pour le tri du plus récent au plus ancien. */
const instantSuppression = (transaction) => {
  const brut = transaction?.deletedAt
  if (!brut) return 0
  // Timestamp Firestore côté serveur, Date côté marquage optimiste.
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export const useHistoriqueFilters = () => {
  const { completedTransactions } = useTransactions()
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' })
  const [searchTerm, setSearchTerm] = useState('')
  const [appliedDateFilter, setAppliedDateFilter] = useState({ from: '', to: '' })
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('')
  const [showTodayOnly, setShowTodayOnly] = useState(false)


  // Transactions filtrées avec useMemo pour optimiser les performances
  const filteredTransactions = useMemo(() => {
    return completedTransactions.filter(transaction => {
      // Ravitaillements et clôtures sont des mouvements de la boutique, pas des
      // transactions d'agents : ils ont leur onglet. Les laisser ici les
      // affichait sous « Client inconnu », code vide, au milieu des dépôts.
      if (STORE_MOVEMENT_TYPES.includes(transaction.type)) return false
      // Une ligne supprimée a rendu son montant aux soldes : la laisser ici la
      // ferait relire comme une opération vivante, et le total de la journée
      // compterait un dépôt que la boutique n'a plus.
      if (estSupprimee(transaction)) return false
      return matchesDateFilter(transaction, appliedDateFilter, showTodayOnly) &&
             matchesSearchTerm(transaction, appliedSearchTerm || searchTerm)
    })
  }, [completedTransactions, appliedDateFilter, appliedSearchTerm, searchTerm, showTodayOnly])

  /**
   * La corbeille : tout ce qui a été supprimé, des deux provenances, du plus
   * récent au plus ancien.
   *
   * Ni le filtre de date ni la recherche ne s'y appliquent — on y vient pour
   * retrouver ce qu'on vient de perdre, pas pour explorer une période. Les
   * mouvements de boutique n'y sont pas écartés : un ravitaillement ne peut pas
   * être supprimé, donc il ne peut pas s'y trouver.
   */
  const corbeille = useMemo(
    () => completedTransactions
      .filter(estSupprimee)
      .sort((a, b) => instantSuppression(b) - instantSuppression(a)),
    [completedTransactions],
  )

  const applyDateFilter = (filter) => {
    setDateFilter(filter)
    setAppliedDateFilter(filter)
    setShowTodayOnly(false) // Désactive l'affichage "aujourd'hui seulement" quand on filtre par date
  }

  const applySearchFilter = (term) => {
    setSearchTerm(term)
    setAppliedSearchTerm(term)
  }

  // Fonction pour la recherche en temps réel (appelée au changement de input)
  const handleSearchChange = (term) => {
    setSearchTerm(term)
    // La recherche se fait automatiquement via le useMemo
  }

  // Fonction pour revenir aux transactions du jour uniquement
  const resetToToday = () => {
    setDateFilter({ from: '', to: '' })
    setSearchTerm('')
    setAppliedDateFilter({ from: '', to: '' })
    setAppliedSearchTerm('')
    setShowTodayOnly(true)
  }

  const resetFilters = () => {
    setDateFilter({ from: '', to: '' })
    setSearchTerm('')
    setAppliedDateFilter({ from: '', to: '' })
    setAppliedSearchTerm('')
    setShowTodayOnly(false)
  }

  return {
    // État
    dateFilter,
    searchTerm,
    showTodayOnly,
    
    // Données filtrées
    filteredTransactions,
    corbeille,
    allTransactions: completedTransactions,
    
    // Actions
    setDateFilter,
    setSearchTerm,
    applyDateFilter,
    applySearchFilter,
    handleSearchChange,
    resetToToday,
    resetFilters
  }
}
