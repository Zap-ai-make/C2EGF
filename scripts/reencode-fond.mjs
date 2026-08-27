/**
 * Ré-encodage du fond du bandeau : PNG 1280×800 (1,76 Mo) → JPEG 1920×540.
 * Passe par le chromium déjà installé pour la QA visuelle — aucun encodeur
 * ajouté au projet.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const source = process.argv[2]
const sortie = process.argv[3]
const L = Number(process.argv[4] || 1920)
const H = Number(process.argv[5] || 540)
const Q = Number(process.argv[6] || 0.82)
const FOCUS = Number(process.argv[7] || 0.5) // 0 = haut de l'image, 1 = bas

const b64 = readFileSync(source).toString('base64')
const navigateur = await chromium.launch()
const page = await navigateur.newPage()

const dataUrl = await page.evaluate(
  async ({ b64, L, H, Q, FOCUS }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()

    const canvas = document.createElement('canvas')
    canvas.width = L
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // Sémantique `cover` : on remplit, on rogne le débord, centré.
    const echelle = Math.max(L / img.width, H / img.height)
    const l = img.width * echelle
    const h = img.height * echelle
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (L - l) / 2, (H - h) * FOCUS, l, h)

    return canvas.toDataURL('image/jpeg', Q)
  },
  { b64, L, H, Q, FOCUS }
)

await navigateur.close()

const octets = Buffer.from(dataUrl.split(',')[1], 'base64')
writeFileSync(sortie, octets)

const avant = readFileSync(source).length
console.log(`${source} : ${avant.toLocaleString('fr-FR')} o`)
console.log(`${sortie} : ${octets.length.toLocaleString('fr-FR')} o  (${L}×${H}, qualité ${Q})`)
console.log(`gain : ${(100 - (octets.length / avant) * 100).toFixed(1)} %`)
