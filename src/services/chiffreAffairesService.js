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
 * ⚠ AUCUNE CLOUD FUNCTION. `history` se lit en collection-group directement
 *   depuis le navigateur : `firestore.rules:557-559` autorise ce chemin pour
 *   `isSystemManager()` SEUL (le rôle du patron) — PAS pour `isDealer()`, qui
 *   n'a droit qu'à un agrégat anonymisé par un autre chemin. `createdAt` porte
 *   déjà sa surcharge d'index COLLECTION_GROUP dans les deux sens ; `statut`,
 *   `type`, et leur combinaison demandent chacun leur propre index composite
 *   (`firestore.indexes.json`).
 *
 * ⚠ DOUZE AGRÉGATIONS, PAS UN `not-in` — C'EST LE CŒUR DE LA TÂCHE 9.
 *   Le plan d'origine filtrait avec `where('statut', 'not-in', [...])`. Cette
 *   requête est acceptée par Firestore (vérifié contre l'émulateur,
 *   `tests/functions/tc-273-ca-forme-de-requete.test.js`) — mais `not-in`
 *   écarte EN SILENCE tout document où le champ filtré est ABSENT. Or
 *   l'application traite un `statut` manquant comme « Validée »
 *   (`src/components/clients/LigneHistorique.jsx:100`,
 *   `src/utils/helpers.js:443`) : une ligne d'historique ancienne ou issue
 *   d'un flux paiement-unique legacy est donc du vrai chiffre d'affaires que
 *   `not-in` ferait disparaître sans qu'aucun écran ne puisse le soupçonner.
 *   Mesuré sur un jeu de quatre lignes : `not-in` rend 1 000 là où la vérité
 *   est 8 000 (soit une sous-évaluation de 87 % sur ce jeu).
 *
 *   JAMAIS un `type in [...]` positif non plus : il écarterait en silence
 *   tout type inattendu ou absent — exactement le piège de `not-in`. Une
 *   liste d'exclusion peut sur-compter (visible, corrigeable) ; une liste
 *   d'inclusion peut sous-compter en silence (invisible).
 *
 * ⚠ RONDE DE CORRECTION 1 (CRITIQUE) — `history` NE PORTE PAS QUE DES
 *   OPÉRATIONS CLIENTS. La première version de ce service sommait `montant`
 *   sans filtre de `type`, qui additionnait donc AUSSI le float que le dealer
 *   fait transiter par la boutique :
 *   - `Ravitaillement` (`storeTransactionCommand.js:294`) : `montant: amount`,
 *     l'argent envoyé par le dealer À la boutique ;
 *   - `Clôture` (`:467`) : `montant: total`, la SOMME DES SOLDES stock +
 *     liquidité de la boutique — écrite à CHAQUE clôture, CHAQUE jour, par
 *     CHAQUE boutique ;
 *   - `Retour` (`:763`) : `montant: amount`, ce que la boutique RETOURNE au
 *     dealer.
 *   Aucun des trois ne répond à « combien les clients ont-ils déposé ? » — le
 *   dépôt le savait déjà et l'avait déjà écrit ailleurs : `helpers.js:370`,
 *   `TYPES_DEALER = ['Ravitaillement', 'Retour', 'Clôture']`, exclus de
 *   l'export remis au gérant pour cette exacte raison. Mesuré (`tc-273-03`) :
 *   un ravitaillement de 2 000 000 + une clôture à 1 800 000 + un retour de
 *   420 000, à côté de 350 000 de vraie activité cliente, faisait lire
 *   4 570 000 au lieu de 350 000.
 *
 * ⚠ RONDE DE CORRECTION 2 (R52, CRITIQUE) — LA PREMIÈRE CORRECTION
 *   DOUBLE-COMPTAIT, PARCE QUE SON INVARIANT ÉTAIT FAUX. La ronde 1 soustrayait
 *   SIX termes indépendants (`statut == 'Annulée'`, `'Supprimée'`, et
 *   `type == 'Ravitaillement'|'Retour'|'Clôture'`) en supposant qu'ils ne se
 *   recoupaient JAMAIS — parce que `refuserSiIntouchable`
 *   (`storeTransactionCommand.js:79`) refuse l'annulation et la suppression
 *   sur les trois types dealer (`UNCANCELLABLE_TYPES`, `:49`). **Ce
 *   raisonnement était un non-sequitur** : il suppose que
 *   `refuserSiIntouchable` est le SEUL écrivain de ces statuts, jamais
 *   vérifié. Il ne l'est pas :
 *   - `cancelClosure` (`:513-538`) exige `type === 'Clôture'`, écrit
 *     `statut: 'Annulée'`, et N'APPELLE JAMAIS `refuserSiIntouchable` ;
 *   - `trashReplenishmentReturn` (`:803-829`) exige `type === 'Retour'`,
 *     écrit `statut: 'Supprimée'`, même contournement.
 *   Une clôture annulée entrait donc dans `total`, PUIS se faisait soustraire
 *   DEUX FOIS (une fois via `type == 'Clôture'`, une fois via
 *   `statut == 'Annulée'`) — mesuré (`tc-273-05`) : −1 870 000 au lieu de
 *   350 000 sur un jeu avec une clôture annulée de 1 800 000 et un retour
 *   supprimé de 420 000. Déterministe, reproductible à chaque annulation de
 *   clôture — pas une fenêtre de course.
 *
 *   LA CORRECTION EST DONC UNE INCLUSION-EXCLUSION COMPLÈTE, PAS UN PATCH SUR
 *   CES DEUX CHEMINS CONNUS — précisément parce qu'un raisonnement ciblé sur
 *   des chemins de code nommés vient d'échouer une fois ; un troisième chemin
 *   d'écriture inconnu aujourd'hui ne doit pas pouvoir recasser ce calcul.
 *   Poser A = les trois types dealer, B = `statut == 'Annulée'`,
 *   C = `statut == 'Supprimée'` :
 *
 *     Σ(A∪B∪C) = Σ(A) + Σ(B) + Σ(C) − Σ(A∩B) − Σ(A∩C)
 *     CA        = total − Σ(A∪B∪C)
 *
 *   `B∩C = ∅` est la SEULE hypothèse que cette arithmétique s'autorise encore
 *   — et elle est solide : `statut` est un champ unique, qui ne porte qu'UNE
 *   valeur à la fois (propriété du MODÈLE DE DONNÉES, pas du comportement
 *   serveur). `A∩B` et `A∩C`, en revanche, ne sont PAS supposés vides : ils
 *   sont CALCULÉS, via les six intersections `type × statut` ci-dessous.
 *   Douze agrégations au lieu de six : le coût (environ 1 lecture par millier
 *   de documents chacune) reste négligeable sur un écran que seul le patron
 *   ouvre ; le prix est en lisibilité, payé pour ne dépendre d'aucune promesse
 *   sur qui écrit quoi.
 */

