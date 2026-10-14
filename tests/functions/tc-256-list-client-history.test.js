/**
 * TC-256 — listClientHistory : l'historique d'un agent, toutes boutiques.
 *   Handler integration avec Firestore Emulator, { db } injecté.
 *
 * Comportement protégé :
 *   autorisation : refus sans auth, profil inactif, DEALER refusé (une identité
 *                  client ne doit jamais lui parvenir), payload hors liste blanche.
 *   lecture      : deux boutiques réunies en une seule liste ; non terminées à part.
 *   pagination   : pages de 50, curseur sérialisable, ex æquo sur createdAt.
 *   totaux       : comptés sur TOUT l'historique, pas sur la page.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { listClientHistoryHandler, PAGE } from '../../functions/src/clients/listClientHistory.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

const CAISSIERE = { uid: 'u-caissiere', role: 'member', storeId: 'store-a', active: true, name: 'Awa' }
const DEALER = { uid: 'u-dealer', role: 'dealer', active: true, name: 'Le dealer' }
const INACTIVE = { uid: 'u-inactive', role: 'member', storeId: 'store-a', active: false, name: 'Ex' }
const GERANT = { uid: 'u-gerant', role: 'store_admin', storeId: 'store-a', active: true, name: 'Le gerant' }
// Un role que le projet n'emploie pas. Il doit etre REFUSE : une liste blanche
// ferme la porte a ce qu'elle ne connait pas, une liste noire l'ouvre.
const INCONNU = { uid: 'u-inconnu', role: 'partenaire', storeId: 'store-a', active: true, name: 'Qui ?' }

const appel = (uid, data = { clientId: 'c1' }) =>
  listClientHistoryHandler({ auth: { uid }, data }, { db })

const poser = (chemin, id, donnees) => db.doc(`${chemin}/${id}`).set(donnees)

beforeEach(async () => {
  await Promise.all([
    effacer('clients/store-a/history'), effacer('clients/store-b/history'),
    effacer('clients/store-a/drafts'), effacer('clients/store-b/drafts'),
    effacer('stores'), effacer('users'),
  ])
  // ⚠ EN PARALLÈLE, PAS EN SÉRIE. Chaque aller-retour vers l'émulateur coûte
  //   près d'une seconde sur cette machine : sept écritures enchaînées suffisent
  //   à dépasser le délai d'un hook, et l'échec s'affiche alors sur le PREMIER
  //   test au lieu du hook qui l'a causé.
  await Promise.all([
    ...[CAISSIERE, DEALER, INACTIVE, GERANT, INCONNU].map((p) => db.doc(`users/${p.uid}`).set(p)),
    db.doc('stores/store-a').set({ name: 'C2EGF OUAGA', active: true }),
    db.doc('stores/store-b').set({ name: 'C2EGF BOBO', active: true }),
  ])
// ⚠ 30 s, ET CE N'EST PAS DE LA COMPLAISANCE. Ce hook fait une douzaine
//   d'allers-retours vers l'émulateur ; sous les 10 s par défaut, il expire dès
//   que la machine est chargée — et vitest affiche alors l'échec sur le PREMIER
//   test, ici « refuse un appel sans authentification », qui n'a rien à voir.
//   Un faux échec qui accuse un test d'autorisation est pire qu'un hook lent :
//   on cherche une faille de sécurité qui n'existe pas.
}, 30000)

const ligne = (over = {}) => ({
  clientId: 'c1', type: 'Dépôt', montant: 100, statut: 'Validée',
  createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13, 8, 0)), operatorName: 'Awa',
  ...over,
})

describe('TC-256 — autorisation', () => {
  it('[TC-256-01] refuse un appel sans authentification', async () => {
    await expect(listClientHistoryHandler({ auth: null, data: { clientId: 'c1' } }, { db }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[TC-256-02] refuse un profil inactif', async () => {
    await expect(appel('u-inactive')).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  /**
   * ⚠ LE DEALER EST REFUSÉ, ET CE N'EST PAS UN DÉTAIL. Les règles ne lui donnent
   *   aujourd'hui qu'un agrégat sans aucune identité client ; cette fonction rend
   *   des noms et des montants nominatifs.
   */
  it('[TC-256-03] refuse le dealer', async () => {
    await expect(appel('u-dealer')).rejects.toMatchObject({ code: 'HISTORY_ROLE_FORBIDDEN' })
  })

  /**
   * ⚠ UNE LISTE BLANCHE, PAS UNE LISTE NOIRE. Le controle refusait nommement le
   *   dealer et laissait passer tout le reste : un role ajoute plus tard aurait
   *   herite en silence de l'historique financier nominatif de tous les agents.
   */
  it('[TC-256-03b] refuse un role que le projet n’emploie pas', async () => {
    await expect(appel('u-inconnu')).rejects.toMatchObject({ code: 'HISTORY_ROLE_FORBIDDEN' })
  })

  /** Le role de caissiere s'appelle `member`, et le gerant `store_admin`. */
  it('[TC-256-03c] accepte les deux roles de boutique', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await expect(appel('u-caissiere')).resolves.toMatchObject({ success: true })
    await expect(appel('u-gerant')).resolves.toMatchObject({ success: true })
  })

  it('[TC-256-04] refuse un profil inexistant', async () => {
    await expect(appel('u-fantome')).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
  })

  it('[TC-256-05] refuse une clé hors liste blanche', async () => {
    await expect(appel('u-caissiere', { clientId: 'c1', storeId: 'store-b' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[TC-256-06] refuse un clientId vide ou non textuel', async () => {
    await expect(appel('u-caissiere', { clientId: '' })).rejects.toMatchObject({ code: 'INVALID_CLIENT_ID' })
    await expect(appel('u-caissiere', { clientId: 42 })).rejects.toMatchObject({ code: 'INVALID_CLIENT_ID' })
  })

  /** Un curseur mal formé est REFUSÉ, jamais ignoré : l'ignorer renverrait la page 1. */
  it('[TC-256-07] refuse un curseur mal formé', async () => {
    await expect(appel('u-caissiere', { clientId: 'c1', curseur: { chemin: 42 } }))
      .rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
    await expect(appel('u-caissiere', { clientId: 'c1', curseur: 'abc' }))
      .rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
    await expect(appel('u-caissiere', { clientId: 'c1', curseur: { chemin: 'users/u-caissiere' } }))
      .rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
  })
})

describe('TC-256 — les deux boutiques réunies', () => {
  it('[TC-256-08] rend les opérations des deux boutiques, nommées', async () => {
    await poser('clients/store-a/history', 'h1', ligne({ montant: 250 }))
    await poser('clients/store-b/history', 'h2', ligne({ montant: 75, createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 12, 8, 0)) }))

    const { lignes } = await appel('u-caissiere')
    expect(lignes.map((l) => l.storeName)).toEqual(['C2EGF OUAGA', 'C2EGF BOBO'])
    expect(lignes.map((l) => l.montant)).toEqual([250, 75])
  })

  it('[TC-256-09] n’inclut jamais les opérations d’un autre client', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'autre', ligne({ clientId: 'c2' }))

    const { lignes } = await appel('u-caissiere')
    expect(lignes).toHaveLength(1)
  })

  it('[TC-256-10] les non terminées sortent dans `enCours`, pas dans `lignes`', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-b/drafts', 'd1', ligne({ type: 'Retrait', montant: 100, remainingAmount: 40, statut: 'Non Terminées' }))

    const { lignes, enCours, totaux } = await appel('u-caissiere')
    expect(lignes.map((l) => l.id)).toEqual(['h1'])
    expect(enCours.map((l) => l.id)).toEqual(['d1'])
    expect(totaux.resteAPayer).toBe(40)
    expect(totaux.resteAEncaisser).toBe(0)
  })

  it('[TC-256-11] un client sans aucune opération rend des listes vides, pas une erreur', async () => {
    const reponse = await appel('u-caissiere')
    expect(reponse).toMatchObject({ success: true, lignes: [], enCours: [], encore: false, curseurSuivant: null })
    expect(reponse.totaux.operations).toBe(0)
  })

  it('[TC-256-12] les ravitaillements et clôtures sont écartés', async () => {
    await poser('clients/store-a/history', 'r1', ligne({ type: 'Ravitaillement' }))
    await poser('clients/store-a/history', 'c1', ligne({ type: 'Clôture' }))
    await poser('clients/store-a/history', 'h1', ligne())

    const { lignes } = await appel('u-caissiere')
    expect(lignes.map((l) => l.id)).toEqual(['h1'])
  })
})

