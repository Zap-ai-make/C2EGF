import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()
let historique = []
// Les réserves réelles de la boutique. Larges par défaut : la plupart des tests
// portent sur le reste dû, et un disponible étroit les ferait échouer pour une
// raison qui n'est pas la leur.
let soldes = { stock: 999_000_000, liquidite: 999_000_000 }

vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../src/services/storeTransactionCommandService', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ completedTransactions: historique }),
}))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({
    getStock: () => soldes.stock,
    // Le panneau lit la liquidite DU RESEAU debite, pas la somme des reseaux.
    getNetworkLiquidite: () => soldes.liquidite,
  }),
}))

import RavitaillementPanel from '../../src/components/transactions/RavitaillementPanel.jsx'
import { formatCurrency } from '../../src/utils/formatCurrency'

/**
 * Le formatage FR sépare les milliers par une espace fine insécable (U+202F),
 * que Testing Library aplatit en espace ordinaire du côté du DOM mais pas du
 * côté attendu. On aplatit donc l'attendu aussi — la propriété testée est le
 * MONTANT, pas le caractère qu'Intl choisit pour le découper.
 */
const fr = (valeur) => String(valeur).replace(/\s/g, ' ')

/**
 * TC-229 — Le panneau de ravitaillement (S8).
 *
 * CE QU'IL DOIT MONTRER, ET POURQUOI C'EST CELUI-LÀ
 * ────────────────────────────────────────────────
 * La boutique reçoit du stock de plusieurs personnes dans la journée et doit
 * rendre à CHACUNE ce qu'elle a reçu d'elle. L'écran sert donc d'abord à
 * montrer **des dettes séparées** : on ne solde pas une livraison de l'un avec
 * ce qu'on doit à l'autre, et c'est le total de SA colonne qui règle avec
 * quelqu'un.
 *
 * Le total général s'y ajoute en tête, et répond à une autre question — « que
 * doit la boutique en tout ? » — qu'on se pose en fermant. Il informe, il ne
 * solde personne ; les tests gardent les deux distincts.
 *
 * Et il doit TAIRE les livraisons d'avant S8, dont le reste dû est
 * inconnaissable : les afficher comme entièrement dues ferait dire au logiciel
 * que la boutique doit tout.
 */

const rav = (over = {}) => ({
  id: 'rav-1',
  type: 'Ravitaillement',
  expediteur: 'Patron',
  montant: 100_000,
  returnedAmount: 0,
  remainingAmount: 100_000,
  balanceType: 'stock',
  date: '08/10/2026 08:00',
  createdAt: new Date('2026-10-08T08:00:00Z'),
  ...over,
})

const afficher = () => render(<RavitaillementPanel open onClose={() => {}} />)

beforeEach(() => {
  runStoreTransactionCommand.mockReset().mockResolvedValue({ id: 'ret-1', remainingAmount: 0 })
  showToast.mockReset()
  historique = []
  soldes = { stock: 999_000_000, liquidite: 999_000_000 }
})

