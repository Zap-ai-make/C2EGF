import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

/**
 * TC-415 — les suites de la relecture indépendante des transferts d'argent
 * (2026-11-23). Quatre défauts relevés, chacun fixé ici avant sa correction :
 *   I1  la recherche de l'historique ne trouvait pas un transfert par son nom,
 *       son code ou son téléphone ;
 *   I2  la corbeille, la fenêtre « Annuler » de l'historique et le journal des
 *       modifications affichaient « Client inconnu · Transfert argent » ;
 *   I3  les deux restes des transferts n'étaient pas à l'écran : le Total caisse
 *       ne se vérifiait plus à la main (spec, « Le total de la caisse ») ;
 *   I4  après avoir coché l'option, le cache de l'appareil gardait l'ancienne
 *       fiche : un démarrage hors ligne masquait l'onglet.
 */

let contextValue
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableHeader: 'bg-gray-100', tableBorder: 'border-gray-300', text: 'text-gray-900' } }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => contextValue }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({ useSimpleNetworkData: () => ({ getStock: () => 400000 }) }))

const enregistrer = vi.fn()
const rafraichir = vi.fn()
vi.mock('../../src/services/reglagesBoutiqueService.js', () => ({
  enregistrerTransfertsArgent: (...a) => enregistrer(...a),
  rafraichirFicheBoutique: (...a) => rafraichir(...a),
}))
vi.mock('../../src/hooks/useEnLigne.js', () => ({ useEnLigne: () => true }))
const mettreAJourBoutique = vi.fn()
vi.mock('../../src/context/AuthContext', async () => ({
  AuthContext: (await import('react')).createContext(null),
  useAuth: () => ({ activeStore: { id: 'store-a', transfertsArgent: false }, mettreAJourBoutique }),
}))

import { matchesSearchTerm, getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'
import CorbeilleTable from '../../src/components/historique/CorbeilleTable.jsx'
import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import ModificationsDialog from '../../src/components/historique/ModificationsDialog.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import CaseTransfertsArgent from '../../src/components/profil/CaseTransfertsArgent.jsx'

const T = {
  id: 'T', type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', codeTransfert: 'MTCN123',
  telephone: '70123456', reseau: 'Orange', montant: 50000, balanceType: 'liquidite', montantTraite: 20000, resteATraiter: 30000,
  tranches: [], statut: 'Non Terminées', date: '23/11/2026 08:12',
}
const R = {
  ...T, id: 'R', service: 'Ria', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', codeTransfert: undefined, telephone: undefined,
  montant: 75000, balanceType: 'stock', montantTraite: 0, resteATraiter: 75000,
}

beforeEach(() => {
  enregistrer.mockReset().mockResolvedValue({ transfertsArgent: true })
  rafraichir.mockReset().mockResolvedValue(undefined)
  mettreAJourBoutique.mockClear()
  contextValue = {
    pendingTransactions: [T, R],
    loading: false,
    getActionButtons: (t) => getAvailableActions(t.type),
    getTransactionStyles,
    addPaymentTranche: vi.fn(),
    addRefundTranche: vi.fn(),
    startEditTransaction: vi.fn(),
    trashTransaction: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
    envoyerAuSiege: vi.fn(),
    traiterTransfertArgent: vi.fn(),
  }
})

describe('TC-415 — I1, la recherche de l’historique', () => {
  it('[TC-415-01] un transfert se trouve par son nom, son code et son téléphone, pas par « inconnu »', () => {
    expect(matchesSearchTerm(T, 'diallo')).toBe(true)
    expect(matchesSearchTerm(T, 'mtcn123')).toBe(true)
    expect(matchesSearchTerm(T, '7012')).toBe(true)
    expect(matchesSearchTerm(T, 'inconnu')).toBe(false)
    expect(matchesSearchTerm({ client: { nom: 'KABORE', prenom: 'Issa' }, code: '1234567', type: 'Dépôt' }, 'kabore')).toBe(true)
  })
})

describe('TC-415 — I2, le nom et le libellé partout', () => {
  it('[TC-415-02] la corbeille', () => {
    render(<CorbeilleTable transactions={[{ ...T, statut: 'Supprimée', deletedAt: new Date(1) }]} />)
    const ligne = screen.getByTestId('ligne-corbeille')
    expect(ligne).toHaveTextContent('DIALLO Awa')
    expect(ligne).toHaveTextContent('Western Union · Transfert')
    expect(ligne).not.toHaveTextContent('Client inconnu')
    expect(ligne).not.toHaveTextContent('Transfert argent')
  })

  it('[TC-415-03] l’en-tête de la fenêtre « Annuler » de l’historique', async () => {
    const V = { ...R, montantTraite: 75000, resteATraiter: 0, statut: 'Validée' }
    render(<HistoriqueTable transactions={[V]} />)
    fireEvent.click(within(screen.getByText('OUEDRAOGO Paul').closest('tr')).getByTestId('supprimer-historique'))
    await screen.findByRole('button', { name: 'Annuler la transaction' })
    expect(document.body.textContent).toMatch(/OUEDRAOGO Paul · Ria · Retrait · 75\s000 FCFA/)
    expect(document.body.textContent).not.toMatch(/Client inconnu/)
  })

  it('[TC-415-04] le journal des modifications', () => {
    render(<ModificationsDialog transaction={T} open onClose={() => {}} />)
    expect(screen.getByText('DIALLO Awa · Western Union · Transfert')).toBeInTheDocument()
  })
})

describe('TC-415 — I3, les deux restes à l’écran', () => {
  it('[TC-415-05] deux cases : ce qui reste à envoyer au siège, ce qui reste à encaisser', () => {
    render(<TransactionTable />)
    expect(screen.getByTestId('case-transferts-non-terminees')).toHaveTextContent('Transferts à envoyer')
    expect(screen.getByTestId('nombre-transferts-non-terminees')).toHaveTextContent('1')
    expect(screen.getByTestId('total-transferts-non-terminees').textContent).toMatch(/30\s000/)
    expect(screen.getByTestId('case-retraits-transfert-non-terminees')).toHaveTextContent('Retraits à encaisser')
    expect(screen.getByTestId('nombre-retraits-transfert-non-terminees')).toHaveTextContent('1')
    expect(screen.getByTestId('total-retraits-transfert-non-terminees').textContent).toMatch(/75\s000/)
    expect(screen.getByTestId('nombre-tout-non-terminees')).toHaveTextContent('2')
  })

  it('[TC-415-06] chaque case filtre sa propre opération', () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-retraits-transfert-non-terminees'))
    expect(screen.queryByText('DIALLO Awa')).toBeNull()
    expect(screen.getByText('OUEDRAOGO Paul')).toBeInTheDocument()
  })
})

describe('TC-415 — I4, le cache de la fiche après l’option', () => {
  it('[TC-415-07] un réglage enregistré relit la fiche, pour que l’appareil la garde à jour hors ligne', async () => {
    render(<CaseTransfertsArgent />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Western Union, Ria, MoneyGram et autres' }))
    expect(await screen.findByText('Enregistré.')).toBeInTheDocument()
    expect(rafraichir).toHaveBeenCalledWith('store-a')
  })

  it('[TC-415-08] une relecture qui échoue ne gâche pas le réglage enregistré', async () => {
    rafraichir.mockRejectedValueOnce(new Error('hors ligne'))
    render(<CaseTransfertsArgent />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Western Union, Ria, MoneyGram et autres' }))
    expect(await screen.findByText('Enregistré.')).toBeInTheDocument()
    expect(mettreAJourBoutique).toHaveBeenCalledWith({ transfertsArgent: true })
  })
})