const TYPES_DEALER = Object.freeze(['Ravitaillement', 'Retour', 'Clôture'])
const STATUTS_DEFAITS = Object.freeze(['Annulée', 'Supprimée'])

/**
 * Les bornes d'une période.
 *
 * ⚠ LA JOURNÉE D'EXPLOITATION, PAS LA JOURNÉE UTC — POUR LE JOUR *ET* POUR LE
 *   MOIS. `getBusinessDayBounds` lit le fuseau du profil client. Les deux
 *   coïncident pour C2EGF (le Burkina est à UTC+0), mais le profil porte le
 *   fuseau précisément pour qu'une autre instance du produit n'hérite pas d'un
 *   découpage faux — y compris sur le premier et le dernier jour d'un mois.
 *   ⚠ RONDE DE CORRECTION 1 (I1) — le mois construisait ses bornes en
 *     `Date.UTC` brut, un oubli pointé en relecture : sans effet pour C2EGF
 *     (UTC+0), mais faux dans toute instance décalée. Les deux bornes passent
 *     maintenant par la même fonction que le jour — seule la DATE-CLÉ passée
 *     change (le 1er du mois, puis le 1er du mois suivant).
 */
export function bornesPeriode({ type, cle }) {
  if (type === 'mois') {
    const [annee, mois] = String(cle).split('-').map(Number)
    const { start: debut } = getBusinessDayBounds(`${annee}-${String(mois).padStart(2, '0')}-01`)
    const anneeSuivante = mois === 12 ? annee + 1 : annee
    const moisSuivant = mois === 12 ? 1 : mois + 1
    const { start: fin } = getBusinessDayBounds(`${anneeSuivante}-${String(moisSuivant).padStart(2, '0')}-01`)
    return { debut, fin }
  }
  // `getBusinessDayBounds` rend deja deux `Date` : les re-envelopper
  // masquerait une erreur de type si sa signature changeait.
  const { start, end } = getBusinessDayBounds(cle)
  return { debut: start, fin: end }
}

