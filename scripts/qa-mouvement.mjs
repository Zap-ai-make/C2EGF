/**
 * qa-mouvement.mjs — l'arrivée du bandeau ne laisse jamais l'interface abîmée.
 *
 * POURQUOI CETTE SONDE EXISTE.
 * Elle est née d'un défaut qu'elle aurait empêché. Une version antérieure de la
 * séquence, écrite avec GSAP, posait l'état de DÉPART sur les nœuds dès sa
 * construction — la marque passait à `opacity: 0` avant que rien ne bouge — et
 * le démontage ne restaurait pas ce style en ligne. React montant deux fois en
 * développement, la seconde séquence lisait cette valeur comme sa valeur
 * D'ARRIVÉE : le bandeau s'affichait sans son logo, DÉFINITIVEMENT.
 *
 * Ni les tests, ni le lint, ni la sonde de contraste ne le voyaient. Il fallait
 * regarder l'image. C'est ce que fait ce script, et il le fait sans yeux.
 *
 * L'animation est depuis passée en CSS pur, ce qui rend cette classe de défaut
 * beaucoup moins probable — une `@keyframes` ne laisse rien derrière elle. La
 * sonde reste : c'est elle qui a mesuré, sur la version précédente, que des
 * montants devenaient plus flous après la séquence qu'avant (un `transform`
 * résiduel promeut le nœud en couche composée et change l'anticrénelage du
 * texte). Le défaut était invisible à l'œil et parfaitement mesurable.
 *
 * CE QU'ELLE MESURE — une seule chose, et elle est exigeante :
 *
 *   l'état APRÈS la séquence doit être RIGOUREUSEMENT celui qu'obtient une
 *   personne ayant demandé le mouvement réduit, pour qui aucune animation ne
 *   se joue.
 *
 * Cette égalité est la formulation vérifiable de la règle du lot : le mouvement
 * est une COUCHE, jamais une condition d'affichage. Comparer deux captures au
 * hash près ne laisse aucune place à l'appréciation — un pixel d'écart, et la
 * couche a fui.
 *
 * Elle vérifie de surcroît que le nom reste ANNONÇABLE : le wordmark est
 * découpé en lettres pour être animé, et un découpage mal fait transforme un
 * nom de marque en suite de caractères pour tout ce qui lit la page.
 */
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { ouvrirBanc } from './lib/banc.mjs'

const LARGEUR = Number(process.argv[2]) || 1440
const empreinte = (tampon) => createHash('sha256').update(tampon).digest('hex').slice(0, 16)

/**
 * La zone d'arrivée. Plus large que le seul bandeau, à dessein : une capture
 * trop serrée ne verrait pas un voisin laissé décalé par la séquence, et c'est
 * précisément la classe de défaut qui a coûté le logo.
 */
const capturerBarre = (page) =>
  page.screenshot({ clip: { x: 0, y: 0, width: LARGEUR, height: 420 } })

const { serveur, url } = await ouvrirBanc()
const navigateur = await chromium.launch()

let echecs = 0
const echoue = (message) => { echecs += 1; console.error(`  ✗ ${message}`) }

try {
  /** La référence : aucune animation n'est construite, l'état est d'emblée final. */
  const calme = await navigateur.newPage({
    viewport: { width: LARGEUR, height: 700 },
    reducedMotion: 'reduce',
  })
  await calme.goto(url, { waitUntil: 'networkidle' })
  await calme.waitForTimeout(800)
  const reference = await capturerBarre(calme)

  /** Le cas réel : la séquence se joue entièrement, puis on regarde. */
  const anime = await navigateur.newPage({ viewport: { width: LARGEUR, height: 700 } })
  await anime.goto(url, { waitUntil: 'networkidle' })
  // Confortablement au-delà de la séquence (1,5 s de bout en bout), pour que le
  // résultat ne dépende jamais de la charge de la machine.
  await anime.waitForTimeout(2500)
  const apres = await capturerBarre(anime)

  console.log(`\nbarre d'arrivée — fenêtre de ${LARGEUR} px`)
  console.log(`  mouvement réduit : ${empreinte(reference)}`)
  console.log(`  après séquence   : ${empreinte(apres)}`)

  if (empreinte(reference) === empreinte(apres)) {
    console.log('  ✓ la séquence atterrit exactement sur l’état statique')
  } else {
    echoue(
      'la séquence NE retombe PAS sur l’état statique — un style posé par ' +
      'l’animation survit à sa fin, ou un nœud reste masqué'
    )
  }

  // LE NOM RESTE-T-IL LISIBLE D'UN BLOC ?
  // Le wordmark est découpé en lettres pour être animé. Le texte doit malgré
  // tout rester entier dans le DOM — c'est ce qui fait fonctionner la recherche
  // dans la page et la sélection — et le lecteur d'écran doit annoncer le nom,
  // pas l'épeler. Le découpage étant déclaratif, il ne peut plus « survivre »
  // à quoi que ce soit ; ce qu'on vérifie ici, c'est qu'il reste ANNONÇABLE.
  const dom = await anime.evaluate(() => {
    const wordmark = document.querySelector('.bandeau-marque p')
    return {
      texte: wordmark?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      nomAccessible: wordmark?.getAttribute('aria-label') ?? '',
    }
  })

  if (dom.nomAccessible && dom.nomAccessible === dom.texte) {
    console.log(`  ✓ le nom reste lisible d’un bloc — « ${dom.nomAccessible} »`)
  } else {
    echoue(
      `le nom annoncé (« ${dom.nomAccessible} ») ne correspond pas au texte rendu ` +
      `(« ${dom.texte} ») : un lecteur d’écran épellerait le wordmark`
    )
  }
} finally {
  await navigateur.close()
  await serveur.close()
}

if (echecs > 0) {
  console.error(`\n${echecs} contrôle(s) en échec.\n`)
  process.exit(1)
}
console.log('')
