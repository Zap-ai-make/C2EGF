import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const signatures = [
  { name: 'clé privée', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'compte de service Google', pattern: /"type"\s*:\s*"service_account"/ },
  { name: 'jeton GitHub', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'clé AWS', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'jeton Slack', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
]

const listed = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
if (listed.status !== 0) {
  console.error(listed.stderr || 'Impossible de lister les fichiers suivis par Git.')
  process.exit(1)
}

const findings = []
for (const path of listed.stdout.split('\0').filter(Boolean)) {
  let stats
  try {
    stats = statSync(path)
  } catch {
    continue
  }
  if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) continue

  const buffer = readFileSync(path)
  if (buffer.includes(0)) continue
  const text = buffer.toString('utf8')
  for (const signature of signatures) {
    if (signature.pattern.test(text)) findings.push(`${path}: ${signature.name}`)
  }
}

if (findings.length > 0) {
  console.error(`Secrets potentiels détectés dans des fichiers suivis :\n${findings.join('\n')}`)
  process.exit(1)
}

console.log('Aucune signature de secret à haute confiance dans les fichiers suivis.')