describe('TC-229 — la liste', () => {
  it('[TC-229-1] annonce qu’il n’y a rien à rendre quand c’est le cas', () => {
    afficher()
    expect(screen.getByText(/Rien à rendre/i)).toBeInTheDocument()
  })

  it('[TC-229-2] groupe par expéditeur et totalise ce qui est dû à chacun', () => {
    historique = [
      rav({ id: 'a', expediteur: 'Patron', remainingAmount: 100_000 }),
      rav({ id: 'b', expediteur: 'Mme Sawadogo', remainingAmount: 70_000 }),
      rav({ id: 'c', expediteur: 'Patron', remainingAmount: 20_000 }),
    ]
    afficher()

    const patron = within(screen.getByTestId('groupe-Patron'))
    expect(patron.getByText('120 000 FCFA')).toBeInTheDocument()
    expect(patron.getByTestId('ravitaillement-a')).toBeInTheDocument()
    expect(patron.getByTestId('ravitaillement-c')).toBeInTheDocument()

    expect(within(screen.getByTestId('groupe-Mme Sawadogo')).getByText('70 000 FCFA')).toBeInTheDocument()
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LA PRODUCTION.
   *   Les livraisons déjà en base n'ont ni expéditeur ni reste dû. Les montrer
   *   reviendrait à réclamer un montant que la boutique a peut-être déjà remis.
   */
  it('[TC-229-3] tait les livraisons d’avant le suivi, et les soldées', () => {
    const ancienne = rav({ id: 'vieille' })
    delete ancienne.remainingAmount
    delete ancienne.expediteur
    historique = [ancienne, rav({ id: 'soldee', remainingAmount: 0 }), rav({ id: 'due' })]
    afficher()

    expect(screen.getByTestId('ravitaillement-due')).toBeInTheDocument()
    expect(screen.queryByTestId('ravitaillement-vieille')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ravitaillement-soldee')).not.toBeInTheDocument()
  })

  it('[TC-229-4] affiche ce qui a déjà été rendu et ce qui reste', () => {
    historique = [rav({ montant: 100_000, returnedAmount: 30_000, remainingAmount: 70_000 })]
    afficher()

    const ligne = within(screen.getByTestId('ravitaillement-rav-1'))
    expect(ligne.getByText(/rendu 30 000 FCFA/)).toBeInTheDocument()
    expect(ligne.getByText(/reste 70 000 FCFA/)).toBeInTheDocument()
  })

  it('[TC-229-5] mène à la saisie d’une nouvelle livraison', () => {
    afficher()
    fireEvent.click(screen.getByTestId('nouveau-ravitaillement'))
    expect(screen.getByLabelText('Montant (FCFA)')).toBeInTheDocument()
  })

  /**
   * Le total général ne sert à solder PERSONNE — on rend à chacun sa colonne —
   * mais c'est le chiffre qu'on cherche en fermant, et il ne s'additionne pas
   * de tête sur cinq groupes.
   */
  it('[TC-229-12] totalise tout ce qui est dû, tous expéditeurs confondus', () => {
    historique = [
      rav({ id: 'a', expediteur: 'Patron', remainingAmount: 1_000_000 }),
      rav({ id: 'b', expediteur: 'Mme Sawadogo', remainingAmount: 500_000 }),
      rav({ id: 'c', expediteur: 'Patron', remainingAmount: 250_000 }),
    ]
    afficher()

    const total = within(screen.getByTestId('total-ravitaillements'))
    expect(total.getByText(fr(formatCurrency(1_750_000)))).toBeInTheDocument()
    expect(total.getByText('3 livraisons à rendre')).toBeInTheDocument()
  })

  it('[TC-229-13] ne compte dans ce total que ce qui est réellement dû', () => {
    const ancienne = rav({ id: 'vieille', remainingAmount: 9_000_000 })
    delete ancienne.remainingAmount
    historique = [
      rav({ id: 'due', remainingAmount: 300_000 }),
      rav({ id: 'soldee', remainingAmount: 0 }),
      ancienne,
    ]
    afficher()

    const total = within(screen.getByTestId('total-ravitaillements'))
    expect(total.getByText(fr(formatCurrency(300_000)))).toBeInTheDocument()
    expect(total.getByText('1 livraison à rendre')).toBeInTheDocument()
  })

  it('[TC-229-14] ne montre aucun total quand il n’y a rien à rendre', () => {
    afficher()
    expect(screen.queryByTestId('total-ravitaillements')).not.toBeInTheDocument()
  })
})

describe('TC-229 — le retour', () => {
  it('[TC-229-6] s’ouvre sur la livraison choisie, avec son reste dû', () => {
    historique = [rav({ expediteur: 'Mme Sawadogo', remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))

    const formulaire = within(screen.getByTestId('formulaire-retour'))
    expect(formulaire.getByText('Mme Sawadogo')).toBeInTheDocument()
    expect(formulaire.getByText('70 000 FCFA')).toBeInTheDocument()
  })

  it('[TC-229-7] envoie le montant et la réserve choisis', async () => {
    historique = [rav({ remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '40000' } })
    fireEvent.click(screen.getByRole('radio', { name: /Espèce/ }))
    fireEvent.click(screen.getByTestId('confirmer-retour'))

    await waitFor(() => expect(runStoreTransactionCommand).toHaveBeenCalledWith({
      action: 'returnReplenishment',
      replenishmentId: 'rav-1',
      amount: 40_000,
      balanceType: 'liquidite',
    }))
  })

  /**
   * Le serveur refuse déjà un montant supérieur au reste dû. On le refuse AUSSI
   * ici pour que la caissière le voie AVANT le clic, avec le chiffre — un
   * aller-retour pour apprendre qu'on a tapé un zéro de trop est un
   * aller-retour de trop.
   */
  it('[TC-229-8] refuse un montant supérieur au reste dû, avant l’envoi', () => {
    historique = [rav({ remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '80000' } })

    expect(screen.getByTestId('confirmer-retour')).toBeDisabled()
    expect(screen.getByText(/Supérieur au reste dû/)).toBeInTheDocument()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  it('[TC-229-9] propose par défaut la réserve reçue', () => {
    historique = [rav({ balanceType: 'liquidite' })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))

    expect(screen.getByRole('radio', { name: /Espèce/ })).toBeChecked()
  })

  it('[TC-229-10] garde le formulaire ouvert et montre le refus du serveur', async () => {
    runStoreTransactionCommand.mockRejectedValue(new Error('Stock insuffisant pour Orange. Disponible: 12 000 FCFA'))
    historique = [rav()]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '50000' } })
    fireEvent.click(screen.getByTestId('confirmer-retour'))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Stock insuffisant pour Orange. Disponible: 12 000 FCFA', 'error',
    ))
    expect(screen.getByTestId('formulaire-retour')).toBeInTheDocument()
  })

  it('[TC-229-11] revient à la liste une fois le retour enregistré', async () => {
    historique = [rav()]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '10000' } })
    fireEvent.click(screen.getByTestId('confirmer-retour'))

    await waitFor(() => expect(screen.getByTestId('nouveau-ravitaillement')).toBeInTheDocument())
  })
})