/**
 * Une seule agrégation `sum(montant)`, sur la plage donnée, avec un filtre
 * d'égalité optionnel sur `statut` ET/OU `type` — jamais `not-in` ni `in`
 * (voir le commentaire d'en-tête). Les deux filtres combinés servent les six
 * intersections de l'inclusion-exclusion (ronde de correction 2).
 *
 * ⚠ TROIS ISSUES DISTINCTES, PAS DEUX. `chiffreAffaires` doit pouvoir
 *   distinguer « cette agrégation a échoué » (la requête a levé — index
 *   manquant, hors-ligne…) de « cette agrégation a répondu, mais sa forme est
 *   inattendue » (`total` absent ou non numérique) : la première ne doit
 *   JAMAIS se travestir en 0 ni en l'autre, parce que l'appelant réagit
 *   différemment aux deux.
 *
 * ⚠ CE QUE CETTE GARDE NE PEUT PAS ATTRAPER — MESURÉ, PAS SUPPOSÉ
 *   (`tc-273-04`) : un `montant` non numérique (`"7000"`, une chaîne) n'est
 *   PAS ignoré en rendant `total` non numérique — `sum()` l'exclut purement
 *   et simplement DU CALCUL, et répond un nombre tout à fait valide (measuré :
 *   1000 sur {1000, "7000"}, pas `null`, pas `NaN`). Firestore ne signale donc
 *   JAMAIS, dans la réponse de l'agrégat, qu'une valeur a été écartée : un
 *   `montant` corrompu sous-évalue le CA sans qu'aucune combinaison de champs
 *   de la réponse ne le révèle. Le fermer demanderait de lire chaque document
 *   un par un pour vérifier le TYPE de son `montant` — exactement le coût par
 *   lecture que l'agrégation sert à éviter. Ce risque est donc ACCEPTÉ, pas
 *   fermé : la garde ci-dessous protège contre une réponse dont la FORME est
 *   inattendue (champ absent, SDK qui change), pas contre ce cas précis, qui
 *   ne lève aucun signal détectable à ce niveau.
 * @returns {Promise<{ok: true, valeur: number} | {ok: false, echec: boolean}>}
 */
