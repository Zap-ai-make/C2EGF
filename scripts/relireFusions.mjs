/**
 * relireFusions.mjs — relire les noms que la fusion a réécrits. LECTURE SEULE.
 *
 * POURQUOI CE SCRIPT EXISTE
 * ─────────────────────────
 * `fusionnerClients.mjs` reporte sur la survivante le nom le plus complet de la
 * grappe : le plus de mots, puis la chaîne la plus longue. C'est ce qui sauve les
 * annotations (« INTERDIT », « PAS DE DEPOT »).
 *
 * ⚠ MAIS CE CRITÈRE NE TRANCHE PAS TOUT. Quand deux orthographes ont le même
 *   nombre de mots ET la même longueur — « OUEDRAOGO BOUKARY » contre
 *   « OUEDRAOGO BOUKARE » —, le choix se fait par identifiant Firestore, donc
 *   SANS AUCUN FONDEMENT MÉTIER. Le commerce est bien le même (c'est le code
 *   agent qui l'a dit), mais l'orthographe retenue est arbitraire.
 *
 *   Ce script sépare les deux cas : les reports JUSTIFIÉS (le nom retenu en dit
 *   strictement plus) et les reports ARBITRAIRES (deux écritures équivalentes,
 *   départagées par un identifiant technique). Seuls les seconds demandent une
 *   relecture — et la boutique est la seule à savoir comment ses clients
 *   s'appellent.
 *
 * Usage :
 *   node scripts/relireFusions.mjs [--csv <fichier>] [--tous]
 *
 *   --csv    écrit le détail, pour corriger sur pièces
 *   --tous   affiche aussi les reports justifiés (par défaut : les arbitraires)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile, writeFile } from 'node:fs/promises'
import { resolveResetProject } from './lib/assertResetProject.mjs'
import { echouerAvecAide } from './lib/aideIdentifiants.mjs'
import { plier, motsDe, annotationsDansLeNom } from './lib/doublonsClients.mjs'

const argv = process.argv.slice(2)
const option = (nom) => {
  const i = argv.indexOf(nom)
  return i >= 0 ? argv[i + 1] : undefined
}
const fichierCsv = option('--csv')
const tous = argv.includes('--tous')

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
let serviceAccount = null
if (serviceAccountPath) {
  try {
    serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  } catch (error) {
    echouerAvecAide(`Identifiants illisibles :\n  ${serviceAccountPath}\n  (${error.message})`)
  }
} else if (!process.env.GCLOUD_PROJECT) {
  echouerAvecAide('Ni GOOGLE_APPLICATION_CREDENTIALS ni GCLOUD_PROJECT ne sont définis.')
}

let projectId
let isProduction
try {
  ;({ projectId, isProduction } = resolveResetProject({
    serviceAccount,
    envProjectId: process.env.GCLOUD_PROJECT,
    execute: false,
  }))
} catch (error) {
  echouerAvecAide(`Identifiants refusés : ${error.message}`)
}

if (!isProduction && !projectId.startsWith('demo-')) {
  echouerAvecAide(`Projet refusé : « ${projectId} ». Ce script ne lit que ce dépôt ou un demo-*.`)
}

initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
const db = getFirestore()

const nombre = (n) => Number(n).toLocaleString('fr-FR')
console.log(`Projet : ${projectId}${isProduction ? '  (PRODUCTION — LECTURE SEULE)' : ''}`)

// ⚠ DEUX SOURCES POUR LA LISTE DES BOUTIQUES, ET IL EN FAUT DEUX.
//   Se fier à la seule collection `stores` rendrait invisibles les journaux
//   d'une boutique qui n'y figure pas — et un rapport qui annonce « aucun nom
//   réécrit » parce qu'il a cherché au mauvais endroit est pire qu'une erreur :
//   il rassure. Les fiches portent leur `registeredStoreId`, on prend l'union.
const stores = await db.collection('stores').get()
const fiches = await db.collection('globalClients').get()
const storeIds = [...new Set([
  ...stores.docs.map((d) => d.id),
  ...fiches.docs.map((d) => d.data().registeredStoreId).filter(Boolean),
])]

const fusions = []
for (const storeId of storeIds) {
  const journaux = await db.collection(`clients/${storeId}/auditLogs`)
    .where('action', '==', 'CLIENT_MERGED')
    .get()
  for (const doc of journaux.docs) fusions.push({ storeId, id: doc.id, ...doc.data() })
}

console.log(`${nombre(fusions.length)} fusion(s) journalisée(s) dans ${nombre(storeIds.length)} boutique(s).`)

/**
 * Un report est JUSTIFIÉ quand le nom retenu en dit strictement plus : plus de
 * mots, ou la même composition en plus long. Sinon il est ARBITRAIRE — deux
 * écritures équivalentes qu'un identifiant technique a départagées.
 */
const classer = (avant, apres) => {
  const motsAvant = motsDe({ nom: avant }).size
  const motsApres = motsDe({ nom: apres }).size
  if (motsApres > motsAvant) return 'justifie'
  if (plier(avant).length < plier(apres).length) return 'justifie'
  return 'arbitraire'
}

const reports = fusions
  .filter((f) => f.nomApres && f.nomAvant && f.nomApres !== f.nomAvant)
  .map((f) => ({ ...f, verdict: classer(f.nomAvant, f.nomApres) }))

const arbitraires = reports.filter((r) => r.verdict === 'arbitraire')
const justifies = reports.filter((r) => r.verdict === 'justifie')

