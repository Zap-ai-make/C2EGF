/**
 * restoreDeletedAccount.mjs — Restaure un compte Firebase Auth supprimé par erreur.
 *
 * Principe : la suppression d'un compte Auth est définitive, mais les données
 * Firestore (profil users/{uid}, boutique stores/{storeId} et tout son contenu
 * clients/{storeId}/…) restent indexées par UID / storeId, pas par le compte
 * Auth lui-même. On recrée donc le compte Auth avec le MÊME UID d'origine, ce
 * qui re-relie automatiquement le profil et la boutique. Le mot de passe ne peut
 * pas être récupéré (hash non lisible) → on émet un lien de réinitialisation.
 *
 * L'UID d'origine est retrouvé, dans l'ordre :
 *   1) --uid=... si fourni
 *   2) document users/{uid} encore présent (email == cible)   → doc.id
 *   3) document stores/{id} (email == cible)                  → store.adminUid
 *
 * Sécurité (audit) :
 *   - DRY-RUN par défaut ; n'écrit rien sans --execute.
 *   - Le DRY-RUN (lecture seule) est autorisé sur tout projet, y compris la
 *     production, pour permettre le diagnostic.
 *   - L'ÉCRITURE (--execute) est cantonnée aux projets demo-* : toute tentative
 *     d'exécution sur taofic-ajagbe (ou tout projet non demo-) est REFUSÉE.
 *     Le dépôt ne contient donc aucun chemin d'écriture production pendant l'audit.
 *   - Idempotent : ré-exécutable sans effet de bord destructeur.
 *   - Aucune suppression. Aucune donnée métier touchée.
 *
 * Usage :
 *   # 1) Diagnostic à blanc (aucune écriture, prod ou demo) :
 *   GOOGLE_APPLICATION_CREDENTIALS=/chemin/serviceAccount.json \
 *     node scripts/restoreDeletedAccount.mjs --email=compte@example.com
 *   # 2) Restauration réelle (émulateur / projet demo-* uniquement) :
 *   GOOGLE_APPLICATION_CREDENTIALS=/chemin/demoServiceAccount.json \
 *     node scripts/restoreDeletedAccount.mjs --email=compte@example.com --execute
 */

import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { resolveRestoreProject, AssertFirebaseProjectError } from './lib/assertRestoreProject.mjs'

// ── Arguments ────────────────────────────────────────────────────────────────
const getArg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(`--${name}=`.length) : null
}

const email = String(getArg('email') || '').trim().toLowerCase()
const uidOverride = String(getArg('uid') || '').trim()
const execute = process.argv.includes('--execute')
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!email) {
  console.error('Usage: node scripts/restoreDeletedAccount.mjs --email=compte@example.com [--uid=UID] [--execute]')
  process.exit(1)
}
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du service account Firebase Admin.')
  process.exit(1)
}

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))

// ── Résolution du projet + garde d'écriture (émulateur-only pour --execute) ──
// Le DRY-RUN (lecture seule) est autorisé sur tout projet ; --execute est
// cantonné aux projets demo-* (aucune écriture production pendant l'audit).
let projectId
try {
  projectId = resolveRestoreProject({
    serviceAccount,
    envProjectId: process.env.GCLOUD_PROJECT,
    execute,
  })
} catch (error) {
  if (error instanceof AssertFirebaseProjectError) {
    console.error(`Opération bloquée [${error.code}] : ${error.message}`)
    if (execute) {
      console.error('Le DRY-RUN (sans --execute) reste autorisé pour diagnostiquer, y compris en production.')
    }
    process.exit(1)
  }
  throw error
}

initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

console.log(`Projet: ${projectId}`)
console.log(`${execute ? 'EXECUTION' : 'DRY-RUN'} — restauration de ${email}\n`)

// ── 1. Retrouver l'UID d'origine + la boutique ───────────────────────────────
let uid = uidOverride || null
let storeId = null
let profile = null

if (!uid) {
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get()
  if (!usersSnap.empty) {
    uid = usersSnap.docs[0].id
    profile = usersSnap.docs[0].data()
    storeId = profile.storeId ?? null
    console.log(`UID retrouvé via users/{uid} (profil intact): ${uid}`)
  }
}

if (!uid) {
  const storesSnap = await db.collection('stores').where('email', '==', email).limit(1).get()
  if (!storesSnap.empty) {
    storeId = storesSnap.docs[0].id
    uid = storesSnap.docs[0].data().adminUid ?? null
    console.log(`UID retrouvé via stores/{id}.adminUid: ${uid} (boutique ${storeId})`)
  }
}

