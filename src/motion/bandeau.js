import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(SplitText)

/**
 * L'arrivée sur le bandeau de marque — la signature de l'application.
 *
 * C'est le seul moment d'arrivée de tout le produit : la bande défile hors de
 * l'écran dès qu'on travaille (voir `Layout.jsx`), et ne revient qu'au prochain
 * chargement. Elle est donc le seul endroit où une séquence orchestrée se
 * justifie — partout ailleurs, l'outil est ouvert quatre à cinq fois par jour
 * et le mouvement deviendrait une taxe (DESIGN.md §9).
 *
 * LE CONCEPT : « le titre ne paraît pas, il se propage ».
 * C2EGF est un distributeur : le float descend d'Orange à la centrale, puis aux
 * succursales, puis aux agents. Le wordmark se résout donc DU CENTRE VERS LES
 * BORDS — le mouvement dit ce que fait l'entreprise, au lieu de décorer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNE TIMELINE EN PAUSE, DEUX CONSOMMATEURS
 *
 * Cette fonction ne joue rien. Elle construit et rend la main. Deux appelants
 * s'en servent :
 *
 *   • l'application — `Layout.jsx` la joue une fois, au montage ;
 *   • le banc Remotion — il la SCRUTE, image par image, par `seek(frame / fps)`.
 *
 * Le banc importe ce constructeur ET le composant réel. Il ne redessine pas le
 * bandeau : il exécute le même mouvement sur le même composant. C'est la leçon
 * de `scripts/lib/banc.mjs`, qui monte l'écran réel parce qu'une maquette
 * dérive. Une timeline qui se jouerait elle-même serait impossible à scruter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI TOUT EST EN `.from()`
 *
 * Exigence non négociable : l'état final DOIT être l'état statique. Si le
 * JavaScript ne s'exécute pas — erreur, réseau coupé, navigateur ancien —, le
 * bandeau doit s'afficher exactement comme aujourd'hui. Le mouvement est une
 * couche, jamais une condition d'affichage.
 *
 * `.from()` donne cette garantie par construction : il anime DEPUIS un état
 * inventé VERS l'état naturel de l'élément. La fin de la timeline, c'est le CSS
 * tel qu'il est écrit — il n'y a aucune valeur d'arrivée à tenir à jour, donc
 * aucune à laisser diverger. Un `.to()` aurait dupliqué le CSS dans le JS.
 *
 * Corollaire : sous mouvement réduit, on ne construit RIEN. On ne joue pas une
 * version dégradée, on ne touche pas au DOM ; l'état statique est déjà la
 * bonne réponse. C'est `Layout.jsx` qui tranche, avant d'appeler ici.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LA PREMIÈRE VERSION RATAIT
 *
 * Elle enchaînait trois fondus : la marque paraissait, les lettres montaient, la
 * ligne de métier se posait. Trois arrivées polies, sans lien entre elles. La
 * propagation n'était affirmée que dans ce commentaire — RIEN À L'ÉCRAN NE LA
 * CAUSAIT —, et le décalage des lettres, à 25 ms, passait trop vite pour se
 * lire autrement que « le mot apparaît ». Un geste qu'on ne voit pas revient à
 * ne pas l'avoir fait.
 *
 * L'onde émise par la marque est la correction : elle relie la source à la
 * conséquence. Elle atteint la ligne du nom juste avant que les lettres bougent,
 * si bien que le regard lit un enchaînement et non une coïncidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNE SEULE HARDIESSE (DESIGN.md §14)
 *
 * Elle est dépensée sur l'onde et le nom. Tout le reste se tait — et deux gestes
 * prévus au plan restent coupés :
 *
 * 1. L'IMPULSION ORANGE qui devait traverser toute la bande. Les deux lueurs
 *    vivent dans le `background-image` de `.bandeau-marque` : les animer voulait
 *    dire repeindre un dégradé de 1920 px à chaque image. L'onde dit désormais
 *    la même chose pour le prix d'une transformation. Elle est BLANCHE, et non
 *    orange : `net-orange` est le jeton de l'opérateur, réservé aux données — un
 *    décor ne l'emprunte pas.
 *
 * 2. LA CONTRACTION DE L'INTERLETTRAGE sur la ligne de métier. Cette ligne porte
 *    `tracking-[0.18em]` en mobile et `md:tracking-[0.28em]` au-delà : une valeur
 *    figée en style EN LIGNE écraserait la bascule responsive. Et à 10 px, en
 *    capitales, le geste est invisible.
 *
 * Quatre gestes, dans le budget, une seule fois, jamais en boucle — la bande
 * quitte l'écran, animer en boucle un élément qu'on ne regarde plus coûterait de
 * la batterie pour rien.
 */

