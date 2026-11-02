/**
 * firebaseEmulateurs.mjs — `firebase <arguments>` avec un délai de découverte
 * des functions de 120 s.
 *
 * Pourquoi : l'émulateur Functions laisse 10 s au code pour se charger. Sur un
 * poste chargé, `firebase-admin` et `firebase-functions` n'y suffisent pas :
 * aucune fonction n'est chargée, `emulators:exec` lance quand même les tests, et
 * tous reçoivent `functions/not-found` (audit QUA-09, 40 échecs sur 40). C'est
 * le piège des dix secondes de `docs/deployer-les-functions.md`, côté tests.
 *
 * `FUNCTIONS_DISCOVERY_TIMEOUT` est la seule soupape de firebase-tools, et
 * c'est une variable d'environnement, en SECONDES. Ce script la pose sans
 * dépendance de plus ; une valeur déjà donnée par la personne est gardée.
 *
 * La commande passe par le shell : `firebase` est un `.cmd` sous Windows. Un
 * argument qui contient des espaces (la commande vitest) est donc remis entre
 * guillemets, ce que cmd et sh comprennent tous deux.
 */
import { spawnSync } from 'node:child_process'

const argumentsFirebase = process.argv.slice(2)
if (argumentsFirebase.some((argument) => argument.includes('"'))) {
  console.error('firebaseEmulateurs.mjs : un argument contient un guillemet, il ne peut pas être transmis tel quel.')
  process.exit(1)
}

const citer = (argument) => (/\s/.test(argument) ? `"${argument}"` : argument)
const execution = spawnSync(['firebase', ...argumentsFirebase.map(citer)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '120' },
})

if (execution.error) {
  console.error(`firebaseEmulateurs.mjs : ${execution.error.message}`)
  process.exit(1)
}
process.exit(execution.status ?? 1)
