import { describe, it, expect, vi } from 'vitest'

/**
 * TC-241 — Les quatre constats que la revue avait laissés à vérifier.
 *
 * TC-239 et TC-240 ont fermé les défauts CONFIRMÉS du premier passage. Ceux-ci
 * étaient restés au stade de l'hypothèse, faute de temps pour les instruire.
 * Ils se sont tous les quatre révélés réels, et trois des quatre font dire au
 * logiciel quelque chose de faux sur de l'argent :
 *
 *   1. Une dette de ravitaillement sortie de la page de 100 lignes disparaissait
 *      de « ce qu'il reste à rendre ». La boutique lisait « Rien à rendre »
 *      en devant encore. ← la plus grave : elle efface une dette.
 *   2. `settlementAgentCode` n'était écrit qu'à la dernière tranche : l'export
 *      attribuait tout le montant au dernier compte crédité.
 *   3. Une ligne « Annulée » comptait dans le total d'un groupe, et son badge
 *      cédait la place au compte d'opérations — invisible et fausse à la fois.
 *   4. Le plafond « Disponible » d'un retour en espèces lisait la somme des
 *      réseaux, là où le serveur n'en débite qu'un. ← TC-242, qui a besoin du DOM.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. La dette de ravitaillement ignore la fenêtre de pagination
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
}))
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(), connectAuthEmulator: vi.fn() }))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn(), getApp: vi.fn() }))
vi.mock('../../src/config/firebase', () => ({ db: {}, auth: {}, firebaseInfo: {}, default: {} }))

const { HistoryService, HISTORY_PAGE_SIZE } = await import('../../src/services/historyService.js')
const { FIRESTORE_CONFIG } = await import('../../src/constants/firestoreConstants.js')
const { accumulerCodesAgent, libelleCodesAgent } = await import('../../functions/src/settlements/settlementShared.js')
const { regrouperParClientEtType } = await import('../../src/utils/regroupement.js')

/** Le service, avec pour seules dépendances celles que l'écoute utilise. */
const service = (overrides = {}) => {
  const subscribeToCollection = vi.fn(() => vi.fn())
  const requireActiveStore = vi.fn(() => ({ id: 'store-241' }))
  const ctx = { requireActiveStore, subscribeToCollection, ...overrides }
  return { svc: new HistoryService({ ctx }), subscribeToCollection, requireActiveStore }
}

/** Les options de requête passées à Firestore par la dernière écoute posée. */
const options = (subscribeToCollection) => subscribeToCollection.mock.calls[0][2]

