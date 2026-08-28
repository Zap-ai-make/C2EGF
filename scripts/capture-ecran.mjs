/**
 * capture-ecran.mjs — capture UN écran du banc d'essai, à l'échelle réelle.
 *
 * `npm run capture` prend la page entière : utile pour voir l'enchaînement,
 * illisible pour juger un écran. Celui-ci cadre sur un élément et le rend à sa
 * taille réelle — c'est là qu'on voit la densité, l'alignement et ce qui
 * déborde.
 *
 *   node scripts/capture-ecran.mjs <sortie.png> <sélecteur> [largeur] [requête]
 *
 * La requête est passée à l'URL du banc, qui l'utilise pour servir une variante
 * de données — par exemple l'état vide, qu'on ne verrait jamais autrement :
 *
 *   node scripts/capture-ecran.mjs vide.png '[data-testid="store-dealer-requests"]' 1100 demandes=vide
 */
import { chromium } from 'playwright'
import { ouvrirBanc } from './lib/banc.mjs'

const sortie = process.argv[2]
const selecteur = process.argv[3]
const largeur = Number(process.argv[4] || 1440)
const requete = process.argv[5] ? '?' + process.argv[5] : ''

const { serveur, url } = await ouvrirBanc()
const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } })
await page.goto(url + requete, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const el = page.locator(selecteur).first()
await el.scrollIntoViewIfNeeded()
await el.screenshot({ path: sortie, timeout: 60_000, animations: 'disabled' })

await navigateur.close()
await serveur.close()
console.log('capture : ' + sortie)
