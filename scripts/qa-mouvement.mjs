/**
 * qa-mouvement.mjs — la séquence d'arrivée ne laisse jamais l'interface abîmée.
 *
 * POURQUOI CETTE SONDE EXISTE.
 * Elle est née d'un défaut qu'elle aurait empêché. La séquence du bandeau
 * s'écrit en `.from()`, ce qui pose l'état de DÉPART sur les nœuds dès la
 * construction — la marque passe à `opacity: 0` avant que rien ne bouge. Le
 * démontage se contentait alors de `kill()`, qui arrête sans restaurer : le
 * style en ligne restait. React montant deux fois en développement, la seconde
 * séquence lisait cette valeur comme sa valeur d'ARRIVÉE et animait de 0 vers
 * 0. Le bandeau s'affichait sans son logo ni sa ligne de métier, DÉFINITIVEMENT.
 *
 * Ni les tests, ni le lint, ni la sonde de contraste ne le voyaient. Il fallait
 * regarder l'image. C'est ce que fait ce script, et il le fait sans yeux.
 *
 * CE QU'IL MESURE — une seule chose, et elle est exigeante :
 *
 *   l'état APRÈS la séquence doit être RIGOUREUSEMENT celui qu'obtient une
 *   personne ayant demandé le mouvement réduit, pour qui aucune animation
 *   n'est construite.
 *
 * Cette égalité est la formulation vérifiable de la règle du lot : le mouvement
 * est une COUCHE, jamais une condition d'affichage. Si le JavaScript échoue, si
 * l'écran se démonte au milieu, si React remonte — le bandeau retombe sur son
 * état statique. Comparer deux captures au hash près ne laisse aucune place à
 * l'appréciation : un pixel d'écart, et la couche a fui.
 *
 * Il vérifie de surcroît que le DOM est rendu : `SplitText` découpe le wordmark
 * en caractères le temps de la séquence, et l'application le recolle à la fin.
 * Un découpage qui survivrait signalerait une fuite de nœuds à chaque montage.
 */
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { ouvrirBanc } from './lib/banc.mjs'

const LARGEUR = Number(process.argv[2]) || 1440
const empreinte = (tampon) => createHash('sha256').update(tampon).digest('hex').slice(0, 16)

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
  const reference = await calme.locator('.bandeau-marque').screenshot()

  /** Le cas réel : la séquence se joue entièrement, puis on regarde. */
  const anime = await navigateur.newPage({ viewport: { width: LARGEUR, height: 700 } })
  await anime.goto(url, { waitUntil: 'networkidle' })
  // Confortablement au-delà de la durée de la séquence (1,05 s), pour que le
  // résultat ne dépende jamais de la charge de la machine.
  await anime.waitForTimeout(2500)
  const apres = await anime.locator('.bandeau-marque').screenshot()

  console.log(`\nbandeau de marque — fenêtre de ${LARGEUR} px`)
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

  const dom = await anime.evaluate(() => {
    const wordmark = document.querySelector('.bandeau-marque p')
    return {
      enfants: wordmark?.children.length ?? -1,
      texte: wordmark?.textContent?.trim() ?? '',
    }
  })

  if (dom.enfants === 0) {
    console.log(`  ✓ le wordmark est rendu d’un seul tenant — « ${dom.texte} »`)
  } else {
    echoue(
      `le découpage en caractères a survécu à la séquence (${dom.enfants} nœuds) : ` +
      'chaque montage en empilera un de plus'
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
