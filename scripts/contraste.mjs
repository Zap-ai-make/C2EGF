/**
 * contraste.mjs — contraste du texte blanc sur les fonds PHOTOGRAPHIQUES.
 *
 *   node scripts/contraste.mjs [largeur]     (défaut 1440)
 *
 * Deux surfaces de l'application posent du texte blanc sur une photographie
 * voilée : le bandeau de marque et le panneau d'accueil de l'authentification.
 * Sur ces deux-là, le contraste ne se calcule pas — il dépend du pixel, et le
 * seul chiffre qui compte est le PIRE : le pixel de fond le plus clair sous
 * l'emprise du texte.
 *
 * Méthode : on monte le banc, on relève l'emprise réelle de chaque ligne de
 * texte, on masque ce texte — sinon les bords anti-aliasés des lettres polluent
 * l'échantillon —, on capture, et on cherche le maximum de luminance dans
 * chaque rectangle.
 *
 * À relancer dès que change l'image, son cadrage, ou l'opacité d'un voile.
 * Sort en code 1 si une ligne passe sous AA.
 */
import { chromium } from 'playwright'

import { ouvrirBanc } from './lib/banc.mjs'

const largeur = Number(process.argv[2] || 1440)
const SEUIL_AA = 4.5

// Les surfaces à mesurer : leur sélecteur, et le sélecteur du texte à l'intérieur.
const SURFACES = [
  { nom: 'bandeau de marque', racine: '.bandeau-marque', texte: 'p' },
  { nom: "panneau d'authentification", racine: '.panneau-auth', texte: 'h2, p, button' },
]

const { serveur, url } = await ouvrirBanc()
const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const zones = await page.evaluate((SURFACES) => {
  const out = []
  for (const s of SURFACES) {
    const racine = document.querySelector(s.racine)
    if (!racine) continue
    for (const el of racine.querySelectorAll(s.texte)) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      // Coordonnées de PAGE, pas de fenêtre : la capture est pleine hauteur,
      // et ces surfaces ne tiennent pas toutes dans une seule fenêtre. Avec des
      // coordonnées de fenêtre, on échantillonnait du vide — et du vide se lit
      // rgb(0, 0, 0), soit un contraste parfait de 21:1. Une mesure fausse qui
      // annonce la réussite est pire que pas de mesure du tout.
      out.push({
        surface: s.nom,
        texte: el.textContent.trim().slice(0, 42),
        x: Math.floor(r.left + window.scrollX),
        y: Math.floor(r.top + window.scrollY),
        l: Math.ceil(r.width),
        h: Math.ceil(r.height),
      })
    }
  }
  return out
}, SURFACES)

if (zones.length === 0) {
  console.error('aucune surface photographique trouvée dans le banc')
  await navigateur.close()
  await serveur.close()
  process.exit(1)
}

await page.addStyleTag({
  content: SURFACES.map((s) => `${s.racine} ${s.texte} { visibility: hidden; }`).join('\n'),
})
await page.waitForTimeout(200)
const capture = await page.screenshot({ fullPage: true, timeout: 120_000, animations: 'disabled' })

const resultats = await page.evaluate(
  async ({ b64, zones }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)

    const canal = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    const lum = (r, g, b) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)

    return zones.map((z) => {
      if (z.x + z.l > c.width || z.y + z.h > c.height) {
        return { ...z, hors: true, contraste: 0, pixel: [0, 0, 0] }
      }
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

let echec = false
let surfaceCourante = null
for (const r of resultats) {
  if (r.surface !== surfaceCourante) {
    surfaceCourante = r.surface
    console.log(`\n${r.surface} — fond réel, fenêtre de ${largeur} px`)
  }
  if (r.hors) {
    echec = true
    console.log(`  « ${r.texte} »`)
    console.log('     HORS DE LA CAPTURE — zone non mesurée, résultat invalide')
    continue
  }
  const ok = r.contraste >= SEUIL_AA
  if (!ok) echec = true
  console.log(`  « ${r.texte} »`)
  console.log(`     fond le plus clair : rgb(${r.pixel.join(', ')})  →  ${r.contraste.toFixed(2)}:1  ${ok ? 'AA ✓' : 'SOUS AA ✗'}`)
}
process.exit(echec ? 1 : 0)
