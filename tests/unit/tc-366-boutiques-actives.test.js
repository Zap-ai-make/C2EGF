/**
 * TC-366 — les boutiques actives, lues une fois par session (lot A4a,
 * docs/rester-dans-le-quota-gratuit.md §A4).
 *
 * L'accueil du dealer, l'écran Boutiques du patron et le formulaire de demande
 * relisaient chacun les 84 boutiques à chaque ouverture. Une écoute partagée les
 * sert désormais : ce fichier tient ses promesses — la réponse du serveur
 * d'abord, le cache hors ligne, une seule écoute pour tous, et sa fermeture à la
 * déconnexion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  ecoutes: [],
  surCompte: null,
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  collectionGroup: vi.fn((_db, id) => ({ group: id })),
  query: vi.fn((...args) => ({ query: args })),
  where: vi.fn((f, op, v) => ({ where: { f, op, v } })),
  orderBy: vi.fn((f, dir) => ({ orderBy: { f, dir } })),
  limit: vi.fn(n => ({ limit: n })),
  getDocs: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  collectionGroup: mocks.collectionGroup,
  query: mocks.query,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  startAfter: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: mocks.getDocs,
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: vi.fn((cible, options, suivant, erreur) => {
    const ecoute = { cible, options, suivant, erreur, desabonner: vi.fn() }
    mocks.ecoutes.push(ecoute)
    return ecoute.desabonner
  }),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, rappel) => {
    mocks.surCompte = rappel
    rappel({ uid: 'dealer-1' })
    return () => {}
  }),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'dealer-1' } },
  functions: {},
}))

const boutique = (id, name) => ({ id, data: () => ({ name, active: true }) })
const instantane = (docs, fromCache) => ({ docs, metadata: { fromCache } })
const enAttente = (promesse) => Promise.race([promesse.then(() => 'servie'), new Promise(r => setTimeout(() => r('en attente'), 0))])

let service

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.ecoutes.length = 0
  mocks.surCompte = null
  service = await import('../../src/services/boutiquesActives.js')
})

afterEach(() => {
  service.arreterBoutiquesActives()
  vi.useRealTimers()
})

describe('TC-366 — les boutiques actives, une fois par session', () => {
  it('[BA-01] écoute toutes les boutiques actives, triées par nom, sans limite', () => {
    service.lireBoutiquesActives().catch(() => {})

    expect(mocks.ecoutes).toHaveLength(1)
    expect(mocks.collection).toHaveBeenCalledWith({}, 'stores')
    expect(mocks.where).toHaveBeenCalledWith('active', '==', true)
    expect(mocks.orderBy).toHaveBeenCalledWith('name')
    expect(mocks.limit).not.toHaveBeenCalled()
    // Sans cette option, une écoute dont le cache dit déjà la même chose que le
    // serveur ne reçoit jamais `fromCache: false` (constat du lot A3a).
    expect(mocks.ecoutes[0].options).toEqual({ includeMetadataChanges: true })
  })

  it('[BA-02] attend la réponse du serveur, pas celle du cache', async () => {
    const promesse = service.lireBoutiquesActives()
    const [ecoute] = mocks.ecoutes

    ecoute.suivant(instantane([boutique('ancienne', 'ANCIENNE')], true))
    expect(await enAttente(promesse)).toBe('en attente')

    const duServeur = [boutique('ancienne', 'ANCIENNE'), boutique('neuve', 'NEUVE')]
    ecoute.suivant(instantane(duServeur, false))
    await expect(promesse).resolves.toBe(duServeur)
  })

  it('[BA-03] une seule écoute pour tous les écrans de la session', async () => {
    const premiere = service.lireBoutiquesActives()
    const pendant = service.lireBoutiquesActives()
    const docs = [boutique('a', 'A')]
    mocks.ecoutes[0].suivant(instantane(docs, false))

    await expect(premiere).resolves.toBe(docs)
    await expect(pendant).resolves.toBe(docs)
    await expect(service.lireBoutiquesActives()).resolves.toBe(docs)
    expect(mocks.ecoutes).toHaveLength(1)
  })

  it('[BA-04] une boutique créée apparaît à la lecture suivante, sans nouvelle écoute', async () => {
    const lecture = service.lireBoutiquesActives()
    mocks.ecoutes[0].suivant(instantane([boutique('a', 'A')], false))
    await lecture

    const apres = [boutique('a', 'A'), boutique('b', 'B')]
    mocks.ecoutes[0].suivant(instantane(apres, false))

    await expect(service.lireBoutiquesActives()).resolves.toBe(apres)
    expect(mocks.ecoutes).toHaveLength(1)
  })

  it('[BA-05] wifi sans internet : le cache, passé le délai d’attente du serveur', async () => {
    vi.useFakeTimers()
    const promesse = service.lireBoutiquesActives()
    const cache = [boutique('a', 'A')]
    mocks.ecoutes[0].suivant(instantane(cache, true))

    vi.advanceTimersByTime(service.ATTENTE_SERVEUR_MS - 1)
    let servie = false
    promesse.then(() => { servie = true })
    await Promise.resolve()
    expect(servie).toBe(false)

    vi.advanceTimersByTime(1)
    await expect(promesse).resolves.toBe(cache)
  })

  it('[BA-06] navigateur hors ligne : le cache tout de suite', async () => {
    const horsLigne = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const promesse = service.lireBoutiquesActives()
      const cache = [boutique('a', 'A')]
      mocks.ecoutes[0].suivant(instantane(cache, true))

      await expect(promesse).resolves.toBe(cache)
    } finally {
      horsLigne.mockRestore()
    }
  })

  it('[BA-07] une écoute refusée rejette les lectures en cours, la suivante en rouvre une', async () => {
    const promesse = service.lireBoutiquesActives()
    const refus = Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    mocks.ecoutes[0].erreur(refus)

    await expect(promesse).rejects.toBe(refus)

    service.lireBoutiquesActives().catch(() => {})
    expect(mocks.ecoutes).toHaveLength(2)
  })

  it('[BA-08] la déconnexion ferme l’écoute', async () => {
    const lecture = service.lireBoutiquesActives()
    mocks.ecoutes[0].suivant(instantane([boutique('a', 'A')], false))
    await lecture

    mocks.surCompte(null)

    expect(mocks.ecoutes[0].desabonner).toHaveBeenCalledTimes(1)
    service.lireBoutiquesActives().catch(() => {})
    expect(mocks.ecoutes).toHaveLength(2)
  })

  it('[BA-09] un autre compte sur le même appareil n’hérite pas de l’écoute', async () => {
    const lecture = service.lireBoutiquesActives()
    mocks.ecoutes[0].suivant(instantane([boutique('a', 'A')], false))
    await lecture

    mocks.surCompte({ uid: 'patron-1' })

    expect(mocks.ecoutes[0].desabonner).toHaveBeenCalledTimes(1)
  })

  it('[BA-10] le même compte, annoncé de nouveau, garde l’écoute', async () => {
    const lecture = service.lireBoutiquesActives()
    mocks.ecoutes[0].suivant(instantane([boutique('a', 'A')], false))
    await lecture

    mocks.surCompte({ uid: 'dealer-1' })

    expect(mocks.ecoutes[0].desabonner).not.toHaveBeenCalled()
  })
})

describe('TC-366 — ce que les écrans du dealer et du patron lisent', () => {
  it('[BA-11] trois ouvertures : une seule lecture des boutiques, les soldes à chaque fois', async () => {
    const { listNetworkCaisses, listAllActiveStores } = await import('../../src/services/dealerService.js')
    mocks.getDocs.mockResolvedValue({ docs: [] })

    const accueil = listNetworkCaisses()
    mocks.ecoutes[0].suivant(instantane([boutique('a', 'POUYTENGA')], false))
    await expect(accueil).resolves.toMatchObject({ total: 1 })

    await expect(listAllActiveStores()).resolves.toEqual({ stores: [{ id: 'a', name: 'POUYTENGA', active: true }] })
    await expect(listNetworkCaisses()).resolves.toMatchObject({ total: 1 })

    expect(mocks.ecoutes).toHaveLength(1)
    expect(mocks.getDocs).toHaveBeenCalledTimes(2)
    expect(mocks.collectionGroup).toHaveBeenCalledWith({}, 'networkBalances')
  })
})
