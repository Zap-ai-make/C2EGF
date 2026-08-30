#!/usr/bin/env node
/**
 * generate-functions-config.mjs — régénère les configs functions dérivées du profil
 * d'un client : functions/src/config/dealerProfile.js (axe dealer) et
 * functions/src/config/storeProfile.js (axes boutique).
 *
 *   node scripts/generate-functions-config.mjs --client c2egf_burkina          # régénère
 *   node scripts/generate-functions-config.mjs --client c2egf_burkina --check  # échoue si dérive (CI)
 *
 * À lancer au déploiement, en tandem avec scripts/generate-rules.mjs, pour aligner
 * les 3 couches (front, règles, functions) sur le même profil client.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveProfile } from '../config/clients/index.js'
import { generateDealerProfileFile } from './lib/generateDealerProfile.mjs'
import { generateStoreProfileFile } from './lib/generateStoreProfile.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Chaque cible : le fichier généré + le générateur pur qui en produit le contenu.
const TARGETS = [
  {
    label: 'functions/src/config/dealerProfile.js',
    path: resolve(__dirname, '../functions/src/config/dealerProfile.js'),
    generate: generateDealerProfileFile,
  },
  {
    label: 'functions/src/config/storeProfile.js',
    path: resolve(__dirname, '../functions/src/config/storeProfile.js'),
    generate: generateStoreProfileFile,
  },
]

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const clientId = argValue('--client')
const check = process.argv.includes('--check')

if (!clientId) {
  console.error('Usage : node scripts/generate-functions-config.mjs --client <id> [--check]')
  process.exit(2)
}

const profile = resolveProfile(clientId)

// En --check on veut le rapport COMPLET des dérives, pas seulement la première :
// sinon on régénère, on relance, et on découvre la suivante.
let drifted = false

for (const target of TARGETS) {
  const generated = target.generate(profile)
  const current = readFileSync(target.path, 'utf8')
  // Préserve la fin de ligne du fichier (CRLF sous Windows) pour un --check stable.
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  const next = generated.replace(/\n/g, eol)

  if (check) {
    if (next !== current) {
      console.error(`Dérive : ${target.label} ne correspond pas au profil "${clientId}". Régénérez sans --check.`)
      drifted = true
    } else {
      console.log(`OK — ${target.label} à jour pour le profil "${clientId}".`)
    }
  } else {
    writeFileSync(target.path, next)
    console.log(`${target.label} régénéré pour le profil "${clientId}".`)
  }
}

if (check && drifted) process.exit(1)
