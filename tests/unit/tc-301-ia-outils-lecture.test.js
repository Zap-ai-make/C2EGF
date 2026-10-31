/**
 * TC-301 — les outils de LECTURE de l'assistant, contre le vrai `firestoreService`.
 *
 * tc-300 couvre les modules purs ; aucun test n'exécutait `executerOutil` contre
 * la base. C'est par ce trou qu'est passé BUG-06 (audit du 29 octobre 2026) :
 * `outils.js` appelait `getClients`, `getDrafts` et `getHistory` détachées du
 * singleton, donc sans `this`. Chaque lecture levait un TypeError, que
 * `traduirePanne` rendait en « Je n'ai pas pu lire… » — une panne passagère en
 * apparence, un défaut de code en réalité.
 *
 * Seul le SDK Firestore est simulé : `getDocs` répond selon le CHEMIN demandé.
 * Le singleton, sa boutique active, le cache et les services délégués sont
 * réels — c'est précisément leur assemblage qui cassait.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// La base simulée : chemin → documents
// ---------------------------------------------------------------------------

const base = vi.hoisted(() => ({ collections: {} }))

// Les `where` sont APPLIQUÉS, comme le ferait Firestore : une lecture bornée
// ne doit rendre que sa fenêtre, sinon le test ne prouverait pas la borne.
const filtre = vi.hoisted(() => ({
  respecte(document_, { champ, op, valeur }) {
    const v = document_[champ]
    if (v === undefined || v === null) return false
    if (op === '>=') return v >= valeur
    if (op === '<') return v < valeur
    if (op === '<=') return v <= valeur
    if (op === '==') return v === valeur
    throw new Error(`opérateur non simulé : ${op}`)
  },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ path, contraintes: [] })),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  query: vi.fn((ref, ...contraintes) => ({
    path: ref.path,
    contraintes: [...(ref.contraintes ?? []), ...contraintes.filter(Boolean)],
  })),
  orderBy: vi.fn(),
  where: vi.fn((champ, op, valeur) => ({ champ, op, valeur })),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(async (ref) => ({
    docs: (base.collections[ref.path] ?? [])
      .filter((d) => (ref.contraintes ?? []).every((c) => filtre.respecte(d, c)))
      .map(({ id, ...donnees }) => ({ id, data: () => donnees })),
  })),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}))

vi.mock('../../src/services/storeTransactionCommandService.js', () => ({
  runStoreTransactionCommand: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  functions: {},
  firebaseInfo: {},
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

import { getDocs } from 'firebase/firestore'
import { firestoreService } from '../../src/services/firestore.js'
import { DECLARATIONS, executerOutil } from '../../src/lib/ia/outils.js'
import { CLES_DESTINATIONS } from '../../src/lib/ia/destinations.js'

// ---------------------------------------------------------------------------
// Jeux de données — valeurs attendues écrites à la main
// ---------------------------------------------------------------------------

const CLIENTS = [
  { id: 'c1', nom: 'OUEDRAOGO', prenom: 'Souleymane', codeAgent: '1234567', registeredStoreName: 'Gounghin' },
  { id: 'c2', nom: 'KINDA', prenom: 'Adjara', codeAgent: '7654321', registeredStoreName: 'Pissy' },
]

const BROUILLONS_A = [
  { id: 'd1', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 15000, statut: 'Non Terminées', date: '29/10/2026 08:40:00' },
  { id: 'd2', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 9000, statut: 'Annulée', date: '29/10/2026 08:50:00' },
]

const HISTORIQUE_A = [
  { id: 'h1', clientNom: 'KINDA Adjara', type: 'Retrait', montant: 20000, statut: 'Validée', date: '29/10/2026 09:15:00' },
  { id: 'h2', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '29/10/2026 09:30:00' },
]

const HISTORIQUE_B = [
  { id: 'hb1', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 3000, statut: 'Validée', date: '29/10/2026 10:00:00' },
]

const BOUTIQUE_A = { id: 'boutique-a', name: 'Gounghin' }
const BOUTIQUE_B = { id: 'boutique-b', name: 'Pissy' }

beforeEach(() => {
  base.collections = {
    globalClients: CLIENTS,
    'clients/boutique-a/drafts': BROUILLONS_A,
    'clients/boutique-a/history': HISTORIQUE_A,
    'clients/boutique-b/drafts': [],
    'clients/boutique-b/history': HISTORIQUE_B,
  }
  firestoreService.setActiveStore(BOUTIQUE_A)
  // Un outil qui échoue écrit en console : c'est voulu, et cela ne doit pas
  // salir la sortie des tests.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // Vide aussi le cache : sans cela, une lecture d'un test servirait le suivant.
  firestoreService.setActiveStore(null)
  vi.restoreAllMocks()
})

describe('[OL] outils de lecture, sur le vrai firestoreService', () => {
  it('[OL-01] chercher_client rend la fiche trouvée, sans champ d\'audit', async () => {
    const reponse = await executerOutil('chercher_client', { recherche: 'ouedraogo' })

    expect(reponse).toEqual({
      trouves: 1,
      tronque: false,
      clients: [{ nom: 'Souleymane OUEDRAOGO', codeAgent: '1234567', registeredStoreName: 'Gounghin' }],
    })
  })

  it('[OL-02] creances_en_cours additionne ce qui reste dû, annulées écartées', async () => {
    const reponse = await executerOutil('creances_en_cours')

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.nombre).toBe(1)
    expect(reponse.total_du).toBe(15000)
  })

  it('[OL-03] operations_recentes lit l\'historique de la boutique active', async () => {
    const reponse = await executerOutil('operations_recentes', { type: 'Dépôt' })

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.nombre).toBe(1)
    expect(reponse.total).toBe(50000)
    expect(reponse.operations).toEqual([
      { clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '29/10/2026 09:30:00' },
    ])
  })

  it('[OL-04] bilan_du_jour lit ses trois sources sans en déclarer une incomplète', async () => {
    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.clients_enregistres).toBe(2)
    expect(reponse.creances_en_cours).toBe(1)
    expect(reponse.total_des_creances).toBe(15000)
    expect(reponse.lectures_incompletes).toEqual([])
  })

  it('[OL-05] la boutique lue est celle du singleton, pas une autre', async () => {
    firestoreService.setActiveStore(BOUTIQUE_B)

    const reponse = await executerOutil('operations_recentes')

    expect(reponse.nombre).toBe(1)
    expect(reponse.total).toBe(3000)
    expect(reponse.operations[0].clientNom).toBe('ZIDA Kassoum')
  })
})

/**
 * « Le point », par défaut sur la journée ; sur la période que la personne
 * nomme sinon (« les 10 derniers jours », « 3 mois »). Sans borne, le bilan
 * additionnait TOUT l'historique : le cumul depuis l'ouverture, présenté comme
 * le chiffre du jour. La journée est celle du tableau de bord
 * (`useTodayTransactions`) : date saisie dans la journée métier du profil,
 * annulées et lignes sans date écartées.
 *
 * Ouagadougou est à UTC+0 : les bornes attendues s'écrivent en UTC à la main.
 */
