/**
 * tc-109 — la séquence d'arrivée du bandeau.
 *
 * Ce test ne juge pas de quoi l'animation a l'air : une capture le fait mieux
 * (`npm run capture`), et le banc Remotion mieux encore, image par image. Il
 * fige les quatre PROPRIÉTÉS dont dépend le reste du produit, et qu'aucun coup
 * d'œil ne peut vérifier :
 *
 *   1. la timeline ne se joue jamais d'elle-même — sans quoi le banc Remotion
 *      ne pourrait pas la scruter, et le mouvement réduit ne pourrait pas
 *      l'empêcher ;
 *   2. le nom accessible survit au découpage — c'est la SEULE justification du
 *      poids de GSAP dans ce produit ;
 *   3. `nettoyer()` rend le DOM d'origine — sans quoi chaque montage empile un
 *      découpage de plus ;
 *   4. un nœud manquant ne lève pas — un décor qui casse l'écran serait pire
 *      que pas de décor.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  construireTimelineBandeau,
  DUREE_BANDEAU,
} from '../../src/motion/bandeau.js'

const NOM = 'C2EGF BURKINA'
const METIER = 'Distribution mobile money · Burkina Faso'

let monte = null

/** Un bandeau réduit à ses trois nœuds, dans le DOM — SplitText y écrit. */
function poserBandeau() {
  const racine = document.createElement('div')
  racine.innerHTML = `
    <img data-motion="pastille" alt="" aria-hidden="true" />
    <p data-motion="wordmark">${NOM}</p>
    <p data-motion="metier">${METIER}</p>
  `
  document.body.append(racine)
  monte = racine
  return {
    racine,
    pastille: racine.querySelector('[data-motion="pastille"]'),
    wordmark: racine.querySelector('[data-motion="wordmark"]'),
    metier: racine.querySelector('[data-motion="metier"]'),
  }
}

afterEach(() => {
  monte?.remove()
  monte = null
})

