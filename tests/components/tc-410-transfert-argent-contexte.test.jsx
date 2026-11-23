import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'

const service = {}
const { runStoreTransactionCommand } = vi.hoisted(() => ({ runStoreTransactionCommand: vi.fn() }))

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
}))
vi.mock('../../src/services/settlementService', () => ({ addTransactionPayment: vi.fn(), addTransactionRefund: vi.fn() }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: React.createContext(null) }))
vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn(), toasts: [], removeToast: () => {} }) }))

import { TransactionsProvider, useTransactions } from '../../src/context/transactions.jsx'
import { AuthContext } from '../../src/context/AuthContext'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import { EN_ATTENTE, ENVOYEE, TRANSFERT_ARGENT } from '../../src/services/fileEnvoi.js'
import { getAvailableActions } from '../../src/utils/helpers.js'
import { fauxHistorique } from '../fixtures/fauxHistorique.js'

/**
 * TC-410 — les gestes du transfert d'argent dans le contexte des transactions
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md). Ils partent
 * par la file sous leur propre commande ; l'annulation ne passe JAMAIS par
 * `trashDraft` ou `trashHistory`, qui la refuseraient (TC-406).
 */

const AUTH = {
  currentUser: { uid: 'u1', email: 'b1@c2egf.test' },
  userProfile: { role: 'store_admin', storeId: 'store-a', name: 'Awa' },
  activeStore: { id: 'store-a', name: 'Boutique A' },
  loading: false,
}

const fileSimulee = () => ({
  disponible: true,
  soumettre: vi.fn(async () => ({ statut: EN_ATTENTE })),
  retirer: vi.fn(),
  operations: [],
  enAttente: [],
  refusees: [],
})

let tx
function Lecteur() {
  tx = useTransactions()
  return null
}

function monter(envois) {
  const arbre = (
    <AuthContext.Provider value={AUTH}>
      <TransactionsProvider>
        <Lecteur />
      </TransactionsProvider>
    </AuthContext.Provider>
  )
  render(envois ? <EnvoisContext.Provider value={envois}>{arbre}</EnvoisContext.Provider> : arbre)
}

