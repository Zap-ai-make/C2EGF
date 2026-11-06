import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * TC-265 — l'abonnement global du patron, et la précondition du gérant intacte.
 *
 * ⚠ CE QUE CE TEST NE PROUVE PAS, ET IL FAUT LE SAVOIR. Il ne vérifie aucun
 *   rôle : ce service n'en connaît aucun. Le rôle est tenu par le `RoleGuard`
 *   de la route et par `firestore.rules`.
 *
 * ⚠ ET CE QU'IL FIGE VRAIMENT : que personne n'assouplisse `subscribeToClients`
 *   pour servir le patron. `requireActiveStore()` n'y filtre rien — la
 *   collection `globalClients` est à la RACINE — mais c'est la précondition
 *   juste pour les neuf écrans du gérant, dont le reste est bien cloisonné.
 */

const onSnapshot = vi.fn(() => vi.fn())
const collection = vi.fn((_db, path) => ({ path }))
const doc = vi.fn((_db, ...segments) => ({ path: segments.join('/') }))

vi.mock('firebase/firestore', () => ({
  collection: (...a) => collection(...a),
  onSnapshot: (...a) => onSnapshot(...a),
  doc: (...a) => doc(...a), getDoc: vi.fn(), getDocs: vi.fn(),
  query: (ref, ...contraintes) => ({ ref, contraintes }),
  where: (...a) => ({ where: a }), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  serverTimestamp: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), deleteDoc: vi.fn(), writeBatch: vi.fn(),
  getCountFromServer: vi.fn(), collectionGroup: vi.fn(), runTransaction: vi.fn(),
  Timestamp: class { constructor(seconds, nanoseconds) { Object.assign(this, { seconds, nanoseconds }) } },
}))

vi.mock('../../src/config/firebase.js', () => ({ db: {}, auth: {}, functions: {}, persistanceHorsLigne: false }))

const { firestoreService } = await import('../../src/services/firestore.js')

beforeEach(() => {
  onSnapshot.mockClear()
  collection.mockClear()
  doc.mockClear()
  firestoreService.setActiveStore(null)
})

