/**
 * TC-353 — les quatre opérations passent par la file d'envoi (lot G3b,
 * docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Ce que ce fichier verrouille :
 * - la saisie, le règlement, le remboursement et l'ajout d'un client partent
 *   par la file quand elle est là, avec de quoi être reconnus s'ils sont
 *   renvoyés ;
 * - sans file (hors de son fournisseur), l'appel direct d'avant reprend ;
 * - hors ligne, un code agent déjà pris est refusé sur la copie de
 *   l'annuaire, avant d'entrer dans la file ;
 * - chaque opération devient au serveur l'appel qui la reconnaîtra.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'

const service = {}
const { runStoreTransactionCommand, addTransactionPayment, addTransactionRefund } = vi.hoisted(() => ({
  runStoreTransactionCommand: vi.fn(),
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
}))

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
  normaliserChampsAgent: (d) => ({
    ...(d.codeAgent !== undefined ? { codeAgent: d.codeAgent } : {}),
    ...(d.numeroAgent !== undefined ? { numeroAgent: d.numeroAgent } : {}),
  }),
}))
vi.mock('../../src/services/settlementService', () => ({ addTransactionPayment, addTransactionRefund }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: React.createContext(null) }))

import { TransactionsProvider, useTransactions } from '../../src/context/transactions.jsx'
import { ClientsProvider } from '../../src/context/ClientsContext.jsx'
import { ClientsContext } from '../../src/context/ClientsContext.jsx'
import { AuthContext } from '../../src/context/AuthContext'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import { executerEnvoi } from '../../src/services/envois.js'
import { CLIENT, EN_ATTENTE, ENVOYEE, REFUSEE, REGLEMENT, REMBOURSEMENT, SAISIE } from '../../src/services/fileEnvoi.js'
import { fauxHistorique } from '../fixtures/fauxHistorique.js'

const AUTH = {
  currentUser: { uid: 'u1', email: 'b1@c2egf.test' },
  userProfile: { role: 'store_admin', storeId: 'store-a', name: 'Awa' },
  activeStore: { id: 'store-a', name: 'Boutique A' },
  loading: false,
}

const fileSimulee = (issue = { statut: EN_ATTENTE }, operations = []) => ({
  disponible: true,
  soumettre: vi.fn(async () => issue),
  retirer: vi.fn(),
  operations,
  enAttente: [],
  refusees: [],
})

let tx
let cl
function Lecteurs() {
  tx = useTransactions()
  cl = React.useContext(ClientsContext)
  return null
}

function monter(envois) {
  const arbre = (
    <AuthContext.Provider value={AUTH}>
      <ClientsProvider>
        <TransactionsProvider>
          <Lecteurs />
        </TransactionsProvider>
      </ClientsProvider>
    </AuthContext.Provider>
  )
  render(envois ? <EnvoisContext.Provider value={envois}>{arbre}</EnvoisContext.Provider> : arbre)
}

const ANNUAIRE = [{ id: 'c-existe', nom: 'KABORE', codeAgent: '1000003', registeredStoreId: 'store-b', registeredStoreName: 'Boutique B' }]

beforeEach(() => {
  for (const nom of Object.keys(service)) delete service[nom]
  Object.assign(service, fauxHistorique([]).api, {
    migrateLocalStorageData: vi.fn(),
    subscribeToClients: (cb) => { cb(ANNUAIRE); return () => {} },
    addTransaction: vi.fn(async () => ({ id: 'srv-1' })),
    addClient: vi.fn(async (d) => ({ id: 'srv-c', ...d })),
    nouvelIdClient: () => 'id-local-1',
  })
  runStoreTransactionCommand.mockReset()
  addTransactionPayment.mockReset()
  addTransactionRefund.mockReset()
  tx = undefined
  cl = undefined
})

describe('TC-353 — avec la file, les opérations y passent', () => {
  it('[OF-01] la saisie part par la file, et son issue revient au formulaire', async () => {
    const envois = fileSimulee()
    monter(envois)
    await waitFor(() => expect(tx).toBeDefined())

    let issue
    await act(async () => { issue = await tx.addTransaction({ clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 5000 }) })

    expect(issue).toEqual({ statut: EN_ATTENTE })
    expect(envois.soumettre).toHaveBeenCalledWith(SAISIE, {
      transaction: expect.objectContaining({ clientId: 'c1', montant: 5000, statut: 'Non Terminées', storeId: 'store-a', operatorId: 'u1' }),
    })
    expect(service.addTransaction).not.toHaveBeenCalled()
  })

  it('[OF-02] le règlement et le remboursement prennent la clé du geste pour identifiant', async () => {
    const envois = fileSimulee()
    monter(envois)
    await waitFor(() => expect(tx).toBeDefined())

    await act(async () => { await tx.addPaymentTranche('d1', 2000, 'Cash', 'cle-1', '1000001') })
    await act(async () => { await tx.addRefundTranche('d2', 500, 'Orange Money', 'cle-2') })

    expect(envois.soumettre).toHaveBeenNthCalledWith(1, REGLEMENT,
      { draftId: 'd1', amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'cle-1', agentCode: '1000001' },
      { id: 'reglement-cle-1' })
    expect(envois.soumettre).toHaveBeenNthCalledWith(2, REMBOURSEMENT,
      { draftId: 'd2', amount: 500, paymentMethod: 'Orange Money', idempotencyKey: 'cle-2', agentCode: undefined },
      { id: 'remboursement-cle-2' })
    expect(addTransactionPayment).not.toHaveBeenCalled()
  })

  it('[OF-03] le client en attente revient avec son identifiant local, prêt à servir la transaction', async () => {
    const envois = fileSimulee()
    monter(envois)
    await waitFor(() => expect(cl?.clients).toHaveLength(1))

    let fiche
    await act(async () => { fiche = await cl.addClient({ nom: 'OUATTARA', prenom: 'Ines', codeAgent: '1000099' }) })

    expect(fiche).toMatchObject({ id: 'id-local-1', nom: 'OUATTARA', codeAgent: '1000099', registeredStoreId: 'store-a', enAttente: true })
    expect(envois.soumettre).toHaveBeenCalledWith(CLIENT,
      { donnees: expect.objectContaining({ nom: 'OUATTARA', registeredStoreId: 'store-a', dateAjout: expect.any(String) }) },
      { id: 'id-local-1' })
  })

  it('[OF-04] le client envoyé revient tel que le serveur l’a écrit', async () => {
    const envois = fileSimulee({ statut: ENVOYEE, resultat: { id: 'id-local-1', nom: 'OUATTARA' } })
    monter(envois)
    await waitFor(() => expect(cl?.clients).toHaveLength(1))

    let fiche
    await act(async () => { fiche = await cl.addClient({ nom: 'OUATTARA' }) })
    expect(fiche).toEqual({ id: 'id-local-1', nom: 'OUATTARA' })
  })

  it('[OF-05] un code agent déjà dans l’annuaire est refusé avant d’entrer dans la file', async () => {
    const envois = fileSimulee()
    monter(envois)
    await waitFor(() => expect(cl?.clients).toHaveLength(1))

    await act(async () => {
      await expect(cl.addClient({ nom: 'AUTRE', codeAgent: '1000003' })).rejects.toMatchObject({ code: 'CLIENT_DOUBLON' })
    })
    expect(envois.soumettre).not.toHaveBeenCalled()
  })
})

describe('TC-353 — ce qui attend apparaît dans les listes (lot G3c)', () => {
  const saisie = (id, statut, autres = {}) => ({
    id, type: SAISIE, etat: EN_ATTENTE, creeLe: Date.UTC(2026, 10, 6, 9), tentatives: 0, erreur: null,
    charge: { transaction: { clientId: 'c1', client: { nom: 'HORSLIGNE' }, type: 'Dépôt', reseau: 'Orange', montant: 2000, statut } },
    ...autres,
  })
  const avecOperations = (operations) => fileSimulee({ statut: EN_ATTENTE }, operations)

  it('[OF-09] une non terminée en attente rejoint les non terminées, une validée l’historique', async () => {
    monter(avecOperations([saisie('cmd-1', 'Non Terminées'), saisie('cmd-2', 'Validée')]))
    await waitFor(() => expect(tx?.pendingTransactions.map((t) => t.id)).toEqual(['cmd-1']))
    expect(tx.pendingTransactions[0].envoi).toEqual({ etat: EN_ATTENTE, erreur: null })
    expect(tx.completedTransactions.map((t) => t.id)).toContain('cmd-2')
  })

  it('[OF-10] en attente, elle accepte les mêmes gestes qu’une autre ; refusée, plus aucun', async () => {
    monter(avecOperations([]))
    await waitFor(() => expect(tx).toBeDefined())
    const attente = tx.getActionButtons({ type: 'Dépôt', envoi: { etat: EN_ATTENTE } })
    expect(attente).toMatchObject({ modifier: true, encaisser: true })
    const refusee = tx.getActionButtons({ type: 'Dépôt', envoi: { etat: REFUSEE } })
    expect(Object.values(refusee).some(Boolean)).toBe(false)
    // Une tranche en attente fige la ligne, comme au serveur ; il reste à la solder.
    const partielle = tx.getActionButtons({ type: 'Dépôt', remainingAmount: 100, reglementsEnAttente: [{ id: 'r' }] })
    expect(partielle).toMatchObject({ encaisser: true, modifier: false, annuler: false })
  })

  it('[OF-11] le règlement d’une ligne en attente emporte sa nature, pour les soldes provisoires', async () => {
    const envois = avecOperations([saisie('cmd-1', 'Non Terminées')])
    monter(envois)
    await waitFor(() => expect(tx?.pendingTransactions).toHaveLength(1))

    await act(async () => { await tx.addPaymentTranche('cmd-1', 2000, 'Cash', 'cle-3') })
    expect(envois.soumettre).toHaveBeenCalledWith(REGLEMENT,
      expect.objectContaining({ draftId: 'cmd-1', type: 'Dépôt' }),
      { id: 'reglement-cle-3' })
  })

  it('[OF-13] la marque « en attente » d’une fiche ne part pas avec la transaction', async () => {
    const envois = avecOperations([])
    monter(envois)
    await waitFor(() => expect(tx).toBeDefined())
    await act(async () => { await tx.addTransaction({ clientId: 'k-1', client: { id: 'k-1', nom: 'ATTENTE', enAttente: true }, type: 'Dépôt', reseau: 'Orange', montant: 100 }) })
    const { transaction } = envois.soumettre.mock.calls[0][1]
    expect(transaction.client).toEqual({ id: 'k-1', nom: 'ATTENTE' })
  })

  it('[OF-12] une fiche en attente est dans la liste, et compte pour le contrôle de doublon', async () => {
    const op = { id: 'k-1', type: CLIENT, etat: EN_ATTENTE, creeLe: 1, tentatives: 0, erreur: null, charge: { donnees: { nom: 'ATTENTE', codeAgent: '1000050' } } }
    const envois = avecOperations([op])
    monter(envois)
    await waitFor(() => expect(cl?.clients.map((c) => c.id)).toEqual(['k-1', 'c-existe']))
    expect(cl.clients[0].enAttente).toBe(true)

    await act(async () => {
      await expect(cl.addClient({ nom: 'AUTRE', codeAgent: '1000050' })).rejects.toMatchObject({ code: 'CLIENT_DOUBLON' })
    })
    expect(envois.soumettre).not.toHaveBeenCalled()
  })
})

describe('TC-353 — sans file, l’appel direct d’avant reprend', () => {
  it('[OF-06] saisie, règlement et client vont droit au serveur', async () => {
    monter(null)
    await waitFor(() => expect(cl?.clients).toHaveLength(1))

    let issue
    await act(async () => { issue = await tx.addTransaction({ clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100 }) })
    await act(async () => { await tx.addPaymentTranche('d1', 100, 'Cash', 'cle-9') })
    await act(async () => { await cl.addClient({ nom: 'DIRECT' }) })

    expect(issue).toEqual({ statut: ENVOYEE })
    expect(service.addTransaction).toHaveBeenCalledTimes(1)
    expect(addTransactionPayment).toHaveBeenCalledWith({ draftId: 'd1', amount: 100, paymentMethod: 'Cash', idempotencyKey: 'cle-9', agentCode: undefined })
    expect(service.addClient).toHaveBeenCalledWith(expect.objectContaining({ nom: 'DIRECT', registeredStoreId: 'store-a' }))
  })
})

describe('TC-353 — chaque opération devient l’appel qui la reconnaîtra', () => {
  it('[OF-07] la saisie porte son commandeId, le règlement sa clé, le client son identifiant', async () => {
    service.enregistrerClientEnvoye = vi.fn(async () => ({ id: 'op-c' }))
    await executerEnvoi({ id: 'op-s', type: SAISIE, creeLe: 1000, charge: { transaction: { montant: 1 } } }, 91000)
    await executerEnvoi({ id: 'op-r', type: REGLEMENT, creeLe: 1000, charge: { draftId: 'd', amount: 1, paymentMethod: 'Cash', idempotencyKey: 'k1' } }, 91000)
    await executerEnvoi({ id: 'op-b', type: REMBOURSEMENT, creeLe: 1000, charge: { draftId: 'd', amount: 1, paymentMethod: 'Cash', idempotencyKey: 'k2', agentCode: '1000001' } }, 91000)
    await executerEnvoi({ id: 'op-c', type: CLIENT, creeLe: 1000, charge: { donnees: { nom: 'X' } } }, 91000)

    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'add', transaction: { montant: 1 }, commandeId: 'op-s', ageMs: 90000 })
    expect(addTransactionPayment).toHaveBeenCalledWith({ draftId: 'd', amount: 1, paymentMethod: 'Cash', idempotencyKey: 'k1', agentCode: undefined, ageMs: 90000 })
    expect(addTransactionRefund).toHaveBeenCalledWith({ draftId: 'd', amount: 1, paymentMethod: 'Cash', idempotencyKey: 'k2', agentCode: '1000001' })
    expect(service.enregistrerClientEnvoye).toHaveBeenCalledWith('op-c', { nom: 'X' })
  })

  it('[OF-08] un type inconnu est un refus, pas une panne : il ne bloque pas la file', async () => {
    await expect(executerEnvoi({ id: 'x', type: 'autre', charge: {} })).rejects.toMatchObject({ code: 'ENVOI_INCONNU' })
  })
})