describe('tc-109 — séquence d’arrivée du bandeau', () => {
  it('rend une timeline EN PAUSE, qui ne démarre pas seule', () => {
    const { racine } = poserBandeau()
    const { timeline, nettoyer } = construireTimelineBandeau({ racine })

    expect(timeline.paused()).toBe(true)
    expect(timeline.progress()).toBe(0)
    nettoyer()
  })

  it('tient dans le budget annoncé', () => {
    const { racine } = poserBandeau()
    const { timeline, nettoyer } = construireTimelineBandeau({ racine })

    // `DUREE_BANDEAU` est un PLAFOND, pas une mesure recopiée depuis les tweens
    // — recopiée, elle divergerait au premier réglage de décalage. Le banc
    // Remotion en déduit son nombre d'images : une séquence qui déborde serait
    // coupée en fin de vidéo, et on validerait un mouvement amputé.
    expect(timeline.duration()).toBeLessThanOrEqual(DUREE_BANDEAU)

    // Et pas trop en dessous : un budget qu'on cesse d'occuper est un budget
    // qu'on a oublié de mettre à jour.
    expect(timeline.duration()).toBeGreaterThan(DUREE_BANDEAU - 0.25)

    nettoyer()
  })

  it('préserve le nom accessible malgré le découpage en caractères', () => {
    const { racine, wordmark } = poserBandeau()
    const { nettoyer } = construireTimelineBandeau({ racine })

    // D'ABORD : le découpage a bien eu lieu. Sans cette vérification, le test
    // passerait aussi le jour où SplitText échouerait en silence — un texte
    // jamais découpé garde évidemment son nom accessible. Un test qui réussit
    // pour la mauvaise raison est pire que pas de test.
    expect(wordmark.children.length).toBeGreaterThan(1)

    // ENSUITE seulement : le mot entier reste annoncé d'un bloc, et les
    // fragments sortent de l'arbre d'accessibilité. C'est très exactement ce
    // qu'on achète en ajoutant GSAP à ce produit — sans quoi un lecteur
    // d'écran épellerait « C 2 E G F ».
    expect(wordmark.getAttribute('aria-label')).toBe(NOM)
    for (const fragment of wordmark.children) {
      expect(fragment.getAttribute('aria-hidden')).toBe('true')
    }

    nettoyer()
  })

  it('rend le texte d’un seul tenant une fois les lettres posées', () => {
    const { racine, wordmark } = poserBandeau()
    const avant = wordmark.innerHTML

    const { timeline, restaurerTexte, nettoyer } = construireTimelineBandeau({ racine })
    expect(wordmark.children.length).toBeGreaterThan(1)

    // Ce que l'application branche sur `onComplete` : le découpage ne sert que
    // pendant la séquence. Après, le DOM final est RIGOUREUSEMENT le DOM
    // statique — pas seulement quelque chose qui lui ressemble.
    timeline.progress(1)
    restaurerTexte()

    expect(wordmark.innerHTML).toBe(avant)
    nettoyer()
  })

  it('rend le DOM d’origine au nettoyage', () => {
    const { racine, wordmark } = poserBandeau()
    const avant = wordmark.innerHTML

    const { nettoyer } = construireTimelineBandeau({ racine })
    nettoyer()

    expect(wordmark.innerHTML).toBe(avant)
    expect(wordmark.textContent.trim()).toBe(NOM)
  })

  it('laisse les nœuds dans leur état naturel à la fin', () => {
    const { racine, pastille, metier } = poserBandeau()
    const { timeline, nettoyer } = construireTimelineBandeau({ racine })

    timeline.progress(1)

    // L'exigence : l'état final EST l'état statique. Tout est écrit en
    // `.from()`, donc rien n'est masqué ni décalé une fois la séquence finie.
    expect(Number(pastille.style.opacity || 1)).toBe(1)
    expect(Number(metier.style.opacity || 1)).toBe(1)

    nettoyer()
  })

  /**
   * LA RÉGRESSION QUI A COÛTÉ LE LOGO.
   *
   * `.from()` écrit l'état de DÉPART dès la construction : la marque passe à
   * `opacity: 0` avant même que la séquence démarre. Si l'on se contente ensuite
   * de `kill()`, GSAP arrête la course mais NE RESTAURE RIEN — le style en ligne
   * `opacity: 0` reste sur le nœud.
   *
   * Or React monte deux fois en développement (`StrictMode`, dans `main.jsx` et
   * `preview.jsx`). Au second montage, un nouveau `.from()` lit la valeur
   * COURANTE comme valeur d'arrivée : elle vaut 0. Il anime donc de 0 vers 0, et
   * la marque comme la ligne de métier disparaissent DÉFINITIVEMENT.
   *
   * Le bandeau s'affichait sans son logo ni sa ligne de métier, et ni les 2 098
   * tests ni le lint ne le voyaient : il fallait regarder la capture. Ce test
   * est le filet qui manquait — il vaut pour tout démontage en cours de
   * séquence, pas seulement pour StrictMode.
   */
  it('restitue les styles si la séquence est interrompue, et repart sain au montage suivant', () => {
    const { racine, pastille, metier } = poserBandeau()

    const premiere = construireTimelineBandeau({ racine })
    premiere.timeline.progress(0.1)
    premiere.nettoyer()

    // Rien ne doit subsister : sinon le montage suivant prendrait
    // l'invisibilité pour l'état naturel des nœuds.
    expect(pastille.style.opacity).toBe('')
    expect(metier.style.opacity).toBe('')

    const seconde = construireTimelineBandeau({ racine })
    seconde.timeline.progress(1)

    expect(Number(pastille.style.opacity || 1)).toBe(1)
    expect(Number(metier.style.opacity || 1)).toBe(1)
    seconde.nettoyer()
  })

  it('ne lève pas quand un nœud manque', () => {
    expect(() => construireTimelineBandeau({}).nettoyer()).not.toThrow()
    expect(() => construireTimelineBandeau().nettoyer()).not.toThrow()
  })
})
