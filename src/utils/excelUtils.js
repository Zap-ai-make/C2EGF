import { EXCEL_HEADERS } from '../constants'
import { CLIENT_ID } from '../config/clientIsolation'

// ---------------------------------------------------------------------------
// Détection d'en-têtes — import robuste
// ---------------------------------------------------------------------------

/**
 * Normalise un en-tête de colonne pour la détection.
 * Supprime les accents, trim, lowercase.
 */
function normalizeHeader(header) {
  if (typeof header !== 'string') return ''
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // supprime les diacritiques
}

/**
 * Table de correspondance en-tête normalisé → champ canonique du modèle client.
 * La colonne Boutique est mappée sur '_boutique_ignored' : elle est présente
 * dans les exports mais ne doit jamais définir registeredStoreId/registeredStoreName.
 * Ces champs sont injectés par addClient depuis la boutique active connectée.
 */
const HEADER_ALIASES = {
  // Nom
  'nom': 'nom',
  'name': 'nom',
  // Prénom
  'prenom': 'prenom',
  'first name': 'prenom',
  'firstname': 'prenom',
  // Numéro d'identité
  "numero d'identite": 'numeroIdentite',
  'numero identite': 'numeroIdentite',
  'identite': 'numeroIdentite',
  // Numéro personnel
  'numero personnel': 'numeroPersonnel',
  'telephone': 'numeroPersonnel',
  'tel': 'numeroPersonnel',
  // Numéro agent / Code agent → champ 'orange' dans le modèle client
  'numero agent / code agent': 'orange',
  'numero agent': 'orange',
  'code agent': 'orange',
  'agent': 'orange',
  'orange': 'orange',
  // Localité
  'localite': 'localite',
  'locality': 'localite',
  'ville': 'localite',
  // Agent commercial
  'agent commercial': 'agentCommercial',
  'commercial': 'agentCommercial',
  // Date d'ajout
  "date d'ajout": 'dateAjout',
  'date ajout': 'dateAjout',
  'date': 'dateAjout',
  // Boutique — INFORMATIVE UNIQUEMENT, jamais utilisée pour définir la propriété
  'boutique': '_boutique_ignored',
  'store': '_boutique_ignored',
  'magasin': '_boutique_ignored',
}

/**
 * Étiquettes lisibles des champs canoniques, utilisées dans les messages d'erreur.
 */
const FIELD_LABELS = {
  'nom': 'Nom',
  'prenom': 'Prénom',
  'numeroIdentite': "Numéro d'identité",
  'numeroPersonnel': 'Numéro personnel',
  'orange': 'Numéro agent / Code agent',
  'localite': 'Localité',
  'agentCommercial': 'Agent commercial',
  'dateAjout': "Date d'ajout",
  '_boutique_ignored': 'Boutique',
}

function getFieldLabel(field) {
  return FIELD_LABELS[field] || field
}

/**
 * Normalise la valeur d'une cellule pour un champ donné.
 * Les numéros importés depuis Excel peuvent arriver comme Number (ex: 70001234).
 * On les convertit en string pour préserver le type attendu par le service client.
 * Les chaînes avec zéro initial ("0012") sont préservées telles quelles.
 */
function normalizeCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Entier : pas de décimale superflue
    return Number.isInteger(value) ? String(value) : String(value)
  }
  // NaN, Infinity, objet, tableau → chaîne vide
  return ''
}

/**
 * Détecte si une ligne est vide (toutes les cellules sont nulles/undefined/chaîne vide).
 */
function isRowEmpty(row) {
  if (!Array.isArray(row) || row.length === 0) return true
  return row.every(cell => cell === null || cell === undefined || cell === '')
}

/**
 * Analyse un tableau jsonData (résultat de sheet_to_json avec header:1) et
 * retourne { success, clients, count } ou { success: false, error, clients: [] }.
 *
 * Cette fonction est exportée pour permettre les tests unitaires sans FileReader.
 * Elle n'accède à aucune ressource externe.
 *
 * @param {Array} jsonData - Tableau de tableaux : première ligne = en-têtes, reste = données
 * @returns {{ success: boolean, clients: Array, count: number, error?: string }}
 */
