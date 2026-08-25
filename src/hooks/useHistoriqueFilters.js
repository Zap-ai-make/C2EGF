import { useState, useMemo } from 'react'
import { useTransactions } from '../context/transactions.jsx'
import { matchesSearchTerm, matchesDateFilter } from '../utils/helpers.js'

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
      return matchesDateFilter(transaction, appliedDateFilter, showTodayOnly) && 
             matchesSearchTerm(transaction, appliedSearchTerm || searchTerm)
    })
  }, [completedTransactions, appliedDateFilter, appliedSearchTerm, searchTerm, showTodayOnly])

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
