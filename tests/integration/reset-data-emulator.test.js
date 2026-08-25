/**
 * Tests d'intégration — Remise à zéro des données (resetDataToZero.mjs)
 *
 * Pré-requis : firebase emulators:exec --only auth,firestore --project demo-akayis-test "npm run test:integration"
 *
 * Scénarios :
 *   A — dry-run : rapport affiché, AUCUNE écriture, aucun backup créé.
 *   B — execute : cibles purgées, soldes remis à zéro (forme stricte),
 *       globalClients/users/stores intacts, trace RESET_PERFORMED, backup complet.
 *   C — refus production non interactif : exit 1 avant toute connexion.
 *   D — restore : restoreFromBackup.mjs ramène l'état pré-reset.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdtemp, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import { validateEmulatorEnv } from '../../scripts/lib/technicalUserProvisioning.mjs'
import { readNdjson } from '../../scripts/lib/firestoreBackup.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = join(__dirname, '../../scripts')

// ─────────────────────────────────────────────
// Garde de sécurité avant toute initialisation
// ─────────────────────────────────────────────
const envCheck = validateEmulatorEnv(process.env)
if (!envCheck.ok) {
  throw new Error(
    `[SÉCURITÉ] Environnement émulateur invalide : [${envCheck.code}] ${envCheck.message}\n` +
    'Lance via : firebase emulators:exec --only auth,firestore --project demo-akayis-test "npm run test:integration"'
  )
}

const PROJECT_ID = envCheck.projectId
if (PROJECT_ID !== 'demo-akayis-test') {
  throw new Error(`[SÉCURITÉ] GCLOUD_PROJECT doit être "demo-akayis-test" (reçu : "${PROJECT_ID}")`)
}

// ─────────────────────────────────────────────
// Initialisation Admin SDK + helpers
// ─────────────────────────────────────────────
let app, db
let backupRoot

beforeAll(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, 'test-reset-integration')
  db = getFirestore(app)
  backupRoot = await mkdtemp(join(tmpdir(), 'akayis-reset-test-'))
})

afterAll(async () => {
  if (backupRoot) await rm(backupRoot, { recursive: true, force: true })
  if (app) await deleteApp(app)
})

const CLI_PROCESS_TIMEOUT = 50000

async function runCLI(script, args, envOverrides = {}) {
  const env = {
    ...process.env,
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
    GCLOUD_PROJECT: PROJECT_ID,
    ...envOverrides,
  }
  delete env.GOOGLE_APPLICATION_CREDENTIALS

  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const proc = spawn(process.execPath, [join(SCRIPTS_DIR, script), ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    const killTimer = setTimeout(() => {
      if (settled) return
      settled = true
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ exitCode: -1, stdout, stderr: `[CLI_PROCESS_TIMEOUT] ${script}`, timedOut: true })
    }, CLI_PROCESS_TIMEOUT)

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve({ exitCode: code ?? 0, stdout, stderr, timedOut: false })
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve({ exitCode: -1, stdout, stderr: err.message, timedOut: false })
    })
  })
}

/** Export récursif complet de l'émulateur : { "chemin/doc": data }. */
async function dumpAll() {
  const out = {}
  async function dumpDocRef(docRef) {
    const snap = await docRef.get()
    if (snap.exists) out[docRef.path] = snap.data()
    for (const col of await docRef.listCollections()) {
      for (const child of await col.listDocuments()) {
        await dumpDocRef(child)
      }
    }
  }
  for (const col of await db.listCollections()) {
    for (const docRef of await col.listDocuments()) {
      await dumpDocRef(docRef)
    }
  }
  return out
}

function pathsUnder(dump, prefix) {
  return Object.keys(dump).filter((p) => p.startsWith(prefix))
}

// ─────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────
const T0 = Timestamp.fromMillis(1700000000000)

