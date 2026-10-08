import { EXCEL_HEADERS } from '../constants'
import { CLIENT_ID } from '../config/clientIsolation'
import { parseFcfaAmount } from './fcfaAmount.js'
import { champsAgent, repartirValeurAgent } from './agentFields.js'

export const EXCEL_IMPORT_LIMITS = Object.freeze({
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_UNCOMPRESSED_BYTES: 50 * 1024 * 1024,
  MAX_ARCHIVE_ENTRIES: 1000,
  MAX_ROWS: 1000,
  MAX_COLUMNS: 32,
})

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
])
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls'])

function hasExcelSignature(bytes) {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const compound = bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    .every((value, index) => bytes[index] === value)
  return zip || compound
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

export function validateExcelContent(bytes) {
  if (!hasExcelSignature(bytes)) {
    throw new Error('Le contenu du fichier ne correspond pas à un classeur Excel.')
  }
  // Le vieux format XLS/CFB n'est pas compressé : la limite du fichier borne
  // déjà son volume. Pour XLSX/XLSM, lire le répertoire central avant SheetJS
  // évite de décompresser une archive dont le volume annoncé est démesuré.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return

  let eocd = -1
  const searchStart = Math.max(0, bytes.length - 65_557)
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (readUint32(bytes, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Archive Excel incomplète ou corrompue.')

  const entries = readUint16(bytes, eocd + 10)
  const centralSize = readUint32(bytes, eocd + 12)
  const centralOffset = readUint32(bytes, eocd + 16)
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Les archives Excel ZIP64 ne sont pas acceptées.')
  }
  if (entries > EXCEL_IMPORT_LIMITS.MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw new Error('L’archive Excel dépasse les limites autorisées.')
  }

  let offset = centralOffset
  let uncompressedBytes = 0
  for (let index = 0; index < entries; index++) {
    if (readUint32(bytes, offset) !== 0x02014b50) throw new Error('Répertoire Excel corrompu.')
    uncompressedBytes += readUint32(bytes, offset + 24)
    if (uncompressedBytes > EXCEL_IMPORT_LIMITS.MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Le contenu décompressé du fichier Excel est trop volumineux.')
    }
    offset += 46 + readUint16(bytes, offset + 28) + readUint16(bytes, offset + 30) + readUint16(bytes, offset + 32)
  }
}

function assertWorksheetBounds(XLSX, worksheet) {
  if (!worksheet?.['!ref']) return
  const range = XLSX.utils.decode_range(worksheet['!ref'])
  const rows = range.e.r - range.s.r + 1
  const columns = range.e.c - range.s.c + 1
  if (rows > EXCEL_IMPORT_LIMITS.MAX_ROWS + 1) {
    throw new Error(`Le fichier dépasse la limite de ${EXCEL_IMPORT_LIMITS.MAX_ROWS} lignes.`)
  }
  if (columns > EXCEL_IMPORT_LIMITS.MAX_COLUMNS) {
    throw new Error(`Le fichier dépasse la limite de ${EXCEL_IMPORT_LIMITS.MAX_COLUMNS} colonnes.`)
  }
}

export async function readExcelFile(file, sheetOptions = {}) {
  const validation = validateExcelFile(file)
  if (!validation.isValid) throw new Error(validation.message)

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  validateExcelContent(bytes)

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(bytes, { type: 'array', sheetRows: EXCEL_IMPORT_LIMITS.MAX_ROWS + 2 })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('Le classeur ne contient aucune feuille.')
  const worksheet = workbook.Sheets[firstSheetName]
  assertWorksheetBounds(XLSX, worksheet)
  return XLSX.utils.sheet_to_json(worksheet, sheetOptions)
}

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
  // Code agent et numéro agent : deux colonnes depuis la séparation.
  'code agent': 'codeAgent',
  'numero agent': 'numeroAgent',
  // ⚠ L'ANCIENNE COLONNE RESTE ACCEPTÉE, et ce n'est pas de la compatibilité
  //   gratuite : la boutique possède déjà des fichiers à ce format, exportés
  //   avant la séparation. Son contenu est réparti par longueur à la lecture
  //   (`repartirValeurAgent`), exactement comme les fiches déjà en base.
  'numero agent / code agent': '_agent_legacy',
  'agent': '_agent_legacy',
  'orange': '_agent_legacy',
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
  'codeAgent': 'Code agent',
  'numeroAgent': 'Numéro agent',
  '_agent_legacy': 'Numéro agent / Code agent',
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
  if (jsonData.length > EXCEL_IMPORT_LIMITS.MAX_ROWS + 1) {
    return { success: false, error: `Le fichier dépasse la limite de ${EXCEL_IMPORT_LIMITS.MAX_ROWS} lignes.`, clients: [] }
  }
  if (rawHeaders.length > EXCEL_IMPORT_LIMITS.MAX_COLUMNS) {
    return { success: false, error: `Le fichier dépasse la limite de ${EXCEL_IMPORT_LIMITS.MAX_COLUMNS} colonnes.`, clients: [] }
  }

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

    // L'ancienne colonne unique, répartie comme le reste : un fichier exporté
    // avant la séparation reste importable sans retouche. Les deux colonnes
    // neuves, si elles sont là, l'emportent — elles sont explicites.
    if (client._agent_legacy !== undefined) {
      const reparti = repartirValeurAgent(client._agent_legacy)
      if (!client.codeAgent) client.codeAgent = reparti.codeAgent
      if (!client.numeroAgent) client.numeroAgent = reparti.numeroAgent
      delete client._agent_legacy
    }

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

export function parseHistoryImportRows(rows, importBatchId = Date.now()) {
  if (!Array.isArray(rows) || rows.length > EXCEL_IMPORT_LIMITS.MAX_ROWS) {
    throw new Error(`Le fichier dépasse la limite de ${EXCEL_IMPORT_LIMITS.MAX_ROWS} lignes.`)
  }

  const transactions = []
  rows.forEach((row, index) => {
    if (!row || !Object.values(row).some(value => String(value ?? '').trim() !== '')) return
    const clientName = String(row.Client || '').trim()
    const type = String(row.Type || '').trim()
    const amount = parseFcfaAmount(row['Montant (FCFA)'])
    if (!clientName || !type || amount === null) {
      throw new Error(`Ligne ${index + 2} invalide : Client, Type et Montant (FCFA) positif sont obligatoires.`)
    }
    transactions.push({
      client: clientName,
      clientId: `import-${importBatchId}-${index}`,
      type,
      reseau: String(row['Réseau'] || 'Orange').trim(),
      code: String(row.Code || '000000').trim(),
      montant: amount,
      statut: 'Validée',
      userEmail: String(row['Email utilisateur'] || '').trim(),
    })
  })
  return transactions
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
    // Les champs numériques (numeroPersonnel, code/numéro agent, numeroIdentite)
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
      // Une fiche d'avant la séparation est répartie ici, à l'export : le
      // fichier produit est donc toujours au nouveau format, même si la base
      // ne l'est pas encore.
      forceText(champsAgent(client).codeAgent),
      forceText(champsAgent(client).numeroAgent),
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
      { width: 14 }, // Code agent
      { width: 14 }, // Numéro agent
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
  return readExcelFile(file, { header: 1 })
    .then((jsonData) => {
      const result = parseWorksheetRows(jsonData)
      if (!result.success) return Promise.reject(result)
      return result
    })
    .catch((error) => Promise.reject({
      success: false,
      error: error?.error || `Erreur de lecture du fichier: ${error.message}`,
    }))
}

// Fonction pour valider le format du fichier
export const validateExcelFile = (file) => {
  if (!file?.name || file.size > EXCEL_IMPORT_LIMITS.MAX_FILE_BYTES) {
    return { isValid: false, message: `Le fichier Excel ne doit pas dépasser ${EXCEL_IMPORT_LIMITS.MAX_FILE_BYTES / 1024 / 1024} Mo.` }
  }
  const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  const validExtension = EXCEL_EXTENSIONS.has(fileExtension)
  const validType = !file.type || EXCEL_MIME_TYPES.has(file.type)
  const isValid = validExtension && validType
  return {
    isValid,
    message: isValid ? 'Fichier valide' : 'Veuillez sélectionner un fichier Excel (.xlsx, .xlsm, ou .xls)',
  }
}
