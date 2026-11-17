/**
 * Les numéros de la boutique, hors de Firestore
 * (docs/superpowers/specs/2026-11-17-numeros-boutique-design.md).
 *
 *   — le numéro FLOTTE : celui sur lequel on appelle la boutique ;
 *   — le numéro DEALER, un par réseau : la SIM qui reçoit la monnaie
 *     électronique des agents. L'app Oxygen compose le code d'envoi avec lui.
 *
 * Sur la fiche : `stores/{id}.flotte` et `stores/{id}.dealer.{reseau}`, 8
 * chiffres, sans espace ni indicatif (contrat Oxygen, §9).
 *
 * ⚠ LES LECTEURS NE RENDENT QU'UN NUMÉRO CONFORME. Une fiche retouchée à la
 *   main dans la console pourrait porter « 76 54 32 10 » ou neuf chiffres :
 *   l'app composerait un numéro faux, et des unités envoyées à un mauvais
 *   numéro sont perdues pour l'agent. Mieux vaut ne rien rendre.
 */

const FORMAT_NUMERO = /^\d{8}$/

const estObjet = (valeur) => valeur != null && typeof valeur === 'object' && !Array.isArray(valeur)
const conforme = (valeur) => (typeof valeur === 'string' && FORMAT_NUMERO.test(valeur) ? valeur : undefined)

/** Les espaces tapés retirés. Rien devient une chaîne vide. */
export function normaliserNumero(valeur) {
  return typeof valeur === 'string' ? valeur.replace(/\s+/g, '') : ''
}

/**
 * Ce que la boutique a saisi, prêt à écrire. `null` veut dire « effacer ».
 *
 * @param {{ flotte?: string, dealer?: Record<string, string> }} donnee
 * @param {string[]} reseaux les réseaux du profil (`STORE_NETWORKS`)
 * @returns {{ ok: true, flotte: string|null, dealer: Record<string, string|null> } | { ok: false, message: string }}
 */
export function numerosSaisis(donnee, reseaux) {
  const { flotte, dealer = {} } = donnee ?? {}
  if ((flotte !== undefined && typeof flotte !== 'string') || !estObjet(dealer)) {
    return { ok: false, message: 'Numéros invalides.' }
  }
  const inconnu = Object.keys(dealer).find((reseau) => !reseaux.includes(reseau))
  if (inconnu) return { ok: false, message: `Réseau inconnu : ${inconnu}.` }
  if (Object.values(dealer).some((numero) => numero !== undefined && typeof numero !== 'string')) {
    return { ok: false, message: 'Numéros invalides.' }
  }

  const lire = (valeur, libelle) => {
    const numero = normaliserNumero(valeur)
    if (!numero) return { numero: null }
    return FORMAT_NUMERO.test(numero) ? { numero } : { message: `${libelle} : 8 chiffres.` }
  }
  const lueFlotte = lire(flotte, 'Numéro flotte')
  if (lueFlotte.message) return { ok: false, message: lueFlotte.message }
  const dealers = {}
  for (const reseau of reseaux) {
    const lu = lire(dealer[reseau], `Numéro dealer ${reseau}`)
    if (lu.message) return { ok: false, message: lu.message }
    dealers[reseau] = lu.numero
  }
  return { ok: true, flotte: lueFlotte.numero, dealer: dealers }
}

/** Le numéro flotte de la fiche, s'il est conforme. */
export function flotteDe(store) {
  return conforme(store?.flotte)
}

/** Le numéro dealer de la fiche pour ce réseau, s'il est conforme. */
export function dealerDe(store, reseau) {
  return estObjet(store?.dealer) ? conforme(store.dealer[reseau]) : undefined
}