describe('TC-241 — une dette ne se périme pas avec la pagination', () => {
  /**
   * ⚠ LE DÉFAUT. Le panneau de ravitaillement et son badge lisent
   *   `completedTransactions`, qui est une FENÊTRE : les 100 dernières lignes,
   *   plus la journée en cours. Une livraison reçue il y a trois semaines en
   *   sort dès que cent opérations ont suivi — et avec elle, la dette qu'elle
   *   porte. Le logiciel annonçait alors une ardoise soldée qui ne l'était pas.
   */
  it('[TC-241-1] l’écoute des ravitaillements dus n’a AUCUNE limite', () => {
    const { svc, subscribeToCollection } = service()
    svc.subscribeToOpenReplenishments(vi.fn())

    expect(options(subscribeToCollection).limitCount).toBeUndefined()
    expect(HISTORY_PAGE_SIZE).toBe(100) // la fenêtre dont on s'affranchit ici
  })

  it('[TC-241-2] elle ne retient que les livraisons encore ouvertes', () => {
    const { svc, subscribeToCollection } = service()
    svc.subscribeToOpenReplenishments(vi.fn())

    const [collection, , opts] = subscribeToCollection.mock.calls[0]
    expect(collection).toBe(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(opts.where).toEqual([
      { field: 'replenishmentStatus', operator: '==', value: 'open' },
    ])
  })

  /**
   * ⚠ PAS DE `orderBy`, ET C'EST UNE CONTRAINTE FIRESTORE, PAS UN OUBLI.
   *   Un filtre d'égalité seul se sert de l'index automatique. Y ajouter un tri
   *   sur un AUTRE champ exigerait un index composite — donc un déploiement —
   *   pour trier une poignée de lignes que `ravitaillementsEnCours` reclasse
   *   déjà en mémoire. Ce test existe pour qu'on ne l'ajoute pas par réflexe.
   */
  it('[TC-241-3] et aucun tri, qui coûterait un index composite', () => {
    const { svc, subscribeToCollection } = service()
    svc.subscribeToOpenReplenishments(vi.fn())

    expect(options(subscribeToCollection).orderByField).toBeUndefined()
  })

  it('[TC-241-4] la boutique active reste exigée, comme pour l’historique', () => {
    const { svc, requireActiveStore } = service()
    svc.subscribeToOpenReplenishments(vi.fn())

    expect(requireActiveStore).toHaveBeenCalled()
  })

  it('[TC-241-5] l’écoute de l’historique garde sa fenêtre : rien n’a bougé pour elle', () => {
    const { svc, subscribeToCollection } = service()
    svc.subscribeToHistory(vi.fn())

    expect(options(subscribeToCollection)).toMatchObject({
      orderByField: 'createdAt',
      orderDirection: 'desc',
      limitCount: 100,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Le code agent de CHAQUE tranche, et non du dernier
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-241 — les destinations d’un règlement en plusieurs tranches', () => {
  it('[TC-241-6] le premier code ouvre la liste', () => {
    expect(accumulerCodesAgent(null, '1111111')).toEqual(['1111111'])
  })

  it('[TC-241-7] les suivants s’y ajoutent, dans l’ordre de saisie', () => {
    const un = accumulerCodesAgent(null, '1111111')
    const deux = accumulerCodesAgent({ agentCodes: un }, '2222222')

    expect(deux).toEqual(['1111111', '2222222'])
  })

  /** Régler deux fois sur le même compte n'est pas deux destinations. */
  it('[TC-241-8] un code déjà présent n’est pas répété', () => {
    expect(accumulerCodesAgent({ agentCodes: ['1111111'] }, '1111111')).toEqual(['1111111'])
  })

  /**
   * Le champ reste facultatif TRANCHE PAR TRANCHE : la caissière envoie la
   * première moitié sur un compte et remet la seconde en main propre.
   */
  it('[TC-241-9] une tranche sans code laisse la liste intacte', () => {
    expect(accumulerCodesAgent({ agentCodes: ['1111111'] }, null)).toEqual(['1111111'])
    expect(accumulerCodesAgent({ agentCodes: ['1111111'] }, '')).toEqual(['1111111'])
  })

  it('[TC-241-10] un résumé d’avant ce champ repart d’une liste vide', () => {
    expect(accumulerCodesAgent({ netByNetwork: {} }, null)).toEqual([])
    expect(accumulerCodesAgent(undefined, undefined)).toEqual([])
  })

  /** Un seul code reste un code : l'export ne change pas d'allure. */
  it('[TC-241-11] une destination unique s’écrit telle quelle', () => {
    expect(libelleCodesAgent(['1111111'])).toBe('1111111')
  })

  /**
   * ⚠ LE DÉFAUT. Seul le dernier code était écrit. Les citer tous est le seul
   *   libellé qui ne désigne pas un destinataire unique pour de l'argent parti
   *   à plusieurs.
   */
  it('[TC-241-12] plusieurs destinations se citent toutes', () => {
    expect(libelleCodesAgent(['1111111', '2222222', '3333333']))
      .toBe('1111111 + 2222222 + 3333333')
  })

  it('[TC-241-13] aucune destination rend null, et non une chaîne vide', () => {
    expect(libelleCodesAgent([])).toBeNull()
    expect(libelleCodesAgent(undefined)).toBeNull()
    expect(libelleCodesAgent(null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Une ligne annulée ne se regroupe pas
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-241 — le regroupement écarte les lignes annulées', () => {
  const tx = (over = {}) => ({
    id: 'a',
    clientId: 'client-1',
    client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
    type: 'Dépôt',
    montant: 50_000,
    statut: 'Validée',
    ...over,
  })

  /**
   * ⚠ LE DÉFAUT, ET IL SE VOIT DEUX FOIS.
   *   `cancelHistory` a RENDU le montant aux soldes : l'argent n'a pas bougé.
   *   Dans un groupe, la ligne annulée ajoutait quand même son montant au
   *   total — et la colonne Statut, qui affichait « Annulée », cède la place au
   *   compte d'opérations. Le lecteur voyait donc un total trop grand, sans
   *   rien pour s'en douter.
   */
  it('[TC-241-14] son montant ne gonfle pas le total du groupe', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', montant: 50_000 }),
      tx({ id: 'b', montant: 50_000 }),
      tx({ id: 'c', montant: 999_000, statut: 'Annulée' }),
    ])

    const groupes = rangees.filter((r) => r.groupe)
    expect(groupes).toHaveLength(1)
    expect(groupes[0].groupe.total).toBe(100_000)
    expect(groupes[0].groupe.lignes.map((l) => l.id)).toEqual(['a', 'b'])
  })

  /** Seule, elle garde son badge — c'est tout l'intérêt de l'écarter. */
  it('[TC-241-15] elle reste une rangée ordinaire, badge compris', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a' }),
      tx({ id: 'b' }),
      tx({ id: 'c', statut: 'Annulée' }),
    ])

    const seules = rangees.filter((r) => r.seule)
    expect(seules).toHaveLength(1)
    expect(seules[0].seule).toMatchObject({ id: 'c', statut: 'Annulée' })
  })

  /** Deux dépôts dont un annulé : il ne reste qu'une opération vivante. */
  it('[TC-241-16] et sans elle, un groupe de deux n’est plus un groupe', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a' }),
      tx({ id: 'b', statut: 'Annulée' }),
    ])

    expect(rangees.every((r) => r.seule)).toBe(true)
    expect(rangees).toHaveLength(2)
  })

  /** L'accent et la casse ne protègent pas une ligne annulée. */
  it('[TC-241-17] « annulee » sans accent est écartée aussi', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a' }),
      tx({ id: 'b' }),
      tx({ id: 'c', statut: 'annulee' }),
    ])

    expect(rangees.filter((r) => r.groupe)[0].groupe.lignes).toHaveLength(2)
  })

  /**
   * La corbeille n'arrive déjà pas jusqu'ici — `useHistoriqueFilters` l'écarte
   * en amont. Mais le tableau des non terminées marque ses suppressions de
   * façon optimiste, avant la réponse du serveur.
   */
  it('[TC-241-18] une ligne mise à la corbeille non plus', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a' }),
      tx({ id: 'b' }),
      tx({ id: 'c', deletedAt: new Date() }),
    ])

    expect(rangees.filter((r) => r.groupe)[0].groupe.lignes.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('[TC-241-19] une transaction valide se regroupe toujours', () => {
    const rangees = regrouperParClientEtType([tx({ id: 'a' }), tx({ id: 'b' })])

    expect(rangees).toHaveLength(1)
    expect(rangees[0].groupe.total).toBe(100_000)
  })
})
