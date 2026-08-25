import { useState, useRef } from 'react'
import { exportClientsToXLSM, importClientsFromXLSM, validateExcelFile } from '../utils/excelUtils'

export const useExcelOperations = (onImportSuccess, onShowNotification, storesById = {}) => {
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef(null)

  const handleExport = async (clients) => {
    const result = await exportClientsToXLSM(clients, undefined, storesById)
    if (result.success) {
      onShowNotification(`Export réussi ! ${result.count} clients exportés.`, 'success')
    } else {
      onShowNotification(`Erreur lors de l'export : ${result.error}`, 'error')
    }
  }

  const handleImportClick = () => {
    fileInputRef.current.click()
  }

  const handleFileImport = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    const validation = validateExcelFile(file)
    if (!validation.isValid) {
      onShowNotification(validation.message, 'error')
      return
    }

    setIsImporting(true)
    try {
      const result = await importClientsFromXLSM(file)
      if (result.success) {
        await onImportSuccess(result.clients)
        onShowNotification(`Import réussi ! ${result.count} clients importés.`, 'success')
      } else {
        onShowNotification(`Erreur lors de l'import : ${result.error}`, 'error')
      }
    } catch (error) {
      onShowNotification(`Erreur lors de l'import : ${error.error || error.message}`, 'error')
    } finally {
      setIsImporting(false)
      event.target.value = ''
    }
  }

  return {
    isImporting,
    fileInputRef,
    handleExport,
    handleImportClick,
    handleFileImport
  }
}