const enAttente = { id: 'ta1', type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', reseau: 'Orange', montant: 50_000, balanceType: 'liquidite', montantTraite: 0, resteATraiter: 50_000, tranches: [], statut: 'Non Terminées' }
const validee = { id: 'ta2', type: 'Transfert argent', service: 'Ria', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', reseau: 'Orange', montant: 75_000, balanceType: 'stock', montantTraite: 75_000, resteATraiter: 0, tranches: [{ id: 't', montant: 75_000 }], statut: 'Validée', validatedAt: new Date(1) }
const transaction = { service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', montant: 50_000, balanceType: 'liquidite' }

beforeEach(() => {
  for (const nom of Object.keys(service)) delete service[nom]
  const { api } = fauxHistorique([])
  Object.assign(service, api, {
    migrateLocalStorageData: vi.fn(),
    subscribeToDrafts: (cb) => { cb([enAttente]); return () => {} },
    subscribeToHistory: (cb) => { cb([validee]); return () => {} },
    trashDraft: vi.fn(),
    trashHistory: vi.fn(),
  })
  runStoreTransactionCommand.mockReset()
  runStoreTransactionCommand.mockResolvedValue({})
  tx = undefined
})

const pret = async () => {
  await waitFor(() => expect(tx?.pendingTransactions?.length).toBeGreaterThan(0))
  await waitFor(() => expect(tx.completedTransactions.length).toBeGreaterThan(0))
}
const AVANT_TA1 = { operation: 'transfert', montant: 50_000, balanceType: 'liquidite', montantTraite: 0 }

describe('TC-410 — les gestes du transfert d’argent', () => {
  it('[TC-410-01] saisie, tranche et modification partent par la file sous leur commande', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    let issue
    await act(async () => { issue = await tx.ajouterTransfertArgent(transaction) })
    expect(issue).toEqual({ statut: EN_ATTENTE })
    expect(envois.soumettre).toHaveBeenCalledWith(TRANSFERT_ARGENT, { commande: { action: 'addMoneyTransfer', transaction }, reseau: 'Orange' })

    await act(async () => { await tx.traiterTransfertArgent('ta1', 20_000) })
    expect(envois.soumettre).toHaveBeenCalledWith(TRANSFERT_ARGENT, {
      commande: { action: 'settleMoneyTransfer', draftId: 'ta1', amount: 20_000 }, reseau: 'Orange', avant: AVANT_TA1,
    })

    await act(async () => { await tx.modifierTransfertArgent('ta1', { montant: 40_000 }) })
    expect(envois.soumettre).toHaveBeenCalledWith(TRANSFERT_ARGENT, {
      commande: { action: 'updateMoneyTransfer', draftId: 'ta1', updates: { montant: 40_000 } }, reseau: 'Orange', avant: AVANT_TA1,
    })
  })

  it('[TC-410-01b] sans file, la commande part directement', async () => {
    monter()
    await pret()
    let issue
    await act(async () => { issue = await tx.ajouterTransfertArgent(transaction) })
    expect(issue).toEqual({ statut: ENVOYEE })
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'addMoneyTransfer', transaction })
  })

  it('[TC-410-02] « Annuler » vise trashMoneyTransfer, en attente comme validée', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    await act(async () => { await tx.trashTransaction('ta1') })
    await act(async () => { await tx.trashTransaction('ta2') })
    expect(envois.soumettre).toHaveBeenCalledWith(
      TRANSFERT_ARGENT,
      { commande: { action: 'trashMoneyTransfer', draftId: 'ta1' }, reseau: 'Orange', avant: AVANT_TA1 },
      { id: 'transfert_argent-annulation-ta1' },
    )
    expect(envois.soumettre).toHaveBeenCalledWith(
      TRANSFERT_ARGENT,
      { commande: { action: 'trashMoneyTransfer', historyId: 'ta2' }, reseau: 'Orange', avant: { operation: 'retrait', montant: 75_000, balanceType: 'stock', montantTraite: 75_000 } },
      { id: 'transfert_argent-annulation-ta2' },
    )
    expect(service.trashDraft).not.toHaveBeenCalled()
    expect(service.trashHistory).not.toHaveBeenCalled()
  })

  it('[TC-410-03] les boutons : tranche, Modifier jusqu’à la première tranche, jamais les gestes d’un dépôt', async () => {
    monter(fileSimulee())
    await pret()
    expect(tx.getActionButtons(enAttente)).toMatchObject({ modifier: true, trancheTransfert: true, envoyerSiege: false, encaisser: false, payerPar: false, rembourser: false })
    expect(tx.getActionButtons({ ...enAttente, operation: 'retrait' })).toMatchObject({ trancheTransfert: true, encaisser: false })
    const entamee = tx.getActionButtons({ ...enAttente, montantTraite: 20_000, resteATraiter: 30_000 })
    expect(entamee.modifier).toBe(false)
    expect(entamee.trancheTransfert).toBe(true)
    expect(entamee.annuler).not.toBe(false)
  })

  it('[TC-410-04] les autres types gardent leurs boutons', () => {
    expect(getAvailableActions('Dépôt')).toEqual({ modifier: true, payerPar: false, rembourser: false, encaisser: true, envoyerSiege: false, trancheTransfert: false })
    expect(getAvailableActions('Retrait')).toMatchObject({ payerPar: true, trancheTransfert: false })
    expect(getAvailableActions('Remb. siège')).toMatchObject({ envoyerSiege: true, trancheTransfert: false })
    expect(getAvailableActions('Transfert argent')).toMatchObject({ trancheTransfert: true, encaisser: false, envoyerSiege: false })
  })
})