async function seed() {
  const b = db.batch()

  // Conservés
  b.set(db.doc('stores/S1'), { name: 'Boutique 1', active: true, adminUid: 'admin1' })
  b.set(db.doc('stores/S2'), { name: 'Boutique 2', active: true, adminUid: 'admin2' })
  b.set(db.doc('users/admin1'), { role: 'store_admin', storeId: 'S1', email: 'a1@akayis.test', name: 'Admin 1', active: true })
  b.set(db.doc('users/admin2'), { role: 'store_admin', storeId: 'S2', email: 'a2@akayis.test', name: 'Admin 2', active: true })
  b.set(db.doc('users/dealer1'), { role: 'dealer', email: 'd1@akayis.test', name: 'Dealer 1', active: true })
  b.set(db.doc('users/dealer2'), { role: 'dealer', email: 'd2@akayis.test', name: 'Dealer 2', active: true })
  b.set(db.doc('globalClients/c1'), { nom: 'Ouedraogo', prenom: 'Awa', registeredStoreId: 'S1', registeredStoreName: 'Boutique 1' })
  b.set(db.doc('globalClients/c2'), { nom: 'Kabore', prenom: 'Issa', registeredStoreId: 'S1', registeredStoreName: 'Boutique 1' })
  b.set(db.doc('globalClients/c3'), { nom: 'Sawadogo', prenom: 'Fatou', registeredStoreId: 'S2', registeredStoreName: 'Boutique 2' })

  // Cibles top-level
  b.set(db.doc('dealerRequests/r1'), { dealerUid: 'dealer1', requestType: 'stock_add', network: 'Orange', amount: 100000, status: 'pending', createdAt: T0 })
  b.set(db.doc('dealerRequests/r2'), { dealerUid: 'dealer2', requestType: 'open_day', network: 'Orange', amount: 0, status: 'confirmed', createdAt: T0 })
  b.set(db.doc('dealerClosures/cl1'), { dealerUid: 'dealer1', status: 'pending', createdAt: T0 })
  b.set(db.doc('storeDealerTransfers/t1'), { storeId: 'S1', dealerUid: 'dealer1', transferType: 'return_stock', amount: 5000, status: 'pending' })
  b.set(db.doc('dealerPartnerDeposits/p1'), { dealerUid: 'dealer1', operation: 'deposit', amount: 20000 })
  b.set(db.doc('auditLogs/al1'), { action: 'DEALER_REQUEST_CONFIRMED', createdAt: T0 })
  b.set(db.doc('auditLogs/al2'), { action: 'STORE_DEALER_TRANSFER_CREATED', createdAt: T0 })

  // Par boutique
  for (const storeId of ['S1', 'S2']) {
    b.set(db.doc(`clients/${storeId}/drafts/d1`), { type: 'Dépôt', montant: 5000, clientId: 'c1', statut: 'Non Terminées', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/drafts/d2`), { type: 'Retrait', montant: 3000, clientId: 'c2', statut: 'Non Terminées', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/drafts/d1/settlements/s1`), { amount: 2000, paymentMethod: 'Orange', fullySettled: false })
    b.set(db.doc(`clients/${storeId}/drafts/d1/settlements/s2`), { amount: 3000, paymentMethod: 'Espèces', fullySettled: true })
    b.set(db.doc(`clients/${storeId}/history/h1`), { type: 'Dépôt', montant: 8000, clientId: 'c1', statut: 'Validée', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/history/h2`), { type: 'Crédit', montant: 1000, clientId: 'c3', statut: 'Remboursée', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/history/h1/settlements/s1`), { amount: 8000, paymentMethod: 'Orange', fullySettled: true })
    b.set(db.doc(`clients/${storeId}/sessions/sess1`), { openedAt: T0 })
    b.set(db.doc(`clients/${storeId}/sessions/sess2`), { openedAt: T0 })
    b.set(db.doc(`clients/${storeId}/auditLogs/a1`), { action: 'DEALER_REQUEST_CONFIRMED', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/auditLogs/a2`), { action: 'DEALER_REQUEST_REJECTED', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/auditLogs/a3`), { action: 'STORE_DEALER_TRANSFER_CONFIRMED', createdAt: T0 })
    b.set(db.doc(`clients/${storeId}/networkBalances/current`), {
      balances: {
        Orange: { stock: 150000, liquidite: 75000 },
        Moov: { stock: 20000, liquidite: 10000 },
        Telecel: { stock: 0, liquidite: 0 },
        Coris: { stock: 5000, liquidite: 0 },
        Sank: { stock: 0, liquidite: 1000 },
      },
      updatedAt: T0,
    })
  }

  // Boutique orpheline : sous-collection sans doc stores/S3 ni doc clients/S3
  b.set(db.doc('clients/S3/drafts/dx'), { type: 'Dépôt', montant: 999, clientId: 'c9', statut: 'Non Terminées' })

  // Sous-collections héritées de la première version (pilote mai 2026) : à purger
  b.set(db.doc('clients/S1/clients/legacyC1'), { nom: 'Test', prenom: 'Legacy', numeroPersonnel: '76112233', createdAt: T0 })
  b.set(db.doc('clients/S1/users/legacyU1'), { name: 'Employe Test', email: 'legacy@akayis.test', role: 'employee', createdAt: T0 })

  // Settlements orphelins : le brouillon parent "ghost" n'existe pas (supprimé
  // par l'application) mais ses settlements survivent — constaté en production.
  b.set(db.doc('clients/S1/drafts/ghost/settlements/sg1'), { amount: 500, paymentMethod: 'Orange', fullySettled: true })
  b.set(db.doc('clients/S1/history/ghostH/settlements/sg2'), { amount: 700, paymentMethod: 'Espèces', fullySettled: true })

  // Dealers
  for (const uid of ['dealer1', 'dealer2']) {
    b.set(db.doc(`dealerBalances/${uid}`), { balances: { Orange: { stock: 40000, liquidite: 25000 } }, updatedAt: T0 })
    b.set(db.doc(`dealerBalances/${uid}/auditLogs/a1`), { action: 'DEALER_INVENTORY_REPLENISHED', amount: 40000, createdAt: T0 })
    b.set(db.doc(`dealerBalances/${uid}/auditLogs/a2`), { action: 'PARTNER_DEPOSIT', amount: 20000, createdAt: T0 })
  }

  await b.commit()
}

