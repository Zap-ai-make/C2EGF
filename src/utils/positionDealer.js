/**
 * positionDealer.js — « combien de mon argent est dehors », et le rapprochement.
 *
 * PUR (aucune I/O) → testable directement (tc-203).
 *
 * ⚠ DEUX CHOSES S'APPELLENT « DEHORS » DANS CE FICHIER, ET IL FAUT LES TENIR
 *   SÉPARÉES. `dehors` (sans qualificatif) est l'argent DU DEALER : envoyé
 *   moins revenu, le grand nombre de la colonne de gauche. `sommeDehors` est
 *   l'argent DES BOUTIQUES : ce que leurs clients leur doivent, moins ce
 *   qu'elles doivent à leurs clients. Ils sont dans les deux membres OPPOSÉS de
 *   l'égalité ci-dessous. Les confondre inverserait le signe de l'écart.
 *
 * L'IDENTITÉ, ET POURQUOI ELLE A QUATRE TERMES ET NON DEUX
 * ───────────────────────────────────────────────────────
 * On voudrait écrire « somme des caisses = envoyé − revenu ». C'est faux deux
 * fois, et la vérification du code l'a montré.
 *
 * D'abord (S2) : la boutique est débitée à la CRÉATION d'un retour, tandis que
 * `flux.revenuCumul` n'avance qu'à sa CONFIRMATION. Entre les deux, l'argent
 * n'est plus dans la caisse et n'est pas encore compté comme revenu — il est en
 * attente de confirmation.
 *
 * Ensuite : une transaction client NON TERMINÉE n'a fait passer qu'une de ses
 * deux jambes. Un dépôt en attente a baissé le stock sans monter la liquidité
 * (le client doit encore son argent) ; un retrait en attente a monté le stock
 * sans baisser la liquidité (la boutique doit encore le sien). La somme des
 * caisses est donc trop basse de l'un et trop haute de l'autre — et
 * `sommeDehors = dépôts − retraits` est exactement ce qu'il faut lui rendre.
 * D'où :
 *
 *     stock + liquidité + dehors boutiques + en attente
 *         = fonds d'ouverture + envoyé − revenu
 *
 * Aucun de ces deux termes n'est un ornement : chacun est ce qui réconcilie.
 * Retirer le premier casse l'égalité à chaque retour en attente ; retirer le
 * second, à chaque transaction non réglée d'une des quatre-vingt-quatre
 * boutiques — c'est-à-dire en permanence.
 *
 * ⚠ CE QUE CE RAPPROCHEMENT NE PROUVE PAS
 * ───────────────────────────────────────
 * Il ne détecte pas une fraude, et l'écran ne doit pas le laisser croire. Les
 * compteurs de S2 sont partis de zéro le jour de leur mise en service, alors
 * que les boutiques détenaient déjà du float : cet antériorité-là est un écart
 * PERMANENT, et il est normal. Deux autres causes le font respirer d'un jour à
 * l'autre, vérifiées dans `financialImpact.js` pour le profil C2EGF
 * (mono-réseau Orange, méthodes « Orange Money » et « Cash ») :
 *
 *   • une ouverture de journée FIXE les soldes au lieu de les incrémenter.
 *
 * ⚠ Une TROISIÈME cause figurait ici et n'y est plus : « une transaction en
 *   cours déplace le stock sans contrepartie ». Elle n'a pas disparu — elle a
 *   été CHIFFRÉE. C'est `sommeDehors`, désormais un terme de l'identité au lieu
 *   d'une explication qu'on donnait faute de pouvoir la mesurer.
 *
 *   ⚠ Cela ne veut PAS dire que l'écart rétrécit, et il ne faut pas le
 *     promettre. Le terme s'ajoute aux caisses : sur un écart déjà positif —
 *     le cas ordinaire, l'antériorité — il l'AGRANDIT. Ce qui change n'est pas
 *     la taille du nombre, c'est ce qu'il contient : une cause de moins, donc
 *     un résidu qui désigne l'antériorité de plus près.
 *
 * Ce qui est lisible, ce n'est donc pas la valeur de l'écart : c'est son
 * MOUVEMENT. L'écran écrit le chiffre et dit d'où il vient ; il ne le
 * transforme jamais en verdict.
 */

/** Les quatre issues possibles d'un rapprochement. */
export const ETATS = Object.freeze({
  /** On refuse de se prononcer, et on dit pourquoi (`raison`). */
  INDISPONIBLE: 'indisponible',
  /** Écart nul. */
  CONCORDANT: 'concordant',
  /** Les caisses tiennent PLUS que ce que les compteurs ont suivi. */
  ANTERIEUR: 'anterieur',
  /** Les caisses tiennent MOINS : aucun fonds d'ouverture ne l'explique. */
  ANOMALIE: 'anomalie',
})

