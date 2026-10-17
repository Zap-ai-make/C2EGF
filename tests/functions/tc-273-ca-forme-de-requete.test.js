/**
 * TC-273 — la forme de la requête de chiffre d'affaires, contre le vrai
 * émulateur Firestore (pas un mock).
 *
 * ⚠ POURQUOI CE TEST EXISTE. Les sept tests de TC-272 montent
 *   `vi.mock('firebase/firestore')` : ils vérifient la FORME de l'appel (quels
 *   arguments passent à `where`), jamais ce que Firestore en ferait
 *   réellement. C'est exactement ce qui a laissé passer le défaut du brief de
 *   la tâche 9 : `where('statut', 'not-in', [...])` est accepté SANS ERREUR
 *   par Firestore — y compris en agrégation — et rend un résultat ; mais
 *   `not-in` écarte EN SILENCE les documents où le champ `statut` est ABSENT,
 *   alors que l'application traite un `statut` manquant comme « Validée »
 *   (`src/components/clients/LigneHistorique.jsx:100`,
 *   `src/utils/helpers.js:443`). Un mock ne peut pas reproduire cette règle de
 *   Firestore : seul le vrai émulateur le peut.
 *
 * Quatre lignes d'historique, une seule plage de dates, quatre boutiques
 * différentes (pour que le collection-group travaille vraiment) :
 *   validée     → statut 'Validée'   → montant 1000
 *   annulée     → statut 'Annulée'   → montant  500
 *   supprimée   → statut 'Supprimée' → montant  300
 *   sans statut → champ ABSENT      → montant 7000 (= une vraie « Validée »
 *                 silencieuse, voir la citation plus haut)
 *
 * Vérité terrain du chiffre d'affaires sur ce jeu : 8 000 (validée + sans
 * statut — les deux seules lignes qui n'ont pas vu leurs soldes défaits).
 *
 * Handler integration avec Firestore Emulator — même montage que TC-035 et
 * TC-256 : Admin SDK pointé sur l'émulateur, base vidée entre les tests.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet
 * demo-akayis-test, aucun accès production).
 *
 * ⚠ CE QUE CE FICHIER NE VERROUILLE PAS (ronde de correction 1, I6). Les
 *   requêtes ci-dessous sont réécrites À LA MAIN avec l'Admin SDK — ce fichier
 *   N'IMPORTE JAMAIS `src/services/chiffreAffairesService.js`, qui dépend du
 *   SDK navigateur (`firebase/firestore`) et ne peut pas tourner ici. Il
 *   atteste donc une PROPRIÉTÉ DE FIRESTORE (`not-in` répond, `sum()` ignore
 *   les valeurs non numériques, un `type` dealer se filtre comme un `statut`),
 *   pas une propriété du code du service. Si quelqu'un réécrivait un jour le
 *   service en `not-in`, CE FICHIER RESTERAIT VERT — le verrou réel contre ce
 *   retour en arrière est `[TC-272-07]` (`tests/unit/tc-272-chiffre-affaires.test.js`),
 *   qui inspecte les appels `where` du VRAI service.
 *
 * Deux rondes de correction supplémentaires, mesurées ici :
 *   - [TC-273-03] : `history` porte aussi du float dealer (ravitaillement,
 *     retour, clôture) qui n'est pas du chiffre d'affaires client — voir son
 *     en-tête.
 *   - [TC-273-04] : ce que `sum()` fait RÉELLEMENT d'un `montant` en chaîne
 *     (mesuré, pas supposé) — voir son en-tête.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, AggregateField } from 'firebase-admin/firestore'

let adminApp
let db

// Aucun fallback — une exécution sans firebase emulators:exec doit échouer
// avant d'initialiser l'Admin SDK, pour empêcher tout accès à Firebase
// production (même garde que TC-035).
const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) {
    throw new Error(
      'SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. ' +
      'Lancer via : npm run test:functions'
    )
  }
  if (!PROJECT_ID) {
    throw new Error(
      'SÉCURITÉ : GCLOUD_PROJECT non défini. ' +
      'Lancer via : npm run test:functions'
    )
  }
  if (!PROJECT_ID.startsWith('demo-')) {
    throw new Error(`SÉCURITÉ : projectId non-demo. Valeur reçue : "${PROJECT_ID}"`)
  }
  if (PROJECT_ID !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${PROJECT_ID}"`)
  }
  if (['taofic-ajagbe', 'c2egf-b0b5a'].includes(PROJECT_ID)) {
    throw new Error('SÉCURITÉ : projectId de production interdit.')
  }
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

const BOUTIQUES = [
  'boutique-a', 'boutique-b', 'boutique-c', 'boutique-d',
  'boutique-e', 'boutique-f', 'boutique-g', 'boutique-h',
  'boutique-montant-texte',
]

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

// ⚠ TIMEOUT EXPLICITE, MÊME RAISON QUE TC-256 : neuf boutiques à vider à
//   chaque test, et le tout premier appel après le démarrage de l'émulateur
//   peut dépasser le défaut de 10 s à lui seul (mesuré : 7 à 10 s sur cette
//   machine). Un timeout par défaut ferait échouer le PREMIER test du fichier
//   pour une raison qui n'a rien à voir avec lui.
beforeEach(async () => {
  await Promise.all(BOUTIQUES.map((b) => effacer(`clients/${b}/history`)))
}, 30000)

// La plage couvre une seule journée ; les quatre lignes tombent au milieu,
// l'heure exacte n'a aucune importance pour ce test.
const DEBUT = new Date('2026-10-15T00:00:00.000Z')
const FIN = new Date('2026-10-16T00:00:00.000Z')
const DANS_LA_PLAGE = Timestamp.fromDate(new Date('2026-10-15T12:00:00.000Z'))

async function semerLesQuatreLignes() {
  await Promise.all([
    db.doc('clients/boutique-a/history/validee').set({ statut: 'Validée', montant: 1000, createdAt: DANS_LA_PLAGE }),
    db.doc('clients/boutique-b/history/annulee').set({ statut: 'Annulée', montant: 500, createdAt: DANS_LA_PLAGE }),
    db.doc('clients/boutique-c/history/supprimee').set({ statut: 'Supprimée', montant: 300, createdAt: DANS_LA_PLAGE }),
    // ⚠ LA LIGNE QUI PORTE TOUT LE TEST : AUCUN CHAMP `statut`. C'est le cas
    //   réel d'un history ancien ou d'un flux paiement-unique créé
    //   directement par une boutique (firestore.rules:144-153) : l'application
    //   le traite comme « Validée », donc comme du vrai chiffre d'affaires.
    db.doc('clients/boutique-d/history/sans-statut').set({ montant: 7000, createdAt: DANS_LA_PLAGE }),
  ])
}

describe('TC-273 — la forme de la requête de chiffre d’affaires', () => {
  it('[TC-273-01] notre montage — total − annulées − supprimées — rend 8000', async () => {
    await semerLesQuatreLignes()

    const base = db.collectionGroup('history')
      .where('createdAt', '>=', DEBUT)
      .where('createdAt', '<', FIN)

    const [total, annulees, supprimees] = await Promise.all([
      base.aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('statut', '==', 'Annulée').aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('statut', '==', 'Supprimée').aggregate({ total: AggregateField.sum('montant') }).get(),
    ])

    const resultat = (total.data().total ?? 0) - (annulees.data().total ?? 0) - (supprimees.data().total ?? 0)
    expect(resultat).toBe(8000)
  })

  /**
   * ⚠ LE CŒUR DU TEST. Ce montage n'est PAS celui employé par le service — il
   *   existe ici pour que personne ne « simplifie » un jour les trois
   *   agrégations ci-dessus en une seule requête `not-in`. La requête n'est
   *   PAS rejetée par Firestore (vérifié ici même : aucune exception) — elle
   *   répond, silencieusement fausse. `not-in` exclut tout document où
   *   `statut` est ABSENT : la ligne à 7 000 disparaît sans un mot, alors que
   *   c'est du vrai chiffre d'affaires.
   */
  it('[TC-273-02] le montage not-in du plan répond (ne jette pas) et rend 1000, pas 8000', async () => {
    await semerLesQuatreLignes()

    const snap = await db.collectionGroup('history')
      .where('statut', 'not-in', ['Annulée', 'Supprimée'])
      .where('createdAt', '>=', DEBUT)
      .where('createdAt', '<', FIN)
      .aggregate({ total: AggregateField.sum('montant') })
      .get()

    expect(snap.data().total).toBe(1000)
  })
})

