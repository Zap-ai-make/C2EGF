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
import { EN_ATTENTE, ENVOYEE, REMB_SIEGE } from '../../src/services/fileEnvoi.js'
import { fauxHistorique } from '../fixtures/fauxHistorique.js'

/**
 * TC-386 (contexte) — les gestes du remboursement au siège partent par la file,
 * sous leur propre commande ; l'annulation d'une telle ligne ne passe JAMAIS par
 * `trashDraft` ou `trashHistory`, qui la refuseraient (TC-381).
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

const enAttente = { id: 'rs1', type: 'Remb. siège', clientId: 'agent-1', reseau: 'Orange', montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 0, resteAuSiege: 100_000, envoisSiege: [], statut: 'Non Terminées' }
const validee = { id: 'rs2', type: 'Remb. siège', clientId: 'agent-1', reseau: 'Orange', montant: 50_000, balanceType: 'stock', envoyeAuSiege: 50_000, resteAuSiege: 0, envoisSiege: [], statut: 'Validée', directValidation: true, validatedAt: new Date(1) }
const transaction = { client: { id: 'agent-1', nom: 'KABORE', enAttente: true }, clientId: 'agent-1', code: '1234567', montant: 100_000, balanceType: 'liquidite', statut: 'Non Terminées' }

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

describe('TC-386 — avec la file', () => {
  it('[TC-386-C1] la saisie part sous sa commande, sans la marque locale du client', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    let issue
    await act(async () => { issue = await tx.ajouterRembSiege(transaction) })
    expect(issue).toEqual({ statut: EN_ATTENTE })
    expect(envois.soumettre).toHaveBeenCalledWith(REMB_SIEGE, {
      commande: { action: 'addSiegeRepayment', transaction: { ...transaction, client: { id: 'agent-1', nom: 'KABORE' } } },
      reseau: 'Orange',
    })
  })

  it('[TC-386-C2] l’envoi au siège part sous sa commande', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    await act(async () => { await tx.envoyerAuSiege('rs1', 60_000) })
    expect(envois.soumettre).toHaveBeenCalledWith(REMB_SIEGE, {
      commande: { action: 'sendToSiege', draftId: 'rs1', amount: 60_000 },
      reseau: 'Orange',
    })
  })

  it('[TC-386-C3] la modification part avec ce que la ligne a laissé dans les soldes', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    await act(async () => { await tx.modifierRembSiege('rs1', { montant: 80_000 }) })
    expect(envois.soumettre).toHaveBeenCalledWith(REMB_SIEGE, {
      commande: { action: 'updateSiegeRepayment', draftId: 'rs1', updates: { montant: 80_000 } },
      reseau: 'Orange',
      avant: { montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 0 },
    })
  })

  it('[TC-386-C4] « Annuler » vise trashSiegeRepayment, en attente comme validée', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()
    await act(async () => { await tx.trashTransaction('rs1') })
    await act(async () => { await tx.trashTransaction('rs2') })
    expect(envois.soumettre).toHaveBeenCalledWith(
      REMB_SIEGE,
      { commande: { action: 'trashSiegeRepayment', draftId: 'rs1' }, reseau: 'Orange', avant: { montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 0 } },
      { id: 'remb_siege-annulation-rs1' },
    )
    expect(envois.soumettre).toHaveBeenCalledWith(
      REMB_SIEGE,
      { commande: { action: 'trashSiegeRepayment', historyId: 'rs2' }, reseau: 'Orange', avant: { montant: 50_000, balanceType: 'stock', envoyeAuSiege: 50_000 } },
      { id: 'remb_siege-annulation-rs2' },
    )
    expect(service.trashDraft).not.toHaveBeenCalled()
    expect(service.trashHistory).not.toHaveBeenCalled()
  })
})

describe('TC-386 — sans file', () => {
  it('[TC-386-C5] les gestes appellent la commande directement', async () => {
    monter()
    await pret()
    let issue
    await act(async () => { issue = await tx.ajouterRembSiege(transaction) })
    expect(issue).toEqual({ statut: ENVOYEE })
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'addSiegeRepayment', transaction: { ...transaction, client: { id: 'agent-1', nom: 'KABORE' } } })
    await act(async () => { await tx.trashTransaction('rs2') })
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'trashSiegeRepayment', historyId: 'rs2' })
    expect(service.trashHistory).not.toHaveBeenCalled()
  })
})
