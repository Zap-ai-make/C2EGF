#!/usr/bin/env node
/**
 * seedEmulateurs.mjs — un jeu d'essai pour développer sur les émulateurs.
 *
 * Usage : `npm run emulateurs` le lance de lui-même au démarrage. À la main,
 * émulateurs déjà lancés : npm run emulateurs:seed.
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * Les émulateurs démarrent vides : sans compte, personne ne se connecte, et le
 * développement retombait sur la production — 15 679 lectures facturées à chaque
 * chargement de la base clients (docs/rester-dans-le-quota-gratuit.md §E1).
 *
 * Ce que le jeu pose : un patron, LE dealer (un seul actif, invariant
 * d'AGENTS.md), deux boutiques avec leurs soldes Orange, une douzaine de
 * clients fictifs. Deux boutiques, parce que les règles se vérifient à deux.
 *
 * ⚠ ÉMULATEUR UNIQUEMENT, SANS ÉCHAPPATOIRE. `lib/adminApp.mjs` refuse tout
 *   projet qui ne commence pas par `demo-` et bloque `c2egf-b0b5a` en absolu.
 *   Les valeurs par défaut posées ci-dessous visent 127.0.0.1 : une variable
 *   déjà définie l'emporte, mais doit elle aussi viser la machine locale.
 *
 * ⚠ LE MOT DE PASSE N'EST PAS UN SECRET. Il n'ouvre que l'émulateur Auth de ce
 *   poste ; aucun de ces comptes n'existe en production. SEED_MOT_DE_PASSE
 *   permet d'en choisir un autre.
 *
 * Rejouable : chaque compte, chaque document est repris par son identifiant ou
 * son e-mail, jamais dupliqué.
 */

const DEFAUTS = {
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  GCLOUD_PROJECT: 'demo-c2egf-local',
  // Sans identifiants, le SDK Admin cherche le serveur de métadonnées de Google
  // Cloud, attend son délai, puis avertit. L'émulateur n'en a pas besoin.
  METADATA_SERVER_DETECTION: 'none',
}
for (const [nom, valeur] of Object.entries(DEFAUTS)) {
  if (!process.env[nom]) process.env[nom] = valeur
}
for (const nom of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[nom])) {
    console.error(`[SÉCURITÉ] ${nom}=${process.env[nom]} ne vise pas la machine locale.`)
    process.exit(1)
  }
}

const MOT_DE_PASSE = process.env.SEED_MOT_DE_PASSE || 'essai-local'

let admin
try {
  admin = await import('./lib/adminApp.mjs')
} catch (err) {
  console.error(`\n${err.message}`)
  process.exit(1)
}
const { auth, db, projectId, closeAdminApp } = admin
const { FieldValue } = await import('firebase-admin/firestore')
const maintenant = FieldValue.serverTimestamp()

async function compte(email, nom) {
  try {
    const existant = await auth.getUserByEmail(email)
    await auth.updateUser(existant.uid, { password: MOT_DE_PASSE, displayName: nom, disabled: false })
    return existant.uid
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err
    const cree = await auth.createUser({ email, password: MOT_DE_PASSE, displayName: nom })
    return cree.uid
  }
}

async function profilGlobal({ email, nom, role }) {
  const uid = await compte(email, nom)
  await db.doc(`users/${uid}`).set(
    { name: nom, email, role, active: true, lastLogin: null, createdAt: maintenant },
    { merge: true },
  )
  return { email, role, uid }
}

async function boutique({ id, nom, email, stock, liquidite }) {
  const uid = await compte(email, nom)
  await db.doc(`stores/${id}`).set(
    { name: nom, email, active: true, adminUid: uid, createdAt: maintenant, updatedAt: maintenant },
    { merge: true },
  )
  await db.doc(`users/${uid}`).set(
    { name: nom, email, role: 'store_admin', active: true, storeId: id, storeName: nom, lastLogin: null, createdAt: maintenant },
    { merge: true },
  )
  await db.doc(`clients/${id}/networkBalances/current`).set(
    { balances: { Orange: { stock, liquidite } }, updatedAt: maintenant },
    { merge: true },
  )
  return { email, role: 'store_admin', uid, id, nom }
}

// Clients fictifs. Codes agent à 7 chiffres, numéros agent à 8 : la règle de
// src/utils/agentFields.js. Quelques numéros absents, comme en vrai (97 % des
// fiches de production n'en ont pas).
const CLIENTS = [
  ['SAWADOGO', 'Awa', '1000001', '70000001', 'Ouagadougou'],
  ['OUEDRAOGO', 'Issouf', '1000002', null, 'Ouagadougou'],
  ['KABORE', 'Mariam', '1000003', '70000003', 'Koudougou'],
  ['ZONGO', 'Paul', '1000004', null, 'Ouagadougou'],
  ['TRAORE', 'Fatimata', '1000005', null, 'Bobo-Dioulasso'],
  ['COMPAORE', 'Didier', '1000006', '70000006', 'Ouagadougou'],
  ['NIKIEMA', 'Salif', '1000007', null, 'Ziniaré'],
  ['ILBOUDO', 'Rasmata', '1000008', null, 'Ouagadougou'],
  ['YAMEOGO', 'Jean', '1000009', '70000009', 'Koudougou'],
  ['BAMBARA', 'Aminata', '1000010', null, 'Ouahigouya'],
  ['KONATE', 'Moussa', '1000011', null, 'Bobo-Dioulasso'],
  ['TIENDREBEOGO', 'Alice', '1000012', '70000012', 'Ouagadougou'],
]

async function clients(boutiques) {
  const dateAjout = new Date().toLocaleDateString('fr-FR')
  await Promise.all(CLIENTS.map(([nom, prenom, codeAgent, numeroAgent, localite], i) => {
    const b = boutiques[i % boutiques.length]
    const id = `essai-client-${String(i + 1).padStart(2, '0')}`
    return db.doc(`globalClients/${id}`).set({
      nom, prenom, codeAgent, localite,
      ...(numeroAgent ? { numeroAgent } : {}),
      registeredStoreId: b.id,
      registeredStoreName: b.nom,
      dateAjout,
      createdAt: maintenant,
      updatedAt: maintenant,
    }, { merge: true })
  }))
}

try {
  const comptes = [
    await profilGlobal({ email: 'patron@c2egf.test', nom: 'Patron (essai)', role: 'system_manager' }),
    await profilGlobal({ email: 'dealer@c2egf.test', nom: 'Dealer Orange (essai)', role: 'dealer' }),
  ]
  const boutiques = [
    await boutique({ id: 'boutique-essai-1', nom: "Boutique d'essai 1", email: 'boutique1@c2egf.test', stock: 500000, liquidite: 300000 }),
    await boutique({ id: 'boutique-essai-2', nom: "Boutique d'essai 2", email: 'boutique2@c2egf.test', stock: 250000, liquidite: 150000 }),
  ]
  await clients(boutiques)

  console.log(`\nJeu d'essai posé sur ${projectId} (émulateurs).`)
  console.log(`Mot de passe de tous les comptes : ${MOT_DE_PASSE}\n`)
  for (const c of [...comptes, ...boutiques]) {
    console.log(`  ${c.role.padEnd(15)} ${c.email}${c.id ? `  → ${c.id}` : ''}`)
  }
  console.log(`  ${CLIENTS.length} clients répartis entre les deux boutiques.\n`)
} catch (err) {
  console.error(`\nÉchec du jeu d'essai : ${err.message}`)
  console.error('Les émulateurs tournent-ils ? (npm run emulateurs)')
  process.exitCode = 1
} finally {
  await closeAdminApp()
}
