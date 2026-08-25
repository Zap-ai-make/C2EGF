import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import { resolveAndAssertAdminProject } from './lib/resolveAndAssertAdminProject.mjs'

const execute = process.argv.includes('--execute')
const confirmedDeleteAll = process.argv.includes('--confirm-delete-all')
const allowDeleteAll = process.env.AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS === 'true'
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

const serviceAccount = serviceAccountPath
  ? JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  : null

resolveAndAssertAdminProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
})

initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault()
})

const auth = getAuth()
const db = getFirestore()
const users = []
let nextPageToken

if (execute && (!confirmedDeleteAll || !allowDeleteAll)) {
  throw new Error(
    [
      'Suppression bloquee: cette commande supprime TOUS les comptes Auth du projet.',
      'Pour confirmer volontairement, relancez avec --execute --confirm-delete-all',
      'et la variable AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS=true.'
    ].join(' ')
  )
}

do {
  const page = await auth.listUsers(1000, nextPageToken)
  users.push(...page.users)
  nextPageToken = page.pageToken
} while (nextPageToken)

console.log(`${execute ? 'EXECUTION' : 'DRY-RUN'}: ${users.length} comptes Firebase Auth ciblés`)

for (const user of users) {
  console.log(`${execute ? 'DELETE' : 'WOULD DELETE'} ${user.uid} ${user.email || ''}`)

  if (execute) {
    await auth.deleteUser(user.uid)
    await db.doc(`users/${user.uid}`).delete().catch(() => {})
  }
}

if (execute) {
  await db.collection('auditLogs').add({
    type: 'delete_existing_accounts',
    count: users.length,
    executedAt: FieldValue.serverTimestamp()
  }).catch(() => {})
}

if (!execute) {
  console.log(
    'Dry-run uniquement. Pour une suppression totale volontaire, il faut --execute --confirm-delete-all et AKAYIS_ALLOW_DELETE_ALL_ACCOUNTS=true.'
  )
}
