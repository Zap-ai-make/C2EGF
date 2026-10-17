import { collectionGroup, getAggregateFromServer, query, sum, where } from 'firebase/firestore'
import { db } from '../config/firebase.js'
import { getBusinessDayBounds } from '../utils/businessDate.js'

/**
 * Le chiffre d'affaires du réseau, sur une journée ou un mois.
 *
 * ⚠ UNE AGRÉGATION, PAS UNE LECTURE. `getAggregateFromServer` est facturée
 *   environ une lecture par millier de documents parcourus. Descendre les
 *   opérations du réseau pour les additionner dans le navigateur coûterait une
 *   lecture par document — et ferait transiter l'historique entier.
 *
 * ⚠ AUCUNE CLOUD FUNCTION. Les règles autorisent déjà le patron à lire
 *   `history` en collection-group, et `createdAt` porte déjà sa surcharge
 *   d'index COLLECTION_GROUP dans les deux sens. Seule la paire
 *   `statut` + `createdAt` demande un index composite (`firestore.indexes.json`).
 *
 * ⚠ TROIS AGRÉGATIONS, PAS UN `not-in` — C'EST LE CŒUR DE LA TÂCHE 9.
 *   Le plan d'origine filtrait avec `where('statut', 'not-in', [...])`. Cette
 *   requête est acceptée par Firestore (vérifié contre l'émulateur,
 *   `tests/functions/tc-273-ca-forme-de-requete.test.js`) — mais `not-in`
 *   écarte EN SILENCE tout document où le champ `statut` est ABSENT. Or
 *   l'application traite un `statut` manquant comme « Validée »
 *   (`src/components/clients/LigneHistorique.jsx:100`,
 *   `src/utils/helpers.js:443`) : une ligne d'historique ancienne ou issue
 *   d'un flux paiement-unique legacy est donc du vrai chiffre d'affaires que
 *   `not-in` ferait disparaître sans qu'aucun écran ne puisse le soupçonner.
 *   Mesuré sur un jeu de quatre lignes : `not-in` rend 1 000 là où la vérité
 *   est 8 000 (soit une sous-évaluation de 87 % sur ce jeu).
 *
 *   La seule alternative que Firestore accepte est donc une soustraction :
 *   le total de la plage, sans filtre de statut, MOINS les deux statuts qui
 *   défont réellement de l'argent (ci-dessous). Trois agrégations au lieu
 *   d'une coûtent environ 1 lecture par millier de documents chacune : le
 *   surcoût est négligeable face au risque de sous-évaluation silencieuse.
 */

/**
 * Les bornes d'une période.
 *
 * ⚠ LA JOURNÉE D'EXPLOITATION, PAS LA JOURNÉE UTC. `getBusinessDayBounds` lit
 *   le fuseau du profil client. Les deux coïncident pour C2EGF (le Burkina est
 *   à UTC+0), mais le profil porte le fuseau précisément pour qu'une autre
 *   instance du produit n'hérite pas d'un découpage faux.
 */
export function bornesPeriode({ type, cle }) {
  if (type === 'mois') {
    const [annee, mois] = String(cle).split('-').map(Number)
    return {
      debut: new Date(Date.UTC(annee, mois - 1, 1)),
      fin: new Date(Date.UTC(annee, mois, 1)),
    }
  }
  // `getBusinessDayBounds` rend deja deux `Date` : les re-envelopper
  // masquerait une erreur de type si sa signature changeait.
  const { start, end } = getBusinessDayBounds(cle)
  return { debut: start, fin: end }
}