if (!uid) {
  console.error(
    [
      'Impossible de retrouver automatiquement l’UID d’origine.',
      '- Vérifie que le profil users/{uid} ou la boutique stores/{id} (avec email/adminUid) existe encore.',
      '- Sinon, fournis l’UID manuellement via --uid=... (depuis une sauvegarde ou la liste des boutiques).',
    ].join('\n')
  )
  process.exit(1)
}

// Compléter storeId/profile si nécessaire
if (!profile) {
  const pSnap = await db.doc(`users/${uid}`).get()
  profile = pSnap.exists ? pSnap.data() : null
  if (profile?.storeId) storeId = profile.storeId
}
if (!storeId) {
  const byAdmin = await db.collection('stores').where('adminUid', '==', uid).limit(1).get()
  if (!byAdmin.empty) storeId = byAdmin.docs[0].id
}

const storeSnap = storeId ? await db.doc(`stores/${storeId}`).get() : null
const store = storeSnap?.exists ? storeSnap.data() : null

// ── 2. État actuel ───────────────────────────────────────────────────────────
let authExists = false
try {
  await auth.getUser(uid)
  authExists = true
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e
}

console.log('\nÉtat actuel:')
console.log(`  Auth uid=${uid} : ${authExists ? 'DÉJÀ présent' : 'ABSENT (à recréer)'}`)
console.log(`  users/${uid}    : ${profile ? 'présent' : 'ABSENT (à recréer)'}`)
console.log(`  stores/${storeId ?? '?'} : ${store ? 'présent' : 'ABSENT'}`)
if (store) console.log(`  store.adminUid  : ${store.adminUid ?? '—'} ${store.adminUid === uid ? '(cohérent)' : '(à corriger)'}`)

const displayName = profile?.name || profile?.storeName || store?.name || email
const resolvedStoreName = profile?.storeName || store?.name || 'Boutique'

if (!execute) {
  console.log('\nPlan (DRY-RUN — rien écrit) :')
  if (!authExists) console.log(`  • Créer le compte Auth avec uid=${uid}, email=${email}, emailVerified=true`)
  else console.log('  • Réactiver le compte Auth (disabled=false, emailVerified=true)')
  if (!profile) console.log(`  • Recréer users/${uid} { role: store_admin, active: true, storeId: ${storeId}, storeName: ${resolvedStoreName} }`)
  if (store && store.adminUid !== uid) console.log(`  • Corriger stores/${storeId}.adminUid → ${uid}`)
  console.log('  • Générer un lien de réinitialisation de mot de passe (à transmettre au propriétaire)')
  console.log('\nRelance avec --execute pour appliquer.')
  process.exit(0)
}

// ── 3. Exécution ─────────────────────────────────────────────────────────────
const tempPassword = randomBytes(24).toString('base64url') // jamais communiqué; remplacé par reset

if (!authExists) {
  await auth.createUser({
    uid,                       // ← même UID qu'à l'origine : re-lie profil + boutique
    email,
    emailVerified: true,
    disabled: false,
    displayName,
    password: tempPassword,
  })
  console.log(`OK — compte Auth recréé avec uid=${uid}`)
} else {
  await auth.updateUser(uid, { disabled: false, emailVerified: true })
  console.log(`OK — compte Auth uid=${uid} réactivé`)
}

if (!profile) {
  if (!storeId) {
    console.warn('ATTENTION: aucune boutique trouvée pour ce compte — profil users/{uid} recréé sans storeId. À compléter manuellement.')
  }
  await db.doc(`users/${uid}`).set({
    name: displayName,
    email,
    role: 'store_admin',
    active: true,
    storeId: storeId ?? null,
    storeName: resolvedStoreName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`OK — profil users/${uid} restauré`)
} else if (profile.active !== true) {
  await db.doc(`users/${uid}`).set({ active: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  console.log(`OK — profil users/${uid} réactivé (active=true)`)
}

if (store && store.adminUid !== uid) {
  await db.doc(`stores/${storeId}`).set({ adminUid: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  console.log(`OK — stores/${storeId}.adminUid corrigé`)
}

await db.collection('auditLogs').add({
  type: 'restore_deleted_account',
  email,
  uid,
  storeId: storeId ?? null,
  executedAt: FieldValue.serverTimestamp(),
}).catch(() => {})

const resetLink = await auth.generatePasswordResetLink(email)
console.log('\nCompte restauré. Transmets ce lien au propriétaire pour définir son mot de passe :')
console.log(resetLink)
