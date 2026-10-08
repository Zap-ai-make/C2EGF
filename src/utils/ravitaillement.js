import { activeProfile } from '../config/activeClientProfile.js'

/**
 * Les livraisons du dealer, et ce qu'il reste à lui rendre.
 *
 * Ces fonctions sont PURES et lisent l'historique déjà chargé. Aucune n'écrit :
 * les soldes et les restes dus sont calculés par la fonction appelable, et
 * recalculés ici ne servirait qu'à les faire diverger.
 */

export const TYPE_RAVITAILLEMENT = 'Ravitaillement'
export const TYPE_RETOUR = 'Retour'

/** Les expéditeurs du profil client. Vocabulaire commun, pas garde-fou. */
export const EXPEDITEURS_PROFIL = Object.freeze([...(activeProfile.replenishment?.senders ?? [])])

/** Le choix qui ouvre une saisie libre. Doit rester distinct de tout nom réel. */
export const AJOUTER_UN_NOM = '__ajouter__'

const plier = (nom) => String(nom ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/**
 * Une livraison encore due.
 *
 * ⚠ Le test porte sur `remainingAmount`, et son ABSENCE vaut « soldée ».
 *   Les ravitaillements d'avant S8 n'ont ni expéditeur ni reste dû, et ce
 *   dernier est inconnaissable : ce qui en a déjà été rendu ne fut jamais
 *   enregistré. Les afficher comme entièrement dus ferait dire au logiciel que
 *   la boutique doit tout, ce qui est faux et alarmant.
 */
export const estRavitaillementEnCours = (transaction) =>
  transaction?.type === TYPE_RAVITAILLEMENT
  && Number.isFinite(Number(transaction?.remainingAmount))
  && Number(transaction.remainingAmount) > 0
  && !transaction?.deletedAt

/** Les livraisons encore dues, de la plus ancienne à la plus récente. */
export function ravitaillementsEnCours(transactions = []) {
  const vues = new Set()
  return transactions
    .filter((transaction) => {
      if (!estRavitaillementEnCours(transaction) || vues.has(transaction.id)) return false
      vues.add(transaction.id)
      return true
    })
    .sort((a, b) => instant(a) - instant(b))
}

/**
 * L'instant d'une ligne, pour le tri. Timestamp Firestore côté serveur, Date
 * côté marquage optimiste, chaîne côté import.
 */
function instant(transaction) {
  const brut = transaction?.createdAt
  if (!brut) return 0
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

/**
 * Les livraisons groupées par expéditeur, avec le total encore dû à chacun.
 *
 * C'EST CE TOTAL QUI RÈGLE LE SOIR, pas le total général. L'argent n'est pas
 * fongible d'un expéditeur à l'autre : on ne solde pas une livraison de l'un
 * avec ce qu'on doit à l'autre. Un seul grand total masquerait précisément la
 * distinction qui compte.
 *
 * Les groupes sortent par ancienneté de leur plus vieille livraison : celui
 * qui attend depuis le plus longtemps est en tête.
 */
export function grouperParExpediteur(ravitaillements = []) {
  const groupes = new Map()

  for (const ravitaillement of ravitaillements) {
    const nom = ravitaillement.expediteur || 'Sans expéditeur'
    const cle = plier(nom)
    if (!groupes.has(cle)) groupes.set(cle, { expediteur: nom, total: 0, lignes: [] })
    const groupe = groupes.get(cle)
    groupe.total += Number(ravitaillement.remainingAmount) || 0
    groupe.lignes.push(ravitaillement)
  }

  return [...groupes.values()]
}

/**
 * Les noms proposés dans la liste déroulante.
 *
 * Profil + tout expéditeur déjà vu dans l'historique chargé. Un nom ajouté par
 * la boutique y figure PAR CONSTRUCTION : il n'est mémorisé que parce qu'il a
 * servi, donc il porte au moins une ligne.
 *
 * Si une pagination ancienne le laissait hors du lot chargé, le retaper le
 * retrouve quand même : le serveur résout toute saisie contre la liste
 * mémorisée complète et renvoie l'orthographe déjà connue. L'écran peut donc
 * être incomplet sans jamais créer un doublon.
 */
export function expediteursConnus(transactions = []) {
  const vus = new Map()
  for (const nom of EXPEDITEURS_PROFIL) vus.set(plier(nom), nom)

  for (const transaction of transactions) {
    if (transaction?.type !== TYPE_RAVITAILLEMENT) continue
    const nom = transaction?.expediteur
    if (!nom) continue
    const cle = plier(nom)
    if (!vus.has(cle)) vus.set(cle, nom)
  }

  return [...vus.values()]
}

/** Les retours d'une livraison, du plus récent au plus ancien. */
export function retoursDe(transactions = [], replenishmentId) {
  return transactions
    .filter((transaction) =>
      transaction?.type === TYPE_RETOUR
      && transaction?.replenishmentId === replenishmentId
      && !transaction?.deletedAt)
    .sort((a, b) => instant(b) - instant(a))
}