/**
 * TC-273 — ronde de correction 1, CRITIQUE : `history` ne porte pas QUE des
 * opérations clients.
 *
 * ⚠ CE QUE LA SOUSTRACTION OUBLIAIT. `agregerMontant({debut, fin})` sommait
 *   `montant` sur TOUT `history`, sans filtre de `type`. Or trois types n'ont
 *   rien à voir avec « combien les clients ont-ils déposé ? » :
 *   - `Ravitaillement` (`storeTransactionCommand.js:294`) : `montant: amount`,
 *     l'argent que le dealer envoie à la boutique ;
 *   - `Clôture` (`:467`) : `montant: total`, la SOMME DES SOLDES stock +
 *     liquidité de la boutique, écrite à CHAQUE clôture, CHAQUE jour ;
 *   - `Retour` (`:763`) : `montant: amount`, ce que la boutique rend au dealer.
 *
 *   Le dépôt connaît déjà cette règle : `src/utils/helpers.js:370`,
 *   `TYPES_DEALER = ['Ravitaillement', 'Retour', 'Clôture']`, écartés de
 *   l'export remis au gérant précisément parce que « son montant ne répond
 *   pas à combien les clients ont-ils déposé aujourd'hui ».
 *
 * Scénario mesuré ici (repris de la ronde de correction 1) : un ravitaillement
 * de 2 000 000, un retour de 420 000, une clôture à 1 800 000, et 350 000
 * de vraie activité cliente. Le CA du jour vaut 350 000 ; une somme sans
 * filtre de `type` en compterait 4 570 000 — un chiffre dominé par du float
 * que le patron s'envoie à lui-même, pas par ce que ses clients ont déposé.
 */
