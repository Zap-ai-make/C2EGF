/**
 * positionDealer.js — « combien de mon argent est dehors », et le rapprochement.
 *
 * PUR (aucune I/O) → testable directement (tc-203).
 *
 * L'IDENTITÉ, ET POURQUOI ELLE A TROIS TERMES ET NON DEUX
 * ──────────────────────────────────────────────────────
 * On voudrait écrire « somme des caisses = envoyé − revenu ». C'est faux, et
 * la vérification du code l'a montré en S2 : la boutique est débitée à la
 * CRÉATION d'un retour, tandis que `flux.revenuCumul` n'avance qu'à sa
 * CONFIRMATION. Entre les deux, l'argent n'est plus dans la caisse et n'est pas
 * encore compté comme revenu — il est EN TRANSIT. D'où :
 *
 *     somme des caisses + en transit = fonds d'ouverture + envoyé − revenu
 *
 * La ligne « en transit » n'est donc pas un ornement : c'est le terme qui
 * réconcilie. La retirer casse l'égalité à chaque retour en attente.
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
 *   • une transaction en cours chez une boutique déplace son stock sans
 *     contrepartie tant qu'elle n'est pas réglée — un dépôt en attente fait
 *     baisser la somme des caisses, un retrait en attente la fait monter ;
 *     le règlement remet les deux d'accord ;
 *   • une ouverture de journée FIXE les soldes au lieu de les incrémenter.
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
 */
export function rapprocherPosition({
  flux,
  sommeStock = 0,
  sommeLiquidite = 0,
  illisibles = 0,
  enTransit = 0,
  caissesLues = true,
} = {}) {
  const envoye = nombre(flux?.envoyeCumul)
  const revenu = nombre(flux?.revenuCumul)
  const dehors = envoye - revenu
  const sommeCaisses = nombre(sommeStock) + nombre(sommeLiquidite)
  const transit = nombre(enTransit)

  const base = {
    envoye,
    revenu,
    dehors,
    sommeStock: nombre(sommeStock),
    sommeLiquidite: nombre(sommeLiquidite),
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
      sommeCaisses: null,
      etat: ETATS.INDISPONIBLE,
      raison: RAISONS.CAISSES_INDISPONIBLES,
      ecart: null,
    }
  }

  // Ordre volontaire : « compteurs neufs » passe AVANT « caisses incomplètes ».
  // Sur une mise en service, les deux peuvent être vrais en même temps, et
  // c'est le premier qui explique l'écran — l'autre serait un détail technique
  // là où l'utilisateur attend « ça vient de démarrer ».
  if (!flux?.amorce) {
    return { ...base, etat: ETATS.INDISPONIBLE, raison: RAISONS.COMPTEURS_NEUFS, ecart: null }
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
