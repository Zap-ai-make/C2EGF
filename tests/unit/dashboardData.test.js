/**
 * TC-011A -- Caracterisation du hook useAllTransactions
 *
 * Comportement a capturer (golden test) :
 *   - useAllTransactions() fusionne pendingTransactions et completedTransactions
 *     via une Map indexee par transaction.id.
 *   - Les transactions completees ecrasent les transactions en attente de meme id
 *     (la valeur est remplacee, la position dans la Map -- donc dans le tableau
 *     resultat -- correspond a la premiere insertion, c'est-a-dire celle du pending).
 *   - Les transactions dont l'id est falsy (undefined, null, '') sont ignorees.
 *   - Si pendingTransactions ou completedTransactions est undefined/null, le
 *     fallback || [] produit un tableau vide sans erreur.
 *
 * Fichier source : src/hooks/useAllTransactions.js:8-33
 * Dependance mockee : src/context/transactions.jsx (useTransactions)
 *
 * Interdictions :
 *   - Aucun mock de useMemo ni de React.
 *   - Aucun vi.useFakeTimers (ce hook ne lit pas Date).
 *   - Aucun acces Firebase, aucun acces reseau.
 *   - Aucune modification de src/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import {
  pendingNominal,
  completedNominal,
  pendingShared,
  completedShared,
  pendingWithFalsyIds,
  clientToday,
  clientThisMonth,
  clientPreviousMonth,
  clientWithoutDate,
  transactionTopToday,
  transactionLowToday,
  transactionYesterday,
  transactionWithoutDate,
} from '../fixtures/dashboard.js'

// ---------------------------------------------------------------------------
// Mock du contexte transactions
// ---------------------------------------------------------------------------

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: vi.fn(),
}))

// Import apres mock
import { useTransactions } from '../../src/context/transactions.jsx'
import { useAllTransactions } from '../../src/hooks/useAllTransactions.js'
import { useDashboardData } from '../../src/hooks/useDashboardData.js'

// ---------------------------------------------------------------------------

describe('TC-011A -- useAllTransactions', () => {

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Cas 1 -- Union nominale
  // 2 pending (IDs: p-alpha, p-beta) + 1 completed (ID: c-gamma) sans doublon.
  // Resultat attendu : [p-alpha, p-beta, c-gamma] dans cet ordre.
  //
  // Raison de l'ordre :
  //   La Map insere p-alpha puis p-beta (depuis pending).
  //   Puis c-gamma (depuis completed). Aucun doublon, aucune position modifiee.
  //   Array.from(map.values()) => [p-alpha, p-beta, c-gamma].
  // -------------------------------------------------------------------------

  it("[TC-011A-1] union nominale -- retourne les 3 transactions dans l'ordre d'insertion", () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingNominal,
      completedTransactions: completedNominal,
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toEqual([
      pendingNominal[0],
      pendingNominal[1],
      completedNominal[0],
    ])
  })

  // -------------------------------------------------------------------------
  // Cas 2 -- Deduplication
  // pending: [{ id: 'shared-001', montant: 300, statut: 'Non Terminees' }]
  // completed: [{ id: 'shared-001', montant: 350, statut: 'Validee' }]
  //
  // Comportement Map JS :
  //   transactionMap.set('shared-001', pendingShared[0]) => position 0
  //   transactionMap.set('shared-001', completedShared[0]) => valeur ecrasee,
  //     POSITION INCHANGEE (comportement natif de Map en JavaScript)
  //
  // Resultat attendu :
  //   - 1 seul element dans le tableau
  //   - cet element est completedShared[0] (statut 'Validee', montant 350)
  //   - il se trouve a l'index 0 (position de la premiere insertion)
  // -------------------------------------------------------------------------

  it('[TC-011A-2a] deduplication -- un seul element dans le resultat', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingShared,
      completedTransactions: completedShared,
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toHaveLength(1)
  })

  it("[TC-011A-2b] deduplication -- l'element retenu est la version completed (pas pending)", () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingShared,
      completedTransactions: completedShared,
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current[0]).toEqual(completedShared[0])
  })

  it('[TC-011A-2c] deduplication -- la version pending est absente du resultat', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingShared,
      completedTransactions: completedShared,
    })

    const { result } = renderHook(() => useAllTransactions())

    // La version pending a montant 300 ; la version completed a montant 350.
    // Aucun objet avec montant 300 ne doit apparaitre.
    const hasPendingVersion = result.current.some(t => t.montant === 300)
    expect(hasPendingVersion).toBe(false)
  })

  it("[TC-011A-2d] deduplication -- position de l'element : index 0 (position d'insertion initiale)", () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingShared,
      completedTransactions: completedShared,
    })

    const { result } = renderHook(() => useAllTransactions())

    // La cle a ete inseree en premier lors du parcours de pending => position 0 dans la Map.
    expect(result.current[0].id).toBe('shared-001')
    expect(result.current[0].statut).toBe('Validée')
  })

  // -------------------------------------------------------------------------
  // Cas 3 -- Transactions sans id (falsy : undefined, null, '')
  //
  // pendingWithFalsyIds contient :
  //   { id: undefined, ... }  => exclue car !undefined === true => condition if(false)
  //   { id: null, ... }       => exclue car !null === true
  //   { id: '', ... }         => exclue car !'' === true (chaine vide est falsy)
  //   { id: 'valid-id-001' }  => incluse car 'valid-id-001' est truthy
  //
  // completedTransactions: []
  // Resultat attendu : [{ id: 'valid-id-001', ... }] -- 1 seul element.
  // -------------------------------------------------------------------------

  it('[TC-011A-3a] id undefined -- ignore (non insere dans la Map)', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingWithFalsyIds,
      completedTransactions: [],
    })

    const { result } = renderHook(() => useAllTransactions())

    const hasUndefinedId = result.current.some(t => t.id === undefined)
    expect(hasUndefinedId).toBe(false)
  })

  it('[TC-011A-3b] id null -- ignore (non insere dans la Map)', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingWithFalsyIds,
      completedTransactions: [],
    })

    const { result } = renderHook(() => useAllTransactions())

    const hasNullId = result.current.some(t => t.id === null)
    expect(hasNullId).toBe(false)
  })

  it('[TC-011A-3c] id chaine vide -- ignore (non insere dans la Map)', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingWithFalsyIds,
      completedTransactions: [],
    })

    const { result } = renderHook(() => useAllTransactions())

    const hasEmptyId = result.current.some(t => t.id === '')
    expect(hasEmptyId).toBe(false)
  })

  it('[TC-011A-3d] transaction avec id valide -- presente dans le resultat', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: pendingWithFalsyIds,
      completedTransactions: [],
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toEqual({
      id: 'valid-id-001',
      type: 'Dépôt',
      montant: 400,
      statut: 'Non Terminées',
      storeId: 'store-a',
      reseau: 'Orange',
      createdAt: '2026-06-17T06:00:00.000Z',
    })
  })

  // -------------------------------------------------------------------------
  // Cas 4 -- Tableaux undefined
  //
  // Le hook contient :
  //   const pending = pendingTransactions || []
  //   const completed = completedTransactions || []
  //
  // Si useTransactions() retourne { pendingTransactions: undefined,
  //   completedTransactions: undefined }, le fallback produit [] dans les deux cas.
  // Resultat attendu : [] sans erreur.
  // -------------------------------------------------------------------------

  it('[TC-011A-4a] pendingTransactions et completedTransactions undefined -- retourne [] sans erreur', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: undefined,
      completedTransactions: undefined,
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toEqual([])
  })

  it('[TC-011A-4b] pendingTransactions null et completedTransactions null -- retourne [] sans erreur', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: null,
      completedTransactions: null,
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Cas 5 -- Entrees vides
  // pendingTransactions: [], completedTransactions: []
  // Resultat attendu : []
  // -------------------------------------------------------------------------

  it('[TC-011A-5] tableaux vides -- retourne []', () => {
    useTransactions.mockReturnValue({
      pendingTransactions: [],
      completedTransactions: [],
    })

    const { result } = renderHook(() => useAllTransactions())

    expect(result.current).toEqual([])
  })

})

// ---------------------------------------------------------------------------
// TC-011B — useDashboardData
//
// Comportement protege :
//   useDashboardData(clients, allTransactions) calcule :
//     - totalClients  : clients.length (tous, sans filtre date)
//     - monthlyClients: clients dont parsefrenchDate(client.dateAjout) tombe
//                       dans le mois ET l'annee courants (new Date())
//     - dailyClients  : clients dont parsefrenchDate(client.dateAjout).toDateString()
//                       === new Date().toDateString()
//     - todayTransactions : allTransactions filtrees par
//                       parsefrenchDate(transaction.date).toDateString() === aujourd'hui
//                       (delegue a useTodayTransactions)
//     - topClient     : "${client.nom} ${client.prenom} (${formatCurrency(montant)})"
//                       de la transaction du jour avec le montant le plus eleve,
//                       ou "Aucune transaction aujourd'hui" si aucune.
//
// Horloge figee : vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
//   => "aujourd'hui" = 17/06/2026, mois courant = juin 2026.
//
// Interdictions :
//   - Aucun mock de parsefrenchDate, formatCurrency, getTopTransaction, Date.
//   - Aucune modification de src/.
//   - Aucun acces Firebase, aucun acces reseau.
// ---------------------------------------------------------------------------

describe('TC-011B -- useDashboardData', () => {

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // [TC-011B-1] totalClients
  //
  // clients.length est retourne sans aucun filtre par date.
  // Passer 3 clients (dont un sans dateAjout et un hors mois) :
  // tous les 3 comptent dans totalClients.
  // -------------------------------------------------------------------------

  it('[TC-011B-1] totalClients -- compte tous les clients sans filtre date', () => {
    const clients = [clientToday, clientThisMonth, clientPreviousMonth]

    const { result } = renderHook(() =>
      useDashboardData(clients, [])
    )

    expect(result.current.totalClients).toBe(3)
  })

  // -------------------------------------------------------------------------
  // [TC-011B-2] monthlyClients
  //
  // Mix : clientToday (17/06/2026 => juin 2026, compte),
  //        clientThisMonth (05/06/2026 => juin 2026, compte),
  //        clientPreviousMonth (15/01/2025 => janvier 2025, ne compte pas),
  //        clientWithoutDate (dateAjout absent => null => ne compte pas).
  // Attendu : 2.
  // -------------------------------------------------------------------------

  it('[TC-011B-2] monthlyClients -- seuls les clients du mois courant (juin 2026) comptent', () => {
    const clients = [clientToday, clientThisMonth, clientPreviousMonth, clientWithoutDate]

    const { result } = renderHook(() =>
      useDashboardData(clients, [])
    )

    expect(result.current.monthlyClients).toBe(2)
  })

  // -------------------------------------------------------------------------
  // [TC-011B-3] dailyClients
  //
  // Meme mix que TC-011B-2.
  // Seul clientToday (17/06/2026) correspond a toDateString() du 17/06/2026.
  // Attendu : 1.
  // -------------------------------------------------------------------------

  it('[TC-011B-3] dailyClients -- seul le client du jour (17/06/2026) compte', () => {
    const clients = [clientToday, clientThisMonth, clientPreviousMonth, clientWithoutDate]

    const { result } = renderHook(() =>
      useDashboardData(clients, [])
    )

    expect(result.current.dailyClients).toBe(1)
  })

  // -------------------------------------------------------------------------
  // [TC-011B-4] todayTransactions
  //
  // transactionTopToday  : date '17/06/2026 09:30' => incluse
  // transactionLowToday  : date '17/06/2026 08:00' => incluse
  // transactionYesterday : date '16/06/2026 14:00' => exclue
  // transactionWithoutDate : pas de champ date => parsefrenchDate(undefined) => null => exclue
  //
  // Attendu : tableau de 2 elements contenant les IDs des transactions du jour.
  // -------------------------------------------------------------------------

  it('[TC-011B-4a] todayTransactions -- inclut les transactions du jour', () => {
    const allTransactions = [
      transactionTopToday,
      transactionLowToday,
      transactionYesterday,
      transactionWithoutDate,
    ]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.todayTransactions).toHaveLength(2)
  })

  it('[TC-011B-4b] todayTransactions -- contient transactionTopToday', () => {
    const allTransactions = [
      transactionTopToday,
      transactionLowToday,
      transactionYesterday,
      transactionWithoutDate,
    ]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    const ids = result.current.todayTransactions.map(t => t.id)
    expect(ids).toContain('txn-top-today-001')
  })

  it('[TC-011B-4c] todayTransactions -- contient transactionLowToday', () => {
    const allTransactions = [
      transactionTopToday,
      transactionLowToday,
      transactionYesterday,
      transactionWithoutDate,
    ]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    const ids = result.current.todayTransactions.map(t => t.id)
    expect(ids).toContain('txn-low-today-001')
  })

  it('[TC-011B-4d] todayTransactions -- exclut transactionYesterday (16/06/2026)', () => {
    const allTransactions = [
      transactionTopToday,
      transactionLowToday,
      transactionYesterday,
      transactionWithoutDate,
    ]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    const ids = result.current.todayTransactions.map(t => t.id)
    expect(ids).not.toContain('txn-yesterday-001')
  })

  it('[TC-011B-4e] todayTransactions -- exclut transactionWithoutDate (champ date absent)', () => {
    const allTransactions = [
      transactionTopToday,
      transactionLowToday,
      transactionYesterday,
      transactionWithoutDate,
    ]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    const ids = result.current.todayTransactions.map(t => t.id)
    expect(ids).not.toContain('txn-nodate-001')
  })

  // -------------------------------------------------------------------------
  // [TC-011B-5] topClient -- transaction la plus haute du jour
  //
  // transactionTopToday.montant = 5000 > transactionLowToday.montant = 1000
  // => getTopTransaction retourne transactionTopToday
  // => topClient contient "Dupont" et "Marie"
  //
  // On utilise toContain pour eviter la dependance a formatCurrency (locale).
  // -------------------------------------------------------------------------

  it('[TC-011B-5a] topClient -- contient le nom de la transaction la plus haute', () => {
    const allTransactions = [transactionTopToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.topClient).toContain('Dupont')
  })

  it('[TC-011B-5b] topClient -- contient le prenom de la transaction la plus haute', () => {
    const allTransactions = [transactionTopToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.topClient).toContain('Marie')
  })

  // -------------------------------------------------------------------------
  // [TC-011B-6] topClient -- aucune transaction du jour
  //
  // Passer uniquement transactionYesterday (exclue par useTodayTransactions).
  // todayTransactions sera vide => topClient reste "Aucune transaction aujourd'hui".
  // -------------------------------------------------------------------------

  it("[TC-011B-6] topClient -- aucune transaction du jour => \"Aucune transaction aujourd'hui\"", () => {
    const allTransactions = [transactionYesterday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.topClient).toBe("Aucune transaction aujourd'hui")
  })

  // -------------------------------------------------------------------------
  // [TC-011B-7] entrees vides
  //
  // clients: [], allTransactions: []
  // Tous les compteurs a zero, todayTransactions vide,
  // topClient = "Aucune transaction aujourd'hui".
  // -------------------------------------------------------------------------

  it('[TC-011B-7] entrees vides -- tous les champs a leur valeur nulle de reference', () => {
    const { result } = renderHook(() =>
      useDashboardData([], [])
    )

    expect(result.current.totalClients).toBe(0)
    expect(result.current.monthlyClients).toBe(0)
    expect(result.current.dailyClients).toBe(0)
    expect(result.current.todayTransactions).toEqual([])
    expect(result.current.topClient).toBe("Aucune transaction aujourd'hui")
  })

})