// ─────────────────────────────────────────────
// Scénarios A → B → D (séquentiels sur le même seed)
// ─────────────────────────────────────────────
describe('Remise à zéro — cycle complet sur émulateur', () => {
  let preResetDump

  beforeAll(async () => {
    await seed()
    preResetDump = await dumpAll()
  }, 60000)

  it('A — dry-run : rapport, aucune écriture, aucun backup', async () => {
    const backupDir = join(backupRoot, 'dry-run')
    const res = await runCLI('resetDataToZero.mjs', [`--backup-dir=${backupDir}`])

    expect(res.timedOut).toBe(false)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('DRY-RUN')
    expect(res.stdout).toContain('SERA SUPPRIMÉ')
    expect(res.stdout).toContain('SERA REMIS À ZÉRO')
    expect(res.stdout).toContain('INTACT')
    expect(res.stdout).toContain('clients/S3')

    const postDump = await dumpAll()
    expect(postDump).toEqual(preResetDump)

    await expect(access(backupDir)).rejects.toThrow()
  }, 60000)

  it('B — execute : purge, soldes à zéro, conservés intacts, trace et backup', async () => {
    const backupDir = join(backupRoot, 'execute')
    const res = await runCLI('resetDataToZero.mjs', ['--execute', `--backup-dir=${backupDir}`])

    expect(res.timedOut).toBe(false)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('REMISE À ZÉRO TERMINÉE')

    const postDump = await dumpAll()

    // Cibles purgées (y compris orphelin S3 et settlements)
    for (const prefix of ['dealerRequests/', 'dealerClosures/', 'storeDealerTransfers/', 'dealerPartnerDeposits/']) {
      expect(pathsUnder(postDump, prefix)).toEqual([])
    }
    for (const storeId of ['S1', 'S2', 'S3']) {
      for (const sub of ['drafts', 'history', 'sessions', 'auditLogs', 'clients', 'users']) {
        expect(pathsUnder(postDump, `clients/${storeId}/${sub}/`)).toEqual([])
      }
    }
    const settlementsCount = await db.collectionGroup('settlements').count().get()
    expect(settlementsCount.data().count).toBe(0)
    for (const uid of ['dealer1', 'dealer2']) {
      expect(pathsUnder(postDump, `dealerBalances/${uid}/auditLogs/`)).toEqual([])
    }

    // Soldes dealers à zéro, documents conservés
    for (const uid of ['dealer1', 'dealer2']) {
      const bal = postDump[`dealerBalances/${uid}`]
      expect(bal).toBeTruthy()
      expect(bal.balances).toEqual({ Orange: { stock: 0, liquidite: 0 } })
    }

    // networkBalances : forme stricte, 5 réseaux à zéro, clés exactes
    for (const storeId of ['S1', 'S2']) {
      const nb = postDump[`clients/${storeId}/networkBalances/current`]
      expect(nb).toBeTruthy()
      expect(Object.keys(nb).sort()).toEqual(['balances', 'updatedAt'])
      expect(nb.balances).toEqual({
        Orange: { stock: 0, liquidite: 0 },
        Moov: { stock: 0, liquidite: 0 },
        Telecel: { stock: 0, liquidite: 0 },
        Coris: { stock: 0, liquidite: 0 },
        Sank: { stock: 0, liquidite: 0 },
      })
    }

    // Conservés intacts (identiques au dump pré-reset)
    for (const prefix of ['globalClients/', 'users/', 'stores/']) {
      const before = Object.fromEntries(Object.entries(preResetDump).filter(([p]) => p.startsWith(prefix)))
      const after = Object.fromEntries(Object.entries(postDump).filter(([p]) => p.startsWith(prefix)))
      expect(after).toEqual(before)
    }

    // Trace finale : un seul doc auditLogs, action RESET_PERFORMED
    const auditPaths = pathsUnder(postDump, 'auditLogs/')
    expect(auditPaths).toHaveLength(1)
    const trace = postDump[auditPaths[0]]
    expect(trace.action).toBe('RESET_PERFORMED')
    expect(trace.projectId).toBe(PROJECT_ID)
    expect(trace.backupDir).toBe(backupDir)

    // Backup : manifest + fichiers cohérents avec l'état pré-reset
    const manifest = JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8'))
    expect(manifest.projectId).toBe(PROJECT_ID)
    const totalBackedUp = Object.values(manifest.files).reduce((a, b) => a + b, 0)
    const expectedBackedUp = Object.keys(preResetDump).filter((p) =>
      p.startsWith('dealerRequests/') || p.startsWith('dealerClosures/') ||
      p.startsWith('storeDealerTransfers/') || p.startsWith('dealerPartnerDeposits/') ||
      p.startsWith('auditLogs/') ||
      /^clients\/[^/]+\/(drafts|history|sessions|auditLogs|clients|users)\//.test(p) ||
      /^clients\/[^/]+\/networkBalances\/current$/.test(p) ||
      /^dealerBalances\/[^/]+(\/auditLogs\/.+)?$/.test(p)
    ).length
    expect(totalBackedUp).toBe(expectedBackedUp)

    // Aller-retour ponctuel : un draft avec son Timestamp encodé
    const s1Lines = await readNdjson(join(backupDir, 'stores', 'S1.ndjson'))
    const d1 = s1Lines.find((l) => l.path === 'clients/S1/drafts/d1')
    expect(d1).toBeTruthy()
    expect(d1.data.montant).toBe(5000)
    expect(d1.data.createdAt).toEqual({ __type: 'timestamp', seconds: 1700000000, nanoseconds: 0 })

    // Les settlements orphelins (parents "missing") sont bien dans le backup
    expect(s1Lines.some((l) => l.path === 'clients/S1/drafts/ghost/settlements/sg1')).toBe(true)
    expect(s1Lines.some((l) => l.path === 'clients/S1/history/ghostH/settlements/sg2')).toBe(true)
  }, 90000)

  it('D — restore : restoreFromBackup ramène l’état pré-reset', async () => {
    const backupDir = join(backupRoot, 'execute')

    const dry = await runCLI('restoreFromBackup.mjs', [`--backup-dir=${backupDir}`])
    expect(dry.exitCode).toBe(0)
    expect(dry.stdout).toContain('DRY-RUN')

    const res = await runCLI('restoreFromBackup.mjs', ['--execute', `--backup-dir=${backupDir}`])
    expect(res.timedOut).toBe(false)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Restauration terminée')

    const postRestoreDump = await dumpAll()
    // La trace RESET_PERFORMED survit à la restauration : on l'écarte de la comparaison.
    const filtered = Object.fromEntries(
      Object.entries(postRestoreDump).filter(([, data]) => data.action !== 'RESET_PERFORMED')
    )
    expect(filtered).toEqual(preResetDump)
  }, 90000)
})

