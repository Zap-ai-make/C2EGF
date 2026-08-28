/**
 * deborde.mjs — la page déborde-t-elle horizontalement, et par la faute de qui ?
 *
 *   node scripts/deborde.mjs [largeur]   (défaut 390)
 *
 * Un débordement horizontal ne se voit pas sur une capture pleine page : celle-ci
 * s'élargit pour tout contenir, et l'image paraît normale. Il faut le mesurer.
 *
 * MÉTHODE — extinction dichotomique. On éteint un sous-arbre, on relit la largeur
 * défilante du document : ce qui la fait retomber est le coupable. On répète en
 * descendant, jusqu'à la feuille fautive.
 *
 * Une première version raisonnait « par ascendance » : un élément large dont un
 * ancêtre défile est contenu, donc innocent. Ce raisonnement est faux, et il a
 * laissé passer le cas réel. Un élément en `position: absolute` sans ancêtre
 * positionné a pour bloc conteneur la PAGE : il échappe au cadre défilant de son
 * ancêtre. C'est exactement ce que fait `sr-only` de Tailwind — un texte
 * invisible d'un pixel, posé dans un `<th>` d'un tableau large, élargissait la
 * page de 645 px. L'extinction, elle, ne raisonne pas : elle mesure.
 *
 * Sort en code 1 si la page déborde : utilisable comme garde-fou.
 */
import { chromium } from 'playwright'

import { ouvrirBanc } from './lib/banc.mjs'

const largeur = Number(process.argv[2] || 390)

const { serveur, url } = await ouvrirBanc()
const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const rapport = await page.evaluate((largeur) => {
  const defilante = () => document.documentElement.scrollWidth
  const decrire = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 90),
    position: getComputedStyle(el).position,
    overflowX: getComputedStyle(el).overflowX,
    droite: Math.round(el.getBoundingClientRect().right),
    largeur: Math.round(el.getBoundingClientRect().width),
    texte: (el.textContent || '').trim().slice(0, 45),
  })

  const chemin = []
  let courant = document.body
  let garde = 0

  while (garde++ < 60) {
    let coupable = null
    for (const enfant of [...courant.children]) {
      const avant = enfant.style.display
      enfant.style.display = 'none'
      const apres = defilante()
      enfant.style.display = avant
      // Éteindre cet enfant ramène la page dans la fenêtre : c'est lui.
      if (apres <= largeur + 1) {
        coupable = enfant
        break
      }
    }
    if (!coupable) break
    chemin.push(decrire(coupable))
    courant = coupable
  }

  return { scrollWidth: defilante(), viewport: largeur, chemin }
}, largeur)

await navigateur.close()
await serveur.close()

const deborde = rapport.scrollWidth > rapport.viewport + 1
console.log(`fenêtre ${largeur} px — document.scrollWidth = ${rapport.scrollWidth}`)

if (!deborde) {
  console.log('la page tient dans la fenêtre')
  process.exit(0)
}

console.log(`débordement de ${rapport.scrollWidth - largeur} px\n`)
console.log('chemin jusqu’au coupable (le dernier est la feuille fautive) :')
for (const n of rapport.chemin) {
  console.log(`  <${n.tag}> droite=${n.droite} largeur=${n.largeur} position=${n.position} overflowX=${n.overflowX}`)
  if (n.cls) console.log(`     class : ${n.cls}`)
  if (n.texte) console.log(`     texte : ${n.texte}`)
}
process.exit(1)
