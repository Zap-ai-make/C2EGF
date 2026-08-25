#!/usr/bin/env node
/**
 * generate-rules.mjs — régénère le bloc « PROFIL-GÉNÉRÉ » de firestore.rules depuis
 * le profil d'un client.
 *
 *   node scripts/generate-rules.mjs --client c2egf_burkina          # régénère le bloc
 *   node scripts/generate-rules.mjs --client c2egf_burkina --check  # échoue si dérive (CI)
 *
 * Ne touche QUE la région entre les marqueurs PROFIL-GÉNÉRÉ ; le reste des règles est
 * écrit à la main. Comportement-préservant : pour un profil dont dealer.networks vaut
 * ['Orange'], la sortie est équivalente aux règles historiques (data.network == 'Orange').
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveProfile } from '../config/clients/index.js'
import {
  generateProfileRulesBlock,
  RULES_BLOCK_START,
  RULES_BLOCK_END,
} from './lib/generateRulesBlock.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rulesPath = resolve(__dirname, '../firestore.rules')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const clientId = argValue('--client')
const check = process.argv.includes('--check')

if (!clientId) {
  console.error('Usage : node scripts/generate-rules.mjs --client <id> [--check]')
  process.exit(2)
}

const profile = resolveProfile(clientId)
const block = generateProfileRulesBlock(profile)

const current = readFileSync(rulesPath, 'utf8')

// Remplacement ligne à ligne (préserve la fin de ligne du fichier : CRLF sous Windows,
// LF sinon), pour que --check soit stable quel que soit le checkout git.
const eol = current.includes('\r\n') ? '\r\n' : '\n'
const lines = current.split(/\r?\n/)
const startLine = lines.findIndex((l) => l.includes(RULES_BLOCK_START))
const endLine = lines.findIndex((l) => l.includes(RULES_BLOCK_END))
if (startLine === -1 || endLine === -1 || endLine < startLine) {
  console.error('Marqueurs PROFIL-GÉNÉRÉ absents (ou dans le désordre) dans firestore.rules — insérez-les d\'abord.')
  process.exit(1)
}

const nextLines = [...lines.slice(0, startLine), ...block.split('\n'), ...lines.slice(endLine + 1)]
const next = nextLines.join(eol)

if (check) {
  if (next !== current) {
    console.error(`Dérive : firestore.rules ne correspond pas au profil "${clientId}". Régénérez sans --check.`)
    process.exit(1)
  }
  console.log(`OK — firestore.rules à jour pour le profil "${clientId}".`)
} else {
  writeFileSync(rulesPath, next)
  console.log(`firestore.rules régénéré pour le profil "${clientId}".`)
}