export const RAISONS = Object.freeze({
  /** La lecture du réseau a échoué : il n'y a pas de somme du tout. */
  CAISSES_INDISPONIBLES: 'caisses-indisponibles',
  /** Aucune opération comptée : les compteurs n'ont rien à rapprocher. */
  COMPTEURS_NEUFS: 'compteurs-neufs',
  /** Au moins une caisse illisible : la somme est incomplète. */
  CAISSES_INCOMPLETES: 'caisses-incompletes',
  /**
   * La lecture des transactions non terminées a échoué : `sommeDehors` manque.
   *
   * ⚠ On refuse plutôt que de compter 0. Compter 0 reviendrait à affirmer
   *   qu'aucune boutique du réseau n'a d'opération en cours — l'affirmation la
   *   moins probable des deux — et l'écart afficherait alors exactement le
   *   trou qu'on vient d'ouvrir, en le présentant comme un fait.
   */
  DEHORS_INDISPONIBLE: 'dehors-indisponible',
})

const nombre = (valeur) => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0)

/**
 * @param {object} args
 * @param {object} args.flux           `inventory.flux` — { envoyeCumul, revenuCumul, dehors, amorce }
 * @param {number} args.sommeStock     somme des stocks lisibles (service S2)
 * @param {number} args.sommeLiquidite somme des liquidités lisibles (service S2)
 * @param {number} args.illisibles     nombre de caisses dont un montant manque
 * @param {number} args.enTransit      montant des retours créés, pas encore confirmés
 * @param {boolean} args.caissesLues   `false` si la lecture du réseau a échoué
 * @param {number} args.sommeDehors    dépôts non terminés − retraits non terminés
 * @param {boolean} args.dehorsLu      `false` si la lecture des non terminées a échoué
 */
export function rapprocherPosition({
  flux,
  sommeStock = 0,
  sommeLiquidite = 0,
  illisibles = 0,
  enTransit = 0,
  caissesLues = true,
  sommeDehors = 0,
  dehorsLu = true,
} = {}) {
  const envoye = nombre(flux?.envoyeCumul)
  const revenu = nombre(flux?.revenuCumul)
  const dehors = envoye - revenu
  const dehorsBoutiques = nombre(sommeDehors)
  // ⚠ Les trois lignes affichées font EXACTEMENT ce total, et c'est la première
  //   chose qu'un lecteur vérifie du regard. Aucun terme ne s'y glisse qui ne
  //   soit pas au-dessus, aucun n'en sort.
  const sommeCaisses = nombre(sommeStock) + nombre(sommeLiquidite) + dehorsBoutiques
  const transit = nombre(enTransit)

  const base = {
    envoye,
    revenu,
    dehors,
    sommeStock: nombre(sommeStock),
    sommeLiquidite: nombre(sommeLiquidite),
    sommeDehors: dehorsBoutiques,
    sommeCaisses,
    enTransit: transit,
    illisibles: nombre(illisibles),
  }

  // ⚠ Lecture échouée : les sommes passent à `null`, pas à zéro. Zéro se lit
  //   « les caisses sont vides » — c'est un montant, et c'est faux. `null`
  //   s'affiche « — » et ne se confond avec rien.
  if (!caissesLues) {
    return {
      ...base,
      sommeStock: null,
      sommeLiquidite: null,
      sommeDehors: null,
      sommeCaisses: null,
      etat: ETATS.INDISPONIBLE,
      raison: RAISONS.CAISSES_INDISPONIBLES,
      ecart: null,
    }
  }

  // ⚠ L'ORDRE DES QUATRE REFUS EST VOLONTAIRE, ET IL N'EST PAS COMMUTATIF.
  //   Plusieurs peuvent être vrais en même temps ; celui qui sort est celui qui
  //   EXPLIQUE l'écran, pas le premier venu.
  //
  //   1. réseau illisible      — il n'y a pas de somme du tout
  //   2. compteurs neufs       — « ça vient de démarrer » : sur une mise en
  //                              service, les trois autres sont souvent vrais
  //                              aussi, et ce serait un détail technique là où
  //                              l'utilisateur attend cette phrase-là
  //   3. non terminées manquantes — un terme entier du total est absent
  //   4. une caisse illisible  — le plus petit trou des quatre
  if (!flux?.amorce) {
    return { ...base, etat: ETATS.INDISPONIBLE, raison: RAISONS.COMPTEURS_NEUFS, ecart: null }
  }

  // Les caisses sont là, mais pas les non terminées. Seule `sommeDehors` passe
  // à `null` : stock et liquidité restent justes et s'affichent, c'est le TOTAL
  // qui ne peut pas se former — comme la colonne de gauche reste juste quand
  // c'est le réseau qui manque.
  if (!dehorsLu) {
    return {
      ...base,
      sommeDehors: null,
      sommeCaisses: null,
      etat: ETATS.INDISPONIBLE,
      raison: RAISONS.DEHORS_INDISPONIBLE,
      ecart: null,
    }
  }

  // Une somme incomplète ne se rapproche pas. Un total faux qui s'annonce juste
  // est pire que pas de total : il ferait chercher un écart qui n'existe pas.
  if (nombre(illisibles) > 0) {
    return { ...base, etat: ETATS.INDISPONIBLE, raison: RAISONS.CAISSES_INCOMPLETES, ecart: null }
  }

  const ecart = sommeCaisses + transit - dehors
  const etat = ecart === 0
    ? ETATS.CONCORDANT
    : ecart > 0 ? ETATS.ANTERIEUR : ETATS.ANOMALIE

  return { ...base, etat, raison: null, ecart }
}

export default rapprocherPosition
