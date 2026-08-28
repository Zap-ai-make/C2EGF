import { AbsoluteFill, useVideoConfig } from 'remotion'
import { useGsapTimeline } from '@remotion/gsap'
import BandeauMarque from '../src/components/BandeauMarque.jsx'
import { construireTimelineBandeau } from '../src/motion/bandeau.js'
import '../src/index.css'

/**
 * La séquence d'arrivée du bandeau, scrutable image par image.
 *
 * CE FICHIER NE DESSINE RIEN. C'est sa propriété la plus importante.
 *
 * Il monte le composant RÉEL — `BandeauMarque`, celui que l'application rend —
 * et lui applique la chorégraphie RÉELLE — `construireTimelineBandeau`, celle
 * que l'application joue. Il n'y a donc aucune maquette à tenir à jour, et
 * aucune dérive possible : si la séquence change, le banc change avec elle,
 * parce que c'est le même code.
 *
 * C'est la leçon de `scripts/lib/banc.mjs`, qui monte l'écran réel plutôt
 * qu'une reproduction, et la raison pour laquelle la chorégraphie a été écrite
 * dès le départ comme une timeline EN PAUSE, séparée de qui la joue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI `anime={false}`
 *
 * Dans l'application, le bandeau joue sa séquence tout seul, sur l'horloge du
 * navigateur. Ici, ce serait la panne : Remotion exige que chaque image soit une
 * fonction PURE de son numéro. Une animation qui avancerait en parallèle rendrait
 * la scrutation incohérente et le rendu non reproductible — deux rendus du même
 * projet donneraient deux vidéos différentes.
 *
 * Le composant est donc rendu inerte, et `useGsapTimeline` prend la main : il
 * fournit une timeline déjà en pause, la peuple par notre constructeur, puis la
 * déplace à `frame / fps`. Rien ne joue ; tout est positionné.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE DÉCOUPAGE N'EST PAS DÉFAIT ICI
 *
 * L'application recolle le wordmark sur `onComplete`. Le banc, lui, va et vient
 * dans le temps : un découpage qui se déferait au passage de la dernière image
 * interdirait tout retour en arrière. C'est pourquoi `restaurerTexte` est resté
 * une décision de l'appelant, et non un effet de bord de la chorégraphie.
 */
export function BandeauSequence() {
  const { width } = useVideoConfig()

  const scope = useGsapTimeline(({ timeline, scope: racine }) => {
    construireTimelineBandeau({ racine, timeline })
  })

  return (
    <AbsoluteFill style={{ backgroundColor: '#07111f' }}>
      {/* La largeur de la composition EST la largeur de rendu : le bandeau
          bascule à 768 px (la photographie n'est chargée qu'au-delà), donc la
          composition doit être rendue à la largeur qu'on veut inspecter, pas
          mise à l'échelle après coup. */}
      <div ref={scope} style={{ width }}>
        <BandeauMarque anime={false} />
      </div>
    </AbsoluteFill>
  )
}

export default BandeauSequence
