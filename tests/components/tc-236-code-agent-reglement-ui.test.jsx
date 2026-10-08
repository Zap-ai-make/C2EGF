import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-236 — Le code agent de destination, à la saisie.
 *
 * CE QUE CE FICHIER PROTÈGE, ET QUE TC-235 NE COUVRE PAS
 * ─────────────────────────────────────────────────────
 * TC-235 vérifie le serveur. Ici on vérifie les trois choses qui se jouent
 * entre le clic et l'appel :
 *
 *   1. le champ est VRAIMENT facultatif — laissé vide, rien n'est transmis, et
 *      surtout rien n'est bloqué ;
 *   2. le code saisi arrive bien jusqu'à l'appel, pour le paiement comme pour
 *      le remboursement ;
 *   3. ⚠ LA CLÉ D'IDEMPOTENCE CHANGE AVEC LE CODE. C'est le piège : sans cela,
 *      corriger un code mal tapé et reconfirmer réutiliserait la même clé, le
 *      serveur reconnaîtrait un rejeu, et la correction serait perdue EN
 *      SILENCE — avec un message de succès par-dessus.
 */

let transactionsValue
const addPaymentTranche = vi.fn()
const addRefundTranche = vi.fn()

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

const brouillon = (over = {}) => ({
  id: 'd-1',
  type: 'Dépôt',
  client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
  code: '000111',
  montant: 50_000,
  statut: 'Non terminée',
  date: '08/10/2026 14:00',
  createdAt: { toMillis: () => Date.now() },
  ...over,
})

const contexte = (actions) => ({
  pendingTransactions: [brouillon()],
  loading: false,
  getActionButtons: () => actions,
  getTransactionStyles: () => ({ textColor: '' }),
  addPaymentTranche,
  addRefundTranche,
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn(),
})

/** Ouvre le menu, choisit une méthode, et rend le champ de code agent. */
const ouvrirSaisie = (bouton = 'Encaisser') => {
  fireEvent.click(screen.getByRole('button', { name: bouton }))
  fireEvent.click(screen.getByText('Cash'))
  return screen.getByTestId('reglement-code-agent')
}

const confirmer = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

beforeEach(() => {
  addPaymentTranche.mockReset().mockResolvedValue(true)
  addRefundTranche.mockReset().mockResolvedValue(true)
  transactionsValue = contexte({ encaisser: true })
})

describe('TC-236 — le champ est facultatif', () => {
  it('[TC-236-1] il se présente comme tel, et ne bloque rien', () => {
    render(<TransactionTable />)
    const champ = ouvrirSaisie()

    expect(screen.getByText(/facultatif/i)).toBeInTheDocument()
    expect(champ).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled()
  })

  it('[TC-236-2] laissé vide, aucun code n’est transmis', async () => {
    render(<TransactionTable />)
    ouvrirSaisie()
    confirmer()

    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    const [, , , , codeAgent] = addPaymentTranche.mock.calls[0]
    expect(codeAgent).toBeUndefined()
  })

  it('[TC-236-3] rempli d’espaces seulement, pas davantage', async () => {
    render(<TransactionTable />)
    fireEvent.change(ouvrirSaisie(), { target: { value: '   ' } })
    confirmer()

    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    expect(addPaymentTranche.mock.calls[0][4]).toBeUndefined()
  })
})

describe('TC-236 — le code arrive jusqu’à l’appel', () => {
  it('[TC-236-4] sur un encaissement', async () => {
    render(<TransactionTable />)
    fireEvent.change(ouvrirSaisie(), { target: { value: '1234567' } })
    confirmer()

    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    expect(addPaymentTranche.mock.calls[0][4]).toBe('1234567')
  })

  it('[TC-236-5] sur un remboursement', async () => {
    transactionsValue = contexte({ rembourser: true })
    render(<TransactionTable />)
    fireEvent.change(ouvrirSaisie('Rembourser'), { target: { value: '7654321' } })
    confirmer()

    await waitFor(() => expect(addRefundTranche).toHaveBeenCalled())
    expect(addRefundTranche.mock.calls[0][4]).toBe('7654321')
  })

  it('[TC-236-6] rogné de ses espaces', async () => {
    render(<TransactionTable />)
    fireEvent.change(ouvrirSaisie(), { target: { value: '  1234567  ' } })
    confirmer()

    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())
    expect(addPaymentTranche.mock.calls[0][4]).toBe('1234567')
  })
})

describe('TC-236 — la clé d’idempotence', () => {
  /**
   * ⚠ LA PROPRIÉTÉ LA PLUS IMPORTANTE DU FICHIER.
   *   La clé est stable par (brouillon, action, méthode, montant) pour qu'une
   *   reprise réseau ne paie pas deux fois. Le code agent DOIT en faire partie :
   *   sinon, corriger une faute de frappe et reconfirmer renverrait le règlement
   *   déjà enregistré, la caissière verrait un succès, et le code corrigé ne
   *   serait jamais écrit.
   */
  it('[TC-236-7] change quand le code agent change', async () => {
    render(<TransactionTable />)

    fireEvent.change(ouvrirSaisie(), { target: { value: '1111111' } })
    confirmer()
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalledTimes(1))

    fireEvent.change(ouvrirSaisie(), { target: { value: '2222222' } })
    confirmer()
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalledTimes(2))

    const [cle1, cle2] = addPaymentTranche.mock.calls.map((appel) => appel[3])
    expect(cle1).not.toBe(cle2)
  })

  it('[TC-236-8] et distingue « pas de code » d’un code donné', async () => {
    render(<TransactionTable />)

    ouvrirSaisie()
    confirmer()
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalledTimes(1))

    fireEvent.change(ouvrirSaisie(), { target: { value: '1234567' } })
    confirmer()
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalledTimes(2))

    const [cle1, cle2] = addPaymentTranche.mock.calls.map((appel) => appel[3])
    expect(cle1).not.toBe(cle2)
  })

  it('[TC-236-9] le champ est vidé après un règlement enregistré', async () => {
    render(<TransactionTable />)
    fireEvent.change(ouvrirSaisie(), { target: { value: '1234567' } })
    confirmer()
    await waitFor(() => expect(addPaymentTranche).toHaveBeenCalled())

    // Le code du règlement précédent ne doit pas se reporter sur le suivant :
    // ce serait écrire une destination que personne n'a saisie.
    expect(ouvrirSaisie()).toHaveValue('')
  })
})
