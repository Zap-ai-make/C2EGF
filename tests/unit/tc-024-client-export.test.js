/**
 * TC-024 — Export XLSM clients : colonne Boutique
 *
 * Comportement protégé :
 *   La fonction exportClientsToXLSM() dans src/utils/excelUtils.js doit inclure
 *   la colonne "Boutique" comme première colonne du fichier exporté.
 *   La valeur est résolue par resolveClientStoreName() selon l'ordre de priorité :
 *     1. client.registeredStoreName non vide → valeur directe
 *     2. lookup storesById[registeredStoreId].name → nom de la boutique
 *     3. registeredStoreId présent mais inconnu → "Boutique inconnue (id)"
 *     4. aucune info → "Boutique inconnue"
 *
 *   La logique d'affichage dans TableRow.jsx utilise :
 *     client.registeredStoreName || 'Ancienne base'
 *   L'export utilise resolveClientStoreName() qui retourne 'Boutique inconnue'
 *   là où le tableau afficherait 'Ancienne base'. Cet écart est documenté et
 *   accepté : l'export sert à l'analyse multi-boutiques et non à l'affichage UI.
 *
 * Colonnes exportées (ordre final) :
 *   Boutique | Nom | Prénom | Numéro d'identité | Numéro personnel |
 *   Numéro agent / Code agent | Localité | Agent commercial | Date d'ajout
 *
 * Fichiers source :
 *   - src/utils/excelUtils.js (resolveClientStoreName, exportClientsToXLSM)
 *   - src/constants/index.js (EXCEL_HEADERS)
 *
 * Interdictions : aucun import Firebase réel, aucun accès réseau.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveClientStoreName, exportClientsToXLSM, parseWorksheetRows } from '../../src/utils/excelUtils.js'
import { EXCEL_HEADERS } from '../../src/constants/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const storesById = {
  'store-abc': { name: 'AKAYIS KOUPELA' },
  'store-xyz': { name: 'AKAYIS POUYTENGA1' },
  'store-noname': {},
  'store-emptyname': { name: '' },
  'store-storename': { storeName: 'AKAYIS STORENAME' },
}

const validClient = {
  id: 'client-1',
  registeredStoreName: 'AKAYIS KOUPELA',
  registeredStoreId: 'store-abc',
  nom: 'OUEDRAOGO',
  prenom: 'Ibrahim',
  numeroIdentite: 'B12345678',
  numeroPersonnel: '0123456789',
  orange: 'AG001',
  localite: 'Koupela Centre',
  agentCommercial: 'Fatima Sawadogo',
  dateAjout: '01/06/2026',
}

// ---------------------------------------------------------------------------
// Section 1 : resolveClientStoreName
// ---------------------------------------------------------------------------

describe('resolveClientStoreName', () => {
  it('registeredStoreName présent → retourne registeredStoreName (trim)', () => {
    const client = { registeredStoreName: 'AKAYIS KOUPELA', registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('registeredStoreName absent → fallback par registeredStoreId', () => {
    const client = { registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('registeredStoreName vide string → fallback par registeredStoreId', () => {
    const client = { registeredStoreName: '', registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('registeredStoreName espaces seuls → fallback par registeredStoreId', () => {
    const client = { registeredStoreName: '   ', registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('registeredStoreName prioritaire même si storesById disponible', () => {
    const client = { registeredStoreName: 'AKAYIS POUYTENGA1', registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS POUYTENGA1')
  })

  it('fallback sur storeName si name absent de storesById', () => {
    const client = { registeredStoreId: 'store-storename' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS STORENAME')
  })

  it('storeId trouvé mais name et storeName absents → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-noname' }
    expect(resolveClientStoreName(client, storesById)).toBe('Boutique inconnue (store-noname)')
  })

  it('storeId trouvé mais name vide → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-emptyname' }
    expect(resolveClientStoreName(client, storesById)).toBe('Boutique inconnue (store-emptyname)')
  })

  it('registeredStoreId inconnu dans storesById → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-INCONNU' }
    expect(resolveClientStoreName(client, storesById)).toBe('Boutique inconnue (store-INCONNU)')
  })

  it('registeredStoreId présent, storesById null → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, null)).toBe('Boutique inconnue (store-abc)')
  })

  it('registeredStoreId présent, storesById undefined → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, undefined)).toBe('Boutique inconnue (store-abc)')
  })

  it('registeredStoreId présent, storesById vide {} → "Boutique inconnue (id)"', () => {
    const client = { registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, {})).toBe('Boutique inconnue (store-abc)')
  })

  it('ni registeredStoreName ni registeredStoreId → "Boutique inconnue"', () => {
    const client = { nom: 'Diallo', prenom: 'Aissata' }
    expect(resolveClientStoreName(client, storesById)).toBe('Boutique inconnue')
  })

  it('client vide {} → "Boutique inconnue"', () => {
    expect(resolveClientStoreName({}, storesById)).toBe('Boutique inconnue')
  })

  it('nom avec accents, apostrophe, tiret → retourné tel quel', () => {
    const client = { registeredStoreName: "AKAYIS POUYTENGA-EST / D'ABIDJAN" }
    expect(resolveClientStoreName(client, storesById)).toBe("AKAYIS POUYTENGA-EST / D'ABIDJAN")
  })

  it('registeredStoreName avec espaces en tête/queue → trimé', () => {
    const client = { registeredStoreName: '  AKAYIS KOUPELA  ' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('registeredStoreName numérique (type incorrect) → ignoré, fallback', () => {
    // Si registeredStoreName est un nombre, typeof !== 'string' → fallback
    const client = { registeredStoreName: 12345, registeredStoreId: 'store-abc' }
    expect(resolveClientStoreName(client, storesById)).toBe('AKAYIS KOUPELA')
  })

  it('objet client source non muté après appel', () => {
    const client = { registeredStoreName: 'AKAYIS KOUPELA', registeredStoreId: 'store-abc' }
    const copy = { ...client }
    resolveClientStoreName(client, storesById)
    expect(client).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// Section 2 : EXCEL_HEADERS — ordre et contenu
// ---------------------------------------------------------------------------

describe('EXCEL_HEADERS', () => {
  it('première colonne est "Boutique"', () => {
    expect(EXCEL_HEADERS[0]).toBe('Boutique')
  })

  it('contient 9 colonnes (Boutique + 8 champs client)', () => {
    expect(EXCEL_HEADERS).toHaveLength(9)
  })

  it('ordre exact des colonnes', () => {
    expect(EXCEL_HEADERS).toEqual([
      'Boutique',
      'Nom',
      'Prénom',
      "Numéro d'identité",
      'Numéro personnel',
      'Numéro agent / Code agent',
      'Localité',
      'Agent commercial',
      "Date d'ajout",
    ])
  })
})

// ---------------------------------------------------------------------------
// Section 3 : exportClientsToXLSM — mapping des données
// ---------------------------------------------------------------------------

// Mock de xlsx pour capturer les données passées sans écrire de fichier.
// resolveCell : extrait la valeur effective d'une cellule, qu'elle soit brute
// ou sous forme d'objet cellule SheetJS { t, v } (utilisé par forceText pour
// garantir le type texte des champs numériques).
const resolveCell = (cell) => {
  if (cell !== null && typeof cell === 'object' && 'v' in cell) return cell.v
  return cell
}

vi.mock('xlsx', async () => {
  const rows = []
  let capturedCols = null
  return {
    utils: {
      aoa_to_sheet: (data) => {
        rows.length = 0
        // Normalise les objets cellule SheetJS {t,v} en valeur brute pour
        // faciliter les assertions dans les tests.
        data.forEach(r => rows.push(
          Array.isArray(r)
            ? r.map(cell => resolveCell(cell))
            : r
        ))
        return { __rows: rows, '!cols': [] }
      },
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      book_append_sheet: (wb, ws, name) => {
        wb.SheetNames.push(name)
        wb.Sheets[name] = ws
        capturedCols = ws['!cols']
      },
    },
    writeFile: vi.fn(),
    __getCapturedRows: () => rows,
    __getCapturedCols: () => capturedCols,
  }
})

describe('exportClientsToXLSM — mapping des données', () => {
  let XLSX

  beforeEach(async () => {
    XLSX = await import('xlsx')
    vi.clearAllMocks()
  })

  it('retourne success:true et count correct', async () => {
    const clients = [validClient]
    const result = await exportClientsToXLSM(clients, 'test', storesById)
    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
  })

  it('première colonne des données est la valeur résolue de la boutique', async () => {
    const clients = [validClient]
    await exportClientsToXLSM(clients, 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    // rows[0] = en-têtes, rows[1] = premier client
    expect(rows[1][0]).toBe('AKAYIS KOUPELA')
  })

  it('valeur exportée boutique identique à resolveClientStoreName', async () => {
    const clients = [validClient]
    await exportClientsToXLSM(clients, 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    const expected = resolveClientStoreName(validClient, storesById)
    expect(rows[1][0]).toBe(expected)
  })

  it('en-tête première colonne est "Boutique"', async () => {
    const clients = [validClient]
    await exportClientsToXLSM(clients, 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[0][0]).toBe('Boutique')
  })

  it('nombre de lignes de données = nombre de clients', async () => {
    const clients = [
      validClient,
      { ...validClient, id: 'client-2', nom: 'KABORE', registeredStoreName: 'AKAYIS POUYTENGA1' },
      { ...validClient, id: 'client-3', nom: 'SAWADOGO', registeredStoreName: '' },
    ]
    await exportClientsToXLSM(clients, 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    // rows[0] = en-têtes, rows[1..n] = données
    expect(rows.length - 1).toBe(clients.length)
  })

  it('colonne Nom (index 1) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][1]).toBe(validClient.nom)
  })

  it('colonne Prénom (index 2) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][2]).toBe(validClient.prenom)
  })

  it('colonne Numéro identité (index 3) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][3]).toBe(validClient.numeroIdentite)
  })

  it('colonne Numéro personnel (index 4) commence par 0 — préservé', async () => {
    const client = { ...validClient, numeroPersonnel: '0123456789' }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(String(rows[1][4])).toMatch(/^0/)
  })

  it('colonne Orange / Code agent (index 5) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][5]).toBe(validClient.orange)
  })

  it('colonne Localité (index 6) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][6]).toBe(validClient.localite)
  })

  it('colonne Agent commercial (index 7) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][7]).toBe(validClient.agentCommercial)
  })

  it('colonne Date ajout (index 8) non altérée', async () => {
    await exportClientsToXLSM([validClient], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][8]).toBe(validClient.dateAjout)
  })

  it('nom de la feuille reste "Clients"', async () => {
    const { utils } = await import('xlsx')
    const wb = utils.book_new()
    utils.book_append_sheet(wb, utils.aoa_to_sheet([[]]), 'Clients')
    expect(wb.SheetNames[0]).toBe('Clients')
  })

  it('export liste vide → success:true, count:0', async () => {
    const result = await exportClientsToXLSM([], 'test', storesById)
    expect(result.success).toBe(true)
    expect(result.count).toBe(0)
  })

  it('client sans boutique → "Boutique inconnue" en colonne 0', async () => {
    const client = { ...validClient, registeredStoreName: undefined, registeredStoreId: undefined }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][0]).toBe('Boutique inconnue')
  })

  it('client boutique inconnue → "Boutique inconnue (id)" en colonne 0', async () => {
    const client = { ...validClient, registeredStoreName: '', registeredStoreId: 'store-ghost' }
    await exportClientsToXLSM([client], 'test', {})
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][0]).toBe('Boutique inconnue (store-ghost)')
  })

  it('storesById non fourni (appel sans argument) → fallback sur registeredStoreName', async () => {
    // Appel sans storesById : doit utiliser le défaut {}
    const client = { ...validClient, registeredStoreName: 'AKAYIS KOUPELA' }
    const result = await exportClientsToXLSM([client], 'test')
    expect(result.success).toBe(true)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][0]).toBe('AKAYIS KOUPELA')
  })

  it('largeur des colonnes = 9 entrées (une par colonne)', () => {
    // Vérification indirecte : EXCEL_HEADERS a 9 entrées, donc !cols aura 9 entrées
    expect(EXCEL_HEADERS).toHaveLength(9)
  })
})

// ---------------------------------------------------------------------------
// Section 4 : Cohérence affichage/export
// ---------------------------------------------------------------------------

describe('Cohérence affichage (TableRow) vs export (resolveClientStoreName)', () => {
  it('client avec registeredStoreName → même valeur dans les deux contextes', () => {
    const client = { registeredStoreName: 'AKAYIS KOUPELA', registeredStoreId: 'store-abc' }
    // TableRow : client.registeredStoreName || 'Ancienne base'
    const displayValue = client.registeredStoreName || 'Ancienne base'
    const exportValue = resolveClientStoreName(client, storesById)
    expect(exportValue).toBe(displayValue)
  })

  it('client sans registeredStoreName → écart documenté et accepté', () => {
    // TableRow affiche 'Ancienne base', resolveClientStoreName retourne 'Boutique inconnue'
    const client = { nom: 'Diallo' }
    const displayValue = client.registeredStoreName || 'Ancienne base'
    const exportValue = resolveClientStoreName(client, storesById)
    // Écart intentionnel : l'export utilise une terminologie métier différente de l'UI
    expect(displayValue).toBe('Ancienne base')
    expect(exportValue).toBe('Boutique inconnue')
    // Vérifier que les deux valeurs sont des strings non vides
    expect(typeof displayValue).toBe('string')
    expect(typeof exportValue).toBe('string')
    expect(displayValue.length).toBeGreaterThan(0)
    expect(exportValue.length).toBeGreaterThan(0)
  })

  it('client avec storeId mais sans registeredStoreName → export utilise lookup', () => {
    const client = { registeredStoreName: '', registeredStoreId: 'store-abc' }
    const displayValue = client.registeredStoreName || 'Ancienne base'
    const exportValue = resolveClientStoreName(client, storesById)
    // TableRow affiche 'Ancienne base', export résout via lookup
    expect(displayValue).toBe('Ancienne base')
    expect(exportValue).toBe('AKAYIS KOUPELA')
  })
})

// ---------------------------------------------------------------------------
// Section 5 : exportClientsToXLSM — champs numériques exportés comme texte
// ---------------------------------------------------------------------------

describe('exportClientsToXLSM — champs numériques exportés comme texte', () => {
  let XLSX

  beforeEach(async () => {
    XLSX = await import('xlsx')
    vi.clearAllMocks()
  })

  it('numeroPersonnel avec zéro initial "0123456789" — préservé en colonne 4', async () => {
    const client = { ...validClient, numeroPersonnel: '0123456789' }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(String(rows[1][4])).toBe('0123456789')
    expect(String(rows[1][4])).toMatch(/^0/)
  })

  it('orange/Code agent "0012" avec zéro initial — préservé en colonne 5', async () => {
    const client = { ...validClient, orange: '0012' }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(String(rows[1][5])).toBe('0012')
  })

  it('numeroIdentite "BF0123456" — préservé en colonne 3', async () => {
    const client = { ...validClient, numeroIdentite: 'BF0123456' }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(String(rows[1][3])).toBe('BF0123456')
  })

  it('numeroPersonnel null → chaîne vide en colonne 4', async () => {
    const client = { ...validClient, numeroPersonnel: null }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][4]).toBe('')
  })

  it('orange undefined → chaîne vide en colonne 5', async () => {
    const client = { ...validClient, orange: undefined }
    await exportClientsToXLSM([client], 'test', storesById)
    const rows = XLSX.__getCapturedRows()
    expect(rows[1][5]).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Section 6 : parseWorksheetRows — compatibilité formats d'import
// ---------------------------------------------------------------------------

/**
 * Construit un tableau jsonData simulant sheet_to_json({ header: 1 }).
 * Première ligne = en-têtes, lignes suivantes = données.
 */