/**
 * Une seule agrégation `sum(montant)`, sur la plage donnée, avec un filtre de
 * statut optionnel (`==`, jamais `not-in` — voir le commentaire d'en-tête).
 *
 * ⚠ TROIS ISSUES DISTINCTES, PAS DEUX. `chiffreAffaires` doit pouvoir
 *   distinguer « cette agrégation a échoué » (la requête a levé — index
 *   manquant, hors-ligne…) de « cette agrégation a répondu mais la somme
 *   n'est pas un nombre » (des `montant` non numériques dorment en base et
 *   `sum()` les a ignorés) : la première ne doit JAMAIS se travestir en 0 ni
 *   en l'autre, parce que l'appelant réagit différemment aux deux (brief de
 *   la tâche 9, contrats de sortie).
 * @returns {Promise<{ok: true, valeur: number} | {ok: false, echec: boolean}>}
 */
async function agregerMontant({ debut, fin, statut }) {
  const clauses = [
    where('createdAt', '>=', debut),
    where('createdAt', '<', fin),
  ]
  if (statut) clauses.push(where('statut', '==', statut))

  try {
    const instantane = await getAggregateFromServer(
      query(collectionGroup(db, 'history'), ...clauses),
      { total: sum('montant') },
    )
    const valeur = instantane.data()?.total
    if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
      return { ok: false, echec: false }
    }
    return { ok: true, valeur }
  } catch (erreur) {
    console.error('[chiffreAffaires] agrégat indisponible', erreur)
    return { ok: false, echec: true }
  }
}

/**
 * @returns {Promise<{total: number|null, incomplet: boolean}>}
 *   `total: null` + `incomplet: false` → au moins une des trois requêtes a
 *     échoué. Jamais un total partiel : une soustraction dont un terme manque
 *     n'est pas un chiffre d'affaires.
 *   `total: null` + `incomplet: true`  → les trois requêtes ont répondu, mais
 *     au moins une somme n'est pas un nombre : des montants non numériques
 *     dorment dans la base et `sum()` les a ignorés.
 *   `total: 0` → une vraie journée sans opération, et c'est une information.
 */
export async function chiffreAffaires({ type, cle }) {
  const { debut, fin } = bornesPeriode({ type, cle })

  const [total, annulees, supprimees] = await Promise.all([
    // Le total brut de la plage, SANS filtre de statut : c'est la seule des
    // trois qui n'a besoin d'aucun index nouveau (`createdAt` porte déjà sa
    // surcharge COLLECTION_GROUP dans les deux sens).
    agregerMontant({ debut, fin }),
    // Une opération annulée n'a jamais eu lieu : `reverseHistoryTransactionImpact`
    // défait son impact sur les soldes (`storeTransactionCommand.js:556-557`).
    // La compter dans le CA afficherait de l'argent qui n'a jamais bougé.
    agregerMontant({ debut, fin, statut: 'Annulée' }),
    // ⚠ DIVERGENCE VOLONTAIRE AVEC `reseauStats.js` — NE PAS ALIGNER L'UN SUR
    //   L'AUTRE. `compteCommeVolume` (src/utils/reseauStats.js:57-58), qui sert
    //   au classement des agents, N'exclut PAS les opérations supprimées : le
    //   volume y reste donc gonflé de ce qui a été effacé. Le CA réseau, lui,
    //   exclut `'Supprimée'` : une suppression appelle elle aussi
    //   `reverseHistoryTransactionImpact` (`storeTransactionCommand.js:583-585`)
    //   — les soldes ont été défaits exactement comme pour une annulation.
    //   Compter cette ligne ferait lire au patron de l'argent qui a été rendu.
    //   Décision produit assumée (brief de la tâche 9, §4) : à remonter au
    //   patron comme un écart entre les deux écrans, pas à corriger ici en
    //   silence.
    agregerMontant({ debut, fin, statut: 'Supprimée' }),
  ])

  // Une panne prime sur tout le reste : si l'un des trois termes n'a pas pu
  // être lu, la soustraction entière est invalide, que les deux autres soient
  // lisibles ou non.
  if (total.echec || annulees.echec || supprimees.echec) {
    return { total: null, incomplet: false }
  }
  if (!total.ok || !annulees.ok || !supprimees.ok) {
    return { total: null, incomplet: true }
  }
  return { total: total.valeur - annulees.valeur - supprimees.valeur, incomplet: false }
}
