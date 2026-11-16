import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { REFUSEE } from '../../src/services/fileEnvoi.js'

/**
 * TC-391 — les cases au-dessus des non terminées filtrent le tableau par nature
 * (docs/superpowers/specs/2026-11-16-filtre-non-terminees-design.md).
 *
 * Décidé par l'utilisateur : les cases sont cliquables et filtrent ; « Tout »
 * vient en premier et est choisi par défaut. Les chiffres des cases, eux, ne
 * bougent jamais : elles comptent toujours toutes les non terminées.
 */

let contextValue
let rembSiegeActif = true

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
// Un VRAI contexte React, et non une simple fonction : le tableau est mémoïsé,
// et seul un changement de contexte le fait se redessiner quand les lignes
// changent sous lui (TC-391-6). Sans fournisseur, la valeur de `contextValue`.
vi.mock('../../src/context/transactions.jsx', async () => {
  const { createContext, useContext } = await import('react')
  const ContexteDeTest = createContext(null)
  return { ContexteDeTest, useTransactions: () => useContext(ContexteDeTest) ?? contextValue }
})
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => 400000 }),
}))
vi.mock('../../src/utils/rembSiege.js', async (original) => {
  const module = await original()
  return {
    ...module,
    get REMB_SIEGE_ACTIF() { return rembSiegeActif },
  }
})

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import { ContexteDeTest } from '../../src/context/transactions.jsx'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const ligne = (id, nom, type, extra = {}) => ({
  id, client: { nom, prenom: 'Awa' }, clientId: `c-${nom}`, type, reseau: 'Orange', code: '1234567',
  montant: 100000, statut: 'Non Terminées', date: '16/11/2026 08:00', ...extra,
})
const D1 = ligne('D1', 'KABORE', 'Dépôt')
const R1 = ligne('R1', 'SANOU', 'Retrait')
const S1 = ligne('S1', 'OUEDRAOGO', 'Remb. siège', { balanceType: 'liquidite', envoyeAuSiege: 0, resteAuSiege: 100000, envoisSiege: [] })
const S2 = ligne('S2', 'ZONGO', 'Remb. siège', { balanceType: 'stock', envoyeAuSiege: 0, resteAuSiege: 100000, envoisSiege: [] })

const contexte = (pendingTransactions) => ({
  pendingTransactions,
  loading: false,
  getActionButtons: (t) => getAvailableActions(t.type),
  getTransactionStyles,
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn(),
  envoyerAuSiege: vi.fn(),
})

const groupe = () => screen.getByRole('group', { name: 'Filtrer par nature' })
const bouton = (nom) => within(groupe()).getByRole('button', { name: new RegExp(`^${nom}`) })
const visibles = () => ['KABORE', 'SANOU', 'OUEDRAOGO', 'ZONGO', 'TRAORE']
  .filter((nom) => screen.queryAllByText(new RegExp(nom)).length > 0)

beforeEach(() => {
  rembSiegeActif = true
  contextValue = contexte([D1, R1, S1, S2])
})

