import { useRef, useState } from 'react'
import { useTransactions } from '../../context/transactions.jsx'
import { EXPORT_CONFIG, MESSAGES } from '../../utils/constants.js'
import { createExportData, generateExportFilename } from '../../utils/helpers.js'

function ActionButtons({ filteredTransactions = [], resetFilters }) {
  const { addTransaction } = useTransactions()
  const fileInputRef = useRef(null)
  const [message, setMessage] = useState(null)


  const handleExport = async () => {
    if (filteredTransactions.length === 0) {
      setMessage({ type: 'error', text: MESSAGES.ERRORS.NO_EXPORT_DATA })
      return
    }

    const exportData = createExportData(filteredTransactions)
    const XLSX = await import('xlsx')

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(exportData)
    ws['!cols'] = EXPORT_CONFIG.COLUMN_WIDTHS
    XLSX.utils.book_append_sheet(wb, ws, EXPORT_CONFIG.SHEET_NAME)
    const filename = generateExportFilename(filteredTransactions.length)

    // Télécharger le fichier
    XLSX.writeFile(wb, filename)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await import('xlsx')
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        
        // Prendre la première feuille
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        
        // Convertir en JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet)
        
        const imports = []
        const importBatchId = Date.now()
        
        // Traiter chaque ligne
        jsonData.forEach((row, index) => {
          // Mapper les données importées vers le format de transaction
          if (row['Client'] && row['Type'] && row['Montant (FCFA)']) {
            const clientName = String(row['Client'] || '').trim()
            const transaction = {
              client: clientName,
              clientId: `import-${importBatchId}-${index}`,
              type: row['Type'],
              reseau: row['Réseau'] || 'Orange',
              code: row['Code'] || '000000',
              montant: parseFloat(row['Montant (FCFA)']) || 0,
              statut: 'Validée', // Les imports sont toujours validés
              userEmail: row['Email utilisateur'] || ''
            }
            
            imports.push(addTransaction(transaction))
          }
        })

        const results = await Promise.allSettled(imports)
        const importedCount = results.filter(result => result.status === 'fulfilled').length
        const failedCount = results.length - importedCount

        if (failedCount > 0) {
          throw new Error(`${failedCount} transaction(s) non importée(s)`)
        }

        setMessage({ type: 'success', text: MESSAGES.SUCCESS.IMPORT_SUCCESS(importedCount) })
        
        // Réinitialiser les filtres pour voir les nouvelles transactions
        resetFilters && resetFilters()
        
      } catch (error) {
        console.error('Erreur lors de l\'import:', error)
        setMessage({ type: 'error', text: MESSAGES.ERRORS.IMPORT_ERROR })
      }
    }
    
    reader.readAsArrayBuffer(file)
    
    // Réinitialiser l'input file
    event.target.value = ''
  }

  return (
    <div className="mt-4 space-y-3">
      {message && (
        <div className={`rounded border px-3 py-2 text-sm ${
          message.type === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <button
          onClick={handleExport}
          className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded font-medium transition-colors"
        >
          Exporter XLSM
        </button>

        <button
          onClick={handleImport}
          className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded font-medium transition-colors"
        >
          Importer (XLSM)
        </button>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept={EXPORT_CONFIG.FILE_EXTENSIONS}
          className="hidden"
        />
      </div>
    </div>
  )
}

export default ActionButtons