describe('TC-273 — le float du dealer n’est pas du chiffre d’affaires', () => {
  it('[TC-273-03] total − annulées − supprimées − ravitaillement − retour − clôture rend 350000, pas 4570000', async () => {
    await Promise.all([
      db.doc('clients/boutique-e/history/ravitaillement').set({
        type: 'Ravitaillement', statut: 'Validée', montant: 2000000, createdAt: DANS_LA_PLAGE,
      }),
      db.doc('clients/boutique-f/history/retour').set({
        type: 'Retour', statut: 'Validee', montant: 420000, createdAt: DANS_LA_PLAGE,
      }),
      db.doc('clients/boutique-g/history/cloture').set({
        type: 'Clôture', statut: 'Validée', montant: 1800000, createdAt: DANS_LA_PLAGE,
      }),
      db.doc('clients/boutique-h/history/depot-client').set({
        type: 'Dépôt', statut: 'Validée', montant: 350000, createdAt: DANS_LA_PLAGE,
      }),
    ])

    const base = db.collectionGroup('history')
      .where('createdAt', '>=', DEBUT)
      .where('createdAt', '<', FIN)

    const [total, annulees, supprimees, ravitaillements, retours, clotures] = await Promise.all([
      base.aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('statut', '==', 'Annulée').aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('statut', '==', 'Supprimée').aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('type', '==', 'Ravitaillement').aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('type', '==', 'Retour').aggregate({ total: AggregateField.sum('montant') }).get(),
      base.where('type', '==', 'Clôture').aggregate({ total: AggregateField.sum('montant') }).get(),
    ])

    // La somme SANS filtre de type — ce que le défaut rendait avant
    // correction. Assertion séparée pour que le test documente les DEUX
    // nombres, pas seulement celui qui finit par s'afficher.
    expect(total.data().total ?? 0).toBe(4570000)

    const resultat = (total.data().total ?? 0)
      - (annulees.data().total ?? 0)
      - (supprimees.data().total ?? 0)
      - (ravitaillements.data().total ?? 0)
      - (retours.data().total ?? 0)
      - (clotures.data().total ?? 0)
    expect(resultat).toBe(350000)
  })
})

/**
 * TC-273 — ronde de correction 1, I2 : ce que `sum()` fait RÉELLEMENT d'un
 * `montant` non numérique.
 *
 * ⚠ MESURE, PAS SUPPOSITION. Le brief de la tâche 9 affirmait que `sum()`
 *   « ignore silencieusement » les valeurs non numériques et laisse `total`
 *   intact — une prémisse jamais vérifiée contre l'émulateur. Ce test mesure
 *   le comportement réel : un `montant` en chaîne (`"7000"`) à côté d'un
 *   `montant` numérique (`1000`), sur la même agrégation.
 *
 *   RÉSULTAT MESURÉ : l'agrégat rend **1000** — `sum()` ignore la valeur en
 *   chaîne (elle n'entre pas dans la somme) SANS faire échouer la requête ni
 *   rendre `null`. La prémisse du brief était donc fausse sur le fond (« ça
 *   ne répond pas `null` ») mais juste sur la conséquence pratique (le
 *   `montant` non numérique disparaît silencieusement de la somme — il est
 *   voué à sous-évaluer le CA, jamais à le rendre `null` ou `incomplet`).
 *   Voir `chiffreAffairesService.js` pour ce que ça change au contrat de
 *   sortie `incomplet: true` — ce cas ne l'atteint JAMAIS en pratique.
 */
describe('TC-273 — ronde de correction 1 (I2) : sum() et un montant en chaîne', () => {
  it('[TC-273-04] un montant en chaîne est ignoré par sum(), le total reste un nombre (pas null)', async () => {
    await Promise.all([
      db.doc('clients/boutique-montant-texte/history/numerique').set({
        statut: 'Validée', montant: 1000, createdAt: DANS_LA_PLAGE,
      }),
      db.doc('clients/boutique-montant-texte/history/texte').set({
        statut: 'Validée', montant: '7000', createdAt: DANS_LA_PLAGE,
      }),
    ])

    const snap = await db.collectionGroup('history')
      .where('createdAt', '>=', DEBUT)
      .where('createdAt', '<', FIN)
      .aggregate({ total: AggregateField.sum('montant') })
      .get()

    expect(snap.data().total).toBe(1000)
  })
})
