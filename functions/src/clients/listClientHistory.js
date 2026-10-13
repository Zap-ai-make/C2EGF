/**
 * listClientHistory.js — tout ce qu'un agent a fait, quelle que soit la boutique.
 *
 * POURQUOI CETTE FONCTION EXISTE
 * ──────────────────────────────
 * `firestore.rules` ferme `clients/{storeId}/history` aux autres boutiques, et
 * la lecture par groupe de collections est réservée au gérant système. Aucune
 * requête navigateur ne peut donc répondre à « combien cet agent doit-il, toutes
 * boutiques confondues ». L'Admin SDK le peut, et c'est ici qu'on décide ce qui
 * sort — exactement le motif de `listOutstandingDrafts` pour le dealer.
 *
 * ⚠ LE DEALER EST REFUSÉ. Les règles ne lui donnent qu'un agrégat sans identité
 *   client ; cette fonction rend des noms et des montants nominatifs.
 */

import { AggregateField } from 'firebase-admin/firestore'
import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'
import { construireHistoriqueClient } from './historiqueClient.js'

/** La taille d'une page. Le panneau charge la suite à la demande. */
export const PAGE = 50

export function validerClientId(valeur) {
  if (typeof valeur !== 'string' || valeur.trim().length === 0 || valeur !== valeur.trim() || valeur.length > 128) {
    throw new DealerRequestError('INVALID_CLIENT_ID', 'Identifiant client invalide.')
  }
  return valeur
}

/**
 * Le curseur, ou `null` s'il n'y en a pas.
 *
 * ⚠ C'EST LE CHEMIN DU DERNIER DOCUMENT LU, PAS UN HORODATAGE. Mesuré sur
 *   émulateur : un curseur construit depuis `toMillis()` perd les nanosecondes,
 *   et tout document de la même milliseconde mais de nanos inférieurs disparaît
 *   de la page suivante — sans erreur, sans compteur. Repartir du SNAPSHOT
 *   compare les valeurs réelles, à pleine précision.
 *
 * ⚠ UN CURSEUR MAL FORMÉ EST REFUSÉ, JAMAIS IGNORÉ. L'ignorer renverrait
 *   silencieusement la première page : l'appelant croirait avancer et relirait
 *   indéfiniment les mêmes lignes.
 */
export function validerCurseur(valeur) {
  if (valeur === undefined || valeur === null) return null
  const chemin = valeur?.chemin
  if (
    typeof valeur !== 'object'
    || Array.isArray(valeur)
    || typeof chemin !== 'string'
    || !/^clients\/[^/]+\/history\/[^/]+$/.test(chemin)
  ) {
    throw new DealerRequestError('INVALID_HISTORY_CURSOR', 'Curseur de pagination invalide.')
  }
  return { chemin }
}

const validerProfilBoutique = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (profile.role === 'dealer') {
    throw new DealerRequestError('HISTORY_ROLE_FORBIDDEN', "L'historique nominatif d'un agent n'est pas accessible au dealer.")
  }
}

/**
 * Les totaux, calculés sur TOUT l'historique du client.
 *
 * ⚠ ILS NE PORTENT PAS SUR LA PAGE. Un nombre qui grandit à chaque « charger
 *   plus » se lit comme un total alors qu'il n'en est pas un.
 *
 * ⚠ CE SONT DES COMPTES, PAS DES SOMMES, ET C'EST UNE DÉCISION. Une ligne
 *   annulée ou mise à la corbeille garde son `montant` alors que l'argent est
 *   déjà revenu aux soldes : l'additionner ferait dire au panneau que l'agent a
 *   déposé une somme qui n'existe plus. L'exclure proprement demanderait de
 *   soustraire des agrégats filtrés sur le statut ET sur le type — deux
 *   énumérations qui sous-estiment en silence ce qu'elles ne connaissent pas.
 *   Les seuls chiffres financiers du panneau viennent donc des non terminées,
 *   qui sont lues en entier : `resteAEncaisser` et `resteAPayer`.
 *
 * ⚠ LE COMPTE GLOBAL SE FAIT SANS `orderBy`, ET C'EST TOUT LE POINT. Firestore
 *   exclut d'une requête triée les documents qui ne portent pas le champ trié :
 *   une vieille ligne sans `createdAt` ne peut pas être listée. Mesuré sur
 *   émulateur : 3 documents au total, 2 seulement une fois `orderBy('createdAt')`
 *   posé. L'écart devient `nonDatees` — un nombre affiché plutôt qu'un silence.
 */