/**
 * BUDGET de la séquence, en secondes — un plafond, pas une mesure.
 *
 * Le banc Remotion en déduit son nombre d'images, et tc-109 vérifie que la
 * chorégraphie tient dedans. C'est le sens de ce chiffre : on ne le recopie pas
 * depuis les tweens (il divergerait au premier réglage), on s'engage dessus.
 *
 * 1,6 s et non 1 s : la première version se lisait « le bandeau apparaît ». Un
 * moment d'arrivée qu'on ne traverse qu'une fois par session peut prendre le
 * temps de dire quelque chose — c'est sur les écrans de travail que le mouvement
 * doit se faire oublier, pas ici.
 */
export const DUREE_BANDEAU = 1.6

/**
 * Construit la séquence d'arrivée, EN PAUSE.
 *
 * @param {Element|null} racine — le `<header>` du bandeau. Les trois nœuds
 *   animés s'y désignent par `data-motion`. Tout est facultatif : un nœud
 *   manquant est simplement sauté, car une signature qui lève sur un décor
 *   incomplet transformerait une décoration en panne d'écran.
 * @param {gsap.core.Timeline} [timeline] — une timeline à peupler plutôt que
 *   d'en créer une. C'est par là que `@remotion/gsap` prend la main.
 * @returns {{ timeline, restaurerTexte: () => void, nettoyer: () => void }}
 *   `nettoyer` est OBLIGATOIRE à l'appel : `SplitText` remplace le contenu du
 *   wordmark par un balisage de caractères, et seul `revert()` rend le DOM
 *   d'origine. Sans lui, chaque montage empile un découpage de plus.
 */