describe('TC-256 — la pagination', () => {
  const poserPlusieurs = async (combien, ms = (i) => Date.UTC(2026, 9, 13, 0, 0) + i * 60000) => {
    for (let i = 0; i < combien; i += 1) {
      await poser('clients/store-a/history', `h${String(i).padStart(3, '0')}`, ligne({
        montant: i, createdAt: Timestamp.fromMillis(ms(i)),
      }))
    }
  }

  it('[TC-256-13] la première page est bornée et annonce la suite', async () => {
    await poserPlusieurs(PAGE + 10)
    const page1 = await appel('u-caissiere')

    expect(page1.lignes).toHaveLength(PAGE)
    expect(page1.encore).toBe(true)
    expect(page1.curseurSuivant).toMatchObject({ chemin: expect.any(String) })
  })

  it('[TC-256-14] la page suivante reprend exactement où la première s’arrête', async () => {
    await poserPlusieurs(PAGE + 10)
    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    expect(page2.lignes).toHaveLength(10)
    expect(page2.encore).toBe(false)
    expect(page2.curseurSuivant).toBeNull()

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(new Set(tous).size).toBe(PAGE + 10)
  })

  /** Les pages suivantes ne recalculent ni les totaux ni les non terminées. */
  it('[TC-256-15] seule la première page porte les totaux et les non terminées', async () => {
    await poserPlusieurs(PAGE + 1)
    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    expect(page1.totaux).not.toBeNull()
    expect(page2.totaux).toBeNull()
    expect(page2.enCours).toEqual([])
  })

  /**
   * ⚠ REVIEW FOCUS 2 — DEUX OPÉRATIONS À LA MÊME SECONDE. C'est courant en
   *   caisse. Sans `__name__` en second critère de tri ET dans le curseur, la
   *   page suivante saute des lignes ou les répète, sans aucun message.
   */
  it('[TC-256-16] des opérations au même instant ne sont ni perdues ni répétées', async () => {
    await poserPlusieurs(PAGE + 5, () => Date.UTC(2026, 9, 13, 10, 0))

    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(tous).toHaveLength(PAGE + 5)
    expect(new Set(tous).size).toBe(PAGE + 5)
  })

  /**
   * ⚠ LE CURSEUR SORT DU DERNIER DOCUMENT LU, PAS DE LA DERNIÈRE LIGNE RENDUE.
   *   Un ravitaillement est écarté de l'affichage mais occupe une place dans le
   *   tri : si la page se termine sur lui, repartir de la dernière ligne VISIBLE
   *   le relirait à chaque page, et la pagination tournerait en rond sans
   *   jamais atteindre la fin.
   */
  it('[TC-256-22] une page qui finit sur une ligne écartée avance quand même', async () => {
    // Les PAGE-1 premières lignes du tri, les plus récentes.
    for (let i = 0; i < PAGE - 1; i += 1) {
      const id = `h${String(i).padStart(3, '0')}`
      await poser('clients/store-a/history', id, ligne({
        createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + (1000 - i) * 1000),
      }))
    }
    // La PAGE-ième : un ravitaillement. Il est LU, il n'est jamais RENDU.
    await poser('clients/store-a/history', 'ravito', ligne({
      type: 'Ravitaillement', createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + 500 * 1000),
    }))
    await poser('clients/store-a/history', 'apres', ligne({
      createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + 1 * 1000),
    }))

    const page1 = await appel('u-caissiere')
    expect(page1.encore).toBe(true)
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(new Set(tous).size).toBe(tous.length)
    expect(tous).toContain('apres')
  })

  /**
   * ⚠ DEUX OPÉRATIONS DANS LA MÊME MILLISECONDE. Mesuré sur émulateur : un
   *   curseur construit depuis `toMillis()` perd les nanosecondes, et celle qui
   *   en a le moins disparaît de la page suivante — sans erreur et sans
   *   compteur. C'est pour ça que le curseur repart du snapshot.
   */
  it('[TC-256-23] deux opérations à la même milliseconde ne sont pas perdues', async () => {
    await poser('clients/store-a/history', 'haut', ligne({ createdAt: new Timestamp(1000, 900000) }))
    await poser('clients/store-a/history', 'milieu', ligne({ createdAt: new Timestamp(1000, 500000) }))
    await poser('clients/store-a/history', 'bas', ligne({ createdAt: new Timestamp(999, 0) }))

    // Une page d'UNE ligne, pour forcer la frontière à tomber entre « haut » et « milieu ».
    const page1 = await listClientHistoryHandler(
      { auth: { uid: 'u-caissiere' }, data: { clientId: 'c1' } },
      { db, taillePage: 1 },
    )
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(tous).toContain('milieu')
    expect(new Set(tous).size).toBe(3)
  })

  /**
   * Une ligne peut être mise à la corbeille pendant qu'on pagine. On refuse le
   * curseur au lieu de se repositionner en silence : l'échec visible vaut mieux
   * qu'une page qui recommence sans le dire.
   */
  it('[TC-256-24] un curseur dont le document a disparu est refusé', async () => {
    await expect(appel('u-caissiere', {
      clientId: 'c1',
      curseur: { chemin: 'clients/store-a/history/jamais-existe' },
    })).rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
  })
})

