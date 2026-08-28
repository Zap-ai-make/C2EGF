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
 * DEUX GESTES PRÉVUS AU PLAN ONT ÉTÉ COUPÉS (DESIGN.md §14)
 *
 * « Dépense ta hardiesse à un seul endroit. » Elle est dépensée sur le
 * wordmark. Le reste se tait.
 *
 * 1. L'IMPULSION ORANGE qui devait traverser la bande. Les deux lueurs vivent
 *    dans un `background-image` de `.bandeau-marque` : les animer demandait
 *    soit deux calques absolus de plus, soit de refondre le CSS en variables —
 *    et, dans les deux cas, de repeindre un dégradé de 1920 px à chaque image.
 *    Coût réel, pour redire une TROISIÈME fois ce que le départ du centre dit
 *    déjà. Sur mobile, où la photographie n'est pas chargée, elle serait même
 *    devenue l'élément le plus voyant de l'écran, en concurrence avec le texte.
 *
 * 2. LA CONTRACTION DE L'INTERLETTRAGE sur la ligne de métier. Deux raisons,
 *    dont une franchement disqualifiante : cette ligne porte `tracking-[0.18em]`
 *    en mobile et `md:tracking-[0.28em]` au-delà. Une valeur figée en style
 *    EN LIGNE par l'animation écraserait la bascule responsive — la ligne
 *    garderait l'interlettrage du bureau sur un téléphone. Et à 10 px de haut,
 *    en capitales, le geste est de toute façon invisible. L'interlettrage est
 *    par ailleurs une propriété de MISE EN PAGE : l'animer refait couler le
 *    texte à chaque image, quand tout le reste ici tient en transformations et
 *    en opacité.
 *
 * Ce qui reste tient en trois gestes, sous 1,05 s, une seule fois, jamais en
 * boucle — la bande quitte l'écran, animer en boucle un élément qu'on ne
 * regarde plus coûterait de la batterie pour rien.
 */

/** Durée totale, en secondes. Le banc Remotion en déduit son nombre d'images. */
export const DUREE_BANDEAU = 1.05

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

  // 1. LA MARQUE S'ALLUME — le nœud source du réseau. Elle arrive seule, avant
  //    le nom : c'est d'elle que part la propagation.
  if (pastille) {
    tl.from(pastille, { duration: 0.55, opacity: 0, scale: 0.92, ease: ACCELERATION }, 0)
  }

  // 2. LE NOM SE RÉSOUT, DU CENTRE VERS LES BORDS. `from: 'center'` n'est pas
  //    un effet : c'est l'énoncé du concept. Le décalage est serré (25 ms) —
  //    au-delà, treize lettres deviennent une vague, et une vague est
  //    précisément le tic qu'on cherche à éviter.
  if (decoupe?.chars?.length) {
    tl.from(
      decoupe.chars,
      {
        duration: 0.5,
        yPercent: 100,
        ease: ACCELERATION,
        stagger: { each: 0.025, from: 'center' },
      },
      0.25
    )
  }

  // 3. LA LIGNE DE MÉTIER se pose en dernier, discrètement. Elle nomme le
  //    métier ; elle n'a pas à se faire remarquer.
  if (metier) {
    tl.from(metier, { duration: 0.45, opacity: 0, y: 8, ease: ACCELERATION }, 0.6)
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
