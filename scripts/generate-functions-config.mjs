#!/usr/bin/env node
/**
 * generate-functions-config.mjs — régénère functions/src/config/dealerProfile.js
 * depuis le profil d'un client.
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(__dirname, '../functions/src/config/dealerProfile.js')

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
const generated = generateDealerProfileFile(profile)

const current = readFileSync(targetPath, 'utf8')
// Préserve la fin de ligne du fichier (CRLF sous Windows) pour un --check stable.
const eol = current.includes('\r\n') ? '\r\n' : '\n'
const next = generated.replace(/\n/g, eol)

if (check) {
  if (next !== current) {
    console.error(`Dérive : functions/src/config/dealerProfile.js ne correspond pas au profil "${clientId}". Régénérez sans --check.`)
    process.exit(1)
  }
  console.log(`OK — dealerProfile.js à jour pour le profil "${clientId}".`)
} else {
  writeFileSync(targetPath, next)
  console.log(`functions/src/config/dealerProfile.js régénéré pour le profil "${clientId}".`)
}
