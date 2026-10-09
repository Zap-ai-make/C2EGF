import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

/**
 * TC-240 — Les deux défauts d'interface remontés par la revue.
 *
 * Tous deux produisent une ÉCRITURE FINANCIÈRE FAUSSE sans rien afficher
 * d'anormal — c'est ce qui les avait laissés passer :
 *
 *   1. Deux clics dans le même tick sur « Enregistrer le retour » partaient
 *      tous les deux. `envoiEnCours` est un état React : il ne prend effet
 *      qu'au rendu suivant, et l'action serveur `returnReplenishment` n'a pas
 *      de clé d'idempotence pour rattraper le second envoi. Rendre 200 000 en
 *      débitait 400 000 et soldait une dette qui ne l'était pas.
 *
 *   2. Le code agent de destination n'était vidé qu'au succès. Saisi puis
 *      abandonné sur la transaction d'un client, il partait comme destination
 *      du règlement du SUIVANT — dans son historique et dans l'export.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()
let historique = []
let transactionsValue

vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../src/services/storeTransactionCommandService', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => 9_000_000, getNetworkLiquidite: () => 9_000_000 }),
}))

import RavitaillementPanel from '../../src/components/transactions/RavitaillementPanel.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-240 — le retour ne part qu’une fois', () => {
  beforeEach(() => {
    // Une promesse qui ne se résout pas : c'est l'état dans lequel vit le
    // second clic d'un double-clic — le premier envoi est parti, rien n'est
    // encore revenu.
    runStoreTransactionCommand.mockReset().mockReturnValue(new Promise(() => {}))
    showToast.mockReset()
    historique = [{
      id: 'rav-1',
      type: 'Ravitaillement',
      expediteur: 'Patron',
      montant: 500_000,
      returnedAmount: 0,
      remainingAmount: 500_000,
      balanceType: 'stock',
      date: '08/10/2026 08:00',
      createdAt: new Date('2026-10-08T08:00:00Z'),
    }]
    transactionsValue = { completedTransactions: historique }
  })

  /**
   * ⚠ DEUX ENVOIS DANS UN SEUL `act`, ET C'EST TOUT L'ENJEU.
   *   `fireEvent.click` enveloppe chaque clic dans son propre `act()`, qui vide
   *   la file de rendu : au second clic le bouton serait déjà désactivé, et le
   *   test passerait même sans verrou — il ne prouverait rien. Un vrai
   *   double-clic ne laisse PAS React rendre entre les deux. On dispatche donc
   *   les deux soumissions dans le même `act`, ce qui est la seule situation où
   *   un état React arrive trop tard et où seul un verrou synchrone protège.
   */
  const soumettreDeuxFois = async (nombre = 2) => {
    const formulaire = screen.getByTestId('formulaire-retour')
    await act(async () => {
      for (let i = 0; i < nombre; i += 1) {
        formulaire.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      }
    })
  }

  const preparerRetour = () => {
    render(<RavitaillementPanel open onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '200000' } })
  }

  it('[TC-240-1] deux soumissions dans le même tick n’envoient qu’une commande', async () => {
    preparerRetour()
    await soumettreDeuxFois(2)

    expect(runStoreTransactionCommand).toHaveBeenCalledTimes(1)
  })

  it('[TC-240-2] et le montant envoyé est bien celui saisi, une seule fois', async () => {
    preparerRetour()
    await soumettreDeuxFois(3)

    expect(runStoreTransactionCommand.mock.calls).toEqual([[{
      action: 'returnReplenishment',
      replenishmentId: 'rav-1',
      amount: 200_000,
      balanceType: 'stock',
    }]])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-240 — le code agent ne survit pas à un abandon', () => {
  const addPaymentTranche = vi.fn()

  const brouillon = (id, prenom) => ({
    id,
    type: 'Dépôt',
    client: { nom: 'Ouedraogo', prenom },
    code: '000111',
    montant: 50_000,
    statut: 'Non terminée',
    date: '08/10/2026 14:00',
    createdAt: { toMillis: () => Date.now() },
  })

  beforeEach(() => {
    addPaymentTranche.mockReset().mockResolvedValue(true)
    transactionsValue = {
      pendingTransactions: [brouillon('d-A', 'Aïssata'), brouillon('d-B', 'Binta')],
      loading: false,
      getActionButtons: () => ({ encaisser: true }),
      getTransactionStyles: () => ({ textColor: '' }),
      addPaymentTranche,
      addRefundTranche: vi.fn(),
      startEditTransaction: vi.fn(),
      trashTransaction: vi.fn(),
    }
  })

  /**
   * La rangée du tableau portant ce client. On ne peut pas chercher le nom dans
   * tout le document : le menu de règlement, une fois ouvert, le réaffiche dans
   * son récapitulatif — et `getByText` en trouverait alors deux.
   */
  const rangee = (prenom) => within(document.querySelector('tbody'))
    .getByText(`${prenom} Ouedraogo`).closest('tr')

  /** Ouvre le menu d'une ligne, choisit Cash, et rend le champ de code agent. */
  const ouvrir = (prenom) => {
    fireEvent.click(rangee(prenom).querySelector('button'))
    fireEvent.click(screen.getByText('Cash'))
    return screen.getByTestId('reglement-code-agent')
  }

  /**
   * ⚠ LE DÉFAUT. Le code de A finissait écrit comme destination du règlement
   *   de B, dans l'historique et dans la colonne « Code agent destinataire »
   *   de l'export — sans que rien ne le signale, l'empreinte d'idempotence
   *   l'ayant intégré elle aussi.
   */
  it('[TC-240-3] un code saisi pour un client ne part pas avec le suivant', async () => {
    render(<TransactionTable />)

    // Client A : on tape un code, puis on referme le menu sans valider.
    fireEvent.change(ouvrir('Aïssata'), { target: { value: '1234567' } })
    fireEvent.click(rangee('Aïssata').querySelector('button'))

    // Client B : on règle sans toucher au champ.
    ouvrir('Binta')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    const [draftId, , , , codeAgent] = addPaymentTranche.mock.calls[0]
    expect(draftId).toBe('d-B')
    expect(codeAgent).toBeUndefined()
  })

  it('[TC-240-4] le champ se présente vide quand on rouvre un autre menu', () => {
    render(<TransactionTable />)

    fireEvent.change(ouvrir('Aïssata'), { target: { value: '1234567' } })
    fireEvent.click(rangee('Aïssata').querySelector('button'))

    expect(ouvrir('Binta')).toHaveValue('')
  })
})