describe('TC-265 — le patron s’abonne sans boutique active', () => {
  it('[TC-265-01] `subscribeToAllClients` ne lève pas sans boutique active', () => {
    expect(() => firestoreService.subscribeToAllClients(vi.fn())).not.toThrow()
  })

  // ⚠ 02 À 04 PASSENT PAR LE REPLI DEPUIS LE LOT §A1 (docs/rester-dans-le-
  //   quota-gratuit.md). L'abonnement écoute d'abord l'annuaire ; `globalClients`
  //   ne s'ouvre que si l'annuaire n'est pas complet. Ces trois tests figent ce
  //   chemin-là, celui que tout projet sans annuaire rempli emprunte encore.
  //   Le chemin par l'annuaire est couvert par 12 à 15 plus bas.
  it('[TC-265-02] sans annuaire complet, il vise la racine `globalClients`', () => {
    firestoreService.subscribeToAllClients(vi.fn())
    annuaireRepond([])
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  it('[TC-265-03] il rend une fonction qui ferme toutes ses écoutes', () => {
    const fermetures = [vi.fn(), vi.fn()]
    onSnapshot.mockReturnValueOnce(fermetures[0]).mockReturnValueOnce(fermetures[1])
    const stop = firestoreService.subscribeToAllClients(vi.fn())
    annuaireRepond([])
    stop()
    expect(fermetures[0]).toHaveBeenCalled()
    expect(fermetures[1]).toHaveBeenCalled()
  })

  it('[TC-265-04] les documents arrivent avec leur identifiant', () => {
    const recu = vi.fn()
    firestoreService.subscribeToAllClients(recu)
    annuaireRepond([])
    const [, surSuivant] = onSnapshot.mock.calls[1]
    surSuivant({ docs: [{ id: 'c1', data: () => ({ nom: 'OUEDRAOGO' }) }] })
    expect(recu).toHaveBeenCalledWith([{ id: 'c1', nom: 'OUEDRAOGO' }])
  })
})

/**
 * Fait répondre le serveur pour l'annuaire entier — toujours la PREMIÈRE écoute
 * ouverte, avec `includeMetadataChanges` depuis le lot G2.
 */
function annuaireRepond(docs) {
  const [ref, options, surSuivant] = onSnapshot.mock.calls[0]
  expect(ref).toEqual({ path: 'annuaireClients' })
  expect(options).toEqual({ includeMetadataChanges: true })
  surSuivant({ docs, metadata: { fromCache: false } })
}

const tranche = (id, entrees) => ({ id, data: () => ({ entrees, majLe: { seconds: 10, nanoseconds: 5 } }) })
const ETAT_COMPLET = { id: '_etat', data: () => ({ complet: true, tranches: 64, fiches: 2 }) }

describe('TC-265 — par l’annuaire quand il est complet (§A1)', () => {
  it('[TC-265-12] l’abonnement écoute l’annuaire avant tout', () => {
    firestoreService.subscribeToAllClients(vi.fn())
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'annuaireClients')
    expect(collection).not.toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  it('[TC-265-13] annuaire complet : les fiches en viennent, `globalClients` n’est jamais écouté', () => {
    const recu = vi.fn()
    firestoreService.subscribeToAllClients(recu)
    annuaireRepond([ETAT_COMPLET, tranche('t00', { c1: { nom: 'OUEDRAOGO' } }), tranche('t01', { c2: { nom: 'KABORE' } })])
    expect(recu).toHaveBeenCalledWith([{ id: 'c1', nom: 'OUEDRAOGO' }, { id: 'c2', nom: 'KABORE' }])
    expect(collection).not.toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  // Lot G2 : une fois l'annuaire lu, seules les tranches modifiées depuis sont
  // demandées. L'écoute de la collection entière se ferme.
  it('[TC-265-16] puis seules les tranches modifiées depuis la plus récente sont écoutées', () => {
    firestoreService.subscribeToAllClients(vi.fn())
    annuaireRepond([ETAT_COMPLET, tranche('t00', { c1: { nom: 'OUEDRAOGO' } })])

    expect(onSnapshot.mock.results[0].value).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(2)
    const [cible, options] = onSnapshot.mock.calls[1]
    expect(options).toEqual({ includeMetadataChanges: true })
    expect(cible).toEqual({
      ref: { path: 'annuaireClients' },
      contraintes: [{ where: ['majLe', '>', expect.objectContaining({ seconds: 10, nanoseconds: 5 })] }],
    })
  })

  it('[TC-265-17] sans cache Firestore (émulateurs), aucune copie n’est gardée sur l’appareil', () => {
    expect(firestoreService._copieAnnuaire()).toBeNull()
  })

  it('[TC-265-14] le chemin boutique passe par le même annuaire, précondition intacte', () => {
    firestoreService.setActiveStore({ id: 's1', name: 'FADA' })
    const recu = vi.fn()
    firestoreService.subscribeToClients(recu)
    annuaireRepond([ETAT_COMPLET, tranche('t00', { c1: { nom: 'OUEDRAOGO' } })])
    expect(recu).toHaveBeenCalledWith([{ id: 'c1', nom: 'OUEDRAOGO' }])
    expect(collection).not.toHaveBeenCalledWith(expect.anything(), 'globalClients')
  })

  it('[TC-265-15] une erreur de l’annuaire n’atteint pas l’écran : le repli s’ouvre', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const recu = vi.fn()
    recu.onError = vi.fn()
    firestoreService.subscribeToAllClients(recu)
    const [, , , surErreur] = onSnapshot.mock.calls[0]
    surErreur(Object.assign(new Error('refusé'), { code: 'permission-denied' }))
    expect(recu.onError).not.toHaveBeenCalled()
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'globalClients')
    console.warn.mockRestore()
  })
})

describe('TC-265 — le chemin du gérant garde sa précondition', () => {
  it('[TC-265-05] `subscribeToClients` lève toujours sans boutique active', () => {
    expect(() => firestoreService.subscribeToClients(vi.fn()))
      .toThrow(/Boutique active introuvable/)
  })

  it('[TC-265-06] et il fonctionne avec une boutique active', () => {
    firestoreService.setActiveStore({ id: 's1', name: 'FADA' })
    expect(() => firestoreService.subscribeToClients(vi.fn())).not.toThrow()
  })
})

/**
 * ⚠ UNE FICHE, PAS LA BASE (docs/rester-dans-le-quota-gratuit.md §A2).
 *   L'historique d'un client écoutait les ~15 700 fiches du réseau pour en
 *   afficher une seule : 15 679 lectures facturées à chaque ouverture faite
 *   après 30 minutes, là où l'écoute d'un document en coûte une.
 */
describe('TC-265 — l’abonnement à une seule fiche', () => {
  it('[TC-265-07] il vise le document `globalClients/{id}`, sans boutique active', () => {
    firestoreService.subscribeToClient('c1', vi.fn())
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'globalClients', 'c1')
    expect(collection).not.toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('[TC-265-08] la fiche arrive avec son identifiant, et le désabonnement est rendu', () => {
    const stop = vi.fn()
    onSnapshot.mockReturnValueOnce(stop)
    const recu = vi.fn()
    expect(firestoreService.subscribeToClient('c1', recu)).toBe(stop)
    const [, surSuivant] = onSnapshot.mock.calls[0]
    surSuivant({ id: 'c1', exists: () => true, data: () => ({ nom: 'OUEDRAOGO' }) })
    expect(recu).toHaveBeenCalledWith({ id: 'c1', nom: 'OUEDRAOGO' })
  })

  it('[TC-265-09] une fiche absente — supprimée, ou jamais créée — rend `null`', () => {
    const recu = vi.fn()
    firestoreService.subscribeToClient('inconnu', recu)
    const [, surSuivant] = onSnapshot.mock.calls[0]
    surSuivant({ id: 'inconnu', exists: () => false, data: () => undefined })
    expect(recu).toHaveBeenCalledWith(null)
  })

  /**
   * ⚠ L'IDENTIFIANT VIENT DE L'ADRESSE. `doc()` LÈVE sur un identifiant vide ou
   *   qui contient « / » (`/admin/clients/a%2Fb/historique`). L'ancienne
   *   recherche en mémoire répondait « introuvable » ; une exception ferait
   *   tomber l'écran. Aucune fiche ne peut porter un tel identifiant.
   */
  it('[TC-265-10] un identifiant que le SDK refuse rend `null` au lieu de lever', () => {
    doc.mockImplementationOnce(() => { throw new Error('Invalid document reference') })
    const recu = vi.fn()
    let stop
    expect(() => { stop = firestoreService.subscribeToClient('a/b', recu) }).not.toThrow()
    expect(recu).toHaveBeenCalledWith(null)
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })

  it('[TC-265-11] une erreur d’écoute atteint `onError` du callback', () => {
    const recu = vi.fn()
    recu.onError = vi.fn()
    firestoreService.subscribeToClient('c1', recu)
    const [, , surErreur] = onSnapshot.mock.calls[0]
    const panne = Object.assign(new Error('Accès refusé.'), { code: 'permission-denied' })
    surErreur(panne)
    expect(recu.onError).toHaveBeenCalledWith(panne)
  })
})