describe('TC-256 — les totaux portent sur tout, pas sur la page', () => {
  it('[TC-256-17] le compte dépasse la page chargée', async () => {
    for (let i = 0; i < PAGE + 7; i += 1) {
      await poser('clients/store-a/history', `h${i}`, ligne({ createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + i * 1000) }))
    }
    const { lignes, totaux } = await appel('u-caissiere')
    expect(lignes).toHaveLength(PAGE)
    expect(totaux.operations).toBe(PAGE + 7)
  })

  /**
   * ⚠ UNE LIGNE ANNULÉE OU MISE À LA CORBEILLE A DÉJÀ RENDU SON MONTANT AUX
   *   SOLDES. Le panneau ne publie donc aucune somme tirée de l'historique : les
   *   seuls chiffres financiers viennent des non terminées, lues en entier.
   */
  it('[TC-256-18] aucune somme d’argent n’est tirée de l’historique', async () => {
    await poser('clients/store-a/history', 'h1', ligne({ montant: 500000 }))
    await poser('clients/store-a/history', 'annulee', ligne({ montant: 500000, statut: 'Annulée' }))

    const { totaux } = await appel('u-caissiere')
    expect(totaux.depots).toBeUndefined()
    expect(totaux.retraits).toBeUndefined()
    expect(totaux.nonClassees).toBeUndefined()
    // Les comptes, eux, comptent bien les deux : une ligne annulée a eu lieu.
    expect(totaux.operations).toBe(2)
  })

  /**
   * ⚠ REVIEW FOCUS 3 — UN DOCUMENT SANS `createdAt` EST EXCLU PAR `orderBy`.
   *   Firestore ignore les documents qui ne portent pas le champ trié : ces
   *   lignes ne seraient JAMAIS listées, et rien ne le dirait. Le total vient
   *   d'un `count()` SANS `orderBy`, donc l'écart se voit.
   */
  it('[TC-256-20] une ligne sans horodatage est comptée même si elle ne peut pas être listée', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'vieille', { clientId: 'c1', type: 'Dépôt', montant: 7, date: '01/01/2025' })

    const { lignes, totaux } = await appel('u-caissiere')
    expect(lignes).toHaveLength(1)
    expect(totaux.operations).toBe(2)
    expect(totaux.nonDatees).toBe(1)
  })

  it('[TC-256-21] le récapitulatif par boutique compte chaque boutique', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'h2', ligne())
    await poser('clients/store-b/history', 'h3', ligne())

    const { totaux } = await appel('u-caissiere')
    expect(totaux.parBoutique).toEqual([
      { storeId: 'store-a', storeName: 'C2EGF OUAGA', operations: 2 },
      { storeId: 'store-b', storeName: 'C2EGF BOBO', operations: 1 },
    ])
  })
})