// ─────────────────────────────────────────────
// Scénario C — refus production non interactif
// ─────────────────────────────────────────────
describe('Remise à zéro — refus production sans terminal', () => {
  it('C — GCLOUD_PROJECT=c2egf-b0b5a + verrous, stdin non-TTY → exit 1 sans écriture', async () => {
    const res = await runCLI(
      'resetDataToZero.mjs',
      ['--execute', '--allow-production'],
      {
        GCLOUD_PROJECT: 'c2egf-b0b5a',
        AKAYIS_ALLOW_PRODUCTION_RESET: 'true',
        // Empêche tout contact accidentel avec la prod : l'hôte émulateur reste actif,
        // mais le script doit refuser AVANT toute initialisation Firebase.
      }
    )

    expect(res.timedOut).toBe(false)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('REFUS')
    expect(res.stderr).toContain('confirmation interactive')
  }, 30000)

  it('C bis — sans les verrous, la garde bloque avant le TTY', async () => {
    const res = await runCLI(
      'resetDataToZero.mjs',
      ['--execute'],
      { GCLOUD_PROJECT: 'c2egf-b0b5a' }
    )

    expect(res.exitCode).not.toBe(0)
    expect(res.stderr).toContain('PRODUCTION_RESET_NOT_UNLOCKED')
  }, 30000)
})
