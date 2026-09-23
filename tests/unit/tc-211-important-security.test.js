import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveFirebaseRuntime } from '../../src/config/firebaseRuntime.js'
import { EXCEL_IMPORT_LIMITS, parseHistoryImportRows, parseWorksheetRows, validateExcelContent, validateExcelFile } from '../../src/utils/excelUtils.js'
import { normalizeSubscriptionObserver } from '../../src/services/subscriptionObserver.js'

describe('TC-211 — durcissement du lot 3B', () => {
  it('refuse tout projet réel et tout hôte distant hors production', () => {
    expect(() => resolveFirebaseRuntime({
      DEV: true,
      VITE_FIREBASE_PROJECT_ID: 'client-reel',
      VITE_USE_FIREBASE_EMULATORS: 'true',
    })).toThrow(/demo-/)

    expect(() => resolveFirebaseRuntime({
      VITE_FIREBASE_RUNTIME_MODE: 'qa',
      VITE_FIREBASE_PROJECT_ID: 'demo-c2egf',
      VITE_USE_FIREBASE_EMULATORS: 'true',
      VITE_FIRESTORE_EMULATOR_HOST: 'firebase.example.com',
    })).toThrow(/localhost/)
  })

  it('exige les émulateurs hors production', () => {
    expect(() => resolveFirebaseRuntime({
      DEV: true,
      VITE_FIREBASE_PROJECT_ID: 'demo-c2egf',
    })).toThrow(/obligatoires/)
  })

  it('déclare les en-têtes HTTP de sécurité essentiels', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]))
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'")
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Permissions-Policy']).toContain('camera=()')
  })

  it('rejette les fichiers Excel trop gros et les tableaux démesurés', () => {
    expect(validateExcelFile({
      name: 'clients.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: EXCEL_IMPORT_LIMITS.MAX_FILE_BYTES + 1,
    }).isValid).toBe(false)

    const rows = [['Nom', 'Prénom'], ...Array.from(
      { length: EXCEL_IMPORT_LIMITS.MAX_ROWS + 1 },
      () => ['Ouédraogo', 'Awa'],
    )]
    expect(parseWorksheetRows(rows)).toMatchObject({ success: false, clients: [] })
  })

  it('rejette un faux fichier Excel et une archive au volume décompressé excessif', () => {
    expect(() => validateExcelContent(new Uint8Array([1, 2, 3, 4]))).toThrow(/contenu/)

    const bytes = new Uint8Array(68)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint32(24, EXCEL_IMPORT_LIMITS.MAX_UNCOMPRESSED_BYTES + 1, true)
    view.setUint32(46, 0x06054b50, true)
    view.setUint16(56, 1, true)
    view.setUint32(58, 46, true)
    view.setUint32(62, 0, true)
    expect(() => validateExcelContent(bytes)).toThrow(/décompressé/)
  })

  it('normalise une fonction ou un observateur explicite', () => {
    const onNext = () => {}
    const onError = () => {}
    onNext.onError = onError
    expect(normalizeSubscriptionObserver(onNext)).toEqual({ onNext, onError })
    expect(normalizeSubscriptionObserver({ next: onNext, onError })).toEqual({ onNext, onError })
  })

  it('valide tout l’import historique avant d’autoriser la moindre écriture', () => {
    expect(parseHistoryImportRows([
      { Client: 'Awa', Type: 'Dépôt', 'Montant (FCFA)': '1 000' },
    ], 42)).toMatchObject([{ client: 'Awa', montant: 1000, clientId: 'import-42-0' }])

    expect(() => parseHistoryImportRows([
      { Client: 'Awa', Type: 'Dépôt', 'Montant (FCFA)': '1000' },
      {},
      { Client: 'Issa', Type: 'Retrait', 'Montant (FCFA)': '12.5' },
    ], 42)).toThrow(/Ligne 4 invalide/)
  })
})
