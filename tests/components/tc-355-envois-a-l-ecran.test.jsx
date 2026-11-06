/**
 * TC-355 — la caissière voit ce qui attend le réseau (lot G3c,
 * docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Ce que ce fichier verrouille :
 * - une saisie faite hors ligne apparaît dans les non terminées et accepte les
 *   mêmes gestes qu'une autre ; refusée, elle se retire ;
 * - un règlement en attente se lit sous le montant ; refusé, il se retire ;
 * - le bandeau du bas compte ce qui attend, même quand le navigateur se croit
 *   en ligne (wifi sans internet) ;
 * - la déconnexion est refusée tant qu'une opération attend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let contextValue

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableHeader: 'a b', tableBorder: '', text: '' } }),
}))
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ themeClasses: { tableHeader: 'a b', tableBorder: '', text: '' } }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => contextValue,
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1', email: 'b1@c2egf.test', metadata: {} },
    userProfile: { role: 'store_admin', storeId: 'store-a', name: 'Awa' },
    activeStore: { id: 'store-a', name: 'Boutique A' },
    logout: vi.fn(),
  }),
}))
vi.mock('../../src/hooks/useUserActivity', () => ({ useUserActivity: () => ({}) }))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import OfflineBanner from '../../src/components/OfflineBanner.jsx'
import Profil from '../../src/pages/Profil.jsx'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import { CLIENT, EN_ATTENTE, REFUSEE, REGLEMENT, SAISIE } from '../../src/services/fileEnvoi.js'

const ligne = (over = {}) => ({
  id: 'tx-1', client: { nom: 'BANABA', prenom: 'Guafarou' }, type: 'Dépôt', reseau: 'Orange',
  code: '1000001', montant: 5000, statut: 'Non Terminées', date: '06/11/2026', ...over,
})

const envoisSimules = (over = {}) => ({
  disponible: true, soumettre: vi.fn(), retirer: vi.fn(async () => true),
  operations: [], enAttente: [], refusees: [], ...over,
})

function monterTableau(lignes, envois = envoisSimules()) {
  contextValue = {
    pendingTransactions: lignes,
    loading: false,
    // Comme le contexte : refusée, une ligne n'accepte plus rien.
    getActionButtons: (t) => (t.envoi?.etat === REFUSEE ? { annuler: false } : { modifier: true, encaisser: true }),
    getTransactionStyles: () => ({ bgColor: '', textColor: '' }),
    addPaymentTranche: vi.fn(), addRefundTranche: vi.fn(), startEditTransaction: vi.fn(), trashTransaction: vi.fn(),
  }
  render(<EnvoisContext.Provider value={envois}><TransactionTable /></EnvoisContext.Provider>)
  return envois
}

const rangee = (texte) => screen.getByText(texte).closest('tr')

beforeEach(() => {
  contextValue = undefined
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

describe('TC-355 — les non terminées en attente', () => {
  it('[EC-01] une saisie en attente se lit, se règle, se modifie et s’annule', () => {
    monterTableau([ligne({ id: 'cmd-1', client: { nom: 'HORSLIGNE' }, envoi: { etat: EN_ATTENTE, erreur: null } }), ligne()])
    const enAttente = rangee('HORSLIGNE')
    expect(within(enAttente).getByTestId('envoi-en-attente')).toHaveTextContent('En attente d’envoi')
    expect(within(enAttente).getByRole('button', { name: 'Encaisser' })).toBeInTheDocument()
    expect(within(enAttente).getByRole('button', { name: 'Modifier' })).toBeInTheDocument()
    expect(within(enAttente).getByTestId('supprimer-non-terminee')).toBeInTheDocument()

    const ordinaire = rangee(/BANABA/)
    expect(within(ordinaire).queryByTestId('envoi-en-attente')).toBeNull()
    expect(within(ordinaire).getByTestId('supprimer-non-terminee')).toBeInTheDocument()
  })

  it('[EC-02] refusée, elle dit pourquoi et se retire d’un geste', () => {
    const envois = monterTableau([ligne({ id: 'cmd-2', client: { nom: 'REFUSEE' }, envoi: { etat: REFUSEE, erreur: { code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock Orange insuffisant.' } } })])
    const r = rangee('REFUSEE')
    expect(within(r).getByTestId('envoi-refuse')).toHaveTextContent('Refusée : Stock Orange insuffisant.')
    expect(within(r).queryByRole('button', { name: 'Encaisser' })).toBeNull()
    expect(within(r).queryByTestId('supprimer-non-terminee')).toBeNull()

    fireEvent.click(within(r).getByTestId('retirer-envoi'))
    expect(envois.retirer).toHaveBeenCalledWith('cmd-2')
  })

  it('[EC-03] un règlement en attente se lit sous le montant ; refusé, il se retire', () => {
    const envois = monterTableau([ligne({
      reglementsEnAttente: [
        { id: 'reglement-k1', type: REGLEMENT, amount: 2000, paymentMethod: 'Cash', etat: EN_ATTENTE, erreur: null },
        { id: 'reglement-k2', type: REGLEMENT, amount: 1000, paymentMethod: 'Orange Money', etat: REFUSEE, erreur: { message: 'Reste dû dépassé.' } },
      ],
      remainingAmount: 3000, settlementStatus: 'partial', paidAmount: 2000,
    })])
    expect(screen.getByTestId('reglement-en-attente')).toHaveTextContent('Règlement 2 000 FCFA (Cash) en attente d’envoi')
    const refuse = screen.getByTestId('reglement-refuse')
    expect(refuse).toHaveTextContent('Reste dû dépassé.')
    expect(screen.getByText(/Reste : 3 000 FCFA/)).toBeInTheDocument()

    fireEvent.click(within(refuse).getByRole('button', { name: 'Retirer' }))
    expect(envois.retirer).toHaveBeenCalledWith('reglement-k2')
  })
})

describe('TC-355 — le message d’un règlement gardé', () => {
  it('[EC-09] « Connexion absente » ne reste pas affiché : il se ferme seul', async () => {
    monterTableau([ligne()])
    contextValue.addPaymentTranche = vi.fn(async () => ({ statut: EN_ATTENTE }))
    const r = rangee(/BANABA/)
    fireEvent.click(within(r).getByRole('button', { name: 'Encaisser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirmer' })) })
      expect(screen.getByText(/Connexion absente ou lente : le règlement est gardé/)).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(6100) })
      expect(screen.queryByText(/Connexion absente ou lente : le règlement est gardé/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TC-355 — le bandeau du bas', () => {
  const monterBandeau = (envois) => render(<EnvoisContext.Provider value={envois}><OfflineBanner /></EnvoisContext.Provider>)

  it('[EC-04] en ligne et rien en attente : pas de bandeau', () => {
    monterBandeau(envoisSimules())
    expect(screen.queryByTestId('bandeau-hors-ligne')).toBeNull()
  })

  it('[EC-05] le navigateur se croit en ligne, mais deux opérations attendent : le bandeau le dit', () => {
    monterBandeau(envoisSimules({ enAttente: [{}, {}], refusees: [{}] }))
    const bandeau = screen.getByTestId('bandeau-hors-ligne')
    expect(bandeau).toHaveTextContent('2 opérations en attente d’envoi')
    expect(bandeau).toHaveTextContent('1 opération refusée par le serveur')
    expect(bandeau).not.toHaveTextContent('Hors ligne')
  })

  it('[EC-06] hors ligne, le bandeau d’avant reste, avec ce qui attend', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    monterBandeau(envoisSimules({ enAttente: [{}] }))
    expect(screen.getByTestId('bandeau-hors-ligne')).toHaveTextContent('Hors ligne — les données affichées proviennent du cache local · 1 opération en attente d’envoi : elle partira dès le retour de la connexion')
  })
})

describe('TC-355 — le panneau des envois', () => {
  const OPERATIONS = [
    { id: 's1', type: SAISIE, etat: EN_ATTENTE, charge: { transaction: { type: 'Dépôt', montant: 2000, client: { prenom: 'Awa', nom: 'SAWADOGO' } } } },
    { id: 'c1', type: CLIENT, etat: REFUSEE, erreur: { code: 'CLIENT_DOUBLON', message: 'Ce code agent est déjà enregistré.' }, charge: { donnees: { prenom: 'Ines', nom: 'OUATTARA' } } },
    { id: 'r1', type: REGLEMENT, etat: REFUSEE, erreur: null, charge: { amount: 500, paymentMethod: 'Cash' } },
  ]
  const ouvrir = (envois) => {
    render(<EnvoisContext.Provider value={envois}><OfflineBanner /></EnvoisContext.Provider>)
    fireEvent.click(screen.getByTestId('voir-envois'))
  }

  it('[EC-10] une fiche refusée, qui n’a aucune ligne ailleurs, s’y lit avec sa raison et se retire', () => {
    const envois = envoisSimules({ operations: OPERATIONS, enAttente: [OPERATIONS[0]], refusees: OPERATIONS.slice(1) })
    ouvrir(envois)
    const lignes = screen.getAllByTestId('envoi-ligne')
    expect(lignes[0]).toHaveTextContent(/Dépôt de 2.000 FCFA — Awa SAWADOGO/)
    expect(lignes[0]).toHaveTextContent('En attente d’envoi')
    expect(within(lignes[0]).queryByRole('button', { name: 'Retirer' })).toBeNull()

    expect(lignes[1]).toHaveTextContent('Fiche client : Ines OUATTARA')
    expect(lignes[1]).toHaveTextContent('Refusée : Ce code agent est déjà enregistré.')
    fireEvent.click(within(lignes[1]).getByRole('button', { name: 'Retirer' }))
    expect(envois.retirer).toHaveBeenCalledWith('c1')

    expect(lignes[2]).toHaveTextContent('Règlement de 500 FCFA (Cash)')
  })

  it('[EC-11] tout est parti pendant qu’il est ouvert : il le dit, sans se refermer sous la main', () => {
    const avec = envoisSimules({ operations: OPERATIONS.slice(0, 1), enAttente: OPERATIONS.slice(0, 1) })
    const { rerender } = render(<EnvoisContext.Provider value={avec}><OfflineBanner /></EnvoisContext.Provider>)
    fireEvent.click(screen.getByTestId('voir-envois'))
    rerender(<EnvoisContext.Provider value={envoisSimules()}><OfflineBanner /></EnvoisContext.Provider>)
    expect(screen.getByText('Tout est parti.')).toBeInTheDocument()
    expect(screen.queryByTestId('bandeau-hors-ligne')).toBeNull()
  })
})

describe('TC-355 — la déconnexion', () => {
  const ouvrirDeconnexion = (envois) => {
    render(<EnvoisContext.Provider value={envois}><MemoryRouter><Profil /></MemoryRouter></EnvoisContext.Provider>)
    fireEvent.click(screen.getAllByRole('button').find((b) => /déconnecter|déconnexion/i.test(b.textContent)))
  }
  const boutonConfirmer = () => screen.getAllByRole('button').filter((b) => /déconnecter|déconnexion/i.test(b.textContent)).at(-1)

  it('[EC-07] refusée tant qu’une opération attend, avec la raison', () => {
    ouvrirDeconnexion(envoisSimules({ enAttente: [{}, {}] }))
    expect(screen.getByTestId('deconnexion-bloquee')).toHaveTextContent('2 opérations attendent encore le réseau')
    expect(boutonConfirmer()).toBeDisabled()
  })

  it('[EC-08] possible quand rien n’attend', () => {
    ouvrirDeconnexion(envoisSimules())
    expect(screen.queryByTestId('deconnexion-bloquee')).toBeNull()
    expect(boutonConfirmer()).not.toBeDisabled()
  })
})
