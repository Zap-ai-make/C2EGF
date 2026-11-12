/**
 * TC-036 — Câblage du vrai wrapper callable de production (V2-7A)
 *
 * PÉRIMÈTRE :
 *   - Vérifie que functions/src/index.js exporte les deux callables avec les bons noms.
 *   - Importe et teste le vrai wrapCallable de functions/src/callable.js.
 *     Aucune copie de la logique de production dans ce fichier.
 *   - Vérifie la conversion DealerRequestError → HttpsError (code, message, details).
 *   - Vérifie le masquage des erreurs internes inconnues.
 *   - Vérifie les régions : us-central1, et europe-west1 le temps du passage (lot C1).
 *
 * RÉSOLUTION DES MODULES :
 *   callable.js est dans functions/src/, donc firebase-functions est résolu depuis
 *   functions/node_modules/ — la dépendance est disponible même si elle n'est pas
 *   dans les node_modules racine du projet.
 *
 * LIMITATION :
 *   L'appel HTTP réel via httpsCallable nécessiterait l'émulateur Functions (port 5001).
 *   Un test HTTP end-to-end est requis avant le premier déploiement (V2-7B).
 *
 * Prérequis : firebase emulators:exec --only firestore --project demo-akayis-test
 *
 * Sections :
 *   §WR-A — Structure des exports (noms, types, région)
 *   §WR-B — Vrai wrapCallable de production (import depuis callable.js)
 *   §WR-C — Garde anti-production (helper pur)
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { DealerRequestError, HTTP_CODES } from '../../functions/src/errors.js'
import { wrapCallable, HttpsError } from '../../functions/src/callable.js'

// ─────────────────────────────────────────────────────────────────────────────
// Garde anti-production : refus sans fallback
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. ' +
      'Lancer via : npm run test:functions'
    )
  }
  const projectId = process.env.GCLOUD_PROJECT
  if (!projectId || !projectId.startsWith('demo-') || projectId !== 'demo-akayis-test') {
    throw new Error(
      `SÉCURITÉ : GCLOUD_PROJECT invalide pour TC-036. Valeur : "${projectId}"`
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// §WR-A — Structure des exports de functions/src/index.js
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-036-WRA — exports callable de index.js', () => {
  let indexModule

  beforeAll(async () => {
    // Import dynamique : index.js appelle initializeApp() au niveau module,
    // ce qui nécessite FIRESTORE_EMULATOR_HOST (déjà vérifié en beforeAll global).
    indexModule = await import('../../functions/src/index.js')
  }, 60_000)
  // ⚠ 60 s, et ce n'est PAS un délai gonflé pour masquer une lenteur.
  //
  //   Ce hook charge le graphe complet des 24 callables. À chaud il prend moins
  //   d'une seconde ; à froid, cache disque vide, il a dépassé les 10 s par
  //   défaut de Vitest — la suite tombait alors sans qu'aucune assertion soit en
  //   cause, ce qui envoie chercher un bug là où il n'y en a pas.
  //
  //   Le même plafond de 10 s existe côté `firebase deploy` (étape de
  //   découverte du manifeste) et a fait échouer un déploiement réel pour la
  //   même raison. Là-bas il se relève avec FUNCTIONS_DISCOVERY_TIMEOUT ; ici,
  //   avec ce troisième argument.
  //
  //   Ce que ce délai ne doit PAS devenir : un tapis sous lequel glisser un
  //   import qui dérape. Mesure de référence, à refaire si le hook expire
  //   encore — le manifeste complet se sert en 2,3 s sur cette machine.

  it('[WRA-01] confirmDealerRequest est exporté', () => {
    expect(indexModule.confirmDealerRequest).toBeDefined()
  })

  it('[WRA-02] rejectDealerRequest est exporté', () => {
    expect(indexModule.rejectDealerRequest).toBeDefined()
  })

  it('[WRA-03] confirmDealerRequest est une fonction (callable)', () => {
    expect(typeof indexModule.confirmDealerRequest).toBe('function')
  })

  it('[WRA-04] rejectDealerRequest est une fonction (callable)', () => {
    expect(typeof indexModule.rejectDealerRequest).toBe('function')
  })

  it('[WRA-05] aucun export non prévu dans index.js', () => {
    const allowedExports = new Set([
      'confirmDealerRequest',
      'rejectDealerRequest',
      'createDealerClosure',
      'confirmDealerClosure',
      'rejectDealerClosure',
      'addTransactionPayment',
      'addTransactionRefund',
      'storeTransactionCommand',
      'createStoreDealerTransfer',
      'confirmStoreDealerTransfer',
      'rejectStoreDealerTransfer',
      'replenishDealerInventory',
      'decreaseDealerInventory',
      'createPartnerDeposit',
      'listOutstandingDrafts',
      'listClientHistory',
      // Collaborations inter-boutiques
      'createStoreCollaboration',
      'confirmStoreCollaboration',
      'rejectStoreCollaboration',
      'listStoreCollaborationProviders',
      // Dettes internes — remboursement par tranches
      'declareInternalDebtSettlement',
      'confirmInternalDebtSettlement',
      'rejectInternalDebtSettlement',
      // Dettes internes — compensation
      'declareInternalDebtCompensation',
      'confirmInternalDebtCompensation',
      'rejectInternalDebtCompensation',
      // Annuaire des clients (docs/rester-dans-le-quota-gratuit.md §A1) — pas
      // des callables : un déclencheur Firestore et une route réservée à l'IAM.
      'majAnnuaireClients',
      'reconstruireAnnuaireClients',
      // Création d'une boutique par le patron
      'creerBoutique',
      // Liaison à l'app agent Oxygen : le code de la caissière, et le point
      // d'entrée réservé au serveur Oxygen (WRA-13, WRA-14).
      'genererCodeLiaison',
      'pointEntreeOxygen',
    ])
    for (const key of Object.keys(indexModule)) {
      expect(
        allowedExports.has(key),
        `Export inattendu dans index.js : "${key}"`
      ).toBe(true)
    }
  })

  it('[WRA-06] région europe-west1 déclarée dans confirmDealerRequest', () => {
    const fn = indexModule.confirmDealerRequest
    // firebase-functions v2 : __endpoint.region est un tableau de chaînes
    const regions = fn.__endpoint?.region
    expect(Array.isArray(regions)).toBe(true)
    expect(regions).toContain('europe-west1')
  })

  it('[WRA-07] région europe-west1 déclarée dans rejectDealerRequest', () => {
    const fn = indexModule.rejectDealerRequest
    const regions = fn.__endpoint?.region
    expect(Array.isArray(regions)).toBe(true)
    expect(regions).toContain('europe-west1')
  })

  it('[WRA-08] TOUS les callables servent us-central1, à côté de la base, et europe-west1 le temps du passage', () => {
    // Formulation générale plutôt qu'un test par export : un callable ajouté plus
    // tard dans une autre région échoue ici sans qu'il faille penser à écrire son
    // test.
    //
    // ⚠ LA RÈGLE VIENT DE LA BASE (lot C1, docs/rester-dans-le-quota-gratuit.md §C1).
    //   Elle est en nam5 : depuis europe-west1, chaque lecture traversait
    //   l'Atlantique, en série, et Cloud Run facture ce temps d'attente. Les deux
    //   régions servent tant qu'une application pas encore rechargée appelle
    //   l'ancienne. Le jour où on la retire, ce test passe à `['us-central1']`.
    //
    // ⚠ SAUF LES CALLABLES NÉES APRÈS LE PASSAGE : aucune application ne les a
    //   jamais appelées en europe-west1 (WRA-12).
    const NEES_APRES_C1 = new Set(['creerBoutique', 'genererCodeLiaison'])
    const callables = Object.entries(indexModule).filter(([, fn]) => fn.__endpoint?.callableTrigger)
    expect(callables.length).toBeGreaterThanOrEqual(27)
    for (const [name, fn] of callables) {
      expect(Array.isArray(fn.__endpoint?.region), `${name} : région absente`).toBe(true)
      expect([...fn.__endpoint.region].sort(), `${name} : mauvaises régions`)
        .toEqual(NEES_APRES_C1.has(name) ? ['us-central1'] : ['europe-west1', 'us-central1'])
    }
  })

  it('[WRA-12] la création de boutique pèse le moins possible sur le quota de la région', () => {
    // Le quota régional compte les instances EXISTANTES, à 1 vCPU chacune par
    // défaut (docs/deployer-les-functions.md §5). Une callable qui sert quelques
    // fois par mois n'a besoin ni de deux instances ni d'un vCPU entier.
    const endpoint = indexModule.creerBoutique.__endpoint
    expect(endpoint.callableTrigger).toBeDefined()
    expect(endpoint.region).toEqual(['us-central1'])
    expect(endpoint.maxInstances).toBe(1)
    expect(endpoint.cpu).toBe('gcf_gen1')
  })

  it('[WRA-13] le code de liaison Oxygen pèse le moins possible sur le quota de la région', () => {
    // Même raison que WRA-12 : quelques appels par jour, nés après le lot C1.
    const endpoint = indexModule.genererCodeLiaison.__endpoint
    expect(endpoint.callableTrigger).toBeDefined()
    expect(endpoint.region).toEqual(['us-central1'])
    expect(endpoint.maxInstances).toBe(1)
    expect(endpoint.cpu).toBe('gcf_gen1')
  })

  it('[WRA-14] le point d’entrée Oxygen n’est appelable que par son compte de service, jamais par le public', () => {
    // Google refuse toute requête sans le jeton de ce compte AVANT le code :
    // aucune instance ne démarre, aucune lecture n'est facturée. Ouvert au
    // public, n'importe qui pourrait sonder quels agents travaillent ici.
    const route = indexModule.pointEntreeOxygen.__endpoint
    expect(route.httpsTrigger).toBeDefined()
    expect(route.httpsTrigger.invoker).toEqual([`oxygen-appel@${process.env.GCLOUD_PROJECT}.iam.gserviceaccount.com`])
    expect(route.region).toEqual(['us-central1'])
    expect(route.maxInstances).toBe(1)
    expect(route.cpu).toBe('gcf_gen1')
  })

  it('[WRA-10] l’annuaire tourne en us-central1, la région que la base nam5 impose', () => {
    // Eventarc n'accepte pas de multi-région pour un déclencheur Firestore : une
    // base nam5 se déclenche depuis us-central1. Une function dans une autre
    // région ne recevrait aucun événement. La reconstruction lit ~15 700 fiches :
    // elle tourne au plus près de la base, pour la même raison.
    const declencheur = indexModule.majAnnuaireClients.__endpoint
    expect(declencheur.region).toEqual(['us-central1'])
    expect(declencheur.eventTrigger?.eventType).toBe('google.cloud.firestore.document.v1.written')
    expect(declencheur.eventTrigger?.eventFilterPathPatterns?.document).toBe('globalClients/{clientId}')
    expect(indexModule.reconstruireAnnuaireClients.__endpoint.region).toEqual(['us-central1'])
  })

  it('[WRA-11] la reconstruction est réservée aux comptes du projet, jamais publique', () => {
    // Elle lit toute la base : ouverte au public, n'importe qui pourrait la
    // déclencher en boucle et faire payer ~15 700 lectures par appel.
    const route = indexModule.reconstruireAnnuaireClients.__endpoint
    expect(route.httpsTrigger).toBeDefined()
    expect(route.httpsTrigger.invoker).toEqual(['private'])
  })

  it('[WRA-09] TOUS les callables plafonnent leurs instances', () => {
    // Ce test parle d'ARGENT autant que de quota.
    //
    // Sans `maxInstances`, une function de 2e génération monte jusqu'à cent
    // conteneurs. Sur un plan Blaze, un bug, une boucle de réessai côté client
    // ou un appel répété les ouvrent — et les font payer. Le plafond est la
    // seule chose qui borne le pire des cas.
    //
    // Il a aussi une conséquence immédiate au déploiement : 24 callables sans
    // plafond réservent 2 300 vCPU dans la région, au-delà du quota d'un projet
    // neuf. Trois functions ont échoué à se créer pour cette raison, avec un
    // message qui ne parle que de CPU et jamais d'instances — la formulation
    // générale de ce test évite d'avoir à s'en souvenir.
    for (const [name, fn] of Object.entries(indexModule)) {
      const plafond = fn.__endpoint?.maxInstances
      expect(typeof plafond, `${name} : aucun plafond d'instances`).toBe('number')
      expect(plafond, `${name} : plafond hors de portée du besoin`).toBeGreaterThan(0)
      expect(plafond, `${name} : plafond trop haut pour être une protection`).toBeLessThanOrEqual(20)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §WR-B — Vrai wrapCallable de production (functions/src/callable.js)
// ─────────────────────────────────────────────────────────────────────────────
// Ces tests importent et exercent directement le wrapCallable de production.
// Aucune copie de la logique n'existe dans ce fichier.
//
// Protocole : wrapCallable(handler, deps) retourne async (request) => {...}
//
// HttpsError est importé via callable.js (résolu depuis functions/node_modules/).

const VALID_HTTPS_CODES = new Set([
  'ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded',
  'not-found', 'already-exists', 'permission-denied', 'resource-exhausted',
  'failed-precondition', 'aborted', 'out-of-range', 'unimplemented',
  'internal', 'unavailable', 'data-loss', 'unauthenticated',
])

describe('TC-036-WRB — vrai wrapCallable de production', () => {
  it('[WRB-01] DealerRequestError UNAUTHENTICATED → HttpsError code "unauthenticated" + details.code', async () => {
    const handler = async () => {
      throw new DealerRequestError('UNAUTHENTICATED', 'Vous devez être connecté.')
    }
    const wrapped = wrapCallable(handler, {})
    try {
      await wrapped({})
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpsError)
      expect(e.code).toBe('unauthenticated')
      expect(e.message).toBe('Vous devez être connecté.')
      expect(e.details).toEqual({ code: 'UNAUTHENTICATED' })
    }
  })

  it('[WRB-02] DealerRequestError REQUEST_NOT_FOUND → HttpsError code "not-found"', async () => {
    const handler = async () => {
      throw new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.')
    }
    const wrapped = wrapCallable(handler, {})
    try {
      await wrapped({})
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpsError)
      expect(e.code).toBe('not-found')
      expect(e.details).toEqual({ code: 'REQUEST_NOT_FOUND' })
    }
  })

  it('[WRB-03] DealerRequestError BALANCE_OVERFLOW → HttpsError code "failed-precondition"', async () => {
    const handler = async () => {
      throw new DealerRequestError('BALANCE_OVERFLOW', 'Overflow.')
    }
    const wrapped = wrapCallable(handler, {})
    try {
      await wrapped({})
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpsError)
      expect(e.code).toBe('failed-precondition')
      expect(e.details).toEqual({ code: 'BALANCE_OVERFLOW' })
    }
  })

  it('[WRB-04] erreur inconnue → HttpsError code "internal" + message générique, aucune fuite', async () => {
    const handler = async () => { throw new Error('Détail interne confidentiel') }
    const wrapped = wrapCallable(handler, {})
    try {
      await wrapped({})
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpsError)
      expect(e.code).toBe('internal')
      expect(e.message).toBe("Une erreur interne s'est produite.")
      expect(e.message).not.toContain('confidentiel')
    }
  })

  it('[WRB-05] succès du handler → valeur retournée telle quelle', async () => {
    const handler = async () => ({ success: true, requestId: 'req-1' })
    const wrapped = wrapCallable(handler, {})
    const result  = await wrapped({})
    expect(result).toEqual({ success: true, requestId: 'req-1' })
  })

  it('[WRB-06] tous les codes HTTP_CODES sont des codes HttpsError valides', () => {
    for (const [code, httpCode] of Object.entries(HTTP_CODES)) {
      expect(
        VALID_HTTPS_CODES.has(httpCode),
        `HTTP_CODES.${code} = "${httpCode}" n'est pas un code HttpsError valide`
      ).toBe(true)
    }
  })

  it('[WRB-07] request.auth et request.data sont transmis au handler ; dépendances injectées', async () => {
    let captured
    const handler = async (request, deps) => {
      captured = { auth: request.auth, data: request.data, hasDeps: !!deps.db }
      return { ok: true }
    }
    const mockDeps = { db: {}, FieldValue: {} }
    const wrapped  = wrapCallable(handler, mockDeps)
    await wrapped({ auth: { uid: 'test-uid' }, data: { requestId: 'r-1' } })
    expect(captured.auth).toEqual({ uid: 'test-uid' })
    expect(captured.data).toEqual({ requestId: 'r-1' })
    expect(captured.hasDeps).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §WR-C — Garde anti-production (helper pur pour vérification offline)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-036-WRC — garde anti-production (logique pure)', () => {
  function checkProductionGuard(projectId, emulatorHost) {
    if (!emulatorHost)                          return 'MISSING_EMULATOR_HOST'
    if (!projectId)                             return 'MISSING_PROJECT'
    if (!projectId.startsWith('demo-'))         return 'NON_DEMO_PROJECT'
    if (projectId !== 'demo-akayis-test')       return 'WRONG_DEMO_PROJECT'
    return 'OK'
  }

  it('[WRC-01] host absent → MISSING_EMULATOR_HOST', () => {
    expect(checkProductionGuard('demo-akayis-test', undefined)).toBe('MISSING_EMULATOR_HOST')
  })

  it('[WRC-02] project absent → MISSING_PROJECT', () => {
    expect(checkProductionGuard(undefined, '127.0.0.1:8080')).toBe('MISSING_PROJECT')
  })

  it('[WRC-03] project production (taofic-ajagbe) → NON_DEMO_PROJECT', () => {
    expect(checkProductionGuard('taofic-ajagbe', '127.0.0.1:8080')).toBe('NON_DEMO_PROJECT')
  })

  it('[WRC-04] project non-demo → NON_DEMO_PROJECT', () => {
    expect(checkProductionGuard('my-real-project', '127.0.0.1:8080')).toBe('NON_DEMO_PROJECT')
  })

  it('[WRC-05] demo-autre-projet → WRONG_DEMO_PROJECT', () => {
    expect(checkProductionGuard('demo-autre', '127.0.0.1:8080')).toBe('WRONG_DEMO_PROJECT')
  })

  it('[WRC-06] demo-akayis-test valide → OK', () => {
    expect(checkProductionGuard('demo-akayis-test', '127.0.0.1:8080')).toBe('OK')
  })
})