const HISTORIQUE_DATE = [
  { id: 'j1', clientNom: 'KINDA Adjara', type: 'Retrait', montant: 20000, statut: 'Validée', date: '29/10/2026 00:05:00', createdAt: new Date('2026-10-29T00:05:00Z') },
  { id: 'j2', clientNom: 'OUEDRAOGO Souleymane', type: 'Dépôt', montant: 50000, statut: 'Validée', date: '28/10/2026 23:55:00', createdAt: new Date('2026-10-28T23:55:00Z') },
  { id: 'j3', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 7000, statut: 'Annulée', date: '29/10/2026 11:00:00', createdAt: new Date('2026-10-29T11:00:00Z') },
  { id: 'j4', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 4000, statut: 'Validée', date: '29/10/2026 11:30:00', createdAt: new Date('2026-10-29T11:30:00Z') },
  { id: 'j5', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 1000, statut: 'Validée', createdAt: new Date('2026-10-29T11:45:00Z') },
  { id: 'j6', clientNom: 'KINDA Adjara', type: 'Retrait', montant: 3000, statut: 'Validée', date: '20/10/2026 10:00:00', createdAt: new Date('2026-10-20T10:00:00Z') },
  { id: 'j7', clientNom: 'ZIDA Kassoum', type: 'Dépôt', montant: 9000, statut: 'Validée', date: '19/10/2026 23:59:00', createdAt: new Date('2026-10-19T23:59:00Z') },
]