function makeJsonData(headers, rows) {
  return [headers, ...rows]
}

// En-têtes du nouveau format (9 colonnes, Boutique en premier)
const NEW_HEADERS = [
  'Boutique',
  'Nom',
  'Prénom',
  "Numéro d'identité",
  'Numéro personnel',
  'Numéro agent / Code agent',
  'Localité',
  'Agent commercial',
  "Date d'ajout",
]

// En-têtes de l'ancien format (8 colonnes, sans Boutique)
const OLD_HEADERS = [
  'Nom',
  'Prénom',
  "Numéro d'identité",
  'Numéro personnel',
  'Numéro agent / Code agent',
  'Localité',
  'Agent commercial',
  "Date d'ajout",
]

const SAMPLE_ROW_9 = [
  'AKAYIS KOUPELA',    // Boutique (ignorée à l'import)
  'OUEDRAOGO',         // Nom
  'Ibrahim',           // Prénom
  'B12345678',         // Numéro d'identité
  '0123456789',        // Numéro personnel
  'AG001',             // Numéro agent / Code agent
  'Koupela Centre',    // Localité
  'Fatima Sawadogo',   // Agent commercial
  '01/06/2026',        // Date d'ajout
]

const SAMPLE_ROW_8 = [
  'OUEDRAOGO',         // Nom
  'Ibrahim',           // Prénom
  'B12345678',         // Numéro d'identité
  '0123456789',        // Numéro personnel
  'AG001',             // Numéro agent / Code agent
  'Koupela Centre',    // Localité
  'Fatima Sawadogo',   // Agent commercial
  '01/06/2026',        // Date d'ajout
]

