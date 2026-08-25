/**
 * Remise à zéro des données AKAYIS avant démarrage de l'activité réelle.
 *
 * CONSERVÉ INTACT  : globalClients, users, stores.
 * REMIS À ZÉRO     : dealerBalances/{uid} (stock/liquidite → 0, docs conservés),
 *                    clients/{storeId}/networkBalances/current (5 réseaux → 0).
 * SUPPRIMÉ         : dealerRequests, dealerClosures, storeDealerTransfers,
 *                    dealerPartnerDeposits, auditLogs (top-level),
 *                    clients/{storeId}/{drafts,history,sessions,auditLogs} (+ settlements),
 *                    dealerBalances/{uid}/auditLogs.
 *
 * Sécurité :
 *   - Dry-run par défaut : aucune écriture, aucun backup, rapport seulement.
 *   - --execute sur demo-* uniquement, sauf déverrouillage production à 4 verrous :
 *     --execute + --allow-production + AKAYIS_ALLOW_PRODUCTION_RESET='true'
 *     + confirmation interactive du projectId (refusée si stdin non interactif).
 *   - Backup NDJSON complet et vérifié AVANT toute écriture (piste d'audit hors ligne).
 *   - Toute sous-collection inconnue détectée → abandon en mode execute.
 *
 * Usage :
 *   node scripts/resetDataToZero.mjs                    # dry-run
 *   node scripts/resetDataToZero.mjs --execute          # execute (demo-* / émulateur)
 *   node scripts/resetDataToZero.mjs --execute --allow-production   # production (voir doc)
 *   Option : --backup-dir=<chemin> (défaut : backups/reset-<timestamp>)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveResetProject, PRODUCTION_PROJECT_ID } from './lib/assertResetProject.mjs'
import { NdjsonWriter } from './lib/firestoreBackup.mjs'
import { verifyResetBackup } from './lib/verifyResetBackup.mjs'
import { withRetry } from './lib/withRetry.mjs'

// ─────────────────────────────────────────────
// Périmètre (allowlists explicites)
// ─────────────────────────────────────────────
const TOP_LEVEL_DELETE = [
  'dealerRequests',
  'dealerClosures',
  'storeDealerTransfers',
  'dealerPartnerDeposits',
  'auditLogs',
]
const TOP_LEVEL_PRESERVE = ['globalClients', 'users', 'stores']
// 'clients' et 'users' : sous-collections héritées de la première version de
// l'application (pilote de mai 2026, vues sous clients/taofic_ajagbe) —
// confirmées comme données de test à purger, inexistantes ailleurs.
const STORE_SUBCOLLECTIONS_DELETE = ['drafts', 'history', 'sessions', 'auditLogs', 'clients', 'users']
const STORE_SUBCOLLECTIONS_PRESERVE = ['networkBalances']
const TXN_SUBCOLLECTIONS_DELETE = ['settlements']
const DEALER_SUBCOLLECTIONS_DELETE = ['auditLogs']
const NETWORKS = ['Orange', 'Moov', 'Telecel', 'Coris', 'Sank']
const PAGE_SIZE = 500

// ─────────────────────────────────────────────
// Phase 0 — Arguments, garde, confirmation
// ─────────────────────────────────────────────
const execute = process.argv.includes('--execute')
const allowProductionFlag = process.argv.includes('--allow-production')
const backupDirArg = process.argv.find((a) => a.startsWith('--backup-dir='))

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const serviceAccount = serviceAccountPath
  ? JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  : null

const { projectId, isProduction } = resolveResetProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
  execute,
  allowProductionFlag,
  envAllowProductionReset: process.env.AKAYIS_ALLOW_PRODUCTION_RESET,
})

if (execute && isProduction) {
  if (!process.stdin.isTTY) {
    console.error(
      'REFUS : la remise à zéro en PRODUCTION exige une confirmation interactive au clavier.\n' +
      'Le flux stdin n\'est pas un terminal (exécution en pipe/CI). Opération bloquée.'
    )
    process.exit(1)
  }
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question(
    `ATTENTION : REMISE À ZÉRO IRRÉVERSIBLE du projet de PRODUCTION.\n` +
    `Tapez exactement le projectId (${PRODUCTION_PROJECT_ID}) pour confirmer : `
  )
  rl.close()
  if (answer.trim() !== PRODUCTION_PROJECT_ID) {
    console.error('Confirmation invalide. Opération annulée, aucune écriture effectuée.')
    process.exit(1)
  }
}

initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
})
const db = getFirestore()
// Transport REST : connexions courtes, bien plus robustes que gRPC sur le
// réseau instable du poste d'administration (coupures ECONNRESET).
// Pas sur émulateur : le transport REST exige de vraies clés d'authentification.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  db.settings({ preferRest: true })
}

console.log(`Projet : ${projectId}${isProduction ? ' (PRODUCTION)' : ''}`)
console.log(`Mode   : ${execute ? 'EXECUTION' : 'DRY-RUN (aucune écriture)'}`)
console.log('')

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function countCollection(ref) {
  const agg = await withRetry(() => ref.count().get(), 'comptage')
  return agg.data().count
}

async function* paginate(collRef) {
  let last = null
  for (;;) {
    let q = collRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
    if (last) q = q.startAfter(last)
    // Relire une page est sans effet de bord : nouvelle tentative sûre.
    const snap = await withRetry(() => q.get(), `lecture ${collRef.path || 'collection'}`)
    if (snap.empty) return
    for (const doc of snap.docs) yield doc
    last = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE_SIZE) return
  }
}

const getDoc = (path) => withRetry(() => db.doc(path).get(), `lecture ${path}`)
const listDocs = (path) => withRetry(() => db.collection(path).listDocuments(), `liste ${path}`)
const listCols = (path) => withRetry(() => db.doc(path).listCollections(), `sous-collections ${path}`)

// Les ids Firestore peuvent contenir des caractères interdits dans un nom de
// fichier Windows : on les remplace, avec suffixe numérique en cas de collision.
const usedFileNames = new Set()
function safeFileName(id) {
  let base = id.replace(/[^A-Za-z0-9._-]/g, '_')
  if (base === '') base = '_'
  let name = base
  let i = 1
  while (usedFileNames.has(name)) name = `${base}~${i++}`
  usedFileNames.add(name)
  return name
}

// ─────────────────────────────────────────────
// Phase 1 — Énumération du périmètre (lecture seule)
// ─────────────────────────────────────────────
const warnings = []

const storeIds = new Set()
for (const doc of (await listDocs('stores'))) storeIds.add(doc.id)
// listDocuments() retourne aussi les parents "missing" qui ne portent que des
// sous-collections — indispensable pour attraper les boutiques orphelines.
for (const doc of (await listDocs('clients'))) storeIds.add(doc.id)

const dealerIds = new Set()
const dealersSnap = await withRetry(
  () => db.collection('users').where('role', '==', 'dealer').get(),
  'liste des dealers'
)
for (const doc of dealersSnap.docs) dealerIds.add(doc.id)
for (const doc of (await listDocs('dealerBalances'))) dealerIds.add(doc.id)

// Filet de sécurité : aucune sous-collection inconnue ne doit exister là où
// recursiveDelete va passer (elle serait détruite sans backup).
for (const storeId of storeIds) {
  const subCols = await listCols(`clients/${storeId}`)
  for (const col of subCols) {
    if (!STORE_SUBCOLLECTIONS_DELETE.includes(col.id) && !STORE_SUBCOLLECTIONS_PRESERVE.includes(col.id)) {
      warnings.push(`Sous-collection inconnue : clients/${storeId}/${col.id}`)
    }
  }
}
for (const dealerUid of dealerIds) {
  const subCols = await listCols(`dealerBalances/${dealerUid}`)
  for (const col of subCols) {
    if (!DEALER_SUBCOLLECTIONS_DELETE.includes(col.id)) {
      warnings.push(`Sous-collection inconnue : dealerBalances/${dealerUid}/${col.id}`)
    }
  }
}

// ─────────────────────────────────────────────
// Phase 2 — Comptages et rapport (dry-run et execute)
// ─────────────────────────────────────────────
const counts = { topLevel: {}, stores: {}, dealers: {}, settlementsTotal: 0 }

for (const name of TOP_LEVEL_DELETE) {
  counts.topLevel[name] = await countCollection(db.collection(name))
}
counts.settlementsTotal = await countCollection(db.collectionGroup('settlements'))

for (const storeId of storeIds) {
  const perStore = {}
  for (const sub of STORE_SUBCOLLECTIONS_DELETE) {
    perStore[sub] = await countCollection(db.collection(`clients/${storeId}/${sub}`))
  }
  perStore.networkBalancesCurrent = (await getDoc(`clients/${storeId}/networkBalances/current`)).exists
  counts.stores[storeId] = perStore
}

for (const dealerUid of dealerIds) {
  counts.dealers[dealerUid] = {
    balanceDoc: (await getDoc(`dealerBalances/${dealerUid}`)).exists,
    auditLogs: await countCollection(db.collection(`dealerBalances/${dealerUid}/auditLogs`)),
  }
}

console.log('── SERA SUPPRIMÉ ──────────────────────────────')
for (const [name, n] of Object.entries(counts.topLevel)) {
  console.log(`  ${name} : ${n} document(s)`)
}
console.log(`  settlements (toutes boutiques) : ${counts.settlementsTotal} document(s)`)
for (const [storeId, per] of Object.entries(counts.stores)) {
  const details = STORE_SUBCOLLECTIONS_DELETE.map((s) => `${s}=${per[s]}`).join(', ')
  console.log(`  clients/${storeId} : ${details}`)
}
for (const [uid, per] of Object.entries(counts.dealers)) {
  console.log(`  dealerBalances/${uid}/auditLogs : ${per.auditLogs} document(s)`)
}

console.log('── SERA REMIS À ZÉRO (documents conservés) ────')
for (const [uid, per] of Object.entries(counts.dealers)) {
  console.log(`  dealerBalances/${uid} : ${per.balanceDoc ? 'stock et liquidité → 0' : 'absent, ignoré'}`)
}
for (const [storeId, per] of Object.entries(counts.stores)) {
  console.log(`  clients/${storeId}/networkBalances/current : ${per.networkBalancesCurrent ? 'tous réseaux → 0' : 'absent, ignoré'}`)
}

console.log('── INTACT ─────────────────────────────────────')
for (const name of TOP_LEVEL_PRESERVE) {
  console.log(`  ${name} : ${await countCollection(db.collection(name))} document(s) (non modifiés)`)
}

if (warnings.length > 0) {
  console.log('── AVERTISSEMENTS ─────────────────────────────')
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}

if (!execute) {
  console.log('')
  console.log('Dry-run uniquement : aucune écriture effectuée, aucun backup créé.')
  console.log('Pour exécuter réellement : --execute (demo-*) ; production : voir documentation du script.')
  process.exit(0)
}

if (warnings.length > 0) {
  console.error('')
  console.error('ABANDON : des sous-collections inconnues ont été détectées (voir avertissements).')
  console.error('Mettre à jour le périmètre du script avant toute exécution. Aucune écriture effectuée.')
  process.exit(1)
}

// ─────────────────────────────────────────────
// Phase 3 — Backup complet AVANT toute écriture
// ─────────────────────────────────────────────
const timestamp = new Date().toISOString().replace(/:/g, '-')
const backupDir = backupDirArg
  ? backupDirArg.slice('--backup-dir='.length)
  : join('backups', `reset-${timestamp}`)

try {
  const existing = await readdir(backupDir)
  if (existing.length > 0) {
    console.error(`ABANDON : le dossier de backup ${backupDir} existe déjà et n'est pas vide.`)
    process.exit(1)
  }
} catch {
  // dossier absent : normal
}
await mkdir(join(backupDir, 'stores'), { recursive: true })
await mkdir(join(backupDir, 'dealerBalances'), { recursive: true })

console.log('')
console.log(`Backup en cours vers ${backupDir} ...`)

const manifestFiles = {}
let backupTotals = { topLevel: {}, stores: {}, dealers: {}, settlementsTotal: 0 }

for (const name of TOP_LEVEL_DELETE) {
  const writer = new NdjsonWriter(join(backupDir, `${name}.ndjson`))
  for await (const doc of paginate(db.collection(name))) {
    await writer.writeDoc(doc.ref.path, doc.data())
  }
  backupTotals.topLevel[name] = await writer.close()
  manifestFiles[`${name}.ndjson`] = backupTotals.topLevel[name]
}

const unknownTxnSubcollections = []

for (const storeId of storeIds) {
  const fileName = `stores/${safeFileName(storeId)}.ndjson`
  const writer = new NdjsonWriter(join(backupDir, fileName))
  const perStore = { settlements: 0, settlementsExpected: 0, networkBalancesBackedUp: false }

  for (const sub of STORE_SUBCOLLECTIONS_DELETE) {
    let n = 0
    for await (const doc of paginate(db.collection(`clients/${storeId}/${sub}`))) {
      await writer.writeDoc(doc.ref.path, doc.data())
      n += 1
    }
    perStore[sub] = n

    // Les transactions (drafts/history) portent des settlements. On énumère les
    // refs via listDocuments (et non une requête) : quand l'application supprime
    // un brouillon, sa sous-collection settlements peut survivre sous un parent
    // "missing" — invisible aux requêtes mais détruite par recursiveDelete,
    // elle doit donc être sauvegardée aussi (798 vs 379 constatés en prod).
    if (sub === 'drafts' || sub === 'history') {
      const txnRefs = await listDocs(`clients/${storeId}/${sub}`)
      for (const txnRef of txnRefs) {
        const txnSubCols = await withRetry(() => txnRef.listCollections(), `sous-collections ${txnRef.path}`)
        for (const col of txnSubCols) {
          if (!TXN_SUBCOLLECTIONS_DELETE.includes(col.id)) {
            unknownTxnSubcollections.push(`${txnRef.path}/${col.id}`)
            continue
          }
          // Comptage serveur par boutique : un écart compensé entre boutiques
          // ne doit pas passer la porte de vérification.
          perStore.settlementsExpected += await countCollection(col)
          for await (const settlement of paginate(col)) {
            await writer.writeDoc(settlement.ref.path, settlement.data())
            perStore.settlements += 1
          }
        }
      }
    }
  }

  const nbSnap = await getDoc(`clients/${storeId}/networkBalances/current`)
  if (nbSnap.exists) {
    await writer.writeDoc(nbSnap.ref.path, nbSnap.data())
    perStore.networkBalancesBackedUp = true
  }

  const written = await writer.close()
  manifestFiles[fileName] = written
  backupTotals.stores[storeId] = perStore
  backupTotals.settlementsTotal += perStore.settlements
}

for (const dealerUid of dealerIds) {
  const fileName = `dealerBalances/${safeFileName(dealerUid)}.ndjson`
  const writer = new NdjsonWriter(join(backupDir, fileName))
  const perDealer = { auditLogs: 0, balanceBackedUp: false }

  const balSnap = await getDoc(`dealerBalances/${dealerUid}`)
  if (balSnap.exists) {
    await writer.writeDoc(balSnap.ref.path, balSnap.data())
    perDealer.balanceBackedUp = true
  }
  for await (const doc of paginate(db.collection(`dealerBalances/${dealerUid}/auditLogs`))) {
    await writer.writeDoc(doc.ref.path, doc.data())
    perDealer.auditLogs += 1
  }

  const written = await writer.close()
  manifestFiles[fileName] = written
  backupTotals.dealers[dealerUid] = perDealer
}

if (unknownTxnSubcollections.length > 0) {
  console.error('ABANDON : sous-collections inconnues sous des transactions :')
  for (const p of unknownTxnSubcollections) console.error(`  ⚠ ${p}`)
  console.error('Aucune suppression effectuée. Mettre à jour le périmètre du script.')
  process.exit(1)
}

// Porte de vérification : le backup doit couvrir exactement les comptages,
// y compris les documents de soldes écrasés en phase 5 (voir verifyResetBackup.mjs).
const verificationErrors = verifyResetBackup({
  counts,
  backupTotals,
  topLevelDelete: TOP_LEVEL_DELETE,
  storeSubcollectionsDelete: STORE_SUBCOLLECTIONS_DELETE,
})

if (verificationErrors.length > 0) {
  console.error('ABANDON : le backup ne correspond pas aux comptages (activité concurrente ?) :')
  for (const e of verificationErrors) console.error(`  ✗ ${e}`)
  console.error('Aucune suppression effectuée. Relancer quand l\'application est inactive.')
  process.exit(1)
}

await writeFile(
  join(backupDir, 'manifest.json'),
  JSON.stringify(
    {
      projectId,
      createdAt: new Date().toISOString(),
      argv: process.argv.slice(2),
      script: 'scripts/resetDataToZero.mjs',
      files: manifestFiles,
      counts,
    },
    null,
    2
  ),
  'utf8'
)

console.log(`Backup vérifié : ${Object.values(manifestFiles).reduce((a, b) => a + b, 0)} document(s) sauvegardé(s).`)

// ─────────────────────────────────────────────
// Phase 4 — Suppressions (recursiveDelete : chunks ≤500, sous-collections incluses)
// ─────────────────────────────────────────────
console.log('')
console.log('Suppression en cours ...')

try {
  // Une suppression est idempotente : nouvelle tentative sûre après coupure réseau.
  const recursiveDelete = (path) =>
    withRetry(() => db.recursiveDelete(db.collection(path)), `suppression ${path}`)

  for (const name of TOP_LEVEL_DELETE.filter((n) => n !== 'auditLogs')) {
    await recursiveDelete(name)
    console.log(`  supprimé : ${name}`)
  }

  for (const storeId of storeIds) {
    // Jamais recursiveDelete sur le doc clients/{storeId} lui-même :
    // cela détruirait networkBalances. Sous-collections cibles uniquement.
    for (const sub of STORE_SUBCOLLECTIONS_DELETE) {
      await recursiveDelete(`clients/${storeId}/${sub}`)
    }
    console.log(`  supprimé : clients/${storeId}/{${STORE_SUBCOLLECTIONS_DELETE.join(',')}}`)
  }

  for (const dealerUid of dealerIds) {
    await recursiveDelete(`dealerBalances/${dealerUid}/auditLogs`)
    console.log(`  supprimé : dealerBalances/${dealerUid}/auditLogs`)
  }

  // auditLogs top-level en dernier : garder la trace applicative le plus longtemps possible.
  await recursiveDelete('auditLogs')
  console.log('  supprimé : auditLogs')

  // ─────────────────────────────────────────────
  // Phase 5 — Remise à zéro des soldes (shape stricte des règles Firestore)
  // ─────────────────────────────────────────────
  console.log('')
  console.log('Remise à zéro des soldes ...')

  let zeroedDealerBalances = 0
  for (const dealerUid of dealerIds) {
    const ref = db.doc(`dealerBalances/${dealerUid}`)
    const snap = await getDoc(ref.path)
    if (!snap.exists) {
      console.log(`  dealerBalances/${dealerUid} : absent, ignoré`)
      continue
    }
    const data = snap.data()
    const zeroBalances = {}
    for (const network of Object.keys(data.balances || {})) {
      zeroBalances[network] = { stock: 0, liquidite: 0 }
    }
    // set() complet : idempotent, nouvelle tentative sûre.
    await withRetry(
      () => ref.set({ ...data, balances: zeroBalances, updatedAt: FieldValue.serverTimestamp() }),
      `remise à zéro ${ref.path}`
    )
    zeroedDealerBalances += 1
    console.log(`  dealerBalances/${dealerUid} : remis à zéro`)
  }

  let zeroedNetworkBalances = 0
  for (const storeId of storeIds) {
    const ref = db.doc(`clients/${storeId}/networkBalances/current`)
    const snap = await getDoc(ref.path)
    if (!snap.exists) {
      console.log(`  clients/${storeId}/networkBalances/current : absent, ignoré`)
      continue
    }
    const zeroBalances = {}
    for (const network of NETWORKS) zeroBalances[network] = { stock: 0, liquidite: 0 }
    // set() sans merge : forme exacte exigée par firestore.rules (balances + updatedAt).
    await withRetry(
      () => ref.set({ balances: zeroBalances, updatedAt: FieldValue.serverTimestamp() }),
      `remise à zéro ${ref.path}`
    )
    zeroedNetworkBalances += 1
    console.log(`  clients/${storeId}/networkBalances/current : remis à zéro`)
  }

  // ─────────────────────────────────────────────
  // Phase 6 — Trace finale + résumé
  // ─────────────────────────────────────────────
  // ID déterministe : une nouvelle tentative après coupure réseau ne peut pas
  // créer de doublon de la trace.
  await withRetry(() => db.doc(`auditLogs/reset-${timestamp}`).set({
    action: 'RESET_PERFORMED',
    projectId,
    backupDir,
    deletedCounts: counts.topLevel,
    deletedSettlements: counts.settlementsTotal,
    deletedPerStore: counts.stores,
    zeroedDealerBalances,
    zeroedNetworkBalances,
    executedBy: 'scripts/resetDataToZero.mjs',
    executedAt: FieldValue.serverTimestamp(),
  }), 'trace RESET_PERFORMED')

  console.log('')
  console.log('══ REMISE À ZÉRO TERMINÉE ══════════════════════')
  console.log(`  Soldes dealers remis à zéro   : ${zeroedDealerBalances}`)
  console.log(`  Soldes boutiques remis à zéro : ${zeroedNetworkBalances}`)
  console.log(`  Backup complet                : ${backupDir}`)
  console.log('  Trace RESET_PERFORMED écrite dans auditLogs.')
  console.log('')
  console.log('  IMPORTANT : archiver immédiatement le dossier de backup sur un second support.')
} catch (err) {
  console.error('')
  console.error('══ ÉCHEC PARTIEL ═══════════════════════════════')
  console.error(`  Erreur : ${err.message}`)
  console.error(`  Le backup complet et vérifié reste disponible : ${backupDir}`)
  console.error('  Le script est ré-exécutable : relancer pour terminer la purge (un nouveau backup sera créé).')
  process.exit(1)
}
