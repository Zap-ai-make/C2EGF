import { parsefrenchDate } from './helpers.js'
import { BUSINESS_TIME_ZONE } from './businessDate.js'

/**
 * Depuis combien de temps une transaction n'est pas terminée.
 *
 * À QUOI ÇA SERT, VRAIMENT
 * ────────────────────────
 * Une transaction non terminée, c'est un client qui attend — ou qui est parti
 * sans qu'on s'en aperçoive. Le tableau les affichait dans l'ordre, sans jamais
 * dire laquelle traîne : une ligne de 14:24 ne signale rien tant qu'on n'a pas
 * regardé l'heure qu'il est et fait la soustraction de tête, pour chaque ligne.
 *
 * TOUT EST PUR ICI, ET C'EST LE POINT
 * ───────────────────────────────────
 * `maintenant` est un PARAMÈTRE, jamais `Date.now()` lu à l'intérieur. Un
 * compteur qui lit l'horloge lui-même ne se teste qu'avec une horloge truquée,
 * et l'on finit par tester le trucage. Ici, il suffit de passer deux nombres.
 */

/** Au-delà, la ligne s'allume : le client attend depuis une demi-heure. */
export const SEUIL_ALERTE_MS = 30 * 60 * 1000

const SECONDE = 1000
const MINUTE = 60 * SECONDE
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

const deuxChiffres = (valeur) => String(valeur).padStart(2, '0')

/**
 * L'instant où la ligne est devenue « non terminée », en millisecondes.
 *
 * Trois sources, dans cet ordre, et l'ordre compte :
 *
 *   1. `createdAt`, posé par le serveur — à la milliseconde près ;
 *   2. la même valeur en Date, quand c'est le marquage optimiste local qui l'a
 *      écrite avant le retour du serveur ;
 *   3. la date FR « JJ/MM/AAAA HH:MM », qui n'a que la minute.
 *
 * Renvoie `null` si rien n'est lisible — et c'est voulu. Un compteur reparti
 * de zéro sur une ligne vieille de trois heures mentirait plus utilement qu'il
 * n'informerait ; mieux vaut ne rien afficher.
 */
export function instantDeDepart(transaction) {
  const brut = transaction?.createdAt
  if (brut) {
    if (typeof brut.toMillis === 'function') return brut.toMillis()
    const date = brut instanceof Date ? brut : new Date(brut)
    if (!Number.isNaN(date.getTime())) return date.getTime()
  }

  const repli = parsefrenchDate(transaction?.date)
  if (repli && !Number.isNaN(repli.getTime())) return repli.getTime()

  return null
}

/**
 * Une durée en texte.
 *
 *   — sous 24 h : « 00:12:34 », les secondes comprises, parce que c'est un
 *     compteur qu'on regarde tourner ;
 *   — au-delà : « 3j 04:12 ». Un brouillon oublié depuis trois jours afficherait
 *     sinon « 76:12:04 », qu'il faut déchiffrer avant de comprendre.
 */
export function formaterAttente(ms) {
  // Une horloge locale en retard sur le serveur donne un écart négatif. Le
  // montrer en « -00:00:03 » ferait douter du reste ; on plancher à zéro.
  const duree = Math.max(0, Number(ms) || 0)

  if (duree >= JOUR) {
    const jours = Math.floor(duree / JOUR)
    const heures = Math.floor((duree % JOUR) / HEURE)
    const minutes = Math.floor((duree % HEURE) / MINUTE)
    return `${jours}j ${deuxChiffres(heures)}:${deuxChiffres(minutes)}`
  }

  const heures = Math.floor(duree / HEURE)
  const minutes = Math.floor((duree % HEURE) / MINUTE)
  const secondes = Math.floor((duree % MINUTE) / SECONDE)
  return `${deuxChiffres(heures)}:${deuxChiffres(minutes)}:${deuxChiffres(secondes)}`
}

/**
 * Ce que la ligne doit afficher, ou `null` si elle ne peut rien afficher.
 *
 * @param {object} transaction
 * @param {number} maintenant  L'instant courant, en millisecondes.
 * @returns {{ms: number, texte: string, enRetard: boolean}|null}
 */
export function attenteDe(transaction, maintenant) {
  const depart = instantDeDepart(transaction)
  if (depart === null) return null

  const ms = Math.max(0, (Number(maintenant) || 0) - depart)
  return { ms, texte: formaterAttente(ms), enRetard: ms >= SEUIL_ALERTE_MS }
}

/**
 * L'instant où la transaction a QUITTÉ les non terminées, en millisecondes.
 *
 * ⚠ `validatedAt` ET RIEN D'AUTRE, et c'est tout le discernement de ce fichier.
 *   Une transaction validée d'un geste au formulaire n'est jamais passée par les
 *   non terminées : le serveur l'écrit directement dans l'historique (action
 *   `add`, branche `VALIDATED`), avec un `createdAt` et PAS de `validatedAt`.
 *   Elle n'a donc pas de chronomètre — personne n'a attendu. Toute ligne qui
 *   porte `validatedAt` a, elle, séjourné dans les brouillons : c'est la seule
 *   marque fiable, et elle est déjà dans les données.
 */
export function instantDArrivee(transaction) {
  const brut = transaction?.validatedAt
  if (!brut) return null
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

/** Une heure seule, « 14:24 » — la date vit déjà dans la colonne d'à côté. */
export function formaterHeure(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('fr-FR', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Combien de temps une transaction TERMINÉE a mis — départ, arrivée, durée.
 *
 * C'est le chronomètre des non terminées, arrêté. Le badge qui tournait dans le
 * tableau disait « ce client attend depuis » ; une fois réglée, la ligne part
 * dans l'historique et la même mesure devient « ce client a attendu ». Sans
 * cela, le seul chiffre que la boutique voulait vraiment — combien de temps
 * ça a pris — disparaissait à l'instant où il devenait définitif.
 *
 * Renvoie `null` dans deux cas, et aucun n'est un échec :
 *   — pas de `validatedAt` : la ligne n'a jamais attendu (validation directe) ;
 *   — une durée nulle : créée et validée dans la même écriture serveur, comme
 *     un ravitaillement ou un retour. Afficher « 00:00:00 » ferait lire une
 *     mesure là où il n'y a rien à mesurer.
 *
 * @returns {{debut: number, fin: number, ms: number, texte: string}|null}
 */
export function dureeDe(transaction) {
  const debut = instantDeDepart(transaction)
  const fin = instantDArrivee(transaction)
  if (debut === null || fin === null) return null

  const ms = Math.max(0, fin - debut)
  if (ms === 0) return null

  return { debut, fin, ms, texte: formaterAttente(ms) }
}
