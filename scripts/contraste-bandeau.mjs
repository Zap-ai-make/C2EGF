/**
 * contraste-bandeau.mjs — mesure le contraste du texte du bandeau sur le fond
 * RÉELLEMENT rendu.
 *
 * Pourquoi un outil plutôt qu'un calcul : le fond du bandeau est une
 * photographie sous deux voiles dégradés. Le contraste dépend donc du pixel,
 * pas d'une couleur qu'on pourrait poser dans une formule. Le calcul à la main
 * donne un ordre de grandeur ; il ne donne pas le PIRE cas, qui est le seul qui
 * compte pour WCAG.
 *
 * Méthode : on monte le banc d'essai, on masque le contenu du bandeau — sinon
 * les bords anti-aliasés des lettres polluent l'échantillon —, on capture, et
 * on cherche le pixel de fond le plus clair sous l'emprise du texte. C'est là
 * que le blanc a le moins de contraste.
 *
 *   node scripts/contraste-bandeau.mjs [largeur]
 *
 * À relancer dès que change l'image, son cadrage, ou l'opacité des voiles de
 * `.bandeau-marque` (src/index.css) : les trois entrent dans le résultat.
 */
import { chromium } from 'playwright'

import { ouvrirBanc } from './lib/banc.mjs'

const largeur = Number(process.argv[2] || 1440)
const SEUIL_AA = 4.5

const { serveur, url } = await ouvrirBanc()

const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 600 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

// Emprise réelle du texte, relevée sur la page avant de le masquer.
const zones = await page.evaluate(() => {
  const bandeau = document.querySelector('.bandeau-marque')
  if (!bandeau) return null
  return [...bandeau.querySelectorAll('p')].map((el) => {
    const r = el.getBoundingClientRect()
    return {
      texte: el.textContent.trim().slice(0, 40),
      x: Math.floor(r.left),
      y: Math.floor(r.top),
      l: Math.ceil(r.width),
      h: Math.ceil(r.height),
    }
  })
})

if (!zones || zones.length === 0) {
  console.error('bandeau introuvable dans le banc d’essai')
  await navigateur.close()
  await serveur.close()
  process.exit(1)
}

await page.addStyleTag({ content: '.bandeau-marque > div { visibility: hidden; }' })
await page.waitForTimeout(200)
const capture = await page.screenshot()

const resultats = await page.evaluate(
  async ({ b64, zones }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    const ctx = c.getContext('2d')

    const canal = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    const lum = (r, g, b) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)

    return zones.map((z) => {
      const d = ctx.getImageData(z.x, z.y, z.l, z.h).data
      let pire = 0
      let pixel = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) {
        const L = lum(d[i], d[i + 1], d[i + 2])
        if (L > pire) {
          pire = L
          pixel = [d[i], d[i + 1], d[i + 2]]
        }
      }
      return { ...z, contraste: 1.05 / (pire + 0.05), pixel }
    })
  },
  { b64: capture.toString('base64'), zones }
)

await navigateur.close()
await serveur.close()

console.log(`bandeau de marque — fond réel, fenêtre de ${largeur} px\n`)
let echec = false
for (const r of resultats) {
  const ok = r.contraste >= SEUIL_AA
  if (!ok) echec = true
  console.log(`  « ${r.texte} »`)
  console.log(`     pixel de fond le plus clair : rgb(${r.pixel.join(', ')})`)
  console.log(`     contraste du blanc          : ${r.contraste.toFixed(2)}:1  ${ok ? 'AA ✓' : 'SOUS AA'}`)
}
process.exit(echec ? 1 : 0)