export function construireTimelineBandeau({ racine, timeline } = {}) {
  // UN SEUL MÉCANISME DE REPÉRAGE, pour les deux consommateurs.
  //
  // La première version prenait trois refs React. Le banc Remotion ne peut pas
  // les atteindre : il monte le composant, il n'en tient pas les refs. Faire
  // porter le repérage par le DOM lui-même — `data-motion` — donne à
  // l'application et au banc exactement la même prise, et supprime le risque
  // qu'ils finissent par animer deux choses différentes.
  const trouver = (nom) => racine?.querySelector(`[data-motion="${nom}"]`) ?? null
  const pastille = trouver('pastille')
  const wordmark = trouver('wordmark')
  const metier = trouver('metier')
  const onde = trouver('onde')

  // `mask: 'chars'` enferme chaque caractère dans son propre cadre à débordement
  // masqué : les lettres MONTENT DERRIÈRE leur masque au lieu de flotter. C'est
  // ce qui fait lire « révélation » plutôt que « vol ».
  //
  // L'option `aria` vaut « auto » par défaut : le mot entier reste le nom
  // accessible de l'élément, et les fragments sortent de l'arbre
  // d'accessibilité. C'est la seule raison pour laquelle ce lot ajoute GSAP —
  // un découpage écrit à la main ferait épeler « C 2 E G F » à un lecteur
  // d'écran, ou obligerait à reconstruire ce que SplitText fait nativement.
  const decoupe = wordmark
    ? SplitText.create(wordmark, { type: 'chars', mask: 'chars' })
    : null

  // La timeline peut être FOURNIE. `@remotion/gsap` possède la sienne — déjà en
  // pause à l'instant zéro — et la scrute par numéro d'image ; il faut alors la
  // peupler plutôt qu'en créer une seconde qui vivrait à côté.
  //
  // L'accélération est donc écrite sur CHAQUE tween, et non dans les `defaults`
  // de la timeline : une timeline reçue n'a pas nos défauts, et la séquence
  // n'aurait alors pas la même allure dans le banc et dans l'application. Le
  // banc mentirait, ce qui est la seule chose qu'on lui interdit.
  const tl = timeline ?? gsap.timeline({ paused: true })
  const ACCELERATION = 'power3.out'

  // 1. LE NŒUD S'ALLUME. La marque arrive seule, avant tout le reste : c'est
  //    d'elle que part ce qui suit.
  if (pastille) {
    tl.from(pastille, { duration: 0.55, opacity: 0, scale: 0.9, ease: ACCELERATION }, 0)
  }

  // 2. LE NŒUD ÉMET. L'onde s'ouvre depuis la marque et se dissipe.
  //
  //    C'est LE geste qui manquait. La première version enchaînait trois
  //    fondus : la marque paraissait, puis les lettres montaient, puis la ligne
  //    de métier se posait. Trois arrivées polies, sans lien entre elles — la
  //    propagation n'existait que dans ce commentaire. Rien à l'écran ne la
  //    CAUSAIT.
  //
  //    L'onde établit cette causalité. Elle part de la marque et atteint la
  //    ligne du nom juste avant que les lettres bougent : le regard lit une
  //    conséquence, pas une coïncidence. C'est aussi la seule hardiesse de la
  //    séquence (DESIGN.md §14) — tout le reste se tait.
  //
  //    `fromTo` et non `from` : l'onde n'a pas d'état naturel à retrouver, elle
  //    doit FINIR invisible. Son opacité de départ est déjà nulle dans le CSS,
  //    si bien que sans JavaScript elle n'apparaît jamais — et que l'état
  //    d'arrivée de la séquence reste, ici aussi, l'état statique.
  if (onde) {
    tl.fromTo(
      onde,
      { opacity: 0.65, scale: 1 },
      { duration: 0.75, opacity: 0, scale: 2.6, ease: 'power2.out' },
      0.34
    )
  }

  // 3. LE NOM SE RÉSOUT, DU CENTRE VERS LES BORDS — dans l'ordre où l'onde
  //    passe sous les lettres. `from: 'center'` n'est pas un effet : la marque
  //    est exactement au-dessus du centre du mot, et la radiation part de là.
  //
  //    Le décalage passe de 25 à 45 ms. À 25, les douze lettres se levaient en
  //    300 ms — trop vite pour qu'on lise autre chose que « le mot apparaît ».
  //    Le geste ne se voyait pas, ce qui revenait à ne pas l'avoir.
  if (decoupe?.chars?.length) {
    tl.from(
      decoupe.chars,
      {
        duration: 0.55,
        yPercent: 100,
        ease: ACCELERATION,
        stagger: { each: 0.045, from: 'center' },
      },
      0.52
    )
  }

  // 4. LA LIGNE DE MÉTIER se pose en dernier, une fois le calme revenu. Elle
  //    nomme le métier ; elle n'a pas à se faire remarquer.
  if (metier) {
    tl.from(metier, { duration: 0.45, opacity: 0, y: 8, ease: ACCELERATION }, 1.05)
  }

  return {
    timeline: tl,

    /**
     * Rend au wordmark son texte d'un seul tenant.
     *
     * À appeler dès que les lettres sont posées : le découpage n'a de raison
     * d'être que PENDANT la séquence. Une fois finie, il ne reste qu'une
     * douzaine de nœuds à porter pour rien — et le DOM final devient alors
     * rigoureusement identique au DOM statique, au lieu de seulement lui
     * ressembler.
     *
     * Ce n'est délibérément PAS branché ici, sur `onComplete` : le banc Remotion
     * scrute la timeline en avant et en arrière, et un découpage qui se défait
     * au passage de la dernière image l'empêcherait de revenir en arrière.
     * C'est donc l'appelant qui décide — l'application le branche, le banc non.
     */
    restaurerTexte() {
      decoupe?.revert()
    },

    /**
     * Défait la séquence ET rend aux nœuds les styles qu'ils avaient avant elle.
     *
     * `revert()` et NON `kill()`, et la nuance a coûté le logo du bandeau.
     * `kill()` arrête la course sans rien restaurer : `.from()` ayant écrit
     * l'état de départ dès la construction, la marque restait à `opacity: 0` en
     * style EN LIGNE. React montant deux fois en développement (`StrictMode`),
     * le second `.from()` lisait alors cette valeur courante comme sa valeur
     * D'ARRIVÉE — il animait de 0 vers 0, et la marque ne revenait jamais.
     *
     * `revert()` remet les nœuds dans leur état d'avant l'animation. C'est ce
     * qui garantit l'exigence de fond : quoi qu'il arrive — interruption,
     * remontage, erreur —, le bandeau retombe sur son état statique, celui que
     * le CSS décrit et que le produit affichait avant ce lot.
     */
    nettoyer() {
      tl.revert()
      decoupe?.revert()
    },
  }
}
