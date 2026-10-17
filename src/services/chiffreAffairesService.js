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
 *   déjà sa surcharge d'index COLLECTION_GROUP dans les deux sens ; `statut`
 *   et `type` demandent chacun leur propre index composite avec `createdAt`
 *   (`firestore.indexes.json`).
 *
 * ⚠ SIX AGRÉGATIONS, PAS UN `not-in` — C'EST LE CŒUR DE LA TÂCHE 9.
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
 *   La seule alternative que Firestore accepte est donc une soustraction :
 *   le total de la plage, sans aucun filtre, MOINS les cinq catégories qui ne
 *   sont pas du chiffre d'affaires client (ci-dessous). JAMAIS un `type in
 *   [...]` positif non plus : il écarterait en silence tout type inattendu ou
 *   absent — exactement le piège de `not-in` que cette tâche corrige. Une
 *   liste d'exclusion peut sur-compter (visible, corrigeable) ; une liste
 *   d'inclusion peut sous-compter en silence (invisible). Six agrégations au
 *   lieu d'une coûtent environ 1 lecture par millier de documents chacune : le
 *   surcoût est négligeable face au risque de sous-évaluation silencieuse.
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
 *   4 570 000 au lieu de 350 000 — le chiffre dominé par de l'argent que le
 *   réseau s'envoie à lui-même, pas par ce que les clients ont déposé.
 *
 * ⚠ PAS DE DOUBLE COMPTAGE ENTRE LES SIX TERMES — UN INVARIANT SERVEUR, PAS
 *   UNE COÏNCIDENCE. Une ligne pourrait en théorie être soustraite deux fois
 *   (une fois comme `'Annulée'`, une fois comme `'Ravitaillement'`) si les
 *   deux catégories se recoupaient. Elles ne se recoupent PAS aujourd'hui :
 *   `storeTransactionCommand.js:49` définit `UNCANCELLABLE_TYPES` comme
 *   EXACTEMENT `[Ravitaillement, Clôture, Retour]`, et `refuserSiIntouchable`
 *   (`:79`) refuse l'annulation, la suppression ET la réouverture sur ces
 *   trois types. Un ravitaillement ne peut donc jamais porter `statut:
 *   'Annulée'` ou `'Supprimée'`. **Le jour où un de ces types deviendrait
 *   annulable, cette soustraction double-compterait en silence** — à
 *   revérifier si `UNCANCELLABLE_TYPES` change.
 */

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
 * Une seule agrégation `sum(montant)`, sur la plage donnée, avec UN filtre
 * d'égalité optionnel — `statut` OU `type`, jamais `not-in` ni `in` (voir le
 * commentaire d'en-tête).
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
 *   `total: null` + `incomplet: false` → au moins une des six requêtes a
 *     échoué. Jamais un total partiel : une soustraction dont un terme manque
 *     n'est pas un chiffre d'affaires — vérifié y compris quand c'est un terme
 *     du MILIEU qui manque (`tc-272`, panne sur l'agrégat « ravitaillement »).
 *   `total: null` + `incomplet: true`  → au moins une des six réponses n'a pas
 *     la forme attendue (`total` absent ou non numérique côté SDK). En
 *     pratique, un `montant` non numérique EN BASE n'emprunte PAS ce chemin —
 *     voir la mise en garde sur `agregerMontant` ci-dessus.
 *   `total: 0` → une vraie période sans opération, et c'est une information.
 *
 * ⚠ TOTAL NÉGATIF — ASSUMÉ, PAS MASQUÉ. Les six agrégations ne sont pas
 *   atomiques : une opération créée PUIS annulée entre deux instantanés serait
 *   soustraite sans avoir été comptée dans le total, sur une fenêtre de
 *   quelques millisecondes. Un plancher à 0 rendrait cette incohérence
 *   invisible ; elle ne l'est pas ici, délibérément — un total négatif est une
 *   anomalie assez rare et assez parlante pour qu'on préfère la montrer que la
 *   maquiller. Aucun garde-fou ajouté : son coût (une septième lecture pour
 *   vérifier la cohérence) dépasserait ce qu'il rapporte pour une fenêtre de
 *   course aussi étroite.
 */
export async function chiffreAffaires({ type, cle }) {
  const { debut, fin } = bornesPeriode({ type, cle })

  const [total, annulees, supprimees, ravitaillements, retours, clotures] = await Promise.all([
    // Le total brut de la plage, SANS AUCUN FILTRE : c'est la seule des six
    // qui n'a besoin d'aucun index nouveau (`createdAt` porte déjà sa
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
    // ⚠ RONDE DE CORRECTION 1 (CRITIQUE) — LES TROIS LIGNES SUIVANTES SONT LA
    //   CORRECTION, PAS UN DÉTAIL. Voir le commentaire d'en-tête : sans elles,
    //   la carte additionne le float que le dealer fait transiter par la
    //   boutique, pas ce que les clients ont déposé.
    agregerMontant({ debut, fin, type: 'Ravitaillement' }),
    agregerMontant({ debut, fin, type: 'Retour' }),
    agregerMontant({ debut, fin, type: 'Clôture' }),
  ])

  const termes = [total, annulees, supprimees, ravitaillements, retours, clotures]

  // Une panne prime sur tout le reste : si l'un des six termes n'a pas pu être
  // lu, la soustraction entière est invalide, que les cinq autres soient
  // lisibles ou non — y compris si le terme en échec est un terme du MILIEU
  // (`tc-272` verrouille ce cas précisément parce que c'est le plus facile à
  // rater : un `if` qui ne teste que le premier et le dernier terme le
  // laisserait passer).
  if (termes.some((t) => t.echec)) {
    return { total: null, incomplet: false }
  }
  if (termes.some((t) => !t.ok)) {
    return { total: null, incomplet: true }
  }
  return {
    total: total.valeur - annulees.valeur - supprimees.valeur
      - ravitaillements.valeur - retours.valeur - clotures.valeur,
    incomplet: false,
  }
}
