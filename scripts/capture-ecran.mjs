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
 *
 * Options d'interaction, appliquées dans cet ordre : `--champ=<sél> --valeur=<v>`
 * remplit un champ, `--clic=<sél>` clique — RÉPÉTABLE, dans l'ordre donné : un
 * écran d'arrivée se trouve souvent deux clics plus loin (vérifier, puis
 * confirmer). Le sélecteur et la valeur sont DEUX
 * drapeaux, et non un seul séparé par « = » : un sélecteur d'attribut en
 * contient déjà un, et le découpage tombait dessus en premier. Certains écrans ne s'atteignent PAS
 * autrement — un récapitulatif de confirmation, par exemple, n'existe qu'après
 * qu'un montant a été saisi et vérifié. Sans elles, le seul moyen de le
 * regarder serait d'ouvrir une porte dérobée dans le formulaire livré.
 */
import { chromium } from 'playwright'
import { ouvrirBanc } from './lib/banc.mjs'

const sortie = process.argv[2]
const selecteur = process.argv[3]
const largeur = Number(process.argv[4] || 1440)
const requete = process.argv[5] ? '?' + process.argv[5] : ''
// --clic=<sélecteur> : cliquer avant de capturer. Certains états ne sont
// atteignables que par une interaction — la bascule connexion/inscription, par
// exemple, vit dans l'état interne du composant.
const clics = process.argv.filter((a) => a.startsWith('--clic=')).map((a) => a.slice(7))
// --champ=<sélecteur> --valeur=<texte> : remplir un champ avant de cliquer.
const champ = (process.argv.find((a) => a.startsWith('--champ=')) || '').slice(8)
const valeur = (process.argv.find((a) => a.startsWith('--valeur=')) || '').slice(9)

const { serveur, url } = await ouvrirBanc()
const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } })
await page.goto(url + requete, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

if (champ) {
  await page.locator(champ).first().fill(valeur)
  await page.waitForTimeout(200)
}

for (const clic of clics) {
  await page.locator(clic).first().click()
  await page.waitForTimeout(600)
}

const el = page.locator(selecteur).first()
await el.scrollIntoViewIfNeeded()
await el.screenshot({ path: sortie, timeout: 60_000, animations: 'disabled' })

await navigateur.close()
await serveur.close()
console.log('capture : ' + sortie)
