/**
 * capture.mjs — boucle de QA visuelle (DESIGN.md §14).
 *
 * Lance un serveur Vite éphémère sur le banc d'essai (`preview.html`), prend
 * une capture pleine page, puis s'arrête. Sert à REGARDER le rendu réel, ce
 * que ni jsdom ni une base vide ne permettent.
 *
 *   node scripts/capture.mjs [chemin-de-sortie] [largeur]
 */

import { chromium } from 'playwright'

import { ouvrirBanc } from './lib/banc.mjs'

const sortie = process.argv[2] || 'capture.png'
const largeur = Number(process.argv[3] || 1440)

const { serveur, url } = await ouvrirBanc()

const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 1000 } })

const erreurs = []
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
page.on('pageerror', (e) => erreurs.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
// Recharts mesure ses conteneurs après le montage : on lui laisse une frame.
await page.waitForTimeout(2500)
// `fullPage` attend que les polices soient prêtes, et la page du banc est
// devenue longue : le délai par défaut de 30 s n'y suffit plus.
await page.screenshot({ path: sortie, fullPage: true, timeout: 120_000, animations: 'disabled' })

await navigateur.close()
await serveur.close()

console.log(`capture : ${sortie} (largeur ${largeur})`)
if (erreurs.length) {
  console.log(`\n${erreurs.length} erreur(s) console :`)
  for (const e of erreurs.slice(0, 10)) console.log('  ' + e)
} else {
  console.log('aucune erreur console')
}
