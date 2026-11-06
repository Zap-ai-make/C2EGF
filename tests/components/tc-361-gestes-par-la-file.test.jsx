/**
 * TC-361 — le ravitaillement, son retour, la modification et l'annulation passent
 * par la file d'envoi (lot G4b, docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Ce que ce fichier verrouille :
 * - chaque geste part par la file quand elle est là, et sans elle l'appel direct reprend ;
 * - ouvrir la correction d'une validée n'appelle PAS le serveur : sans réseau, le
 *   formulaire doit s'ouvrir quand même, et le fermer ne doit rien changer ;
 * - chaque opération devient au serveur l'appel qui la reconnaîtra si elle revient ;
 * - la caissière lit que son geste attend le réseau.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import React from 'react'

const service = {}
const { runStoreTransactionCommand, addTransactionPayment, addTransactionRefund, showToast } = vi.hoisted(() => ({
  runStoreTransactionCommand: vi.fn(),
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
}))
vi.mock('../../src/services/settlementService', () => ({ addTransactionPayment, addTransactionRefund }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: React.createContext(null) }))
vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast, toasts: [], removeToast: () => {} }) }))

import { TransactionsProvider, useTransactions } from '../../src/context/transactions.jsx'
import { AuthContext } from '../../src/context/AuthContext'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import { executerEnvoi } from '../../src/services/envois.js'
import RavitaillementForm from '../../src/components/transactions/RavitaillementForm.jsx'
import EnvoisListe, { decrireOperation } from '../../src/components/EnvoisListe.jsx'
import {
  ANNULATION,
  CIBLE_NON_TERMINEE,
  CIBLE_RETOUR,
  CIBLE_VALIDEE,
  CORRECTION,
  EN_ATTENTE,
  ENVOYEE,
  MODIFICATION,
  RAVITAILLEMENT,
  REFUSEE,
  RETOUR,
  SAISIE,
} from '../../src/services/fileEnvoi.js'
import { MESSAGES } from '../../src/utils/constants.js'
import { fauxHistorique } from '../fixtures/fauxHistorique.js'

const AUTH = {
  currentUser: { uid: 'u1', email: 'b1@c2egf.test' },
  userProfile: { role: 'store_admin', storeId: 'store-a', name: 'Awa' },
  activeStore: { id: 'store-a', name: 'Boutique A' },
  loading: false,
}

const fileSimulee = (operations = [], issue = { statut: EN_ATTENTE }) => ({
  disponible: true,
  soumettre: vi.fn(async () => issue),
  retirer: vi.fn(),
  operations,
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

const brouillon = { id: 'd1', clientId: 'c1', client: { nom: 'BANABA', enAttente: true }, type: 'Dépôt', reseau: 'Orange', montant: 5000, statut: 'Non Terminées' }
const validee = { id: 'h1', clientId: 'c1', client: { nom: 'BANABA' }, type: 'Dépôt', reseau: 'Orange', montant: 5000, statut: 'Encaissé par Cash', paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: new Date(1) }
const retour = { id: 't1', type: 'Retour', montant: 100, reseau: 'Orange', balanceType: 'stock', replenishmentId: 'r1', statut: 'Validee' }

beforeEach(() => {
  for (const nom of Object.keys(service)) delete service[nom]
  const { api } = fauxHistorique([])
  Object.assign(service, api, {
    migrateLocalStorageData: vi.fn(),
    subscribeToDrafts: (cb) => { cb([brouillon]); return () => {} },
    subscribeToHistory: (cb) => { cb([validee, retour]); return () => {} },
    updateDraft: vi.fn(async () => ({})),
    correctHistory: vi.fn(async () => 'nouvelle'),
    trashDraft: vi.fn(async () => 'corbeille'),
    trashHistory: vi.fn(async () => true),
    trashReplenishmentReturn: vi.fn(async () => true),
    reopenHistory: vi.fn(),
    validateTransaction: vi.fn(),
  })
  runStoreTransactionCommand.mockReset()
  addTransactionPayment.mockReset()
  addTransactionRefund.mockReset()
  showToast.mockReset()
  tx = undefined
})

const pret = async () => {
  await waitFor(() => expect(tx?.pendingTransactions?.length).toBeGreaterThan(0))
  await waitFor(() => expect(tx.completedTransactions.length).toBeGreaterThan(0))
}

describe('TC-361 — avec la file, les gestes y passent', () => {
  it('[GF-01] la modification part avec ce que la ligne a laissé dans les soldes, sans la marque locale du client', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()

    let issue
    await act(async () => { issue = await tx.updateTransaction('d1', { montant: 6000, client: { nom: 'BANABA', enAttente: true } }) })

    expect(issue).toEqual({ statut: EN_ATTENTE })
    expect(envois.soumettre).toHaveBeenCalledWith(MODIFICATION, {
      draftId: 'd1',
      updates: { montant: 6000, client: { nom: 'BANABA' } },
      avant: expect.objectContaining({ type: 'Dépôt', montant: 5000, reseau: 'Orange' }),
    })
    expect(service.updateDraft).not.toHaveBeenCalled()
  })

  it('[GF-02] l’annulation prend son identifiant de la ligne : confirmée deux fois, elle n’entre qu’une fois', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()

    await act(async () => { await tx.trashTransaction('d1') })
    expect(envois.soumettre).toHaveBeenCalledWith(
      ANNULATION,
      { cible: CIBLE_NON_TERMINEE, cibleId: 'd1', avant: expect.objectContaining({ montant: 5000 }) },
      { id: `${ANNULATION}-d1` },
    )
    expect(service.trashDraft).not.toHaveBeenCalled()
  })

  it('[GF-03] l’annulation d’une validée et celle d’un retour visent chacune leur commande', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()

    await act(async () => { await tx.trashTransaction('h1') })
    await act(async () => { await tx.trashTransaction('t1') })

    expect(envois.soumettre).toHaveBeenCalledWith(ANNULATION, expect.objectContaining({ cible: CIBLE_VALIDEE, cibleId: 'h1', avant: expect.objectContaining({ paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: true }) }), { id: `${ANNULATION}-h1` })
    expect(envois.soumettre).toHaveBeenCalledWith(ANNULATION, expect.objectContaining({ cible: CIBLE_RETOUR, cibleId: 't1', avant: expect.objectContaining({ balanceType: 'stock' }) }), { id: `${ANNULATION}-t1` })
  })

  it('[GF-04] ouvrir la correction d’une validée n’appelle pas le serveur, et la ligne reste dans l’historique', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()

    await act(async () => { await tx.reopenTransaction(validee) })

    expect(service.reopenHistory).not.toHaveBeenCalled()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
    expect(envois.soumettre).not.toHaveBeenCalled()
    expect(tx.editingTransaction).toMatchObject({ id: 'h1', reopenedFromHistoryId: 'h1', montant: 5000, statut: 'Non Terminées', stockDejaPris: 5000 })
    expect(tx.editingTransaction.paymentMethod).toBeUndefined()
    expect(tx.completedTransactions.map((l) => l.id)).toContain('h1')

    act(() => { tx.clearEditTransaction() })
    expect(tx.completedTransactions.map((l) => l.id)).toContain('h1')
    expect(tx.pendingTransactions.map((l) => l.id)).toEqual(['d1'])
  })

  it('[GF-04b] encaissée sur le réseau même, la ligne a rendu son stock : le formulaire ne doit pas le lui compter', async () => {
    monter(fileSimulee())
    await pret()
    await act(async () => { await tx.reopenTransaction({ ...validee, paymentMethod: 'Orange Money', effectiveNetwork: 'Orange' }) })
    expect(tx.editingTransaction.stockDejaPris).toBe(0)
  })

  it('[GF-05] la correction part en une seule opération, qui ne dit rien du mode de règlement : le serveur le lit', async () => {
    const envois = fileSimulee()
    monter(envois)
    await pret()

    await act(async () => { await tx.reopenTransaction(validee) })
    let issue
    await act(async () => { issue = await tx.saveReopenedCorrection(tx.editingTransaction, { montant: 4000 }) })

    expect(issue).toEqual({ statut: EN_ATTENTE })
    expect(envois.soumettre).toHaveBeenCalledTimes(1)
    const [type, charge] = envois.soumettre.mock.calls[0]
    expect(type).toBe(CORRECTION)
    expect(charge).toMatchObject({ historyId: 'h1', updates: { montant: 4000 } })
    expect(charge.avant).toMatchObject({ paymentMethod: 'Cash', validatedAt: true })
    expect(service.updateDraft).not.toHaveBeenCalled()
    expect(service.validateTransaction).not.toHaveBeenCalled()
  })

  it('[GF-06] le refus reçu pendant l’attente revient au formulaire', async () => {
    const envois = fileSimulee()
    envois.soumettre = vi.fn(async () => { throw Object.assign(new Error('Stock insuffisant'), { code: 'INSUFFICIENT_STORE_BALANCE' }) })
    monter(envois)
    await pret()
    await act(async () => { await tx.reopenTransaction(validee) })
    await expect(tx.saveReopenedCorrection(tx.editingTransaction, { montant: 4000 })).rejects.toThrow('Stock insuffisant')
  })

  it('[GF-07] une ligne saisie hors ligne accepte les mêmes gestes ; refusée, aucun', async () => {
    const saisie = { id: 's1', type: SAISIE, etat: EN_ATTENTE, creeLe: 1, charge: { transaction: { clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées' } } }
    const refusee = { ...saisie, id: 's2', etat: REFUSEE }
    const envois = fileSimulee([saisie, refusee])
    monter(envois)
    await pret()

    const ligne = (id) => tx.pendingTransactions.find((l) => l.id === id)
    expect(tx.getActionButtons(ligne('s1'))).toMatchObject({ modifier: true, encaisser: true })
    expect(tx.getActionButtons(ligne('s1')).annuler).not.toBe(false)
    expect(tx.getActionButtons(ligne('s2'))).toMatchObject({ modifier: false, encaisser: false, annuler: false })
  })

  it('[GF-08] une ligne dont un règlement est engagé ne se modifie ni ne s’annule : le serveur le refuserait', async () => {
    monter(fileSimulee())
    await pret()
    expect(tx.getActionButtons({ ...brouillon, paidAmount: 100, remainingAmount: 4900 })).toMatchObject({ modifier: false, encaisser: true, annuler: false })
  })
})

describe('TC-361 — sans file, l’appel direct reprend', () => {
  it('[GF-09] modifier, annuler et corriger appellent le service', async () => {
    monter(null)
    await pret()

    await act(async () => { await tx.updateTransaction('d1', { montant: 6000 }) })
    expect(service.updateDraft).toHaveBeenCalledWith('d1', { montant: 6000 })

    await act(async () => { await tx.trashTransaction('d1') })
    expect(service.trashDraft).toHaveBeenCalledWith('d1')

    await act(async () => { await tx.trashTransaction('t1') })
    expect(service.trashReplenishmentReturn).toHaveBeenCalledWith('t1')

    let issue
    await act(async () => { await tx.reopenTransaction(validee) })
    await act(async () => { issue = await tx.saveReopenedCorrection(tx.editingTransaction, { montant: 4000 }) })
    expect(service.correctHistory).toHaveBeenCalledWith('h1', { montant: 4000 })
    expect(issue).toEqual({ statut: ENVOYEE })
    await waitFor(() => expect(tx.completedTransactions.map((l) => l.id)).not.toContain('h1'))
  })

  it('[GF-10] une annulation envoyée marque la ligne sans attendre le snapshot', async () => {
    monter(null)
    await pret()
    await act(async () => { await tx.trashTransaction('h1') })
    expect(service.trashHistory).toHaveBeenCalledWith('h1')
    expect(tx.completedTransactions.find((l) => l.id === 'h1')).toMatchObject({ statut: 'Supprimée' })
  })
})

describe('TC-361 — chaque geste devient l’appel qui le reconnaîtra', () => {
  const quand = { creeLe: 1000 }
  const appel = async (operation) => {
    await executerEnvoi({ ...quand, ...operation }, 91000)
    return runStoreTransactionCommand.mock.calls.at(-1)[0]
  }

  it('[GF-11] le ravitaillement et le retour', async () => {
    const commande = { action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo' }
    expect(await appel({ id: 'op-r', type: RAVITAILLEMENT, charge: { commande, reseau: 'Orange' } }))
      .toEqual({ ...commande, commandeId: 'op-r', ageMs: 90000 })
    const rendu = { action: 'returnReplenishment', replenishmentId: 'op-r', amount: 100, balanceType: 'stock' }
    expect(await appel({ id: 'op-t', type: RETOUR, charge: { commande: rendu, reseau: 'Orange' } }))
      .toEqual({ ...rendu, commandeId: 'op-t', ageMs: 90000 })
  })

  it('[GF-12] la modification et la correction : le résumé pour l’écran ne part pas au serveur', async () => {
    expect(await appel({ id: 'op-m', type: MODIFICATION, charge: { draftId: 'd1', updates: { montant: 2 }, avant: { montant: 1 } } }))
      .toEqual({ action: 'updateDraft', draftId: 'd1', updates: { montant: 2 }, commandeId: 'op-m', ageMs: 90000 })
    expect(await appel({ id: 'op-c', type: CORRECTION, charge: { historyId: 'h1', updates: { montant: 2 }, avant: { montant: 1 } } }))
      .toEqual({ action: 'correctHistory', historyId: 'h1', updates: { montant: 2 }, commandeId: 'op-c', ageMs: 90000 })
  })

  it.each([
    [CIBLE_NON_TERMINEE, { action: 'trashDraft', draftId: 'x' }],
    [CIBLE_VALIDEE, { action: 'trashHistory', historyId: 'x' }],
    [CIBLE_RETOUR, { action: 'trashReplenishmentReturn', returnId: 'x' }],
  ])('[GF-13] l’annulation d’une ligne « %s »', async (cible, attendu) => {
    expect(await appel({ id: 'op-a', type: ANNULATION, charge: { cible, cibleId: 'x', avant: { montant: 1 } } }))
      .toEqual({ ...attendu, commandeId: 'op-a', ageMs: 90000 })
  })
})

describe('TC-361 — à l’écran', () => {
  const remplir = () => {
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '300' } })
    fireEvent.click(screen.getByTestId('valider-ravitaillement'))
  }

  it('[GF-14] un ravitaillement sans réseau le dit, et le panneau revient à la liste', async () => {
    const envois = fileSimulee()
    const onComplete = vi.fn()
    render(<EnvoisContext.Provider value={envois}><RavitaillementForm annoncer={showToast} expediteurs={['Mme Sawadogo']} onComplete={onComplete} onCancel={() => {}} /></EnvoisContext.Provider>)
    remplir()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(envois.soumettre).toHaveBeenCalledWith(RAVITAILLEMENT, {
      commande: expect.objectContaining({ action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo' }),
      reseau: 'Orange',
    })
    expect(showToast).toHaveBeenCalledWith(MESSAGES.EN_ATTENTE.RAVITAILLEMENT, 'info')
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  it('[GF-15] reçu par le serveur, il dit le montant ; refusé pendant l’attente, le formulaire reste', async () => {
    const envois = fileSimulee([], { statut: ENVOYEE })
    const onComplete = vi.fn()
    const { unmount } = render(<EnvoisContext.Provider value={envois}><RavitaillementForm annoncer={showToast} expediteurs={['Mme Sawadogo']} onComplete={onComplete} onCancel={() => {}} /></EnvoisContext.Provider>)
    remplir()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/^Ravitaillement enregistré/), 'success')
    unmount()

    const refus = fileSimulee()
    refus.soumettre = vi.fn(async () => { throw new Error('Refusé') })
    const fin = vi.fn()
    render(<EnvoisContext.Provider value={refus}><RavitaillementForm annoncer={showToast} expediteurs={['Mme Sawadogo']} onComplete={fin} onCancel={() => {}} /></EnvoisContext.Provider>)
    remplir()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Refusé', 'error'))
    expect(fin).not.toHaveBeenCalled()
  })

  it('[GF-16] sans file, le formulaire appelle le service directement', async () => {
    runStoreTransactionCommand.mockResolvedValue({ id: 'x' })
    const onComplete = vi.fn()
    render(<RavitaillementForm annoncer={showToast} expediteurs={['Mme Sawadogo']} onComplete={onComplete} onCancel={() => {}} />)
    remplir()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(runStoreTransactionCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'replenish', amount: 300 }))
  })

  it.each([
    [{ type: RAVITAILLEMENT, charge: { commande: { amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo' } } }, 'Ravitaillement de 300 FCFA en stock — reçu de Mme Sawadogo'],
    [{ type: RETOUR, charge: { commande: { amount: 100, balanceType: 'liquidite' } } }, 'Retour de 100 FCFA en espèce'],
    [{ type: MODIFICATION, charge: { updates: { montant: 150 }, avant: { type: 'Dépôt', montant: 100 } } }, 'Correction : Dépôt de 150 FCFA'],
    [{ type: CORRECTION, charge: { updates: { montant: 80 }, avant: { type: 'Retrait', montant: 100 } } }, 'Correction : Retrait de 80 FCFA'],
    [{ type: ANNULATION, charge: { avant: { type: 'Dépôt', montant: 100 } } }, 'Annulation : Dépôt de 100 FCFA'],
  ])('[GF-17] la liste des envois dit ce qui attend : %#', (operation, attendu) => {
    expect(decrireOperation(operation).replace(/\s/g, ' ')).toBe(attendu)
  })

  it('[GF-18] une annulation refusée, qui n’a plus de ligne à elle, se lit et se retire dans la liste', () => {
    const onRetirer = vi.fn()
    render(<EnvoisListe open onClose={() => {}} onRetirer={onRetirer} operations={[{ id: 'a1', type: ANNULATION, etat: REFUSEE, charge: { avant: { type: 'Dépôt', montant: 100 } }, erreur: { message: 'Transaction introuvable.' } }]} />)
    expect(screen.getByTestId('envoi-ligne')).toHaveTextContent('Refusée : Transaction introuvable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    expect(onRetirer).toHaveBeenCalledWith('a1')
  })
})
