import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-416 — l'onglet « Transferts » de l'Historique (demande de l'utilisateur,
 * 2026-11-24) : les transferts d'argent ont leur section à part, et ne se
 * mêlent plus aux transactions des agents.
 *
 * L'onglet existe dès que la boutique a coché l'option, ou dès que
 * l'historique chargé contient un transfert (une boutique qui a décoché doit
 * relire les siens). Sinon il n'encombre pas la barre.
 */

let boutique
let lignes
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin', storeId: 'store-a' }, activeStore: boutique }),
}))
const { getTransactionStyles } = await import('../../src/utils/helpers.js')
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({
    getTransactionStyles,
    completedTransactions: lignes,
    loading: false,
    chargerPeriode: vi.fn(),
    revenirAuJour: vi.fn(),
    reopenTransaction: vi.fn(),
    trashTransaction: vi.fn(),
  }),
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { background: '', text: '', tableHeader: '', tableBorder: '' } }),
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribeOutgoingCollaborations: ({ onUpdate }) => { onUpdate([]); return () => {} },
  subscribeIncomingCollaborations: ({ onUpdate }) => { onUpdate([]); return () => {} },
  subscribeMyDebts: ({ onUpdate }) => { onUpdate([]); return () => {} },
  subscribeMyCredits: ({ onUpdate }) => { onUpdate([]); return () => {} },
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ onUpdate }) => { onUpdate({ requests: [], lastDoc: null, hasMore: false }); return () => {} },
}))

import Historique from '../../src/pages/Historique.jsx'

const aujourdhui = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} 08:12`
}
const DEPOT = { id: 'D', type: 'Dépôt', client: { nom: 'KABORE', prenom: 'Issa' }, clientId: 'a1', code: '1234567', reseau: 'Orange', montant: 100000, statut: 'Validée' }
const TRANSFERT = {
  id: 'T', type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', codeTransfert: 'MTCN123',
  reseau: 'Orange', montant: 50000, balanceType: 'liquidite', montantTraite: 50000, resteATraiter: 0, statut: 'Validée',
}
const RETRAIT = { ...TRANSFERT, id: 'R', service: 'Ria', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', codeTransfert: 'RIA-9', balanceType: 'stock', montant: 75000 }

const poser = (recherche = '') =>
  render(
    <MemoryRouter initialEntries={[`/historique${recherche}`]}>
      <Historique />
    </MemoryRouter>,
  )

beforeEach(() => {
  boutique = { id: 'store-a', transfertsArgent: true }
  const date = aujourdhui()
  lignes = [DEPOT, TRANSFERT, RETRAIT].map((l) => ({ ...l, date }))
})

describe('TC-416 — l’onglet Transferts', () => {
  it('[TC-416-01] l’onglet suit « Transactions clients »', () => {
    poser()
    const onglets = screen.getAllByRole('tab').map((o) => o.textContent)
    expect(onglets.slice(0, 2)).toEqual(['Transactions clients', 'Transferts'])
  })

  it('[TC-416-02] « Transactions clients » ne montre plus les transferts', () => {
    poser()
    expect(screen.getByText('Issa KABORE')).toBeInTheDocument()
    expect(screen.queryByText('DIALLO Awa')).toBeNull()
    expect(screen.queryByText('OUEDRAOGO Paul')).toBeNull()
  })

  it('[TC-416-03] l’onglet Transferts montre les transferts, et eux seuls', () => {
    poser('?onglet=transferts')
    expect(screen.getByText('DIALLO Awa').closest('tr')).toHaveTextContent('Western Union · Transfert')
    expect(screen.getByText('OUEDRAOGO Paul').closest('tr')).toHaveTextContent('Ria · Retrait')
    expect(screen.queryByText('Issa KABORE')).toBeNull()
  })

  it('[TC-416-04] la recherche y trouve un transfert par son code', async () => {
    poser('?onglet=transferts')
    fireEvent.change(screen.getByRole('textbox', { name: /recherch/i }), { target: { value: 'RIA-9' } })
    // La recherche part après un court délai (debounce de ClientSearch).
    await waitFor(() => expect(screen.queryByText('DIALLO Awa')).toBeNull())
    expect(screen.getByText('OUEDRAOGO Paul')).toBeInTheDocument()
  })

  it('[TC-416-05] option décochée et aucun transfert : pas d’onglet ; décochée avec des transferts : l’onglet reste', () => {
    boutique = { id: 'store-a', transfertsArgent: false }
    lignes = [{ ...DEPOT, date: aujourdhui() }]
    const { unmount } = poser()
    expect(screen.queryByRole('tab', { name: 'Transferts' })).toBeNull()
    unmount()
    lignes = [DEPOT, TRANSFERT].map((l) => ({ ...l, date: aujourdhui() }))
    poser()
    expect(screen.getByRole('tab', { name: 'Transferts' })).toBeInTheDocument()
  })

  it('[TC-416-06] une ligne supprimée reste dans la corbeille, pas dans l’onglet', () => {
    lignes = [{ ...TRANSFERT, date: aujourdhui(), statut: 'Supprimée', deletedAt: new Date() }, { ...RETRAIT, date: aujourdhui() }]
    poser('?onglet=transferts')
    expect(screen.queryByText('DIALLO Awa')).toBeNull()
    expect(within(screen.getByText('OUEDRAOGO Paul').closest('tr')).getByText('Ria · Retrait')).toBeInTheDocument()
  })
})
