/**
 * TC-344 — Ce que l'historique affiche, quelle que soit la façon de le lire.
 *
 * Caractérisation écrite AVANT le lot A3a (docs/rester-dans-le-quota-gratuit.md
 * §A3). Le lot change la source de la première page : un `getDocs` facturé à
 * chaque ouverture, remplacé par le premier résultat de l'écoute. Ce qui
 * s'affiche ne doit pas bouger.
 *
 * ⚠ UN FAUX HISTORIQUE QUI PARLE LES DEUX LANGUES (tests/fixtures/fauxHistorique.js). Il sert l'ancienne lecture
 *   (`getHistoryPage` + `subscribeToHistory`) et la nouvelle
 *   (`subscribeToHistoryWindow`) à partir des mêmes lignes. Les mêmes tests
 *   passent donc avant et après le lot : c'est ce qui prouve qu'il ne change
 *   pas le comportement.
 *
 * Les trois écoutes de complément gardent chacune un bug documenté
 * (`historyService.js`) : la journée au-delà de cent lignes, les validées
 * tardives, les ravitaillements dus. Elles sont couvertes ici.
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

const MAINTENANT = '2026-11-06T12:00:00Z'

let ctx
function Lecteur() {
  ctx = useTransactions()
  return null
}

function monter(faux) {
  Object.assign(service, faux.api)
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
const chargerPlus = () => act(() => ctx.loadMoreHistory())

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MAINTENANT))
  for (const nom of Object.keys(service)) delete service[nom]
  ctx = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

// 150 lignes d'avant aujourd'hui : du 5 novembre 11 h, en remontant de dix
// minutes en dix minutes. La centième (h099) date du 4 novembre.
const ANCIENNES = serie('h', 150, '2026-11-05T11:00:00Z')

describe('TC-344 — la fenêtre de l\'historique', () => {
  it('[CH-01] à l\'ouverture : les cent dernières, et jusqu\'où elles remontent', async () => {
    monter(fauxHistorique(ANCIENNES))

    await attendreAffichage(100)
    expect(affichees()).toEqual(ANCIENNES.slice(0, 100).map((l) => l.id))
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))
    expect(ctx.historyDepuis).toBe('04/11/2026')
  })

  it('[CH-02] « plus » charge la suite, puis dit que tout est là', async () => {
    monter(fauxHistorique(ANCIENNES))
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))

    await chargerPlus()

    await attendreAffichage(150)
    expect(ctx.historyHasMore).toBe(false)
    expect(ctx.historyDepuis).toBeNull()
  })

  it('[CH-03] une ligne nouvelle : en tête, sans faire disparaître celle qui sort de la fenêtre', async () => {
    const faux = fauxHistorique(ANCIENNES)
    monter(faux)
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))

    await faux.ajouter(ligne('n1', '2026-11-06T11:00:00Z'))

    await attendreAffichage(101)
    expect(affichees()[0]).toBe('n1')
    expect(affichees()).toContain('h099')

    // Et la suite reprend juste après, sans trou ni doublon.
    await chargerPlus()
    await attendreAffichage(151)
    expect(new Set(affichees()).size).toBe(151)
  })

  it('[CH-04] une ligne modifiée dans la fenêtre s\'affiche modifiée', async () => {
    const faux = fauxHistorique(ANCIENNES)
    monter(faux)
    await attendreAffichage(100)

    await faux.modifier('h005', { statut: 'Annulée' })

    await waitFor(() => expect(ctx.completedTransactions.find((l) => l.id === 'h005').statut).toBe('Annulée'))
  })

  it('[CH-05] un ravitaillement dû, plus ancien que la fenêtre, reste affiché', async () => {
    const dette = ligne('dette', '2026-10-01T09:00:00Z', { type: 'Ravitaillement', replenishmentStatus: 'open' })
    monter(fauxHistorique([...ANCIENNES, dette]))

    await attendreAffichage(101)
    expect(affichees()).toContain('dette')
  })

  it('[CH-06] une non terminée ancienne, validée aujourd\'hui, s\'affiche', async () => {
    const tardive = ligne('tardive', '2026-10-02T09:00:00Z', { validatedAt: horodatage('2026-11-06T10:00:00Z') })
    monter(fauxHistorique([...ANCIENNES, tardive]))

    await attendreAffichage(101)
    expect(affichees()).toContain('tardive')
  })

  it('[CH-07] une journée de plus de cent lignes s\'affiche en entier', async () => {
    // 120 lignes aujourd'hui, de 11 h en remontant de trois minutes en trois minutes.
    const AUJOURDHUI = serie('t', 120, '2026-11-06T11:00:00Z', 3)
    monter(fauxHistorique([...AUJOURDHUI, ...ANCIENNES]))

    await attendreAffichage(120)
    expect(affichees()).toEqual(AUJOURDHUI.map((l) => l.id))
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))
  })

  it('[CH-08] le cache répond d\'abord : la page, le curseur et la suite viennent du serveur', async () => {
    // Le cache garde une ligne que le serveur n'a plus (rouverte ailleurs).
    const fantome = ligne('fantome', '2026-11-05T11:30:00Z')
    const faux = fauxHistorique(ANCIENNES, { cache: [fantome, ...ANCIENNES] })
    monter(faux)

    await faux.synchroniser()

    await waitFor(() => expect(affichees()).not.toContain('fantome'))
    await attendreAffichage(100)
    await waitFor(() => expect(ctx.historyHasMore).toBe(true))
    expect(ctx.historyDepuis).toBe('04/11/2026')

    await chargerPlus()
    await attendreAffichage(150)
    expect(affichees()).not.toContain('fantome')
  })
})
