import { APP_NAME } from '../constants/branding'

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
 * IL NE PILOTE PLUS SA PROPRE ANIMATION, et c'est le changement important.
 * L'arrivée ne s'arrête plus à cette bande : elle traverse la navigation et va
 * jusqu'aux cartes de solde, qui sont ses FRÈRES dans le shell. Une séquence qui
 * dépasse un composant ne peut pas être conduite depuis l'intérieur de ce
 * composant — elle appartient à ce qui les contient (`useArrivee`).
 *
 * Le bandeau redevient donc ce qu'il aurait toujours dû être : du balisage. Il
 * s'affiche pareil sans une ligne de JavaScript.
 *
 * Les attributs `data-motion` ne sont pas des crochets de test : ils sont le
 * repérage que la séquence utilise, et le SEUL. L'application, le banc d'essai
 * et le banc Remotion désignent les mêmes nœuds de la même façon — c'est ce qui
 * garantit qu'ils animent bien la même chose (voir `src/motion/arrivee.js`).
 */
function BandeauMarque() {
  return (
    <header data-motion="bandeau" className="bandeau-marque">
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center md:gap-4 md:py-12">
        {/* La marque dit déjà « C2EGF » : la répéter à voix haute encombrerait
            le lecteur d'écran, qui a le nom en toutes lettres juste après.

            L'enveloppe positionnée n'existe que pour l'onde : elle lui donne le
            bloc conteneur qui la centre exactement sur la marque. Elle reprend
            les dimensions de l'image, donc la mise en page ne bouge pas — c'est
            `npm run deborde` et `npm run contraste` qui le vérifient. */}
        <span className="relative inline-flex h-12 w-12 md:h-14 md:w-14">
          <img
            data-motion="pastille"
            src="/c2egf-mark.png"
            alt=""
            aria-hidden="true"
            width="56"
            height="56"
            className="h-full w-full rounded-full ring-1 ring-white/25"
          />

          {/* L'ONDE — le nœud source qui émet.
              Elle part à `opacity-0` DANS LE CSS, et la séquence la ramène à
              zéro : sans JavaScript, elle n'existe simplement pas, et l'état
              d'arrivée reste rigoureusement l'état statique.
              Le blanc, et non `net-orange` : l'orange est le jeton de
              l'opérateur, réservé aux DONNÉES (index.css). Un décor ne
              l'emprunte pas. */}
          <span
            data-motion="onde"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full opacity-0 ring-1 ring-white/50"
          />
        </span>
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