/** Les contraintes de la dernière lecture d'historique envoyée au SDK. */
function bornesLues() {
  const appels = vi.mocked(getDocs).mock.calls.filter(([ref]) => ref.path === 'clients/boutique-a/history')
  return appels.at(-1)?.[0].contraintes ?? null
}

describe('[OJ] bilan_du_jour : la journée, ou la période demandée', () => {
  beforeEach(() => {
    // Seule l'horloge est figée : les minuteries du cache restent réelles.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-29T12:00:00Z') })
    base.collections['clients/boutique-a/history'] = [...HISTORIQUE_DATE]
    vi.mocked(getDocs).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[OJ-01] la veille, une annulée et une ligne sans date ne comptent pas', async () => {
    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.operations_terminees).toBe(2)
    expect(reponse.total_encaisse).toBe(24000)
    expect(reponse.par_type).toEqual({ Retrait: 20000, Dépôt: 4000 })
    expect(reponse.periode).toEqual({ du: '29/10/2026', au: '29/10/2026', jours: 1 })
  })

  it('[OJ-03] la lecture est bornée à la journée, pas à tout l\'historique', async () => {
    await executerOutil('bilan_du_jour')

    expect(bornesLues()).toEqual(expect.arrayContaining([
      { champ: 'createdAt', op: '>=', valeur: new Date('2026-10-29T00:00:00Z') },
      { champ: 'createdAt', op: '<', valeur: new Date('2026-10-30T00:00:00Z') },
    ]))
  })

  it('[OJ-04] une opération faite entre deux questions apparaît à la seconde', async () => {
    await executerOutil('bilan_du_jour')
    base.collections['clients/boutique-a/history'].push(
      { id: 'j8', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 6000, statut: 'Validée', date: '29/10/2026 11:59:00', createdAt: new Date('2026-10-29T11:59:00Z') },
    )

    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.operations_terminees).toBe(3)
    expect(reponse.total_encaisse).toBe(30000)
  })

  // Premier essai réel (30 octobre 2026) : « Total encaissé : 15 400 000 FCFA »
  // pour 400 000 de dépôts et retraits — ravitaillement et retour additionnés.
  // La règle est celle du chiffre d'affaires (chiffreAffairesService.js).
  it('[OJ-06] ravitaillements, retours et clôtures restent hors des totaux clients, et sont dits à part', async () => {
    base.collections['clients/boutique-a/history'].push(
      { id: 'd1', type: 'Ravitaillement', expediteur: 'Patron', montant: 6000000, statut: 'Validée', date: '29/10/2026 08:00:00', createdAt: new Date('2026-10-29T08:00:00Z') },
      { id: 'd2', type: 'Retour', expediteur: 'Patron', montant: 9000000, statut: 'Validée', date: '29/10/2026 09:00:00', createdAt: new Date('2026-10-29T09:00:00Z') },
      { id: 'd3', type: 'Clôture', montant: 1800000, statut: 'Validée', date: '29/10/2026 10:00:00', createdAt: new Date('2026-10-29T10:00:00Z') },
    )

    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.operations_terminees).toBe(2)
    expect(reponse.total_encaisse).toBe(24000)
    expect(reponse.par_type).toEqual({ Retrait: 20000, Dépôt: 4000 })
    expect(reponse.mouvements_dealer).toEqual({ Ravitaillement: 6000000, Retour: 9000000, Clôture: 1800000 })
  })

  it('[OJ-07] l\'historique sans filtre suit la même règle ; filtré sur un ravitaillement, il le totalise', async () => {
    base.collections['clients/boutique-a/history'].push(
      { id: 'd1', type: 'Ravitaillement', expediteur: 'Patron', montant: 6000000, statut: 'Validée', date: '29/10/2026 08:00:00', createdAt: new Date('2026-10-29T08:00:00Z') },
    )

    const tout = await executerOutil('operations_recentes', { jours: 1 })
    expect(tout.total).toBe(24000)
    expect(tout.mouvements_dealer).toEqual({ Ravitaillement: 6000000 })

    const ravitaillements = await executerOutil('operations_recentes', { jours: 1, type: 'Ravitaillement' })
    expect(ravitaillements.total).toBe(6000000)
    expect(ravitaillements.nombre).toBe(1)
  })

  it('[OJ-05] « les 10 derniers jours » : aujourd\'hui compris, le 19 exclu', async () => {
    const reponse = await executerOutil('bilan_du_jour', { jours: 10 })

    expect(reponse.periode).toEqual({ du: '20/10/2026', au: '29/10/2026', jours: 10 })
    expect(reponse.operations_terminees).toBe(4)
    expect(reponse.total_encaisse).toBe(77000)
    expect(reponse.par_type).toEqual({ Retrait: 23000, Dépôt: 54000 })
    expect(bornesLues()).toEqual(expect.arrayContaining([
      { champ: 'createdAt', op: '>=', valeur: new Date('2026-10-20T00:00:00Z') },
      { champ: 'createdAt', op: '<', valeur: new Date('2026-10-30T00:00:00Z') },
    ]))
  })

  it.each([0, -3, 2.5, 400, 'dix'])(
    '[OJ-06] une période impossible (%s) est refusée sans rien lire',
    async (jours) => {
      const reponse = await executerOutil('bilan_du_jour', { jours })

      expect(reponse.erreur).toBe(true)
      expect(bornesLues()).toBeNull()
    },
  )

  it('[OJ-07] operations_recentes sur 7 jours : bornée, totalisée, période dite', async () => {
    const reponse = await executerOutil('operations_recentes', { jours: 7 })

    expect(reponse.periode).toEqual({ du: '23/10/2026', au: '29/10/2026', jours: 7 })
    expect(reponse.nombre).toBe(3)
    expect(reponse.total).toBe(74000)
    expect(bornesLues()).toEqual(expect.arrayContaining([
      { champ: 'createdAt', op: '>=', valeur: new Date('2026-10-23T00:00:00Z') },
    ]))
  })

  // Le modèle ne passe que ce que la déclaration décrit : un paramètre lu par
  // l'exécutant mais absent de la déclaration ne serait JAMAIS envoyé.
  it.each(['bilan_du_jour', 'operations_recentes'])(
    '[OJ-08] %s déclare au modèle le paramètre `jours` que son exécutant lit',
    (nom) => {
      const declaration = DECLARATIONS.find((d) => d.name === nom)

      expect(declaration.parameters.properties.jours?.type).toBe('INTEGER')
      expect(declaration.parameters.required ?? []).not.toContain('jours')
    },
  )

  it('[OJ-02] les créances en cours restent toutes comptées, quel que soit leur âge', async () => {
    base.collections['clients/boutique-a/drafts'] = [
      { id: 'v1', clientNom: 'KINDA Adjara', type: 'Dépôt', montant: 15000, statut: 'Non Terminées', date: '12/10/2026 09:00:00' },
    ]

    const reponse = await executerOutil('bilan_du_jour')

    expect(reponse.creances_en_cours).toBe(1)
    expect(reponse.total_des_creances).toBe(15000)
  })
})

