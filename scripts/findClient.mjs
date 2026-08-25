/**
 * Recherche LECTURE SEULE dans globalClients (diagnostic).
 *
 * Cherche des clients par numéro personnel OU par fragment de nom/prénom
 * (insensible à la casse pour les noms, chargement en mémoire : adapté à
 * quelques milliers de fiches). Aucune écriture.
 *
 * Usage :
 *   node scripts/findClient.mjs <terme> [terme...]
 *   ex. node scripts/findClient.mjs 76174945 kassana diallo sanfo
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import { resolveResetProject } from './lib/assertResetProject.mjs'

const terms = process.argv.slice(2).filter((t) => !t.startsWith('--'))
if (terms.length === 0) {
  console.error('Usage : node scripts/findClient.mjs <numéro ou nom> [autres termes...]')
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

const snap = await db.collection('globalClients').get()
console.log(`globalClients : ${snap.size} fiche(s) chargée(s)`)

const digitsOnly = (s) => String(s || '').replace(/\D/g, '')

for (const term of terms) {
  const isNumber = /^[0-9+\-\s()/]+$/.test(term)
  const needleDigits = digitsOnly(term)
  const needleText = term.toLowerCase()

  const matches = snap.docs.filter((doc) => {
    const d = doc.data()
    if (isNumber && needleDigits !== '') {
      return digitsOnly(d.numeroPersonnel).includes(needleDigits) ||
        digitsOnly(d.orange).includes(needleDigits) ||
        digitsOnly(d.numeroDA).includes(needleDigits)
    }
    return String(d.nom || '').toLowerCase().includes(needleText) ||
      String(d.prenom || '').toLowerCase().includes(needleText)
  })

  console.log('')
  console.log(`Recherche « ${term} » : ${matches.length} résultat(s)`)
  for (const doc of matches.slice(0, 5)) {
    const d = doc.data()
    console.log(
      `  — ${doc.id} : ${d.nom || '?'} ${d.prenom || '?'} | tel=${d.numeroPersonnel || '—'} | ` +
      `orange=${d.orange || '—'} | boutique=${d.registeredStoreName || d.registeredStoreId || '—'}`
    )
  }
  if (matches.length > 5) console.log(`  … et ${matches.length - 5} autre(s)`)
}
