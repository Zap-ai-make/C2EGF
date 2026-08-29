import { APP_NAME } from '../constants/branding'

/**
 * Le bandeau de marque — la première bande du shell, et le seul moment
 * d'arrivée de l'application.
 *
 * Composition CENTRÉE, comme avant la refonte. L'alignement à gauche poussait
 * la marque dans un coin de la photographie et laissait les deux tiers droits
 * vides ; sur un bandeau qui n'existe qu'à l'arrivée, l'axe central est le seul
 * endroit que le regard cherche. La marque, le nom et la ligne de métier
 * s'empilent sur cet axe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ANIMATION EST ENTIÈREMENT EN CSS, ET LE DÉCOUPAGE EST DÉCLARATIF
 *
 * Une version précédente passait par GSAP et son greffon SplitText : 31,9 Ko
 * gzip, pour un geste que `@keyframes` fait aussi bien. Le retrait n'a rien
 * coûté au rendu — il a même retiré des défauts.
 *
 * SplitText remplaçait le contenu du wordmark par un balisage de caractères,
 * APRÈS le rendu. Il fallait donc défaire cette mutation au démontage, et cette
 * mécanique de restauration a été la source du seul défaut visible du chantier :
 * le bandeau s'est affiché sans son logo, définitivement, parce qu'un
 * `kill()` n'avait pas rendu un style en ligne.
 *
 * Ici, le découpage n'est plus une mutation : c'est le rendu. React produit les
 * lettres, il n'y a rien à défaire, rien à nettoyer, aucun remontage à craindre.
 * Ce que le CSS anime, il l'anime sur du balisage qui a toujours été là.
 *
 * ACCESSIBILITÉ — ce que SplitText faisait, on l'écrit, et c'est trois lignes.
 * Le `<p>` porte le nom entier en `aria-label` ; l'empilement de lettres est
 * masqué de l'arbre d'accessibilité. Un lecteur d'écran annonce donc
 * « C2EGF BURKINA », jamais « C 2 E G F ». Le texte reste par ailleurs présent
 * dans le DOM : la recherche dans la page et la sélection continuent de
 * fonctionner.
 *
 * POURQUOI DÉCOUPER PLUTÔT QUE D'ANIMER LE MOT ENTIER : le nom vient du profil
 * client (`branding.appName`). On ne peut donc pas écrire les lettres en dur, et
 * une valeur qui change d'un client à l'autre doit se découper au rendu.
 *
 * `prefers-reduced-motion` est traité DANS le CSS (`index.css`), pas ici :
 * une animation déclarative n'a besoin d'aucune décision JavaScript pour se
 * taire.
 */

/**
 * Le rang sert au décalage : c'est la DISTANCE AU CENTRE, pas la position.
 *
 * Le mot se résout donc du milieu vers les bords — la marque est exactement
 * au-dessus du centre du nom, et la propagation part de là. Un rang qui vaudrait
 * simplement l'index produirait une vague de gauche à droite, c'est-à-dire un
 * effet, là où l'on veut un énoncé.
 */
const rangDepuisLeCentre = (index, total) => Math.abs(index - (total - 1) / 2)

function BandeauMarque() {
  const lettres = [...APP_NAME]

  return (
    <header className="bandeau-marque">
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center md:gap-4 md:py-12">
        {/* La marque dit déjà « C2EGF » : la répéter à voix haute encombrerait
            le lecteur d'écran, qui a le nom en toutes lettres juste après. */}
        <img
          src="/c2egf-mark.png"
          alt=""
          aria-hidden="true"
          width="56"
          height="56"
          className="marque-arrivee h-12 w-12 rounded-full ring-1 ring-white/25 md:h-14 md:w-14"
        />
        <div className="min-w-0">
          <p
            aria-label={APP_NAME}
            className="wordmark truncate text-2xl font-bold leading-tight tracking-tight text-white md:text-4xl"
          >
            <span aria-hidden="true">
              {lettres.map((lettre, index) => (
                <span
                  // L'index entre dans la clé : le nom est une constante du
                  // profil client, cette liste ne se réordonne jamais.
                  key={`${lettre}-${index}`}
                  className="wordmark-masque"
                  style={{ '--rang': rangDepuisLeCentre(index, lettres.length) }}
                >
                  {/* L'espace doit rester insécable : dans une suite de blocs
                      en ligne, une espace ordinaire se réduirait à rien et le
                      nom se lirait « C2EGFBURKINA ». */}
                  <span className="wordmark-lettre">
                    {lettre === ' ' ? ' ' : lettre}
                  </span>
                </span>
              ))}
            </span>
          </p>
          <p className="ligne-metier mt-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200 md:text-[11px] md:tracking-[0.28em]">
            Distribution mobile money · Burkina Faso
          </p>
        </div>
      </div>
    </header>
  )
}

export default BandeauMarque
export { BandeauMarque }
