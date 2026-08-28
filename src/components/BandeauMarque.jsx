import { useLayoutEffect, useRef } from 'react'
import { APP_NAME } from '../constants/branding'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { construireTimelineBandeau } from '../motion/bandeau'

/**
 * Le bandeau de marque — la première bande du shell, et le seul moment
 * d'arrivée de l'application.
 *
 * IL VIT DANS SON PROPRE FICHIER, et pas dans `Layout.jsx` comme au départ.
 * Le banc Remotion le monte pour scruter la séquence image par image ; importé
 * depuis `Layout.jsx`, il aurait traîné avec lui la navigation, le tiroir des
 * soldes, les contextes et donc Firebase — pour afficher trois lignes de texte
 * sur une photographie. Le composant n'a jamais eu besoin de rien de tout cela.
 *
 * Composition CENTRÉE, comme avant la refonte. L'alignement à gauche poussait
 * la marque dans un coin de la photographie et laissait les deux tiers droits
 * vides ; sur un bandeau qui n'existe qu'à l'arrivée, l'axe central est le seul
 * endroit que le regard cherche. La marque, le nom et la ligne de métier
 * s'empilent sur cet axe.
 *
 * Les attributs `data-motion` ne sont pas des crochets de test : ils sont le
 * repérage que la séquence utilise, et le SEUL. L'application et le banc
 * désignent les mêmes nœuds de la même façon — c'est ce qui garantit qu'ils
 * animent bien la même chose (voir `src/motion/bandeau.js`).
 *
 * @param {boolean} anime — `false` rend le bandeau inerte : le composant ne
 *   construit ni ne joue rien. C'est ce que fait le banc Remotion, qui pilote
 *   lui-même la séquence par numéro d'image et ne veut surtout pas d'une
 *   animation qui avancerait en parallèle, sur l'horloge du navigateur.
 */
function BandeauMarque({ anime = true }) {
  const racine = useRef(null)
  const mouvementReduit = useReducedMotion()

  /**
   * SOUS MOUVEMENT RÉDUIT, ON NE CONSTRUIT RIEN. Pas de version dégradée, pas
   * de découpage du wordmark, pas une ligne de DOM touchée : la séquence est
   * écrite en `.from()`, donc l'état statique EST déjà son état d'arrivée. Ne
   * rien faire est la bonne réponse, et c'est aussi la plus sûre.
   *
   * `useLayoutEffect` et non `useEffect` : la timeline pose son état de départ
   * (lettres sous leur masque, marque à 92 %) au moment où elle est construite.
   * Avec `useEffect`, ce réglage tomberait APRÈS la peinture — le bandeau
   * s'afficherait complet une image, puis sauterait à son début pour s'animer.
   *
   * Le nettoyage n'est pas facultatif, et il fait plus qu'arrêter : il REND aux
   * nœuds leurs styles d'avant. Voir `nettoyer()` — la nuance entre `kill()` et
   * `revert()` a coûté le logo du bandeau.
   */
  useLayoutEffect(() => {
    if (!anime || mouvementReduit) return undefined

    const { timeline, restaurerTexte, nettoyer } = construireTimelineBandeau({
      racine: racine.current,
    })

    // Dès que les lettres sont posées, le wordmark redevient un texte d'un seul
    // tenant : le découpage ne servait qu'à la séquence, et la bande passera le
    // reste de sa vie immobile avant de quitter l'écran.
    timeline.eventCallback('onComplete', restaurerTexte)
    timeline.play()

    return nettoyer
  }, [anime, mouvementReduit])

  return (
    <header ref={racine} className="bandeau-marque">
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center md:gap-4 md:py-12">
        {/* La marque dit déjà « C2EGF » : la répéter à voix haute encombrerait
            le lecteur d'écran, qui a le nom en toutes lettres juste après. */}
        <img
          data-motion="pastille"
          src="/c2egf-mark.png"
          alt=""
          aria-hidden="true"
          width="56"
          height="56"
          className="h-12 w-12 rounded-full ring-1 ring-white/25 md:h-14 md:w-14"
        />
        <div className="min-w-0">
          <p
            data-motion="wordmark"
            className="truncate text-2xl font-bold leading-tight tracking-tight text-white md:text-4xl"
          >
            {APP_NAME}
          </p>
          <p
            data-motion="metier"
            className="mt-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200 md:text-[11px] md:tracking-[0.28em]"
          >
            Distribution mobile money · Burkina Faso
          </p>
        </div>
      </div>
    </header>
  )
}

export default BandeauMarque
export { BandeauMarque }