describe('TC-391 — les cases filtrent le tableau', () => {
  it('[TC-391-1] Tout vient en premier, choisi par défaut, et tout s’affiche', () => {
    render(<TransactionTable />)
    const noms = within(groupe()).getAllByRole('button').map((b) => b.textContent)
    expect(noms.map((n) => n.match(/Tout|Dépôts|Retraits|Remb\. siège/)[0])).toEqual(['Tout', 'Dépôts', 'Retraits', 'Remb. siège'])
    expect(bouton('\\d*\\s*Tout')).toHaveAttribute('aria-pressed', 'true')
    expect(visibles()).toEqual(['KABORE', 'SANOU', 'OUEDRAOGO', 'ZONGO'])
  })

  it('[TC-391-2] Retraits ne garde que le retrait ; les chiffres des cases ne bougent pas', () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    expect(visibles()).toEqual(['SANOU'])
    expect(screen.getByTestId('case-retraits-non-terminees')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filtre-tout')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('nombre-depots-non-terminees')).toHaveTextContent('1')
  })

  it('[TC-391-3] recliquer la case choisie revient à Tout', () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    expect(visibles()).toEqual(['KABORE', 'SANOU', 'OUEDRAOGO', 'ZONGO'])
    expect(screen.getByTestId('filtre-tout')).toHaveAttribute('aria-pressed', 'true')
  })

  it('[TC-391-4] Remb. siège puis Tout ramène toute la liste', () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-siege-non-terminees'))
    expect(visibles()).toEqual(['OUEDRAOGO', 'ZONGO'])
    fireEvent.click(screen.getByTestId('filtre-tout'))
    expect(visibles()).toEqual(['KABORE', 'SANOU', 'OUEDRAOGO', 'ZONGO'])
  })

  it('[TC-391-5] une case à zéro ne se clique pas ; Tout, toujours', () => {
    contextValue = contexte([R1, S1])
    render(<TransactionTable />)
    expect(screen.getByTestId('case-depots-non-terminees')).toBeDisabled()
    expect(screen.getByTestId('filtre-tout')).not.toBeDisabled()
  })

  it('[TC-391-6] la dernière ligne de la nature choisie partie, le tableau repasse à Tout', () => {
    const avec = (valeur) => (
      <ContexteDeTest.Provider value={valeur}><TransactionTable /></ContexteDeTest.Provider>
    )
    const { rerender } = render(avec(contexte([D1, R1, S1, S2])))
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    expect(visibles()).toEqual(['SANOU'])
    rerender(avec(contexte([D1, S1, S2])))
    expect(screen.getByTestId('filtre-tout')).toHaveAttribute('aria-pressed', 'true')
    expect(visibles()).toEqual(['KABORE', 'OUEDRAOGO', 'ZONGO'])
    // Un nouveau retrait arrive : le filtre ne se rallume pas en silence.
    rerender(avec(contexte([D1, S1, S2, ligne('R2', 'TRAORE', 'Retrait')])))
    expect(screen.getByTestId('filtre-tout')).toHaveAttribute('aria-pressed', 'true')
    expect(visibles()).toEqual(['KABORE', 'OUEDRAOGO', 'ZONGO', 'TRAORE'])
  })

  it('[TC-391-7] Tout compte toutes les non terminées, sans montant', () => {
    render(<TransactionTable />)
    expect(screen.getByTestId('nombre-tout-non-terminees')).toHaveTextContent('4')
    expect(screen.getByTestId('filtre-tout').textContent).not.toMatch(/\d{3}\s?\d{3}/)
  })

  it('[TC-391-8] une ligne refusée reste visible dans sa nature, sans compter dans la case', () => {
    const refusee = ligne('X1', 'TRAORE', 'Dépôt', { envoi: { etat: REFUSEE, raison: 'Solde insuffisant' } })
    contextValue = contexte([D1, refusee, R1])
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-depots-non-terminees'))
    expect(visibles()).toEqual(['KABORE', 'TRAORE'])
    expect(screen.getByTestId('nombre-depots-non-terminees')).toHaveTextContent('1')
  })

  it('[TC-391-9] deux dépôts du même agent restent regroupés sous le filtre', () => {
    const D2 = ligne('D2', 'KABORE', 'Dépôt', { date: '16/11/2026 09:00' })
    contextValue = contexte([D1, D2, R1])
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-depots-non-terminees'))
    expect(screen.getByText(/×\s*2/)).toBeInTheDocument()
    expect(visibles()).toEqual(['KABORE'])
  })

  it('[TC-391-10] sans le drapeau du profil, trois boutons', () => {
    rembSiegeActif = false
    render(<TransactionTable />)
    expect(within(groupe()).getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByTestId('case-siege-non-terminees')).toBeNull()
  })
})