export function parseWorksheetRows(jsonData) {
  if (!Array.isArray(jsonData) || jsonData.length === 0) {
    return { success: true, clients: [], count: 0 }
  }

  const rawHeaders = jsonData[0] || []

  // Construire la map : index colonne → champ canonique
  // Détection des doublons : deux colonnes mappées sur le même champ canonique
  // constituent une ambiguïté et déclenchent un rejet immédiat.
  const columnMap = {}
  const fieldToColumn = {} // champ canonique → { originalHeader, colNumber }
  let duplicateError = null

  for (let idx = 0; idx < rawHeaders.length; idx++) {
    const rawHeader = rawHeaders[idx]
    const normalized = normalizeHeader(String(rawHeader ?? ''))
    const field = HEADER_ALIASES[normalized]
    if (!field) continue // colonne inconnue, ignorée

    if (fieldToColumn[field]) {
      const existing = fieldToColumn[field]
      const colA = existing.colNumber
      const colB = idx + 1
      const fieldLabel = getFieldLabel(field)
      duplicateError = `Colonnes ambiguës pour « ${fieldLabel} » : « ${existing.originalHeader} » (colonne ${colA}) et « ${String(rawHeader).trim()} » (colonne ${colB}).`
      break
    }

    fieldToColumn[field] = { originalHeader: String(rawHeader).trim(), colNumber: idx + 1 }
    columnMap[idx] = field
  }

  if (duplicateError) {
    return { success: false, error: duplicateError, clients: [] }
  }

  const fields = Object.values(columnMap)

  // Fallback : si aucun en-tête reconnu → logique positionnelle legacy
  // (fichiers sans ligne d'en-têtes ou format très ancien)
  const hasRecognizedHeaders = fields.length > 0

  if (!hasRecognizedHeaders) {
    // Aucun en-tête reconnu : impossible de mapper les colonnes de façon sûre
    return {
      success: false,
      error: 'Aucun en-tête reconnu dans le fichier. Vérifiez que la première ligne contient les noms de colonnes.',
      clients: [],
    }
  }

  // Vérifier les colonnes obligatoires
  if (!fields.includes('nom')) {
    return {
      success: false,
      error: 'Colonne "Nom" introuvable dans le fichier',
      clients: [],
    }
  }
  if (!fields.includes('prenom')) {
    return {
      success: false,
      error: 'Colonne "Prénom" introuvable dans le fichier',
      clients: [],
    }
  }

  // Lire les lignes de données (après l'en-tête)
  // Phase 1 : collecter les lignes valides et les erreurs
  // Un seul fichier est rejeté dès qu'une ligne présente un nom ou prénom vide.
  // Aucun import partiel n'est autorisé.
  const dataRows = jsonData.slice(1)
  const lineErrors = []
  const validClients = []

  dataRows.forEach((row, rowIndex) => {
    if (isRowEmpty(row)) return // ligne entièrement vide → ignorée

    const client = {}
    Object.entries(columnMap).forEach(([idx, field]) => {
      if (field === '_boutique_ignored') return // colonne Boutique ignorée
      const rawValue = row[Number(idx)]
      client[field] = normalizeCell(rawValue)
    })

    // Garantie de sécurité : ces champs ne doivent jamais venir du fichier
    delete client.registeredStoreId
    delete client.registeredStoreName
    delete client.registeredBy

    const excelRowNumber = rowIndex + 2 // +1 pour l'en-tête, +1 car 1-based

    // Vérification Nom obligatoire
    if (!client.nom || String(client.nom).trim() === '') {
      lineErrors.push(`Ligne ${excelRowNumber} : le nom est obligatoire.`)
      return
    }

    // Vérification Prénom obligatoire
    if (!client.prenom || String(client.prenom).trim() === '') {
      lineErrors.push(`Ligne ${excelRowNumber} : le prénom est obligatoire.`)
      return
    }

    // Ajouter un id temporaire d'import
    client.id = `import_${Date.now()}_${rowIndex}`

    validClients.push(client)
  })

  // Phase 2 : si des erreurs → aucun import partiel
  if (lineErrors.length > 0) {
    return {
      success: false,
      error: lineErrors.join('\n'),
      clients: [],
    }
  }

  return { success: true, clients: validClients, count: validClients.length }
}

/**
 * Résout le nom de la boutique pour un client.
 *
 * Priorité :
 *   1. client.registeredStoreName non vide
 *   2. lookup dans storesById par client.registeredStoreId
 *   3. registeredStoreId seul (nom inconnu)
 *   4. 'Boutique inconnue'
 *
 * Cette logique doit rester alignée avec TableRow.jsx qui affiche
 * `client.registeredStoreName || 'Ancienne base'`.
 * L'export utilise 'Boutique inconnue' à la place de 'Ancienne base'
 * pour les anciens clients afin d'éviter une confusion dans les exports
 * multi-boutiques.
 */
