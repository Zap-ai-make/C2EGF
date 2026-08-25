/**
 * TC-012 — useTodayTransactions : filtrage statut 'Annulée'
 *
 * Comportement protege apres MASTER-SEC-003 :
 *   useTodayTransactions(allTransactions) ne doit PAS retourner de transaction
 *   dont statut === 'Annulée', meme si la date correspond a aujourd'hui.
 *   Ce filtrage empeche les transactions annulees d'apparaitre dans les
 *   agregations dashboard (topClient, compteurs du jour).
 *
 * Fichier source : src/hooks/useTodayTransactions.js
 * Dependance : src/utils/helpers.js (parsefrenchDate) — non mockee
 *
 * Horloge figee : vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
 *   => "aujourd'hui" = Wed Jun 17 2026
 *
 * Cas couverts :
 *   TC-012-1 : statut 'Annulée' du jour => exclu
 *   TC-012-2 : statut 'Validée' du jour => inclus
 *   TC-012-3 : statut 'Remboursée' du jour => inclus
 *   TC-012-4 : statut 'Non Terminées' du jour => inclus
 *   TC-012-5 : mix Validée + Annulée + Remboursée => seules Validée et Remboursée incluses
 *   TC-012-6 : tableau vide => retourne []
 *   TC-012-7 : Annulée hier => exclue (filtre date, pas statut)
 *   TC-012-8 : topClient via useDashboardData ignore la transaction Annulée
 *
 * Interdictions :
 *   - Aucun mock de parsefrenchDate ni de Date directement.
 *   - Aucune modification de src/.
 *   - Aucun acces Firebase, aucun acces reseau.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import {
  transactionTopToday,
  transactionLowToday,
  transactionAnnuleeToday,
  transactionRembToday,
  transactionPendingToday,
} from '../fixtures/dashboard.js'

import { useTodayTransactions } from '../../src/hooks/useTodayTransactions.js'
import { useDashboardData } from '../../src/hooks/useDashboardData.js'

// ---------------------------------------------------------------------------
// Horloge figee a 2026-06-17T10:00:00.000Z pour tous les tests de ce fichier
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// TC-012 — useTodayTransactions direct
// ---------------------------------------------------------------------------

describe('TC-012 -- useTodayTransactions : filtrage statut Annulee', () => {

  // -------------------------------------------------------------------------
  // [TC-012-1] Transaction statut 'Annulée' du jour doit etre exclue
  //
  // transactionAnnuleeToday.date = '17/06/2026 11:00' => correspond a aujourd'hui
  // transactionAnnuleeToday.statut = 'Annulée'
  // Avant correction : incluse (regression). Apres correction : exclue.
  // -------------------------------------------------------------------------

  it("[TC-012-1] transaction 'Annulée' du jour est exclue de todayTransactions", () => {
    const allTransactions = [transactionAnnuleeToday]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    expect(result.current).toHaveLength(0)
  })

  it("[TC-012-1b] l'ID de la transaction 'Annulée' n'apparait pas dans todayTransactions", () => {
    const allTransactions = [transactionAnnuleeToday, transactionTopToday]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    const ids = result.current.map(t => t.id)
    expect(ids).not.toContain('txn-annulee-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012-2] Transaction statut 'Validée' du jour doit etre incluse
  // -------------------------------------------------------------------------

  it("[TC-012-2] transaction 'Validée' du jour est incluse dans todayTransactions", () => {
    const allTransactions = [transactionTopToday]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('txn-top-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012-3] Transaction statut 'Remboursée' du jour doit etre incluse
  //
  // 'Remboursée' n'est pas 'Annulée' => le filtre ne doit pas l'exclure.
  // -------------------------------------------------------------------------

  it("[TC-012-3] transaction 'Remboursée' du jour est incluse dans todayTransactions", () => {
    const allTransactions = [transactionRembToday]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('txn-remb-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012-4] Transaction statut 'Non Terminées' du jour doit etre incluse
  //
  // Les transactions en attente du jour sont incluses dans le dashboard.
  // -------------------------------------------------------------------------

  it("[TC-012-4] transaction 'Non Terminées' du jour est incluse dans todayTransactions", () => {
    const allTransactions = [transactionPendingToday]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('txn-pending-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012-5] Mix Validée + Annulée + Remboursée du jour
  //
  // Seules les transactions non-'Annulée' doivent apparaitre.
  // transactionTopToday (Validée) + transactionAnnuleeToday (Annulée)
  //   + transactionRembToday (Remboursée) + transactionLowToday (Validée)
  // Attendu : 3 transactions (les 3 non-'Annulée').
  // -------------------------------------------------------------------------

  it('[TC-012-5a] mix du jour -- retourne 3 transactions (excluant la 1 Annulée)', () => {
    const allTransactions = [
      transactionTopToday,
      transactionAnnuleeToday,
      transactionRembToday,
      transactionLowToday,
    ]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    expect(result.current).toHaveLength(3)
  })

  it("[TC-012-5b] mix du jour -- transaction 'Annulée' absente du resultat", () => {
    const allTransactions = [
      transactionTopToday,
      transactionAnnuleeToday,
      transactionRembToday,
      transactionLowToday,
    ]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    const ids = result.current.map(t => t.id)
    expect(ids).not.toContain('txn-annulee-today-001')
  })

  it("[TC-012-5c] mix du jour -- transaction 'Validée' presente dans le resultat", () => {
    const allTransactions = [
      transactionTopToday,
      transactionAnnuleeToday,
      transactionRembToday,
      transactionLowToday,
    ]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    const ids = result.current.map(t => t.id)
    expect(ids).toContain('txn-top-today-001')
    expect(ids).toContain('txn-low-today-001')
  })

  it("[TC-012-5d] mix du jour -- transaction 'Remboursée' presente dans le resultat", () => {
    const allTransactions = [
      transactionTopToday,
      transactionAnnuleeToday,
      transactionRembToday,
      transactionLowToday,
    ]

    const { result } = renderHook(() => useTodayTransactions(allTransactions))

    const ids = result.current.map(t => t.id)
    expect(ids).toContain('txn-remb-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012-6] Tableau vide => retourne []
  // -------------------------------------------------------------------------

  it('[TC-012-6] tableau vide -- retourne []', () => {
    const { result } = renderHook(() => useTodayTransactions([]))

    expect(result.current).toEqual([])
  })

  // -------------------------------------------------------------------------
  // [TC-012-7] Transaction 'Annulée' d'hier => exclue par le filtre date
  //
  // Cette exclusion existait deja avant MASTER-SEC-003 (filtre date).
  // Le statut ne change pas ce comportement.
  // -------------------------------------------------------------------------

  it("[TC-012-7] transaction 'Annulée' d'hier -- exclue (filtre date, pas statut seul)", () => {
    // transactionYesterday est Validée d'hier => exclue par date
    // On cree un objet inline Annulée d'hier pour verifier la combinaison
    const annuleeYesterday = {
      id: 'txn-annulee-yesterday-001',
      date: '16/06/2026 15:00',
      montant: 4000,
      type: 'Dépôt',
      statut: 'Annulée',
      storeId: 'store-a',
      reseau: 'Orange',
      client: { nom: 'Test', prenom: 'Annule' },
    }

    const { result } = renderHook(() => useTodayTransactions([annuleeYesterday]))

    expect(result.current).toHaveLength(0)
  })

})

// ---------------------------------------------------------------------------
// TC-012B — Impact sur useDashboardData (topClient)
//
// Via useDashboardData qui consomme useTodayTransactions,
// une transaction 'Annulée' ne doit jamais devenir le topClient.
// ---------------------------------------------------------------------------

describe("TC-012B -- useDashboardData : transaction 'Annulée' exclue du topClient", () => {

  // -------------------------------------------------------------------------
  // [TC-012B-1] Seule la transaction 'Annulée' aujourd'hui => topClient = "Aucune..."
  //
  // Avant correction : topClient contiendrait "Annulé Client (3 000 FCFA)" (regression).
  // Apres correction : topClient = "Aucune transaction aujourd'hui".
  // -------------------------------------------------------------------------

  it("[TC-012B-1] seule transaction du jour est 'Annulée' => topClient = 'Aucune transaction aujourd'hui'", () => {
    const { result } = renderHook(() =>
      useDashboardData([], [transactionAnnuleeToday])
    )

    expect(result.current.topClient).toBe("Aucune transaction aujourd'hui")
  })

  it("[TC-012B-1b] seule transaction 'Annulée' => todayTransactions vide", () => {
    const { result } = renderHook(() =>
      useDashboardData([], [transactionAnnuleeToday])
    )

    expect(result.current.todayTransactions).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // [TC-012B-2] Mix Annulée (montant 3000) + Validée (montant 1000) du jour
  //
  // La transaction 'Annulée' a le montant le plus eleve (3000 > 1000).
  // Avant correction : topClient serait "Annulé Client (3 000 FCFA)" (regression).
  // Apres correction : topClient est base sur la transaction Validée (montant 1000).
  //   => contient 'Martin' (transactionLowToday.client.nom)
  //   => ne contient PAS 'Annulé'
  // -------------------------------------------------------------------------

  it("[TC-012B-2a] mix Annulée(3000) + Validée(1000) -- topClient ne contient pas le client Annulé", () => {
    const allTransactions = [transactionAnnuleeToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.topClient).not.toContain('Annulé')
  })

  it("[TC-012B-2b] mix Annulée(3000) + Validée(1000) -- topClient est base sur la transaction Validée", () => {
    const allTransactions = [transactionAnnuleeToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    // transactionLowToday.client.nom = 'Martin'
    expect(result.current.topClient).toContain('Martin')
  })

  it('[TC-012B-2c] mix Annulée + Validée -- todayTransactions contient 1 seule transaction (la Validée)', () => {
    const allTransactions = [transactionAnnuleeToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.todayTransactions).toHaveLength(1)
    expect(result.current.todayTransactions[0].id).toBe('txn-low-today-001')
  })

  // -------------------------------------------------------------------------
  // [TC-012B-3] Comportement inchange pour les cas nominaux (non-regression)
  //
  // transactionTopToday (Validée, 5000) + transactionLowToday (Validée, 1000)
  // Ce cas existait dans TC-011B-5 — il doit continuer a passer.
  // -------------------------------------------------------------------------

  it('[TC-012B-3] cas nominaux inchanges -- topClient = Dupont Marie (transaction la plus haute)', () => {
    const allTransactions = [transactionTopToday, transactionLowToday]

    const { result } = renderHook(() =>
      useDashboardData([], allTransactions)
    )

    expect(result.current.topClient).toContain('Dupont')
    expect(result.current.topClient).toContain('Marie')
  })

})