async function calculerTotaux(db, clientId) {
  const base = db.collectionGroup('history').where('clientId', '==', clientId)

  const [global, datees] = await Promise.all([
    base.aggregate({ n: AggregateField.count() }).get(),
    base.orderBy('createdAt', 'desc').aggregate({ n: AggregateField.count() }).get(),
  ])

  const operations = global.data().n ?? 0
  return { operations, nonDatees: Math.max(0, operations - (datees.data().n ?? 0)) }
}

/** Le compte d'opérations par boutique — une requête par boutique active. */
async function compterParBoutique(db, clientId, boutiques) {
  const comptes = await Promise.all(boutiques.map(async ({ storeId, storeName }) => {
    const snap = await db.collection(`clients/${storeId}/history`)
      .where('clientId', '==', clientId)
      .aggregate({ n: AggregateField.count() })
      .get()
    return { storeId, storeName, operations: snap.data().n ?? 0 }
  }))
  return comptes
    .filter((b) => b.operations > 0)
    .sort((a, b) => b.operations - a.operations || a.storeName.localeCompare(b.storeName, 'fr'))
}

export async function listClientHistoryHandler(request, { db, taillePage = PAGE }) {
  const actorUid = validateAuthUid(request.auth?.uid)
  validateInputPayload(request.data ?? {}, ['clientId', 'curseur'])
  const clientId = validerClientId(request.data?.clientId)
  const curseur = validerCurseur(request.data?.curseur)

  await readValidatedProfile(db, actorUid, validerProfilBoutique)

  // ⚠ `__name__` EN SECOND CRITÈRE : deux opérations peuvent partager la même
  //   seconde. Un curseur posé sur le seul `createdAt` sauterait les ex æquo ou
  //   les rendrait deux fois. Firestore ajoute `__name__` dans la direction du
  //   dernier `orderBy` — l'index composite couvre donc déjà cette requête.
  let requete = db.collectionGroup('history')
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc')
    .orderBy('__name__', 'desc')
  if (curseur) {
    // ⚠ ON REPART DU SNAPSHOT, pas d'une valeur reconstruite : `startAfter`
    //   compare alors les champs triés à leur précision réelle, nanosecondes
    //   comprises. Une lecture de document de plus par page, contre des lignes
    //   d'argent qui disparaissent en silence : le marché est vite fait.
    const depuis = await db.doc(curseur.chemin).get()
    if (!depuis.exists) {
      throw new DealerRequestError(
        'INVALID_HISTORY_CURSOR',
        "Le repère de pagination n'existe plus. Rouvrir l'historique.",
      )
    }
    requete = requete.startAfter(depuis)
  }

  const premierePage = curseur === null

  // On demande une ligne de plus que la page : sa présence dit qu'il reste à
  // lire, sans coûter une seconde requête pour le savoir.
  const [historySnap, draftsSnap, storesSnap] = await Promise.all([
    requete.limit(taillePage + 1).get(),
    premierePage
      ? db.collectionGroup('drafts').where('clientId', '==', clientId).get()
      : Promise.resolve({ docs: [] }),
    db.collection('stores').get(),
  ])

  const nomsDeBoutique = new Map(storesSnap.docs.map((d) => [d.id, d.data()?.name ?? d.id]))

  const encore = historySnap.docs.length > taillePage
  const documentsPage = encore ? historySnap.docs.slice(0, taillePage) : historySnap.docs

  const { enCours, lignes, attente } = construireHistoriqueClient({
    history: documentsPage.map((d) => ({ id: d.id, chemin: d.ref.path, donnees: d.data() ?? {} })),
    drafts: draftsSnap.docs.map((d) => ({ id: d.id, chemin: d.ref.path, donnees: d.data() ?? {} })),
    nomsDeBoutique,
  })

  // ⚠ LE CURSEUR SORT DU DERNIER DOCUMENT LU, PAS DE LA DERNIÈRE LIGNE RENDUE.
  //   Un ravitaillement écarté par `construireHistoriqueClient` ne figure pas
  //   dans `lignes` mais occupe bien une place dans le tri : partir de la
  //   dernière ligne rendue le relirait à chaque page, et la pagination
  //   tournerait en rond sans jamais atteindre la fin.
  const dernier = documentsPage[documentsPage.length - 1]
  const curseurSuivant = encore && dernier ? { chemin: dernier.ref.path } : null

  let totaux = null
  if (premierePage) {
    const boutiques = storesSnap.docs.map((d) => ({ storeId: d.id, storeName: d.data()?.name ?? d.id }))
    const [globaux, parBoutique] = await Promise.all([
      calculerTotaux(db, clientId),
      compterParBoutique(db, clientId, boutiques),
    ])
    totaux = { ...globaux, ...attente, parBoutique }
  }

  return { success: true, enCours, lignes, totaux, curseurSuivant, encore }
}