/**
 * TC-229 — LE DISPONIBLE, ET POURQUOI IL EST SÉPARÉ DU RESTE DÛ.
 *
 * Deux plafonds bornent un retour, et ils ne disent pas la même chose :
 *
 *   — le RESTE DÛ est ce que la boutique devrait rendre ;
 *   — le DISPONIBLE est ce qu'elle peut rendre.
 *
 * Ils divergent dès que le stock reçu le matin est parti en dépôts dans la
 * journée : on doit encore un million, il n'en reste que deux cent mille. Les
 * confondre dans un seul « montant invalide » rendrait les deux situations
 * indiscernables — alors qu'elles se corrigent autrement : l'une en rendant
 * moins, l'autre en rendant dans l'AUTRE réserve.
 */
describe('TC-229 — le disponible', () => {
  it('[TC-229-15] montre ce que contient la réserve proposée', () => {
    soldes = { stock: 1_240_000, liquidite: 80_000 }
    historique = [rav({ balanceType: 'stock' })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))

    expect(screen.getByTestId('retour-disponible')).toHaveTextContent(fr(formatCurrency(1_240_000)))
  })

  it('[TC-229-16] suit la réserve : basculer change le chiffre', () => {
    soldes = { stock: 1_240_000, liquidite: 80_000 }
    historique = [rav({ balanceType: 'stock' })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.click(screen.getByRole('radio', { name: /Espèce/ }))

    expect(screen.getByTestId('retour-disponible')).toHaveTextContent(fr(formatCurrency(80_000)))
  })

  it('[TC-229-17] refuse un montant que la réserve ne couvre pas', () => {
    soldes = { stock: 20_000, liquidite: 999_000 }
    historique = [rav({ balanceType: 'stock', remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '50000' } })

    expect(screen.getByTestId('confirmer-retour')).toBeDisabled()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI JUSTIFIE DEUX MESSAGES PLUTÔT QU'UN.
   *   Ici 50 000 est SOUS le reste dû (70 000) et AU-DESSUS du stock (20 000).
   *   Dire « supérieur au reste dû » serait faux ; dire « montant invalide »
   *   n'apprendrait pas que l'autre réserve, elle, suffirait.
   */
  it('[TC-229-18] nomme la réserve qui manque, pas le reste dû', () => {
    soldes = { stock: 20_000, liquidite: 999_000 }
    historique = [rav({ balanceType: 'stock', remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '50000' } })

    expect(screen.getByTestId('retour-reserve-insuffisante'))
      .toHaveTextContent(fr(`Stock insuffisant. Disponible : ${formatCurrency(20_000)}.`))
    expect(screen.queryByText(/Supérieur au reste dû/)).not.toBeInTheDocument()
  })

  it('[TC-229-19] laisse passer ce que la réserve couvre', async () => {
    soldes = { stock: 60_000, liquidite: 0 }
    historique = [rav({ balanceType: 'stock', remainingAmount: 70_000 })]
    afficher()
    fireEvent.click(screen.getByTestId('retour-rav-1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '60000' } })
    fireEvent.click(screen.getByTestId('confirmer-retour'))

    await waitFor(() => expect(runStoreTransactionCommand).toHaveBeenCalledWith({
      action: 'returnReplenishment',
      replenishmentId: 'rav-1',
      amount: 60_000,
      balanceType: 'stock',
    }))
  })
})