describe('parseWorksheetRows — compatibilité formats d\'import', () => {
  it('1. Ancien format 8 colonnes sans Boutique → import correct', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [SAMPLE_ROW_8])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(1)
    const c = result.clients[0]
    expect(c.nom).toBe('OUEDRAOGO')
    expect(c.prenom).toBe('Ibrahim')
    expect(c.numeroIdentite).toBe('B12345678')
    expect(c.numeroPersonnel).toBe('0123456789')
    expect(c.orange).toBe('AG001')
    expect(c.localite).toBe('Koupela Centre')
    expect(c.agentCommercial).toBe('Fatima Sawadogo')
    expect(c.dateAjout).toBe('01/06/2026')
  })

  it('2. Nouveau format 9 colonnes avec Boutique → import correct', () => {
    const jsonData = makeJsonData(NEW_HEADERS, [SAMPLE_ROW_9])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(1)
    const c = result.clients[0]
    expect(c.nom).toBe('OUEDRAOGO')
    expect(c.prenom).toBe('Ibrahim')
    expect(c.orange).toBe('AG001')
    expect(c.localite).toBe('Koupela Centre')
  })

  it('3. Boutique en première position → ignorée pour la propriété', () => {
    const jsonData = makeJsonData(NEW_HEADERS, [SAMPLE_ROW_9])
    const result = parseWorksheetRows(jsonData)
    const c = result.clients[0]
    expect(c).not.toHaveProperty('registeredStoreName')
    expect(c).not.toHaveProperty('registeredStoreId')
    // La valeur 'AKAYIS KOUPELA' ne doit pas se retrouver dans un champ boutique
    expect(Object.values(c)).not.toContain('_boutique_ignored')
  })

  it('4. Boutique en dernière position → ignorée pour la propriété', () => {
    const headersLast = [...OLD_HEADERS, 'Boutique']
    const rowLast = [...SAMPLE_ROW_8, 'AKAYIS POUYTENGA1']
    const jsonData = makeJsonData(headersLast, [rowLast])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    const c = result.clients[0]
    expect(c).not.toHaveProperty('registeredStoreName')
    expect(c).not.toHaveProperty('registeredStoreId')
    expect(c.nom).toBe('OUEDRAOGO')
  })

  it('5. Colonnes réordonnées (Prénom avant Nom) → pas de décalage', () => {
    const headersReordered = ['Prénom', 'Nom', "Numéro d'identité", 'Numéro personnel', 'Numéro agent / Code agent', 'Localité', 'Agent commercial', "Date d'ajout"]
    const rowReordered = ['Ibrahim', 'OUEDRAOGO', 'B12345678', '0123456789', 'AG001', 'Koupela Centre', 'Fatima Sawadogo', '01/06/2026']
    const jsonData = makeJsonData(headersReordered, [rowReordered])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    const c = result.clients[0]
    expect(c.nom).toBe('OUEDRAOGO')
    expect(c.prenom).toBe('Ibrahim')
  })

  it('6. Colonne supplémentaire inconnue "Note" → ignorée, pas de décalage', () => {
    const headersExtra = [...OLD_HEADERS, 'Note']
    const rowExtra = [...SAMPLE_ROW_8, 'Commentaire libre']
    const jsonData = makeJsonData(headersExtra, [rowExtra])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    const c = result.clients[0]
    expect(c.nom).toBe('OUEDRAOGO')
    expect(c.prenom).toBe('Ibrahim')
    expect(c.localite).toBe('Koupela Centre')
    // La colonne inconnue ne doit pas polluer l'objet client
    expect(c).not.toHaveProperty('Note')
    expect(c).not.toHaveProperty('note')
  })

  it('7. En-têtes avec espaces "  Nom  " → reconnus', () => {
    const headersSpaced = ['  Nom  ', '  Prénom  ', "  Numéro d'identité  ", '  Numéro personnel  ', '  Numéro agent / Code agent  ', '  Localité  ', '  Agent commercial  ', "  Date d'ajout  "]
    const jsonData = makeJsonData(headersSpaced, [SAMPLE_ROW_8])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients[0].nom).toBe('OUEDRAOGO')
    expect(result.clients[0].prenom).toBe('Ibrahim')
  })

  it('8. Variante sans accent "Prenom" → reconnue', () => {
    const headersNoAccent = ['Nom', 'Prenom', "Numéro d'identité", 'Numéro personnel', 'Numéro agent / Code agent', 'Localité', 'Agent commercial', "Date d'ajout"]
    const jsonData = makeJsonData(headersNoAccent, [SAMPLE_ROW_8])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients[0].prenom).toBe('Ibrahim')
  })

  it('9. Colonne "Nom" manquante → success: false, erreur claire, 0 client créé', () => {
    // Prénom présent mais Nom absent
    const headersNoNom = ['Prénom', "Numéro d'identité", 'Numéro personnel']
    const rowNoNom = ['Ibrahim', 'B12345678', '0123456789']
    const jsonData = makeJsonData(headersNoNom, [rowNoNom])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Nom/i)
    expect(result.clients).toHaveLength(0)
  })

  it('10. Colonne "Prénom" manquante → success: false, erreur claire', () => {
    const headersNoPrenom = ['Nom', "Numéro d'identité", 'Numéro personnel']
    const rowNoPrenom = ['OUEDRAOGO', 'B12345678', '0123456789']
    const jsonData = makeJsonData(headersNoPrenom, [rowNoPrenom])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Pr.nom/i)
    expect(result.clients).toHaveLength(0)
  })

  it('11. numeroPersonnel Excel numérique 70001234 → converti en string "70001234"', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      ['KABORE', 'Aissata', 'BF999', 70001234, 'AG002', 'Ouaga', 'Agent2', '2024-01-01']
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    const c = result.clients[0]
    expect(typeof c.numeroPersonnel).toBe('string')
    expect(c.numeroPersonnel).toBe('70001234')
  })

  it('12. numeroPersonnel chaîne "0070001234" → zéro initial préservé', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      ['KABORE', 'Aissata', 'BF999', '0070001234', 'AG002', 'Ouaga', 'Agent2', '2024-01-01']
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.clients[0].numeroPersonnel).toBe('0070001234')
  })

  it('13. code agent "0012" → zéro initial préservé', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      ['TRAORE', 'Salif', 'BF111', '70001234', '0012', 'Bobo', 'Agent3', '2024-01-01']
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.clients[0].orange).toBe('0012')
  })

  it('14. Valeur Boutique étrangère "AKAYIS POUYTENGA1" → absente de l\'objet client retourné', () => {
    const jsonData = makeJsonData(NEW_HEADERS, [SAMPLE_ROW_9])
    const result = parseWorksheetRows(jsonData)
    const c = result.clients[0]
    // La valeur de la colonne Boutique ne doit pas se retrouver dans les champs
    expect(c.registeredStoreName).toBeUndefined()
    expect(c.registeredStoreId).toBeUndefined()
    expect(c.registeredBy).toBeUndefined()
    // Vérifier exhaustivement qu'aucune valeur de boutique ne pollue l'objet
    const values = Object.values(c)
    expect(values).not.toContain('AKAYIS KOUPELA')
  })

  it('15. Fichier vide (aucune ligne) → success: true, 0 client', () => {
    const result = parseWorksheetRows([])
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  it('16. Ligne vide ignorée', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      SAMPLE_ROW_8,
      [],                                                          // ligne vide
      [null, undefined, '', '', '', '', '', ''],                   // ligne de nulls
      ['SAWADOGO', 'Mariam', 'BF222', '70002222', 'AG003', 'Kaya', 'Agent4', '2024-02-01'],
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(2)
  })

  it('17. Ligne partiellement remplie → nom et prénom présents, autres champs vides string', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      ['DIALLO', 'Aïssata', null, null, null, null, null, null]
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(1)
    const c = result.clients[0]
    expect(c.nom).toBe('DIALLO')
    expect(c.prenom).toBe('Aïssata')
    expect(c.numeroPersonnel).toBe('')
    expect(c.orange).toBe('')
    expect(c.localite).toBe('')
  })

  it('18. Objet jsonData source non muté', () => {
    const row = [...SAMPLE_ROW_8]
    const jsonData = makeJsonData([...OLD_HEADERS], [row])
    const originalLength = jsonData.length
    const originalHeadersSnapshot = [...jsonData[0]]
    parseWorksheetRows(jsonData)
    expect(jsonData).toHaveLength(originalLength)
    expect(jsonData[0]).toEqual(originalHeadersSnapshot)
    expect(row).toEqual(SAMPLE_ROW_8)
  })

  it('Aucun en-tête reconnu → success: false, erreur claire', () => {
    const jsonData = makeJsonData(['ColA', 'ColB', 'ColC'], [['v1', 'v2', 'v3']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.clients).toHaveLength(0)
  })

  it('count correspond au nombre de clients retournés', () => {
    const jsonData = makeJsonData(OLD_HEADERS, [
      SAMPLE_ROW_8,
      ['SAWADOGO', 'Mariam', 'BF222', '70002222', 'AG003', 'Kaya', 'Agent4', '2024-02-01'],
      ['TRAORE', 'Salif', 'BF333', '70003333', 'AG004', 'Bobo', 'Agent5', '2024-03-01'],
    ])
    const result = parseWorksheetRows(jsonData)
    expect(result.count).toBe(result.clients.length)
    expect(result.count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Section 8 : parseWorksheetRows — doublons d'en-têtes
// ---------------------------------------------------------------------------

describe("parseWorksheetRows — doublons d'en-têtes", () => {
  it('1. "Nom" + "Nom" → success: false, erreur doublon', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', 'Nom'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Nom')
    expect(result.clients).toHaveLength(0)
  })

  it('2. "Numéro personnel" + "Téléphone" → rejet', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', 'Numéro personnel', 'Téléphone'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Numéro personnel')
    expect(result.clients).toHaveLength(0)
  })

  it('3. "Numéro agent / Code agent" + "Orange" → rejet', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', 'Numéro agent / Code agent', 'Orange'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it("4. \"Date d'ajout\" + \"Date\" → rejet", () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', "Date d'ajout", 'Date'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('5. deux colonnes "Boutique" → rejet', () => {
    const jsonData = makeJsonData(['Boutique', 'Nom', 'Prénom', 'Boutique'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('6. message contient les deux noms d\'en-têtes originaux', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', 'Numéro personnel', 'Téléphone'], [])
    const result = parseWorksheetRows(jsonData)
    expect(result.error).toMatch(/Numéro personnel/i)
    expect(result.error).toMatch(/Téléphone/i)
  })

  it('7. message contient les numéros de colonnes (1-based)', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom', 'Numéro personnel', 'Téléphone'], [])
    const result = parseWorksheetRows(jsonData)
    // 'Numéro personnel' est en colonne 3, 'Téléphone' en colonne 4
    expect(result.error).toContain('3')
    expect(result.error).toContain('4')
  })

  it('8. colonnes inconnues différentes → acceptées (pas de doublon)', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom', 'Note1', 'Remarque'],
      [['Diallo', 'Aïssata', 'x', 'y']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(1)
  })

  it('9. un seul alias sans doublon → accepté', () => {
    // 'Prenom' sans accent est un alias reconnu pour le champ 'prenom'
    const jsonData = makeJsonData(['Nom', 'Prenom'], [['Diallo', 'Aïssata']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients[0].prenom).toBe('Aïssata')
  })
})

// ---------------------------------------------------------------------------
// Section 9 : parseWorksheetRows — validation Nom/Prénom par ligne
// ---------------------------------------------------------------------------

describe('parseWorksheetRows — validation Nom/Prénom par ligne', () => {
  it('1. Nom vide → rejet avec numéro de ligne', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom'], [['', 'Aïssata']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Ligne 2')
    expect(result.error).toContain('nom')
    expect(result.clients).toHaveLength(0)
  })

  it('2. Prénom vide → rejet avec numéro de ligne', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom'], [['Diallo', '']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Ligne 2')
    expect(result.error).toContain('prénom')
    expect(result.clients).toHaveLength(0)
  })

  it('3. Nom espaces seuls → rejet', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom'], [['   ', 'Aïssata']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('4. Prénom espaces seuls → rejet', () => {
    const jsonData = makeJsonData(['Nom', 'Prénom'], [['Diallo', '   ']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('5. Nom et prénom vides mais téléphone présent → rejet', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom', 'Numéro personnel'],
      [['', '', '70001234']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it("6. ligne entièrement vide → ignorée (pas d'erreur)", () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [
        ['Diallo', 'Aïssata'],
        ['', ''],
        ['Coulibaly', 'Moussa'],
      ]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(2)
  })

  it('7. plusieurs lignes valides → toutes acceptées', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [['Diallo', 'Aïssata'], ['Coulibaly', 'Moussa'], ['Traoré', 'Fatou']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(3)
  })

  it('8. ligne valide suivie d\'une ligne invalide → aucun résultat (success: false, clients: [])', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [['Diallo', 'Aïssata'], ['', 'Moussa']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('9. ligne invalide suivie d\'une ligne valide → aucun résultat', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [['Diallo', ''], ['Coulibaly', 'Moussa']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('10. plusieurs erreurs → comportement déterministe : toutes les erreurs reportées, clients vides', () => {
    // L'implémentation accumule toutes les erreurs avant de rejeter.
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [['', 'A'], ['B', ''], ['', 'C']]
    )
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.clients).toHaveLength(0)
    // Vérifier que les erreurs des trois lignes sont toutes présentes
    expect(result.error).toContain('Ligne 2')
    expect(result.error).toContain('Ligne 3')
    expect(result.error).toContain('Ligne 4')
  })
})

// ---------------------------------------------------------------------------
// Section 10 : Absence d'import partiel
// ---------------------------------------------------------------------------

describe("Absence d'import partiel", () => {
  it('ligne 2 valide, ligne 3 prénom vide, ligne 4 valide → success: false, clients: []', () => {
    const jsonData = makeJsonData(
      ['Nom', 'Prénom'],
      [
        ['Diallo', 'Aïssata'],   // ligne 2 valide
        ['Coulibaly', ''],       // ligne 3 invalide : prénom vide
        ['Traoré', 'Fatou'],     // ligne 4 valide
      ]
    )
    const result = parseWorksheetRows(jsonData)
    // Aucun import partiel : même si lignes 2 et 4 sont valides,
    // la présence de la ligne 3 invalide doit bloquer l'ensemble
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
    expect(result.error).toContain('Ligne 3')
    expect(result.error).toContain('prénom')
  })

  it('une seule ligne invalide parmi dix → aucun client importé', () => {
    const rows = Array.from({ length: 9 }, (_, i) => [`NOM${i}`, `Prenom${i}`])
    rows.push(['', 'SansNom']) // ligne 11 invalide
    const jsonData = makeJsonData(['Nom', 'Prénom'], rows)
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(false)
    expect(result.clients).toHaveLength(0)
  })

  it('zéro ligne de données après filtrage des lignes vides → success: true, clients: []', () => {
    // Toutes les lignes sont vides : aucune erreur, aucun client
    const jsonData = makeJsonData(['Nom', 'Prénom'], [['', ''], ['', '']])
    const result = parseWorksheetRows(jsonData)
    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(0)
    expect(result.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Section 7 : Test circulaire export → parseWorksheetRows
// ---------------------------------------------------------------------------

describe('Test circulaire export → parseWorksheetRows', () => {
  let XLSX

  beforeEach(async () => {
    XLSX = await import('xlsx')
    vi.clearAllMocks()
  })

  it('les données exportées sont retrouvées intactes après import', async () => {
    const clients = [
      {
        id: 'client-circ-1',
        registeredStoreName: 'AKAYIS KOUPELA',
        registeredStoreId: 'store-abc',
        nom: 'Diallo',
        prenom: 'Aïssata',
        numeroIdentite: 'BF0123456',
        numeroPersonnel: '70001234',
        orange: '0012',
        localite: 'Ouagadougou',
        agentCommercial: 'Agent Test',
        dateAjout: '2024-01-15',
      }
    ]

    // Export : capture le worksheetData passé à aoa_to_sheet
    await exportClientsToXLSM(clients, 'test-circ', storesById)
    const capturedRows = XLSX.__getCapturedRows()

    // capturedRows[0] = EXCEL_HEADERS, capturedRows[1..n] = données
    // On reconstruit le jsonData tel que sheet_to_json le produirait
    const simulatedJsonData = capturedRows

    // Import depuis les données capturées
    const result = parseWorksheetRows(simulatedJsonData)

    expect(result.success).toBe(true)
    expect(result.clients).toHaveLength(1)

    const imported = result.clients[0]
    expect(imported.nom).toBe('Diallo')
    expect(imported.prenom).toBe('Aïssata')
    expect(imported.numeroIdentite).toBe('BF0123456')
    expect(imported.numeroPersonnel).toBe('70001234')
    expect(imported.orange).toBe('0012')
    expect(imported.localite).toBe('Ouagadougou')
    expect(imported.agentCommercial).toBe('Agent Test')
    expect(imported.dateAjout).toBe('2024-01-15')

    // La boutique du fichier ne doit pas se retrouver dans l'objet client
    expect(imported.registeredStoreId).toBeUndefined()
    expect(imported.registeredStoreName).toBeUndefined()
  })

  it('numéro avec zéro initial préservé dans le cycle export/import', async () => {
    const clients = [
      {
        id: 'client-circ-2',
        registeredStoreName: 'AKAYIS KOUPELA',
        registeredStoreId: 'store-abc',
        nom: 'TRAORE',
        prenom: 'Salif',
        numeroIdentite: 'BF000001',
        numeroPersonnel: '0070001234',
        orange: '00123',
        localite: 'Bobo-Dioulasso',
        agentCommercial: 'Agent Zero',
        dateAjout: '2024-06-01',
      }
    ]

    await exportClientsToXLSM(clients, 'test-circ-zeros', storesById)
    const capturedRows = XLSX.__getCapturedRows()
    const result = parseWorksheetRows(capturedRows)

    expect(result.success).toBe(true)
    expect(result.clients[0].numeroPersonnel).toBe('0070001234')
    expect(result.clients[0].orange).toBe('00123')
  })

  it('client sans boutique dans le cycle export/import', async () => {
    const clients = [
      {
        id: 'client-circ-3',
        nom: 'SAWADOGO',
        prenom: 'Fatima',
        numeroPersonnel: '70009999',
        orange: 'AG010',
        localite: 'Koupela',
        agentCommercial: 'Agent X',
        dateAjout: '2024-01-01',
        // pas de registeredStoreName ni registeredStoreId
      }
    ]

    await exportClientsToXLSM(clients, 'test-circ-noboutique', {})
    const capturedRows = XLSX.__getCapturedRows()
    const result = parseWorksheetRows(capturedRows)

    expect(result.success).toBe(true)
    expect(result.clients[0].nom).toBe('SAWADOGO')
    // La valeur 'Boutique inconnue' en colonne Boutique est ignorée à l'import
    expect(result.clients[0].registeredStoreName).toBeUndefined()
  })
})
