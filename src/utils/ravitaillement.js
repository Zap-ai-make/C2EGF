import { activeProfile } from '../config/activeClientProfile.js'
import { parseFcfaAmount } from './fcfaAmount.js'
import { formatCurrency } from './formatCurrency.js'

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

/** Les deux réserves qu'un ravitaillement remplit et qu'un retour vide. */
export const VASES = Object.freeze([
  { cle: 'stock', libelle: 'Stock' },
  { cle: 'liquidite', libelle: 'Espèce' },
])

export const libelleVase = (cle) => VASES.find((v) => v.cle === cle)?.libelle ?? cle

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

const estUnVase = (cle) => VASES.some((v) => v.cle === cle)

/**
 * La livraison prête à partir au serveur, ou la raison du refus.
 *
 * Le formulaire et l'assistant envoient la même commande : celle-ci. Le
 * serveur reste le garant (il résout l'expéditeur contre les noms connus et
 * le réseau depuis le profil) ; ce contrôle évite seulement un aller-retour
 * voué au refus.
 *
 * @returns {{ok: true, valeur: number, commande: object} | {ok: false, motif: string, raison: string}}
 */
export function preparerRavitaillement({ montant, vase, expediteur, note }) {
  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return { ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).' }
  if (!estUnVase(vase)) return { ok: false, motif: 'vase', raison: 'Réserve inconnue : Stock ou Espèce.' }
  const nom = String(expediteur ?? '').trim()
  if (!nom) return { ok: false, motif: 'expediteur', raison: 'Indiquez de qui vient le ravitaillement.' }

  return {
    ok: true,
    valeur,
    commande: {
      action: 'replenish',
      amount: valeur,
      balanceType: vase,
      expediteur: nom,
      note: String(note ?? '').trim() || undefined,
    },
  }
}

/**
 * Le retour prêt à partir, ou lequel des deux plafonds bloque.
 *
 * Le reste dû dit ce que la boutique DEVRAIT rendre ; le disponible, ce
 * qu'elle PEUT rendre dans la réserve choisie. Le motif les distingue parce
 * qu'ils se corrigent autrement : l'un en rendant moins, l'autre en rendant
 * dans l'autre réserve.
 *
 * @param {object} p
 * @param {object} p.ravitaillement  la livraison, avec `id` et `remainingAmount`
 * @param {number} p.disponible      ce que contient la réserve choisie, sur le réseau débité
 * @returns {{ok: true, valeur: number, commande: object} | {ok: false, motif: string, raison: string}}
 */
export function preparerRetour({ ravitaillement, montant, vase, disponible }) {
  const reste = Number(ravitaillement?.remainingAmount) || 0
  const valeur = parseFcfaAmount(montant)
  if (valeur === null) return { ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).' }
  if (!estUnVase(vase)) return { ok: false, motif: 'vase', raison: 'Réserve inconnue : Stock ou Espèce.' }
  if (valeur > reste) return { ok: false, motif: 'reste', raison: `Supérieur au reste dû (${formatCurrency(reste)}).` }
  if (valeur > disponible) {
    return {
      ok: false,
      motif: 'reserve',
      raison: `${libelleVase(vase)} insuffisant${vase === 'liquidite' ? 'e' : ''}. Disponible : ${formatCurrency(disponible)}.`,
    }
  }

  return {
    ok: true,
    valeur,
    commande: {
      action: 'returnReplenishment',
      replenishmentId: ravitaillement.id,
      amount: valeur,
      balanceType: vase,
    },
  }
}
