import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * TC-242 — Le plafond d'un retour se lit sur le réseau qui sera débité.
 *
 * ⚠ LE DÉFAUT. Le formulaire affichait « Disponible » en lisant la carte
 *   « Liquidité » de l'accueil, qui ADDITIONNE les espèces de tous les réseaux.
 *   Le serveur, lui, ne débite qu'un seul réseau (`STORE_NETWORKS[0]`). Le
 *   bouton s'ouvrait donc sur un montant que le solde réellement débité ne
 *   contient pas, et le refus arrivait APRÈS le clic — avec un message de
 *   réserve insuffisante que l'écran venait de contredire.
 *
 * POURQUOI LE TESTER ALORS QUE C2EGF N'A QU'UN RÉSEAU
 * ──────────────────────────────────────────────────
 * Sur un profil mono-réseau, la somme ÉGALE la part du premier réseau : le
 * défaut est inerte, et c'est exactement ce qui le rendait invisible. Le profil
 * pilote en déclare cinq. Un test qui se contenterait du profil actif validerait
 * une coïncidence ; celui-ci sépare les deux chiffres pour que le code ne puisse
 * plus les confondre.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()

/** Deux chiffres DIFFÉRENTS : la somme des réseaux, et la part du premier. */
const SOMME_DES_RESEAUX = 9_000_000
const LIQUIDITE_DU_RESEAU = 2_000_000

vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../src/services/storeTransactionCommandService', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ completedTransactions: historique }),
}))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({
    getStock: () => 5_000_000,
    // Les deux accesseurs existent pour de bon : le formulaire doit choisir le
    // second. S'il revient au premier, les attentes ci-dessous tombent.
    getLiquidite: () => SOMME_DES_RESEAUX,
    getNetworkLiquidite: () => LIQUIDITE_DU_RESEAU,
  }),
}))

import RavitaillementPanel from '../../src/components/transactions/RavitaillementPanel.jsx'
import { formatCurrency } from '../../src/utils/formatCurrency'

/** Le formatage FR sépare les milliers d'une espace fine insécable (U+202F). */
const fr = (texte) => texte.replace(/\s/g, ' ')

let historique = []

beforeEach(() => {
  runStoreTransactionCommand.mockReset().mockResolvedValue({ id: 'ret-1' })
  showToast.mockReset()
  historique = [{
    id: 'rav-1',
    type: 'Ravitaillement',
    expediteur: 'Patron',
    montant: 4_000_000,
    returnedAmount: 0,
    remainingAmount: 4_000_000,
    balanceType: 'stock',
    date: '09/10/2026 08:00',
    createdAt: new Date('2026-10-09T08:00:00Z'),
  }]
})

/** Ouvre le retour de la livraison et bascule sur « Espèce ». */
const ouvrirEnEspeces = () => {
  render(<RavitaillementPanel open onClose={() => {}} />)
  fireEvent.click(screen.getByTestId('retour-rav-1'))
  fireEvent.click(screen.getByText('Espèce'))
}

const saisir = (montant) =>
  fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: String(montant) } })

describe('TC-242 — le disponible affiché', () => {
  it('[TC-242-1] est la liquidité du réseau débité, pas la somme des réseaux', () => {
    ouvrirEnEspeces()

    const ligne = fr(screen.getByTestId('retour-disponible').textContent)
    expect(ligne).toContain(fr(formatCurrency(LIQUIDITE_DU_RESEAU)))
    expect(ligne).not.toContain(fr(formatCurrency(SOMME_DES_RESEAUX)))
  })
})

describe('TC-242 — ce que le bouton autorise', () => {
  /**
   * Le montant tient dans la somme des réseaux et dans le reste dû, mais pas
   * dans la caisse que le serveur va débiter. C'est précisément le clic que
   * l'ancien plafond laissait passer.
   */
  it('[TC-242-2] un montant supérieur à la part du réseau est refusé AVANT l’envoi', () => {
    ouvrirEnEspeces()
    saisir(3_000_000)

    expect(screen.getByTestId('retour-reserve-insuffisante')).toBeInTheDocument()
    expect(screen.getByTestId('confirmer-retour')).toBeDisabled()

    fireEvent.submit(screen.getByTestId('formulaire-retour'))
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  it('[TC-242-3] un montant qui tient dans cette part passe', () => {
    ouvrirEnEspeces()
    saisir(LIQUIDITE_DU_RESEAU)

    expect(screen.queryByTestId('retour-reserve-insuffisante')).not.toBeInTheDocument()
    expect(screen.getByTestId('confirmer-retour')).toBeEnabled()
  })

  /** Le message nomme le chiffre qui bloque — sinon il reste incompréhensible. */
  it('[TC-242-4] et le refus cite la part du réseau, pas la somme', () => {
    ouvrirEnEspeces()
    saisir(3_000_000)

    const message = fr(screen.getByTestId('retour-reserve-insuffisante').textContent)
    expect(message).toContain(fr(formatCurrency(LIQUIDITE_DU_RESEAU)))
    expect(message).not.toContain(fr(formatCurrency(SOMME_DES_RESEAUX)))
  })
})

describe('TC-242 — le stock, lui, n’a pas changé de source', () => {
  it('[TC-242-5] la réserve « Stock » reste lue réseau par réseau', () => {
    render(<RavitaillementPanel open onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('retour-rav-1'))

    // « Stock » est la réserve d'origine de la livraison : rien à cliquer.
    expect(fr(screen.getByTestId('retour-disponible').textContent))
      .toContain(fr(formatCurrency(5_000_000)))
  })
})
