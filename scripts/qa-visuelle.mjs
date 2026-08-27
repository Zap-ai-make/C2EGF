/**
 * capture.mjs — boucle de QA visuelle (DESIGN.md §14).
 *
 * Lance un serveur Vite éphémère sur le banc d'essai (`preview.html`), prend
 * une capture pleine page, puis s'arrête. Sert à REGARDER le rendu réel, ce
 * que ni jsdom ni une base vide ne permettent.
 *
 *   node scripts/capture.mjs [chemin-de-sortie] [largeur]
 */

import { createServer } from 'vite'
import { chromium } from 'playwright'

const sortie = process.argv[2] || 'capture.png'
const largeur = Number(process.argv[3] || 1440)

const serveur = await createServer({
  server: { port: 0 },
  logLevel: 'error',
})
await serveur.listen()

const { port } = serveur.httpServer.address()
const url = `http://localhost:${port}/preview.html`

const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 1000 } })

const erreurs = []
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
page.on('pageerror', (e) => erreurs.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
// Recharts mesure ses conteneurs après le montage : on lui laisse une frame.
await page.waitForTimeout(2500)
await page.screenshot({ path: sortie, fullPage: true })

await navigateur.close()
await serveur.close()

console.log(`capture : ${sortie} (largeur ${largeur})`)
if (erreurs.length) {
  console.log(`\n${erreurs.length} erreur(s) console :`)
  for (const e of erreurs.slice(0, 10)) console.log('  ' + e)
} else {
  console.log('aucune erreur console')
}
