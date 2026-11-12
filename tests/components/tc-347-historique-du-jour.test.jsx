/**
 * TC-347 — L'historique s'en tient à la journée en cours (lot G1).
 *
 * Décision du 2026-11-06 (docs/rester-dans-le-quota-gratuit.md §G) : à
 * l'ouverture, rien d'antérieur ne se lit. Quatre écoutes, toutes bornées :
 *   - la journée ;
 *   - les validées depuis ce matin ;
 *   - les supprimées depuis ce matin ;
 *   - les ravitaillements encore dus.
 * Les jours passés ne se lisent qu'à la demande, une fois, quand on choisit des
 * dates.
 *
 * Les garanties des trois écoutes de complément viennent de bugs documentés
 * dans `historyService.js`, et TC-344 les fixait déjà : une journée de plus de
 * cent lignes, une validée tardive, une dette ancienne. Elles sont reprises ici
 * telles quelles ([JC-02] à [JC-04]).
 *
 * Le contexte réel est monté sur un faux historique (tests/fixtures).
 * L'horloge est fixée au 6 novembre 2026, 12 h, à Ouagadougou (UTC+0).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'

const service = {}

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
}))
vi.mock('../../src/services/settlementService', () => ({
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: React.createContext(null),
}))

import { TransactionsProvider, useTransactions } from '../../src/context/transactions.jsx'
import { AuthContext } from '../../src/context/AuthContext'
import { fauxHistorique, horodatage, ligne, serie } from '../fixtures/fauxHistorique.js'

const AUTH = {
  currentUser: { uid: 'u1' },
  userProfile: { role: 'store_admin', storeId: 'store-a' },
  activeStore: { id: 'store-a' },
  loading: false,
}

let ctx
function Lecteur() {
  ctx = useTransactions()
  return null
}

function monter(api) {
  Object.assign(service, api)
  render(
    <AuthContext.Provider value={AUTH}>
      <TransactionsProvider>
        <Lecteur />
      </TransactionsProvider>
    </AuthContext.Provider>,
  )
}

const affichees = () => ctx.completedTransactions.map((l) => l.id)
const attendreAffichage = (nombre) => waitFor(() => expect(affichees()).toHaveLength(nombre))
const charger = (choix) => act(() => ctx.chargerPeriode(choix))
const minuit = (jour) => new Date(`${jour}T00:00:00Z`)

// Trois lignes aujourd'hui (le 6), 150 avant : du 5 à 11 h en remontant jusqu'au 4.
const DU_JOUR = serie('t', 3, '2026-11-06T11:00:00Z')
const ANCIENNES = serie('h', 150, '2026-11-05T11:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  for (const nom of Object.keys(service)) delete service[nom]
  ctx = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TC-347 — à l\'ouverture, la journée seulement', () => {
  it('[JC-01] seules les lignes du jour, et aucune lecture des jours passés', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)

    await attendreAffichage(3)
    expect(affichees()).toEqual(DU_JOUR.map((l) => l.id))
    expect(faux.api.lirePeriode).not.toHaveBeenCalled()
    expect(faux.api.subscribeToHistory).toHaveBeenCalledOnce()
    expect(faux.api.subscribeToHistory.mock.calls[0][1]).toEqual({
      dateRange: { start: minuit('2026-11-06'), endExclusive: minuit('2026-11-07') },
      limitCount: null,
    })
    expect(ctx.periode).toBeNull()
  })

  it('[JC-02] une journée de plus de cent lignes s\'affiche en entier', async () => {
    const AUJOURDHUI = serie('t', 120, '2026-11-06T11:00:00Z', 3)
    monter(fauxHistorique([...AUJOURDHUI, ...ANCIENNES]).api)

    await attendreAffichage(120)
    expect(affichees()).toEqual(AUJOURDHUI.map((l) => l.id))
  })

  it('[JC-03] un ravitaillement dû, même ancien, reste affiché', async () => {
    const dette = ligne('dette', '2026-10-01T09:00:00Z', { type: 'Ravitaillement', replenishmentStatus: 'open' })
    monter(fauxHistorique([...DU_JOUR, ...ANCIENNES, dette]).api)

    await attendreAffichage(4)
    expect(affichees()).toContain('dette')
  })

  it('[JC-04] une non terminée ancienne, validée aujourd\'hui, s\'affiche', async () => {
    const tardive = ligne('tardive', '2026-10-02T09:00:00Z', { validatedAt: horodatage('2026-11-06T10:00:00Z') })
    monter(fauxHistorique([...DU_JOUR, ...ANCIENNES, tardive]).api)

    await attendreAffichage(4)
    expect(affichees()).toContain('tardive')
  })

  it('[JC-05] une ligne ancienne, supprimée aujourd\'hui, rejoint la corbeille du jour', async () => {
    const supprimee = ligne('supprimee', '2026-10-28T09:00:00Z', { statut: 'Supprimée', deletedAt: horodatage('2026-11-06T09:30:00Z') })
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES, supprimee])
    monter(faux.api)

    await attendreAffichage(4)
    expect(ctx.completedTransactions.find((l) => l.id === 'supprimee').deletedAt).toBeTruthy()
    expect(faux.api.subscribeToDeletedSince.mock.calls[0][1]).toEqual(minuit('2026-11-06'))
  })

  it('[JC-06] une ligne nouvelle ou modifiée aujourd\'hui s\'affiche aussitôt', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)

    await faux.ajouter(ligne('n1', '2026-11-06T11:30:00Z'))
    await faux.modifier('t001', { statut: 'Annulée' })

    await attendreAffichage(4)
    expect(affichees()[0]).toBe('n1')
    expect(ctx.completedTransactions.find((l) => l.id === 't001').statut).toBe('Annulée')
  })

  it('[JC-07] loading tient jusqu\'à la première réponse de la journée', async () => {
    const faux = fauxHistorique(DU_JOUR)
    let repondre
    monter({ ...faux.api, subscribeToHistory: (cb) => { repondre = cb; return () => {} } })
    await waitFor(() => expect(repondre).toBeTypeOf('function'))
    expect(ctx.loading).toBe(true)

    act(() => repondre(DU_JOUR))

    await waitFor(() => expect(ctx.loading).toBe(false))
  })
})

describe('TC-347 — les jours passés, à la demande', () => {
  it('[JC-08] des dates choisies : une lecture, une seule, puis leurs lignes s\'affichent', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)

    await charger({ from: '2026-11-04', to: '2026-11-05' })

    await attendreAffichage(153)
    expect(faux.api.lirePeriode).toHaveBeenCalledOnce()
    expect(faux.api.lirePeriode).toHaveBeenCalledWith({ start: minuit('2026-11-04'), endExclusive: minuit('2026-11-06') })
    expect(ctx.periode).toEqual({ from: '2026-11-04', to: '2026-11-05' })
    expect(ctx.periodeEnChargement).toBe(false)

    // La même période, redemandée : rien de plus à payer.
    await charger({ from: '2026-11-04', to: '2026-11-05' })
    expect(faux.api.lirePeriode).toHaveBeenCalledOnce()
  })

  it('[JC-09] la journée en cours n\'est jamais relue : son écoute la tient déjà', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)

    await charger({ from: '2026-11-05', to: '2026-11-06' })
    expect(faux.api.lirePeriode).toHaveBeenCalledWith({ start: minuit('2026-11-05'), endExclusive: minuit('2026-11-06') })

    await charger({ from: '2026-11-06', to: '2026-11-06' })
    expect(faux.api.lirePeriode).toHaveBeenCalledOnce()
    expect(ctx.periode).toEqual({ from: '2026-11-06', to: '2026-11-06' })
  })

  it('[JC-10] « Du » seul : les 31 jours qui suivent, sans dépasser aujourd\'hui', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)

    await charger({ from: '2026-11-01', to: '' })

    expect(ctx.periode).toEqual({ from: '2026-11-01', to: '2026-11-06' })
    expect(faux.api.lirePeriode).toHaveBeenCalledWith({ start: minuit('2026-11-01'), endExclusive: minuit('2026-11-06') })
  })

  it('[JC-11] plus de 31 jours : refusé, sans lecture, et la raison est dite', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)

    await charger({ from: '2026-09-01', to: '2026-11-05' })

    expect(faux.api.lirePeriode).not.toHaveBeenCalled()
    expect(ctx.erreurPeriode).toBe('Choisissez une période de 31 jours au plus.')
    expect(ctx.periode).toBeNull()
  })

  it('[JC-12] revenir au jour oublie la période', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter(faux.api)
    await attendreAffichage(3)
    await charger({ from: '2026-11-04', to: '2026-11-05' })
    await attendreAffichage(153)

    act(() => ctx.revenirAuJour())

    await attendreAffichage(3)
    expect(ctx.periode).toBeNull()
  })

  it('[JC-13] une réponse arrivée après qu\'on est revenu au jour est ignorée', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    let livrer
    monter({ ...faux.api, lirePeriode: () => new Promise((resoudre) => { livrer = resoudre }) })
    await attendreAffichage(3)

    let lecture
    act(() => { lecture = ctx.chargerPeriode({ from: '2026-11-04', to: '2026-11-05' }) })
    await waitFor(() => expect(ctx.periodeEnChargement).toBe(true))
    act(() => ctx.revenirAuJour())
    await act(async () => { livrer({ lignes: ANCIENNES, depuisServeur: true }); await lecture })

    expect(affichees()).toHaveLength(3)
    expect(ctx.periode).toBeNull()
    expect(ctx.periodeEnChargement).toBe(false)
  })

  it('[JC-14] une lecture en échec le dit, et l\'écran garde la journée', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter({ ...faux.api, lirePeriode: async () => { throw new Error('Hors ligne : période non disponible.') } })
    await attendreAffichage(3)

    await charger({ from: '2026-11-04', to: '2026-11-05' })

    expect(ctx.erreurPeriode).toBe('Hors ligne : période non disponible.')
    expect(ctx.periodeEnChargement).toBe(false)
    expect(affichees()).toHaveLength(3)
  })

  it('[JC-15] une ligne de la période supprimée ici quitte aussitôt les transactions vivantes', async () => {
    const faux = fauxHistorique([...DU_JOUR, ...ANCIENNES])
    monter({ ...faux.api, trashHistory: vi.fn(async () => true) })
    await attendreAffichage(3)
    await charger({ from: '2026-11-04', to: '2026-11-05' })
    await attendreAffichage(153)

    await act(() => ctx.trashTransaction('h010'))

    expect(service.trashHistory).toHaveBeenCalledWith('h010')
    expect(ctx.completedTransactions.find((l) => l.id === 'h010').deletedAt).toBeTruthy()
  })
})