/**
 * Le mode d'emploi : l'assistant lit les fiches de l'onglet Aide, la même
 * source que la caissière. Une fiche corrigée corrige l'aide ET l'assistant ;
 * réciter la procédure de mémoire dans le prompt la ferait diverger.
 * Les attentes viennent de `src/content/aideFiches.js`, relevées à la main.
 */
describe('[ME] mode_d_emploi : les fiches de l\'onglet Aide', () => {
  it('[ME-01] sans sujet, le sommaire : cinq rubriques, dans l\'ordre de l\'aide', async () => {
    const reponse = await executerOutil('mode_d_emploi')

    expect(reponse.sommaire.map((r) => [r.rubrique, r.ecran, r.fiches.map((f) => f.numero)])).toEqual([
      ['Enregistrer une opération', 'transactions', [1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ['Stock et espèces', 'transactions', [10, 11]],
      ['Relire et corriger', 'historique', [12, 13, 14, 15, 16, 17, 18, 19]],
      ['Les clients', 'clients', [20, 21, 22]],
      ['L’assistant', 'transactions', [23, 24, 25, 26]],
    ])
    expect(reponse.sommaire[0].fiches[2].titre).toBe('« Valider » ou « Non Terminées » : lequel choisir ?')
  })

  it('[ME-02] « encaisser » rend les fiches qui en parlent, la plus utile d\'abord, libellés lisibles', async () => {
    const reponse = await executerOutil('mode_d_emploi', { sujet: 'encaisser' })

    // 4 : comment terminer ; 8 : la case « Dépôts » ; 23 : la question toute faite de l'assistant.
    expect(reponse.fiches.map((f) => f.numero)).toEqual([4, 8, 23])
    expect(reponse.fiches[0].texte).toContain('« Encaisser »')
    expect(reponse.fiches[0].texte).toContain('« Payer par »')
    expect(reponse.fiches[0].texte).not.toMatch(/\{\{|\*\*/)
    expect(reponse.fiches[0].ecran).toBe('transactions')
  })

  it('[ME-03] des mots entiers : « rendre » ne trouve pas « prendre »', async () => {
    const reponse = await executerOutil('mode_d_emploi', { sujet: 'rendre au dealer' })

    expect(reponse.fiches[0].numero).toBe(11)
    expect(reponse.fiches.map((f) => f.numero)).not.toContain(2)
  })

  it('[ME-04] un sujet sans fiche le dit, et rend le sommaire pour choisir', async () => {
    const reponse = await executerOutil('mode_d_emploi', { sujet: 'photocopieuse' })

    expect(reponse.erreur).toBeUndefined()
    expect(reponse.fiches).toEqual([])
    expect(reponse.message).toBeTruthy()
    expect(reponse.sommaire).toHaveLength(5)
  })

  it('[ME-05] par numéro : la fiche entière, gras retiré', async () => {
    const reponse = await executerOutil('mode_d_emploi', { numero: 11 })

    expect(reponse.fiches).toHaveLength(1)
    expect(reponse.fiches[0].numero).toBe(11)
    expect(reponse.fiches[0].texte).toContain('personne par personne')
    expect(reponse.fiches[0].texte).not.toMatch(/\{\{|\*\*/)
  })

  it('[ME-06] un numéro qui n\'existe pas rend le sommaire, pas une fiche voisine', async () => {
    const reponse = await executerOutil('mode_d_emploi', { numero: 99 })

    expect(reponse.fiches).toEqual([])
    expect(reponse.sommaire).toHaveLength(5)
  })

  it('[ME-07] chaque rubrique mène à un écran que l\'assistant sait ouvrir', async () => {
    const reponse = await executerOutil('mode_d_emploi')

    for (const rubrique of reponse.sommaire) {
      expect(CLES_DESTINATIONS).toContain(rubrique.ecran)
    }
  })

  it('[ME-08] la déclaration expose sujet et numéro, tous deux facultatifs', () => {
    const declaration = DECLARATIONS.find((d) => d.name === 'mode_d_emploi')

    expect(declaration.parameters.properties.sujet?.type).toBe('STRING')
    expect(declaration.parameters.properties.numero?.type).toBe('INTEGER')
    expect(declaration.parameters.required ?? []).toEqual([])
  })
})