export const resolveClientStoreName = (client, storesById) => {
  if (
    client.registeredStoreName &&
    typeof client.registeredStoreName === 'string' &&
    client.registeredStoreName.trim() !== ''
  ) {
    return client.registeredStoreName.trim()
  }
  if (client.registeredStoreId && storesById && storesById[client.registeredStoreId]) {
    const store = storesById[client.registeredStoreId]
    const name = store.name || store.storeName
    if (name && typeof name === 'string' && name.trim() !== '') {
      return name.trim()
    }
    return `Boutique inconnue (${client.registeredStoreId})`
  }
  if (client.registeredStoreId) {
    return `Boutique inconnue (${client.registeredStoreId})`
  }
  return 'Boutique inconnue'
}

// Fonction pour exporter les clients vers XLSM
export const exportClientsToXLSM = async (clients, filename = `clients_${CLIENT_ID}`, storesById = {}) => {
  try {
    const XLSX = await import('xlsx')

    // Convertir les clients en tableau de données
    // Les champs numériques (numeroPersonnel, orange/Code agent, numeroIdentite)
    // sont forcés en type texte pour préserver les zéros initiaux à l'import.
    const forceText = (value) => {
      const str = value !== null && value !== undefined ? String(value) : ''
      // Objet cellule SheetJS avec type explicite 't: s' (string)
      return { t: 's', v: str }
    }

    const data = clients.map(client => [
      resolveClientStoreName(client, storesById),
      client.nom,
      client.prenom,
      forceText(client.numeroIdentite),
      forceText(client.numeroPersonnel),
      forceText(client.orange),
      client.localite,
      client.agentCommercial,
      client.dateAjout
    ])

    // Ajouter les en-têtes en première ligne
    const worksheetData = [EXCEL_HEADERS, ...data]

    // Créer une nouvelle feuille de calcul
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

    // Définir la largeur des colonnes pour une meilleure lisibilité
    worksheet['!cols'] = [
      { width: 22 }, // Boutique
      { width: 15 }, // Nom
      { width: 15 }, // Prénom
      { width: 20 }, // Numéro d'identité
      { width: 18 }, // Numéro personnel
      { width: 12 }, // Orange
      { width: 30 }, // Localité
      { width: 20 }, // Agent commercial
      { width: 15 }  // Date d'ajout
    ]

    // Créer un nouveau classeur et ajouter la feuille
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients')

    // Télécharger le fichier XLSM
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '')
    XLSX.writeFile(workbook, `${filename}_${timestamp}.xlsm`)
    
    return { success: true, count: clients.length }
  } catch (error) {
    console.error('Erreur lors de l\'export:', error)
    return { success: false, error: error.message }
  }
}

// Fonction pour importer des clients depuis un fichier XLSM/XLSX
export const importClientsFromXLSM = (file) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()

      reader.onload = async (e) => {
        try {
          const XLSX = await import('xlsx')
          const data = new Uint8Array(e.target.result)
          const workbook = XLSX.read(data, { type: 'array' })

          // Prendre la première feuille
          const firstSheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[firstSheetName]

          // Convertir en JSON (première ligne = en-têtes)
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

          // Déléguer à parseWorksheetRows qui gère la détection par en-têtes
          const result = parseWorksheetRows(jsonData)

          if (result.success) {
            resolve(result)
          } else {
            reject(result)
          }
        } catch (error) {
          reject({ success: false, error: `Erreur de lecture du fichier: ${error.message}` })
        }
      }

      reader.onerror = () => {
        reject({ success: false, error: 'Erreur de lecture du fichier' })
      }

      reader.readAsArrayBuffer(file)
    } catch (error) {
      reject({ success: false, error: error.message })
    }
  })
}

// Fonction pour valider le format du fichier
export const validateExcelFile = (file) => {
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
    'application/vnd.ms-excel' // .xls (legacy)
  ]
  
  const validExtensions = ['.xlsx', '.xlsm', '.xls']
  const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  
  return {
    isValid: validTypes.includes(file.type) || validExtensions.includes(fileExtension),
    message: validTypes.includes(file.type) || validExtensions.includes(fileExtension) 
      ? 'Fichier valide' 
      : 'Veuillez sélectionner un fichier Excel (.xlsx, .xlsm, ou .xls)'
  }
}
