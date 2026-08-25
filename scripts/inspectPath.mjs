/**
 * Inspection LECTURE SEULE d'une collection Firestore (diagnostic).
 *
 * Affiche le nombre de documents, les premiers ids, les noms de champs et un
 * aperçu tronqué des valeurs. Aucune écriture, autorisé sur tout projet
 * (même politique que le dry-run de resetDataToZero).
 *
 * Usage :
 *   node scripts/inspectPath.mjs <chemin/de/collection> [nbDocs=5]
 *   ex. node scripts/inspectPath.mjs clients/taofic_ajagbe/clients
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import { resolveResetProject } from './lib/assertResetProject.mjs'

const collectionPath = process.argv[2]
const sampleSize = Number(process.argv[3] || 5)

if (!collectionPath || collectionPath.split('/').length % 2 === 0) {
  console.error('Usage : node scripts/inspectPath.mjs <chemin/de/collection> [nbDocs]')
  console.error('Le chemin doit désigner une COLLECTION (nombre impair de segments).')
  process.exit(1)
}

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const serviceAccount = serviceAccountPath
  ? JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  : null

// execute:false → lecture seule, autorisée partout (diagnostic).
const { projectId, isProduction } = resolveResetProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
  execute: false,
})

initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
const db = getFirestore()

console.log(`Projet : ${projectId}${isProduction ? ' (PRODUCTION — lecture seule)' : ''}`)
console.log(`Collection : ${collectionPath}`)
console.log('')

const ref = db.collection(collectionPath)
const agg = await ref.count().get()
console.log(`Total : ${agg.data().count} document(s)`)

function preview(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value.length > 30 ? value.slice(0, 30) + '…' : value}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value.toDate === 'function') return `Timestamp(${value.toDate().toISOString()})`
  if (Array.isArray(value)) return `[tableau, ${value.length} élément(s)]`
  if (typeof value === 'object') return `{objet : ${Object.keys(value).join(', ')}}`
  return typeof value
}

const snap = await ref.limit(sampleSize).get()
for (const doc of snap.docs) {
  console.log('')
  console.log(`— ${doc.id}`)
  const data = doc.data()
  for (const [key, value] of Object.entries(data)) {
    console.log(`    ${key} : ${preview(value)}`)
  }
  const subCols = await doc.ref.listCollections()
  if (subCols.length > 0) {
    console.log(`    (sous-collections : ${subCols.map((c) => c.id).join(', ')})`)
  }
}
