#!/usr/bin/env node
/**
 * emulateursDev.mjs — les trois émulateurs du développement, jeu d'essai posé.
 *
 * Usage : npm run emulateurs   (Ctrl+C pour arrêter), puis npm run dev à côté.
 *
 * Démarre auth, firestore et functions sur `demo-c2egf-local` — le projet que
 * vise le `.env` en mode émulateurs —, attend qu'Auth et Firestore répondent,
 * puis lance `seedEmulateurs.mjs`. Les comptes d'essai existent donc dès que
 * l'écran de connexion s'ouvre.
 *
 * ⚠ RIEN N'EST SAUVÉ À L'ARRÊT, ET C'EST VOULU. Firebase écrit son export dans
 *   un dossier temporaire à la racine du dépôt, puis le renomme. Tant que
 *   `npm run dev` tourne, la surveillance de fichiers de Vite tient ce dossier
 *   et Windows refuse le renommage (EPERM) ; l'export raté laisse en plus un
 *   `firebase-export-*` à la racine. Constaté le 2026-11-04 : quatre échecs
 *   avec Vite lancé, un succès sans lui. Or on développe Vite lancé. Le jeu
 *   d'essai étant rejouable, le reposer à chaque démarrage ne dépend de rien.
 *
 * La découverte des functions passe par `firebaseEmulateurs.mjs`, qui lui
 * laisse 120 s au lieu de 10 (docs/deployer-les-functions.md §2).
 */
import { spawn } from 'node:child_process'

const PROJET = process.env.GCLOUD_PROJECT || 'demo-c2egf-local'
const HUB = 'http://127.0.0.1:4400/emulators'

if (!PROJET.startsWith('demo-')) {
  console.error(`[SÉCURITÉ] Le projet « ${PROJET} » ne commence pas par demo-.`)
  process.exit(1)
}

const emulateurs = spawn(process.execPath, [
  'scripts/firebaseEmulateurs.mjs',
  'emulators:start', '--only', 'auth,firestore,functions', '--project', PROJET,
], { stdio: 'inherit' })

// Ctrl+C atteint aussi les émulateurs : on les laisse s'arrêter proprement au
// lieu de quitter avant eux.
process.on('SIGINT', () => {})
emulateurs.on('exit', (code) => process.exit(code ?? 0))

async function attendreAuthEtFirestore() {
  for (let seconde = 0; seconde < 180; seconde += 1) {
    try {
      const reponse = await fetch(HUB)
      if (reponse.ok) {
        const actifs = await reponse.json()
        if (actifs.auth && actifs.firestore) return true
      }
    } catch { /* le hub n'écoute pas encore */ }
    await new Promise((resoudre) => setTimeout(resoudre, 1000))
  }
  return false
}

if (await attendreAuthEtFirestore()) {
  spawn(process.execPath, ['scripts/seedEmulateurs.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, GCLOUD_PROJECT: PROJET },
  })
} else {
  console.error("\nLes émulateurs n'ont pas répondu en 3 minutes : jeu d'essai non posé.")
  console.error("Une fois prêts : npm run emulateurs:seed")
}