console.log('')
console.log(`${nombre(reports.length)} nom(s) réécrit(s) :`)
console.log(`  ${nombre(justifies.length)} report(s) JUSTIFIÉ(S)   — le nom retenu en dit plus`)
console.log(`  ${nombre(arbitraires.length)} report(s) ARBITRAIRE(S) — deux orthographes équivalentes`)

const afficher = (titre, liste) => {
  if (liste.length === 0) return
  console.log('')
  console.log(titre)
  console.log('─'.repeat(titre.length))
  for (const r of liste) {
    console.log(`  ${r.nomAvant}`)
    console.log(`    → ${r.nomApres}   (${r.survivanteId})`)
  }
}

// ⚠ LE LOT D NE RÉÉCRIT AUCUN NOM — IL EN FAIT DISPARAÎTRE UN.
//   Son journal porte `nomApres: null`, donc il ne passe pas par `classer` : il
//   n'y a pas d'orthographe à départager. Mais c'est le seul lot où un nom
//   ÉTRANGER à celui qui reste a été abandonné, et c'est justement ce qu'il faut
//   pouvoir relire. Le taire ici reviendrait à dire « aucun nom touché » alors
//   que des noms ont été perdus — l'erreur rassurante que ce script existe pour
//   éviter.
const abandons = fusions
  .filter((f) => Array.isArray(f.nomsAbandonnes) && f.nomsAbandonnes.length > 0)
  .flatMap((f) => f.nomsAbandonnes.map((perdu) => ({ ...f, perdu })))

if (abandons.length > 0) {
  console.log('')
  console.log(`${nombre(abandons.length)} nom(s) ABANDONNÉ(S) par le lot D (grappes aux noms sans rapport) :`)
  console.log('')
  console.log('Nom gardé  ←  nom abandonné')
  console.log('─'.repeat(27))
  for (const a of abandons) {
    console.log(`  ${a.nomAvant}  ←  ${a.perdu}   (${a.survivanteId})`)
  }
  console.log('')
  console.log('La fiche abandonnée est dans la sauvegarde de sa fusion, avec son nom.')
}

// ⚠ LA SEULE PERTE DE CE CHANTIER QUI PUISSE COÛTER DE L'ARGENT.
//
//   Un nom abandonné n'est en général qu'un nom. Mais la boutique écrit ses
//   consignes DANS le nom — « PLUS DE DEPOT A CREDIT », « INTERDI DG » — et le
//   lot D, par construction, ne reporte aucun nom sur la survivante : si la
//   consigne était du côté de la fiche supprimée, elle est partie avec.
//
//   Un client interdit redevient alors un client ordinaire, sans trace et sans
//   compteur pour le dire. C'est la seule chose de toute cette fusion qui se
//   découvre au guichet plutôt que dans un rapport — donc le rapport doit la
//   chercher lui-même, au lieu d'attendre qu'on relise 179 lignes à l'œil.
const perdusAvecConsigne = abandons
  .map((a) => ({ ...a, racines: annotationsDansLeNom(a.perdu) }))
  .filter((a) => a.racines.length > 0 && annotationsDansLeNom(a.nomAvant).length === 0)

if (perdusAvecConsigne.length > 0) {
  const t = 'À CORRIGER À LA MAIN : une consigne de gestion est partie avec la fiche'
  console.log('')
  console.log(t)
  console.log('─'.repeat(t.length))
  for (const a of perdusAvecConsigne) {
    console.log(`  ${a.perdu}`)
    console.log(`    la fiche qui reste s'appelle « ${a.nomAvant} » (${a.survivanteId})`)
    console.log(`    mot(s) repéré(s) : ${a.racines.join(', ')}`)
  }
  console.log('')
  console.log('Rouvrir ces fiches dans l’application et remettre la mention dans le nom.')
} else if (abandons.length > 0) {
  console.log('')
  console.log('Aucune consigne de gestion (interdit, pas de depot, …) parmi les noms abandonnés.')
}

afficher('À RELIRE : l\'orthographe retenue est arbitraire', arbitraires)
if (tous) afficher('Reports justifiés (le nom retenu en dit plus)', justifies)
else if (justifies.length > 0) {
  console.log('')
  console.log(`(${nombre(justifies.length)} report(s) justifié(s) masqué(s) — relancer avec --tous pour les voir.)`)
}

if (fichierCsv) {
  const csv = (v) => String(v ?? '').replace(/[;\r\n]/g, ' ')
  const lignes = ['verdict;boutique;survivanteId;nomAvant;nomApres;identifiantAgent;perdantes;sauvegarde']
  for (const r of reports) {
    lignes.push([
      r.verdict, csv(r.storeId), csv(r.survivanteId), csv(r.nomAvant), csv(r.nomApres),
      csv(r.identifiantAgent), csv((r.perdantesIds ?? []).join(' ')), csv(r.sauvegarde),
    ].join(';'))
  }
  // BOM : sans lui, Excel ouvre les accents en charabia.
  await writeFile(fichierCsv, '﻿' + lignes.join('\r\n'), 'utf8')
  console.log('')
  console.log(`Détail écrit dans ${fichierCsv} (${nombre(lignes.length - 1)} ligne(s)).`)
}

console.log('')
console.log('Aucune écriture. Pour corriger un nom, le modifier dans l\'application :')
console.log('la fiche existe toujours, c\'est son libellé qui a changé.')
