/**
 * TC-372 — Les écoutes de l'historique ne meurent plus (correctif du 2026-11-12).
 *
 * LA PANNE
 * ────────
 * `subscribeToCollection` fermait une écoute pour de bon dans deux cas :
 *   - aucune réponse du serveur au bout de 30 s (l'ancien LISTENER_TIMEOUT) ;
 *   - la moindre erreur.
 * Rien ne la rouvrait, et rien ne le disait à l'écran.
 *
 * Depuis le lot G1, la journée est une requête neuve chaque matin : l'appareil
 * n'en a rien en mémoire, et sa première réponse dépend du serveur. Sur une
 * connexion lente, elle passait les 30 s, et l'historique du jour restait figé
 * jusqu'au rechargement. Une saisie envoyée quittait la file d'envoi, et sa ligne
 * ne revenait jamais à l'écran : la transaction était enregistrée, mais invisible.
 *
 * CE QUI EST VERROUILLÉ ICI
 *   [EH-01] une première réponse lente, même après 30 s, arrive aux abonnés ;
 *   [EH-02] après une erreur passagère, l'écoute se rouvre seule et les lignes reviennent ;
 *   [EH-03] un refus des règles ou un index manquant arrête l'écoute et prévient,
 *           puis un nouvel abonné en rouvre une neuve ;
 *   [EH-04] se désabonner arrête aussi une reprise programmée ;
 *   [EH-05] deux abonnés à la même requête partagent une seule écoute (inchangé).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, chemin) => ({ chemin })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn((q) => q),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: { fromMillis: vi.fn(), fromDate: vi.fn() },
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  persistanceHorsLigne: true,
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

vi.mock('../../src/utils/cacheManager', () => ({
  default: {
    setFetchFunction: vi.fn(),
    get: vi.fn(() => null),
    set: vi.fn(),
    invalidate: vi.fn(),
    generateKey: vi.fn(() => 'cle'),
    clear: vi.fn(),
    invalidateCollection: vi.fn(),
    getStats: vi.fn(() => ({})),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
    invalidateRelated: vi.fn(),
  },
}))

import { onSnapshot } from 'firebase/firestore'
import { FirestoreService } from '../../src/services/firestore.js'
import { RESILIENT_BASE_DELAY_MS } from '../../src/services/resilientOnSnapshot.js'

/** Chaque ouverture d'écoute, avec de quoi lui faire répondre ou échouer. */
let ouvertures
const derniere = () => ouvertures[ouvertures.length - 1]

const reponse = (...ids) => ({
  docs: ids.map((id) => ({ id, data: () => ({ type: 'Dépôt', montant: 1000 }) })),
  docChanges: () => [],
})
const erreur = (code) => Object.assign(new Error(code), { code })

const JOURNEE = { where: [{ field: 'createdAt', operator: '>=', value: 'matin' }], orderByField: 'createdAt' }

let svc
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  ouvertures = []
  onSnapshot.mockReset()
  onSnapshot.mockImplementation((_q, suivant, echec) => {
    const fermer = vi.fn()
    ouvertures.push({ suivant, echec, fermer })
    return fermer
  })
  svc = new FirestoreService()
  svc.setActiveStore({ id: 'boutique-a', name: 'Boutique A' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Un abonné comme ceux du contexte : une fonction, et son `onError` posé dessus. */
function abonne() {
  const recu = vi.fn()
  recu.onError = vi.fn()
  return recu
}

describe('TC-372 — les écoutes de l\'historique tiennent', () => {
  it('[EH-01] une première réponse qui met plus de 30 s arrive quand même', () => {
    const recu = abonne()
    svc.subscribeToCollection('history', recu, JOURNEE)

    vi.advanceTimersByTime(120_000)
    expect(derniere().fermer).not.toHaveBeenCalled()
    expect(recu.onError).not.toHaveBeenCalled()

    derniere().suivant(reponse('t1', 't2'))
    expect(recu).toHaveBeenCalledTimes(1)
    expect(recu.mock.calls[0][0].map((l) => l.id)).toEqual(['t1', 't2'])
  })

  it('[EH-02] après une erreur passagère, l\'écoute se rouvre et les lignes reviennent', () => {
    const recu = abonne()
    svc.subscribeToCollection('history', recu, JOURNEE)
    derniere().suivant(reponse('t1'))

    derniere().echec(erreur('unavailable'))
    expect(recu.onError).toHaveBeenCalledTimes(1)
    expect(ouvertures).toHaveLength(1)

    vi.advanceTimersByTime(RESILIENT_BASE_DELAY_MS)
    expect(ouvertures).toHaveLength(2)

    derniere().suivant(reponse('t1', 't2'))
    expect(recu).toHaveBeenCalledTimes(2)
    expect(recu.mock.calls[1][0].map((l) => l.id)).toEqual(['t1', 't2'])
  })

  it('[EH-03] un refus des règles arrête l\'écoute, et un nouvel abonné en rouvre une', () => {
    const premier = abonne()
    svc.subscribeToCollection('history', premier, JOURNEE)
    derniere().echec(erreur('permission-denied'))

    expect(premier.onError).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    expect(ouvertures).toHaveLength(1)

    const second = abonne()
    svc.subscribeToCollection('history', second, JOURNEE)
    expect(ouvertures).toHaveLength(2)
    derniere().suivant(reponse('t1'))
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('[EH-03b] un index manquant ne se réessaie pas non plus', () => {
    const recu = abonne()
    svc.subscribeToCollection('history', recu, JOURNEE)
    derniere().echec(erreur('failed-precondition'))

    vi.advanceTimersByTime(10 * 60_000)
    expect(ouvertures).toHaveLength(1)
    expect(recu.onError).toHaveBeenCalledTimes(1)
  })

  it('[EH-04] se désabonner arrête l\'écoute et la reprise programmée', () => {
    const recu = abonne()
    const arreter = svc.subscribeToCollection('history', recu, JOURNEE)
    const premiere = derniere()
    premiere.echec(erreur('unavailable'))

    arreter()
    vi.advanceTimersByTime(10 * 60_000)
    expect(ouvertures).toHaveLength(1)
    expect(svc.getMetrics().activeListeners).toBe(0)
  })

  it('[EH-04b] se désabonner d\'une écoute vivante la ferme', () => {
    const arreter = svc.subscribeToCollection('history', abonne(), JOURNEE)
    derniere().suivant(reponse('t1'))

    arreter()
    expect(derniere().fermer).toHaveBeenCalledTimes(1)
    expect(svc.getMetrics().activeListeners).toBe(0)
  })

  it('[EH-05] deux abonnés à la même requête partagent une seule écoute', () => {
    const a = abonne()
    const b = abonne()
    const arreterA = svc.subscribeToCollection('history', a, JOURNEE)
    svc.subscribeToCollection('history', b, JOURNEE)
    expect(ouvertures).toHaveLength(1)

    derniere().suivant(reponse('t1'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    arreterA()
    expect(derniere().fermer).not.toHaveBeenCalled()
  })
})
