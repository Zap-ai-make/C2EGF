import gsap from 'gsap'
import { construireTimelineBandeau } from './bandeau.js'

/**
 * L'ARRIVÉE — l'assemblage du plan de travail, en un seul mouvement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE SÉQUENCE REMPLACE L'ANIMATION DU SEUL TITRE
 *
 * La première version animait le bandeau, et rien d'autre. Le reproche du
 * client était juste : ce n'était ni marquant, ni exceptionnel. La cause n'était
 * pas le réglage, elle était de cadrage — un bandeau de 220 px qui QUITTE
 * L'ÉCRAN dès qu'on travaille ne peut pas porter la signature d'un produit. On
 * peaufinait la finition d'un objet trop petit pour ce qu'on lui demandait.
 *
 * Et surtout : on animait la mauvaise chose. Ce qu'un distributeur vient
 * chercher en ouvrant l'application, ce n'est pas son nom de marque, c'est
 * « combien de float me reste-t-il, puis-je ravitailler l'agent suivant ? »
 * (REFONTE.md §1). Le centre du produit, ce sont LES SOLDES.
 *
 * D'où le déplacement : ce n'est plus un effet sur un titre, c'est un moment —
 * le plan de travail s'assemble, et il se termine sur la donnée qu'on est venu
 * lire. Le mouvement cesse d'être une décoration pour devenir un compte rendu
 * de l'état du système.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX PHASES, PARCE QUE LA DONNÉE N'EST PAS LÀ AU DÉPART
 *
 * Les soldes viennent de Firestore : ils n'existent pas au montage. Une timeline
 * unique construite d'un coup serait donc un mensonge — elle prétendrait
 * connaître des chiffres qu'on n'a pas encore.
 *
 *   • PHASE 1, ici : le châssis s'assemble. Bandeau, navigation, cartes. Tout
 *     ce qui est utile est à l'écran en moins d'une seconde ; le travail
 *     typographique du nom se termine après, en garniture, sans rien retenir.
 *   • PHASE 2, dans `NetworkCard` : chaque montant se résout quand SA donnée
 *     arrive (voir `useMontantAnime`).
 *
 * La séquence se termine donc quand le réseau a répondu. C'est le contraire
 * d'une décoration : la durée dit quelque chose de vrai.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ORDRE SERT L'USAGE, PAS LA MISE EN SCÈNE
 *
 * La navigation arrive à 0,15 s et les cartes à 0,3 s — avant que le nom ait
 * fini de se composer. C'est délibéré : faire attendre l'outil pendant qu'un
 * titre se met en place serait joli une fois et pénible les quatre suivantes de
 * la journée (DESIGN.md §9). Le spectacle ne retarde jamais l'usage.
 */

/**
 * BUDGET de la phase 1, en secondes — un plafond, pas une mesure (cf.
 * `DUREE_BANDEAU`). tc-110 vérifie que la chorégraphie tient dedans.
 */
export const DUREE_ARRIVEE = 1.6

const NAVIGATION = '[data-motion="navigation"]'
const CARTE = '[data-motion="carte-solde"]'
const BANDEAU = '[data-motion="bandeau"]'

/**
 * Construit la phase 1, EN PAUSE.
 *
 * @param {Element|null} racine — n'importe quel ancêtre des nœuds animés. Les
 *   trois zones sont FACULTATIVES et repérées par `data-motion` : montée seule
 *   (banc d'essai), la bande de marque s'anime sans navigation ni cartes ;
 *   montée dans le shell, les trois s'enchaînent. Une seule chorégraphie, pas
 *   deux versions à tenir d'accord.
 * @param {gsap.core.Timeline} [timeline] — timeline à peupler plutôt qu'à créer.
 */
export function construireTimelineArrivee({ racine, timeline } = {}) {
  const tl = timeline ?? gsap.timeline({ paused: true })
  const ACCELERATION = 'power3.out'

  /**
   * ON EFFACE LE STYLE EN LIGNE À L'ARRIVÉE, et ce n'est pas de la coquetterie.
   *
   * Un `transform` laissé sur un nœud — fût-il `translate(0, 0)` — promeut ce
   * nœud en COUCHE COMPOSÉE, et le navigateur bascule alors l'anticrénelage du
   * texte du sous-pixel vers le niveau de gris. Les montants des cartes
   * restaient donc légèrement plus flous APRÈS la séquence qu'avant elle.
   *
   * Le défaut était invisible à l'œil et parfaitement mesurable : la sonde
   * `npm run mouvement`, une fois étendue à toute la barre, a relevé 2 582
   * pixels d'écart, jusqu'à 95 niveaux, exactement sur la ligne des chiffres.
   *
   * Elle ne le voyait pas tant qu'elle ne regardait que le bandeau. Élargir la
   * mesure a suffi à faire apparaître un défaut vieux du lot précédent.
   */
  const PROPRIETES = 'transform,opacity'

  // Le bandeau garde sa chorégraphie propre — elle est déjà écrite, testée, et
  // scrutée par le banc. On l'ajoute à CETTE timeline plutôt que d'en créer une
  // seconde qui vivrait en parallèle : c'est exactement ce que le paramètre
  // `timeline` a été conçu pour permettre.
  const sequenceBandeau = construireTimelineBandeau({
    racine: racine?.querySelector(BANDEAU) ?? racine,
    timeline: tl,
  })

  const navigation = racine?.querySelector(NAVIGATION) ?? null
  const cartes = racine ? [...racine.querySelectorAll(CARTE)] : []

  // LA NAVIGATION arrive tôt, et de peu : c'est l'outil. Elle descend de 10 px,
  // pas davantage — une barre qui traverse l'écran attirerait l'œil sur un
  // élément qu'on veut justement voir se fondre dans l'habitude.
  if (navigation) {
    tl.from(
      navigation,
      { duration: 0.45, opacity: 0, y: -10, ease: ACCELERATION, clearProps: PROPRIETES },
      0.15
    )
  }

  // LES CARTES DE SOLDE se posent. Le décalage les fait arriver l'une après
  // l'autre, dans l'ordre du réseau — elles ne surgissent pas ensemble, elles
  // se rangent. Leurs montants, eux, attendent la donnée : phase 2.
  if (cartes.length) {
    tl.from(
      cartes,
      {
        duration: 0.5,
        opacity: 0,
        y: 12,
        ease: ACCELERATION,
        stagger: { each: 0.09 },
        clearProps: PROPRIETES,
      },
      0.3
    )
  }

  return {
    timeline: tl,
    restaurerTexte: sequenceBandeau.restaurerTexte,

    /**
     * `revert()` et non `kill()` — voir `bandeau.js` : `.from()` pose l'état de
     * départ dès la construction, et seul `revert()` le défait. La nuance a
     * déjà coûté le logo du bandeau une fois.
     */
    nettoyer() {
      tl.revert()
      sequenceBandeau.restaurerTexte()
    },
  }
}
