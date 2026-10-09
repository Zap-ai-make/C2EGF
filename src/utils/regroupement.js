/**
 * Une ligne par client et par type, plutôt qu'une ligne par transaction.
 *
 * LE PROBLÈME
 * ───────────
 * Un client qui dépose six fois dans la journée occupait six rangées. Le
 * tableau devenait une liste de gestes au lieu d'une liste de clients, et la
 * question qu'on se pose vraiment — « combien ce client a-t-il déposé ? » —
 * demandait d'additionner six montants de tête, sans se tromper de voisin.
 *
 * CE QUI EST REGROUPÉ, ET CE QUI NE L'EST PAS
 * ───────────────────────────────────────────
 *   — Il faut au moins DEUX transactions de même client et même type. Une seule
 *     reste une rangée ordinaire : la replier n'apprendrait rien et coûterait
 *     un clic pour revenir à ce qu'on voyait déjà.
 *   — Il faut un `clientId`. Un ravitaillement et un retour n'en ont pas — les
 *     regrouper les entasserait tous sous un même « sans client », ce qui est
 *     faux : ils viennent de personnes différentes.
 *
 * TOUT EST PUR ICI. Les deux tableaux appellent la même fonction : s'ils
 * groupaient chacun de leur côté, l'historique et les non terminées finiraient
 * par ne plus replier les mêmes lignes, et personne ne le remarquerait.
 */

import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'

/** Accents et casse retirés : l'historique porte des « Dépôt » et des « Depot ». */
const normaliser = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase()

/**
 * Une ligne annulée ne se regroupe pas, et ce n'est pas un détail d'affichage.
 *
 * `cancelHistory` a RENDU son montant aux soldes : l'argent n'a pas bougé. Dans
 * un groupe, elle disparaissait deux fois — son montant s'ajoutait au total, et
 * la colonne Statut qui affichait « Annulée » cède la place au compte
 * d'opérations. Le lecteur voyait donc un total trop grand, sans rien pour s'en
 * douter. Seule, elle garde son badge et ne fausse aucune somme.
 *
 * La corbeille (`deletedAt`) ne passe déjà pas par ici — `useHistoriqueFilters`
 * l'écarte en amont. On la refuse quand même : le tableau des non terminées
 * marque ses suppressions de façon optimiste, avant que le serveur réponde.
 */
const horsRegroupement = (transaction) => Boolean(transaction?.deletedAt)
  || normaliser(transaction?.statut) === normaliser(FIRESTORE_CONFIG.STATUS.CANCELLED)

/** Deux transactions du même client et du même type partagent cette clé. */
const cleDe = (transaction) => {
  if (horsRegroupement(transaction)) return null
  const client = String(transaction?.clientId ?? '').trim()
  if (!client) return null
  return `${client}::${normaliser(transaction.type)}`
}

/**
 * Transforme une liste de transactions en liste de RANGÉES.
 *
 * Une rangée est soit une transaction seule (`{seule: transaction}`), soit un
 * groupe (`{groupe: {...}}`). L'ordre d'entrée est préservé : un groupe occupe
 * la position de sa PREMIÈRE transaction. Les deux tableaux arrivant triés du
 * plus récent au plus ancien, un groupe se range donc à la date de sa
 * transaction la plus récente — là où l'œil l'attend.
 *
 * @param {Array<object>} transactions
 * @returns {Array<{seule?: object, groupe?: {cle: string, client: object, type: string, total: number, lignes: Array<object>}}>}
 */
export function regrouperParClientEtType(transactions = []) {
  const parCle = new Map()

  for (const transaction of transactions) {
    const cle = cleDe(transaction)
    if (!cle) continue
    if (!parCle.has(cle)) parCle.set(cle, [])
    parCle.get(cle).push(transaction)
  }

  const rangees = []
  const groupesPoses = new Set()

  for (const transaction of transactions) {
    const cle = cleDe(transaction)
    const membres = cle ? parCle.get(cle) : null

    // Seule de son espèce, ou sans client : rangée ordinaire, inchangée.
    if (!membres || membres.length < 2) {
      rangees.push({ seule: transaction })
      continue
    }

    // Groupe : posé une seule fois, à la place de sa première transaction.
    if (groupesPoses.has(cle)) continue
    groupesPoses.add(cle)

    rangees.push({
      groupe: {
        cle,
        client: transaction.client,
        clientId: transaction.clientId,
        type: transaction.type,
        total: membres.reduce((somme, ligne) => somme + (Number(ligne.montant) || 0), 0),
        lignes: membres,
      },
    })
  }

  return rangees
}

/**
 * Le nombre de rangées affichées, groupes dépliés compris.
 *
 * Sert au fenêtrage de l'historique, qui a besoin d'un compte AVANT de rendre :
 * un groupe déplié occupe sa propre rangée plus celles de ses lignes.
 */
export function compterRangees(rangees = [], cleDepliee = () => false) {
  return rangees.reduce(
    (total, rangee) => total + 1 + (rangee.groupe && cleDepliee(rangee.groupe.cle) ? rangee.groupe.lignes.length : 0),
    0,
  )
}
