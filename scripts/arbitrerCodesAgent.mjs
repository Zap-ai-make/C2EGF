/**
 * arbitrerCodesAgent.mjs — les codes agent portés par plusieurs noms. LECTURE SEULE.
 *
 * CE SCRIPT N'ÉCRIT RIEN, et ce n'est pas une précaution : c'est le fond du
 * sujet. Quand « SAWADOGO HAMIDOU » et « BELEM WENDKUNI » partagent un
 * identifiant agent, deux histoires sont possibles et elles appellent des gestes
 * opposés — un code mal saisi qu'il faut corriger, ou un commerce qui a changé
 * de main et dont les deux fiches sont légitimes. Aucune règle ne les sépare,
 * donc aucune fusion ne peut se décider ici. Ces 171 grappes ont été écartées
 * des trois lots de `fusionnerClients.mjs`, et elles le restent.
 *
 * CE QU'IL APPORTE : LE TEMPS
 * ───────────────────────────
 * Un changement de main produit deux périodes d'activité QUI SE SUIVENT. Un code
 * mal saisi produit deux périodes QUI SE CHEVAUCHENT : deux noms opérant le même
 * jour sous le même identifiant, ce qu'un commerce unique ne fait pas.
 *
 * La décision reste celle de la boutique. Elle cesse d'être aveugle.
 *
 * Usage :
 *   node scripts/arbitrerCodesAgent.mjs [--csv <fichier>] [--situation <clé>]
 *
 *   --csv        écrit le dossier complet, une ligne par fiche
 *   --situation  n'affiche qu'une situation, et alors en ENTIER : muette,
 *                une-seule-active, chevauchement, succession, dates-manquantes
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile, writeFile } from 'node:fs/promises'
import { resolveResetProject } from './lib/assertResetProject.mjs'
import { echouerAvecAide } from './lib/aideIdentifiants.mjs'
import { grapperPar, REGLES } from './lib/doublonsClients.mjs'
import { planifierFusion } from './lib/fusionClients.mjs'
import { arbitrerGrappes, SITUATIONS } from './lib/arbitrageCodesAgent.mjs'

const argv = process.argv.slice(2)
const option = (nom) => {
  const i = argv.indexOf(nom)
  return i >= 0 ? argv[i + 1] : undefined
}
const fichierCsv = option('--csv')
const situationVoulue = option('--situation')

// `echouer` reste pour ce qui ne concerne PAS les identifiants : afficher
// l'aide d'authentification sous une faute de frappe dans `--situation`
// noierait le vrai message.
const echouer = (message) => {
  console.error('')
  console.error(message)
  process.exit(1)
}

const clesValides = Object.values(SITUATIONS).map((s) => s.cle)
if (situationVoulue && !clesValides.includes(situationVoulue)) {
  echouer(`Situation inconnue : « ${situationVoulue} ».\nAttendu : ${clesValides.join(', ')}.`)
}

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

// Ce script énumère la base clients et sait l'écrire en CSV : un projet
// étranger est refusé, pas seulement signalé. Lecture seule ne veut pas dire
// sans conséquence.
if (!isProduction && !projectId.startsWith('demo-')) {
  echouerAvecAide(`Projet refusé : « ${projectId} ». Ce script ne lit que ce dépôt ou un demo-*.`)
}

initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
const db = getFirestore()

const nombre = (n) => Number(n).toLocaleString('fr-FR')
const titre = (texte) => {
  console.log('')
  console.log(texte)
  console.log('─'.repeat(texte.length))
}
const jour = (ms) => (ms === null || ms === undefined
  ? '—'
  : new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Africa/Ouagadougou' }))

console.log(`Projet : ${projectId}${isProduction ? '  (PRODUCTION — LECTURE SEULE)' : ''}`)

// ── Lecture ─────────────────────────────────────────────────────────────────
const snap = await db.collection('globalClients').get()
const fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
const storeIds = [...new Set(fiches.map((f) => f.registeredStoreId).filter(Boolean))]

const operations = []
for (const storeId of storeIds) {
  for (const collection of ['history', 'drafts']) {
    const lot = await db.collection(`clients/${storeId}/${collection}`).get()
    for (const doc of lot.docs) {
      const donnees = doc.data()
      operations.push({ chemin: doc.ref.path, clientId: donnees.clientId ?? null, createdAt: donnees.createdAt })
    }
  }
}
const collabs = await db.collection('storeCollaborations').get()
for (const doc of collabs.docs) {
  const donnees = doc.data()
  operations.push({ chemin: doc.ref.path, clientId: donnees.clientId ?? null, createdAt: donnees.createdAt })
}

console.log(`Lu     : ${nombre(fiches.length)} fiche(s), ${nombre(operations.length)} référence(s)`)

const operationsParClient = new Map()
for (const operation of operations) {
  if (!operation.clientId) continue
  if (!operationsParClient.has(operation.clientId)) operationsParClient.set(operation.clientId, [])
  operationsParClient.get(operation.clientId).push(operation)
}

// ── Les grappes que la fusion a écartées, et elles seules ───────────────────
//
// ⚠ ON REPREND EXACTEMENT LE TRI DE `planifierFusion`. Recalculer ici « les
//   grappes à noms divergents » avec un critère maison ferait apparaître des
//   grappes que la fusion a déjà traitées, ou en cacherait d'autres — et le
//   dossier ne correspondrait plus à l'état réel de la base.
const regleAgent = REGLES.find((r) => r.cle === 'agent')
const { grappes } = grapperPar(regleAgent, fiches)
const plan = planifierFusion(grappes, operationsParClient)

const aArbitrer = plan.ecartees
  .filter((e) => e.membres.length >= 2)
  .map((e) => ({ cle: e.cle, membres: e.membres }))

const intrusesSeules = plan.ecartees.filter((e) => e.membres.length === 1)

titre('LES CODES AGENT PORTÉS PAR PLUSIEURS NOMS')
console.log(`${nombre(aArbitrer.length)} grappe(s) où un même identifiant agent porte des noms sans rapport.`)
if (intrusesSeules.length > 0) {
  console.log(`${nombre(intrusesSeules.length)} fiche(s) isolée(s) restée(s) seule(s) après une scission —`)
  console.log('leur grappe a déjà été fusionnée en partie, il n\'y a plus de conflit.')
}

const arbitrage = arbitrerGrappes(aArbitrer, operationsParClient)

titre('CE QUE LE TEMPS EN DIT')
console.log('Un commerce qui change de main produit deux périodes qui SE SUIVENT.')
console.log('Un code mal saisi produit deux périodes qui SE CHEVAUCHENT : deux noms')
console.log('opérant le même jour sous un même identifiant, ce qu\'un seul commerce')
console.log('ne fait pas. C\'est cette lecture-là, et rien de plus.')
console.log('')
for (const situation of Object.values(SITUATIONS)) {
  const liste = arbitrage.parSituation.get(situation.cle)
  console.log(`  ${String(liste.length).padStart(5)}  ${situation.titre}`)
}

// ⚠ UN TÉLÉPHONE PARTAGÉ N'EST PAS UNE PREUVE D'IDENTITÉ.
//   Première version de ce bloc : « l'homonymie est exclue ». Faux, et la
//   production l'a montré aussitôt — « ZIDA KASSOUM » et « KINDA ADJARA » sur un
//   même numéro, « BADO BRIGITTE » et « AGENCE ORODARA » aussi. Un téléphone
//   commun, c'est un couple, des associés, une agence et sa gérante.
//
//   Le signal ne vaut que CROISÉ avec l'écart : partager un numéro ET porter
//   presque le même nom, c'est convaincant ; partager un numéro seul, non.
const avecTelephone = arbitrage.situees.filter((s) => s.telephonePartage)
if (avecTelephone.length > 0) {
  const proches = avecTelephone.filter((s) => s.ecart <= 0.3)
  console.log('')
  console.log(`${nombre(avecTelephone.length)} de ces grappes partagent AUSSI un téléphone, dont ${nombre(proches.length)} au nom proche.`)
  console.log('Un téléphone commun ne prouve rien à lui seul — un couple, des associés et')
  console.log('une agence avec sa gérante le partagent aussi. CROISÉ avec un nom presque')
  console.log('identique, en revanche, il ne laisse guère de doute.')
  for (const grappe of avecTelephone.slice(0, 8)) {
    const marque = grappe.ecart <= 0.3 ? '  ← nom proche' : ''
    const noms = grappe.fiches.map((f) => f.libelle).join(' · ')
    console.log(`    tél. ${grappe.telephonePartage}  ${String(Math.round(grappe.ecart * 100)).padStart(3)} %  ${noms}${marque}`)
  }
  if (avecTelephone.length > 8) {
    console.log(`    … et ${nombre(avecTelephone.length - 8)} autre(s).`)
  }
}

// ⚠ POURQUOI DES DOUBLONS CONTINUENT D'APPARAÎTRE APRÈS CHAQUE NETTOYAGE.
//   Le garde-fou de la saisie refuse un identifiant agent déjà pris, mais il
//   filtre sur `registeredStoreId` : il ne regarde que la boutique courante. Le
//   même agent enregistré au siège puis dans une agence passe donc sans rien
//   déclencher. Si la ligne ci-dessous est élevée, nettoyer la liste est un
//   travail sans fin — c'est la saisie qu'il faut corriger d'abord.
const interBoutiques = arbitrage.situees.filter((s) => s.interBoutiques)
console.log('')
console.log(`${nombre(interBoutiques.length)} grappe(s) sur ${nombre(arbitrage.total)} s'étendent sur PLUSIEURS boutiques.`)
if (interBoutiques.length > 0) {
  console.log('Le garde-fou de la saisie ne regarde que la boutique courante : ces')
  console.log('fiches-là ont été créées sans qu\'il puisse les refuser.')
  for (const grappe of interBoutiques.slice(0, 4)) {
    console.log(`    ${grappe.boutiques.join(' / ')}  —  ${grappe.fiches.map((f) => f.libelle).join(' · ')}`)
  }
  if (interBoutiques.length > 4) console.log(`    … et ${nombre(interBoutiques.length - 4)} autre(s).`)
}

// ── Le détail, situation par situation ──────────────────────────────────────
for (const situation of Object.values(SITUATIONS)) {
  if (situationVoulue && situation.cle !== situationVoulue) continue
  const liste = arbitrage.parSituation.get(situation.cle)
  if (liste.length === 0) continue

  titre(`${situation.titre.toUpperCase()} — ${nombre(liste.length)} grappe(s)`)
  console.log(situation.lecture)
  console.log('')

  const combien = situationVoulue ? liste.length : Math.min(liste.length, 8)
  for (const grappe of liste.slice(0, combien)) {
    // L'écart orthographique en tête de grappe : c'est lui qui dit s'il s'agit
    // du même nom saisi deux fois ou de deux noms différents, et les grappes
    // sont rangées du plus ressemblant au plus douteux.
    const pct = Math.round(grappe.ecart * 100)
    const verdict = pct <= 30 ? 'MÊME NOM, deux orthographes' : 'noms distincts'
    console.log(`  ${grappe.cle}   écart ${String(pct).padStart(3)} %  — ${verdict}`)
    for (const fiche of grappe.fiches) {
      const p = fiche.periode
      const activite = p
        ? `${String(p.nombre).padStart(4)} op.  du ${jour(p.debut)} au ${jour(p.fin)}`
        : '   0 op.'
      const tel = fiche.telephone ? `  tél. ${fiche.telephone}` : ''
      console.log(`      ${activite}  ${fiche.libelle}${tel}`)
    }
  }
  if (combien < liste.length) {
    console.log(`  … et ${nombre(liste.length - combien)} autre(s) — « --situation ${situation.cle} » les affiche toutes.`)
  }
}

// ── Le dossier complet ──────────────────────────────────────────────────────
if (fichierCsv) {
  const csv = (v) => String(v ?? '').replace(/[;\r\n]/g, ' ')
  const lignes = [
    'situation;ecartPourCent;identifiantAgent;clientId;nom;telephone;operations;premiere;derniere;decision',
  ]
  for (const situation of Object.values(SITUATIONS)) {
    for (const grappe of arbitrage.parSituation.get(situation.cle)) {
      for (const fiche of grappe.fiches) {
        lignes.push([
          situation.cle, Math.round(grappe.ecart * 100),
          csv(grappe.cle), csv(fiche.id), csv(fiche.libelle), csv(fiche.telephone),
          fiche.periode?.nombre ?? 0,
          fiche.periode ? jour(fiche.periode.debut) : '',
          fiche.periode ? jour(fiche.periode.fin) : '',
          // Colonne laissée VIDE exprès : c'est la boutique qui la remplit.
          // Y mettre une suggestion ferait d'une lecture un verdict.
          '',
        ].join(';'))
      }
    }
  }
  // BOM : sans lui, Excel ouvre les accents en charabia.
  await writeFile(fichierCsv, '﻿' + lignes.join('\r\n'), 'utf8')
  console.log('')
  console.log(`Dossier écrit dans ${fichierCsv} (${nombre(lignes.length - 1)} ligne(s)).`)
  console.log('La colonne « decision » est vide : c\'est celle que la boutique remplit.')
}

titre('CE QUE CE SCRIPT N\'A PAS FAIT')
console.log('Aucune écriture. Aucune fiche fusionnée, supprimée ni modifiée.')
console.log('')
console.log('Pour corriger un code agent, le modifier dans l\'application : la fiche')
console.log('existe, c\'est son identifiant qui est faux. Une fois les codes séparés,')
console.log('ces grappes disparaissent d\'elles-mêmes du rapport.')
