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

const BOUTIQUES = ['boutique-a', 'boutique-b', 'boutique-c', 'boutique-d']

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

beforeEach(async () => {
  await Promise.all(BOUTIQUES.map((b) => effacer(`clients/${b}/history`)))
})

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
