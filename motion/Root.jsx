import { Composition } from 'remotion'
import { BandeauSequence } from './BandeauSequence.jsx'
import { DUREE_BANDEAU } from '../src/motion/bandeau.js'

/**
 * Les compositions du banc de mouvement.
 *
 * Le banc n'est PAS livré : `motion/` ne fait partie d'aucune entrée de build
 * (`index.html` est la seule), exactement comme `preview.html`. Il sert à deux
 * choses, et à deux choses seulement :
 *
 *   • REGARDER la séquence image par image (`npm run motion`), ce qu'aucune
 *     capture ne permet — un navigateur ne s'arrête pas au milieu d'une
 *     animation ;
 *   • en TIRER UN MP4 (`npm run motion:rendu`) à montrer avant d'arbitrer.
 *
 * La durée n'est pas recopiée : elle est importée de la chorégraphie, et
 * convertie en images ici. Un chiffre écrit deux fois finit par différer, et
 * c'est toujours le banc qui a raison au mauvais moment.
 */

const IPS = 60

/**
 * Une seconde de rabiot APRÈS la séquence. Elle n'est pas décorative : c'est
 * elle qui montre l'état d'arrivée, celui que la personne regardera pendant
 * tout son travail — et c'est là qu'un défaut se voit. Le logo manquant du
 * bandeau vivait précisément dans cette seconde-là.
 */
const REPOS = 1

export function Root() {
  return (
    <Composition
      id="BandeauArrivee"
      component={BandeauSequence}
      durationInFrames={Math.round((DUREE_BANDEAU + REPOS) * IPS)}
      fps={IPS}
      width={1440}
      height={260}
    />
  )
}

export default Root