/**
 * ⚠ UN AGRÉGAT QUI ÉCHOUE NE DOIT PAS EMPORTER LES LIGNES.
 *
 * Les quatre agrégats partageaient un `Promise.all` sans garde : un index
 * d'agrégation absent, un quota dépassé, et la réponse ENTIÈRE était perdue —
 * y compris `lignes` et `enCours`, parfaitement lisibles. `wrapCallable`
 * convertit alors l'erreur en 'internal', que le navigateur rend « Une erreur
 * inattendue s'est produite. » : aucun diagnostic, et un Réessayer qui
 * échouera toujours. La spec tranche — ne PAS afficher de totaux plutôt que
 * d'en afficher de faux.
 *
 * ⚠ CE N'EST PAS UN CAS THÉORIQUE. L'agrégat de groupe sur `clientId` seul n'a
 *   reçu son index qu'après la relecture finale ; sans lui, Firestore répond
 *   FAILED_PRECONDITION à CHAQUE ouverture, car les totaux ne sont calculés que
 *   sur la première page.
 */
describe('TC-256 — quand une agrégation échoue', () => {
  /** Un `db` identique au vrai, sauf que tout `aggregate().get()` rejette. */
  const sansAgregat = (vrai) => {
    const envelopper = (cible) => new Proxy(cible, {
      get(obj, cle) {
        const valeur = obj[cle]
        if (cle === 'aggregate') {
          return () => ({ get: () => Promise.reject(new Error('9 FAILED_PRECONDITION: index manquant')) })
        }
        if (typeof valeur !== 'function') return valeur
        return (...args) => {
          const resultat = valeur.apply(obj, args)
          // On n'enveloppe que les maillons de chaîne de requête : un snapshot
          // ou une promesse doivent ressortir intacts.
          const chainable = resultat
            && typeof resultat === 'object'
            && typeof resultat.where === 'function'
          return chainable ? envelopper(resultat) : resultat
        }
      },
    })
    return envelopper(vrai)
  }

  it('[TC-256-25] les lignes sortent quand même, et les totaux disent « je ne sais pas »', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-b/history', 'h2', ligne({ montant: 250 }))

    const reponse = await listClientHistoryHandler(
      { auth: { uid: 'u-caissiere' }, data: { clientId: 'c1' } },
      { db: sansAgregat(db) },
    )

    expect(reponse.success).toBe(true)
    expect(reponse.lignes).toHaveLength(2)
    // `null` dit « je ne sais pas » ; 0 dirait « aucune », ce qui serait faux.
    expect(reponse.totaux.operations).toBeNull()
    expect(reponse.totaux.parBoutique).toEqual([])
  })

  /**
   * ⚠ `attente` NE VIENT D'AUCUN AGRÉGAT, et doit donc survivre au repli. Il est
   *   calculé sur les non terminées, lues en entier. Le laisser tomber avec les
   *   comptes ferait afficher « 0 à payer » en pied d'un encart dont la ligne
   *   montre un reste de 40 000.
   */
  it('[TC-256-26] les restes des non terminées survivent au repli', async () => {
    await poser('clients/store-a/drafts', 'd1', ligne({
      type: 'Retrait', montant: 100000, remainingAmount: 40000, statut: 'Non Terminées',
    }))

    const reponse = await listClientHistoryHandler(
      { auth: { uid: 'u-caissiere' }, data: { clientId: 'c1' } },
      { db: sansAgregat(db) },
    )

    expect(reponse.enCours).toHaveLength(1)
    expect(reponse.totaux.resteAPayer).toBe(40000)
    expect(reponse.totaux.nbEnAttente).toBe(1)
  })
})

/**
 * ⚠ LE DÉFAUT QUI EMPORTAIT L'APPLICATION ENTIÈRE, vérifié de bout en bout.
 *
 * `collaborations/confirmStoreCollaboration.js` écrit `date: serverTimestamp()`
 * là où tous les autres écrivains mettent une chaîne « JJ/MM/AAAA ». Cette
 * ligne porte un `clientId` : elle sort de la requête de groupe comme les
 * autres. L'encodage du callable transformait le Timestamp en objet nu
 * `{_seconds,_nanoseconds}`, que React refuse comme enfant — et l'unique
 * ErrorBoundary enveloppe `AppContent` ENTIER.
 */
describe('TC-256 — une date non textuelle ne sort jamais du serveur', () => {
  it('[TC-256-27] un Timestamp dans `date` ressort en chaîne', async () => {
    await poser('clients/store-a/history', 'collab', ligne({
      date: Timestamp.fromMillis(Date.UTC(2026, 9, 13, 8, 0)),
      collaborationId: 'collab-1',
    }))

    const { lignes } = await appel('u-caissiere')

    expect(lignes).toHaveLength(1)
    expect(typeof lignes[0].date).toBe('string')
    expect(lignes[0].date).toBe('13/10/2026 08:00')
  })
})