async function agregerMontant({ debut, fin, statut, type }) {
  const clauses = [
    where('createdAt', '>=', debut),
    where('createdAt', '<', fin),
  ]
  if (statut) clauses.push(where('statut', '==', statut))
  if (type) clauses.push(where('type', '==', type))

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
 *   `total: null` + `incomplet: false` → au moins une des douze requêtes a
 *     échoué. Jamais un total partiel : une soustraction dont un terme manque
 *     n'est pas un chiffre d'affaires.
 *   `total: null` + `incomplet: true`  → les douze requêtes ont répondu, mais
 *     au moins une n'a pas la forme attendue (`total` absent ou non numérique
 *     côté SDK). En pratique, un `montant` non numérique EN BASE n'emprunte
 *     PAS ce chemin — voir la mise en garde sur `agregerMontant` ci-dessus.
 *   `total: 0` → une vraie période sans opération, et c'est une information.
 *
 * ⚠ TOTAL NÉGATIF — ASSUMÉ, PAS MASQUÉ. Les douze agrégations ne sont pas
 *   atomiques : une opération créée PUIS annulée entre deux instantanés serait
 *   soustraite sans avoir été comptée dans le total, sur une fenêtre de
 *   quelques millisecondes. Un plancher à 0 rendrait cette incohérence
 *   invisible ; elle ne l'est pas ici, délibérément — un total négatif est une
 *   anomalie assez rare et assez parlante pour qu'on préfère la montrer que la
 *   maquiller. Ceci est DISTINCT du double comptage corrigé en ronde 2 (R52),
 *   qui était déterministe et reproductible, pas une course.
 */
export async function chiffreAffaires({ type, cle }) {
  const { debut, fin } = bornesPeriode({ type, cle })

  const [total, parType, parStatut, intersections] = await Promise.all([
    // Le total brut de la plage, SANS AUCUN FILTRE : c'est la seule des douze
    // qui n'a besoin d'aucun index nouveau (`createdAt` porte déjà sa
    // surcharge COLLECTION_GROUP dans les deux sens).
    agregerMontant({ debut, fin }),
    // Σ(A) — décomposée par type (3 agrégations indépendantes), jamais un
    // `type in [...]` unique (voir le commentaire d'en-tête).
    Promise.all(TYPES_DEALER.map((t) => agregerMontant({ debut, fin, type: t }))),
    // Σ(B) + Σ(C) — annulée et supprimée, qui ne se recoupent jamais entre
    // elles (`statut` est un champ unique, voir le commentaire d'en-tête).
    Promise.all(STATUTS_DEFAITS.map((s) => agregerMontant({ debut, fin, statut: s }))),
    // ⚠ RONDE DE CORRECTION 2 (R52) — Σ(A∩B) ET Σ(A∩C), EN BOUCLE SUR LES DEUX
    //   LISTES, PAS À LA MAIN. Six intersections type × statut : copiées-collées
    //   une par une, elles auraient fini par diverger (un type oublié, un
    //   statut mal orthographié) sans qu'aucun test ne le voie passer avant
    //   l'émulateur. La boucle les fait toutes exister par construction dès
    //   qu'un type ou un statut s'ajoute aux deux listes ci-dessus.
    Promise.all(
      TYPES_DEALER.flatMap((t) => STATUTS_DEFAITS.map((s) => agregerMontant({ debut, fin, type: t, statut: s }))),
    ),
  ])

  const termes = [total, ...parType, ...parStatut, ...intersections]

  // Une panne prime sur tout le reste : si l'un des douze termes n'a pas pu
  // être lu, la soustraction entière est invalide, que les onze autres soient
  // lisibles ou non — y compris un terme du MILIEU (`tc-272` le verrouille).
  if (termes.some((t) => t.echec)) {
    return { total: null, incomplet: false }
  }
  if (termes.some((t) => !t.ok)) {
    return { total: null, incomplet: true }
  }

  const sommeTypes = parType.reduce((s, t) => s + t.valeur, 0)
  const sommeStatuts = parStatut.reduce((s, t) => s + t.valeur, 0)
  const sommeIntersections = intersections.reduce((s, t) => s + t.valeur, 0)

  // CA = total − Σ(A∪B∪C) = total − (Σ(A) + Σ(B) + Σ(C) − Σ(intersections))
  // Voir le commentaire d'en-tête pour la dérivation complète.
  return {
    total: total.valeur - sommeTypes - sommeStatuts + sommeIntersections,
    incomplet: false,
  }
}
