/**
 * TC-124 — Les actions sur une dette.
 *
 * C'est le seul endroit de l'application d'où part une écriture sur une dette,
 * et trois décisions y sont plus coûteuses que les autres :
 *
 *   • LE ROUTAGE DE LA COMPENSATION. Une tranche de compensation vit dans la
 *     même sous-collection qu'un règlement ordinaire, mais elle impute DEUX
 *     dettes. La confirmer par le chemin des règlements n'en imputerait qu'une,
 *     et l'autre boutique resterait débitrice d'un montant déjà éteint. Le
 *     serveur refuse le croisement ; l'interface ne doit pas le tenter.
 *
 *   • LE PLAFOND DÉCLARABLE. Les tranches déjà déclarées réservent leur montant.
 *     Proposer le reste dû ferait échouer côté serveur une saisie que l'écran
 *     venait d'autoriser — l'utilisateur aurait raison de croire l'écran, et
 *     l'écran aurait tort.
 *
 *   • L'ÉCHEC GARDE LA SAISIE. Un dialogue qui se referme sur une erreur fait
 *     disparaître le montant tapé en même temps que le message qui l'explique.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'

const srv = vi.hoisted(() => ({
  tranches: [],
  declareInternalDebtSettlement: vi.fn(),
  confirmInternalDebtSettlement: vi.fn(),
  rejectInternalDebtSettlement: vi.fn(),
  declareInternalDebtCompensation: vi.fn(),
  confirmInternalDebtCompensation: vi.fn(),
  rejectInternalDebtCompensation: vi.fn(),
}))

vi.mock('../../src/services/collaborationService', () => ({
  subscribeDebtSettlements: ({ debtId, onUpdate }) => {
    onUpdate(srv.tranches.filter((t) => t.debtId === debtId))
    return () => {}
  },
  declareInternalDebtSettlement: srv.declareInternalDebtSettlement,
  confirmInternalDebtSettlement: srv.confirmInternalDebtSettlement,
  rejectInternalDebtSettlement: srv.rejectInternalDebtSettlement,
  declareInternalDebtCompensation: srv.declareInternalDebtCompensation,
  confirmInternalDebtCompensation: srv.confirmInternalDebtCompensation,
  rejectInternalDebtCompensation: srv.rejectInternalDebtCompensation,
}))

import PartnerDetails from '../../src/components/debts/PartnerDetails.jsx'
import { formatCurrency } from '../../src/utils/formatCurrency.js'

/**
 * ⚠ DEUX FORMES DU MÊME MONTANT, ET IL FAUT LA BONNE.
 *
 *   `Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine
 *   INSÉCABLE (U+202F). Testing Library normalise les blancs du texte RENDU,
 *   mais pas ceux de la chaîne attendue — une attente construite avec
 *   `formatCurrency` ne retrouve donc jamais son propre montant dans un
 *   `getByText` ou un `toHaveTextContent`.
 *
 *   `montantAffiche` applique la même normalisation que le matcher. À l'inverse,
 *   `toHaveAccessibleName` compare caractère par caractère et veut la sortie
 *   BRUTE de `formatCurrency` (cf. TC-121).
 */
const montantAffiche = (n) => formatCurrency(n).replace(/\s/g, ' ')

const horodatage = { seconds: 1_700_000_000, nanoseconds: 0 }

const dette = (id, remainingAmount, extra = {}) => ({
  id, remainingAmount, originalAmount: remainingAmount, settledAmount: 0,
  status: 'open', createdAt: horodatage, ...extra,
})

const tranche = (debtId, id, amount, method = 'especes', settlementStatus = 'declared') => ({
  debtId, id, amount, method, settlementStatus, declaredAt: horodatage,
})

const partenaire = ({ debts = [], credits = [] } = {}) => ({
  storeId: 'gounghin',
  name: 'Gounghin',
  debts,
  credits,
  debt: debts.reduce((s, d) => s + d.remainingAmount, 0),
  credit: credits.reduce((s, c) => s + c.remainingAmount, 0),
  net: credits.reduce((s, c) => s + c.remainingAmount, 0) - debts.reduce((s, d) => s + d.remainingAmount, 0),
  compensable: Math.min(
    debts.reduce((s, d) => s + d.remainingAmount, 0),
    credits.reduce((s, c) => s + c.remainingAmount, 0),
  ),
})

const poser = (p) => render(<PartnerDetails partner={p} />)

const saisirMontant = (valeur) =>
  fireEvent.change(screen.getByLabelText('Montant'), { target: { value: valeur } })

beforeEach(() => {
  srv.tranches = []
  for (const cle of Object.keys(srv)) {
    if (typeof srv[cle]?.mockReset === 'function') {
      srv[cle].mockReset()
      srv[cle].mockResolvedValue({ success: true })
    }
  }
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-124-A — qui peut faire quoi', () => {
  it('[AC-01] « Rembourser » n’existe que sur MES dettes', () => {
    poser(partenaire({ debts: [dette('d1', 180_000)], credits: [dette('c1', 45_000)] }))
    expect(screen.getAllByRole('button', { name: 'Rembourser' })).toHaveLength(1)
  })

  it('[AC-02] une dette soldée ne propose plus de remboursement', () => {
    poser(partenaire({ debts: [dette('d1', 0, { status: 'settled', settledAmount: 50_000, originalAmount: 50_000 })] }))
    expect(screen.queryByRole('button', { name: 'Rembourser' })).not.toBeInTheDocument()
  })

  it('[AC-03] les tranches de MA dette ne sont pas actionnables : ce n’est pas moi qui confirme', () => {
    srv.tranches = [tranche('d1', 's1', 50_000)]
    poser(partenaire({ debts: [dette('d1', 180_000)] }))
    expect(screen.queryByRole('button', { name: 'Confirmer' })).not.toBeInTheDocument()
  })

  it('[AC-04] les tranches d’une CRÉANCE le sont : c’est moi qu’on attend', () => {
    srv.tranches = [tranche('c1', 's1', 50_000)]
    poser(partenaire({ credits: [dette('c1', 180_000)] }))
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeInTheDocument()
  })

  it('[AC-05] une tranche déjà confirmée n’offre plus d’action', () => {
    srv.tranches = [tranche('c1', 's1', 50_000, 'especes', 'confirmed')]
    poser(partenaire({ credits: [dette('c1', 180_000)] }))
    expect(screen.queryByRole('button', { name: 'Confirmer' })).not.toBeInTheDocument()
  })
})

describe('TC-124-B — le plafond déclarable', () => {
  it('[AC-06] les tranches déjà déclarées réservent leur montant', () => {
    srv.tranches = [tranche('d1', 's1', 40_000)]
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    expect(screen.getByTestId('dialogue-declaration')).toHaveTextContent(
      `Jusqu’à ${montantAffiche(60_000)}`,
    )
  })

  it('[AC-07] la réserve est annoncée sur la ligne, pas seulement dans le dialogue', () => {
    srv.tranches = [tranche('d1', 's1', 40_000)]
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    expect(screen.getByText(`dont ${montantAffiche(40_000)} en attente de confirmation`))
      .toBeInTheDocument()
  })

  it('[AC-08] tout étant déjà déclaré, le bouton est désactivé et dit pourquoi', () => {
    srv.tranches = [tranche('d1', 's1', 100_000)]
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    const bouton = screen.getByRole('button', { name: 'Rembourser' })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute('title', 'Tout le reste dû est déjà déclaré')
  })

  it('[AC-09] un montant au-dessus du plafond est refusé AVANT le réseau', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('150000')
    expect(screen.getByText(`Le maximum est ${montantAffiche(100_000)}.`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Déclarer' })).toBeDisabled()
    expect(srv.declareInternalDebtSettlement).not.toHaveBeenCalled()
  })

  it('[AC-10] un montant non entier est refusé, avec ce qui bloque', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('12,50')
    expect(screen.getByText('Entrez un montant entier, supérieur à zéro.')).toBeInTheDocument()
  })

  it('[AC-11] un champ vide ne crie pas avant qu’on ait tapé', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    expect(screen.queryByText('Entrez un montant entier, supérieur à zéro.')).not.toBeInTheDocument()
  })
})

describe('TC-124-C — la déclaration part bien', () => {
  it('[AC-12] le remboursement envoie la dette, le montant BRUT et la méthode', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('40000')
    fireEvent.change(screen.getByLabelText('Méthode'), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Déclarer' }))

    expect(srv.declareInternalDebtSettlement).toHaveBeenCalledWith({
      debtId: 'd1',
      amount: '40000',
      method: 'Cash',
    })
  })

  it('[AC-13] « Banque » est proposée, en plus des méthodes du profil', () => {
    // Une dette peut se solder par virement bancaire, une transaction client non.
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    const options = within(screen.getByLabelText('Méthode')).getAllByRole('option')
    expect(options.map((o) => o.value)).toContain('Banque')
  })
})

describe('TC-124-D — la compensation', () => {
  it('[AC-14] elle n’est proposée que si les deux bras existent', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    expect(screen.queryByTestId('ouvrir-compensation')).not.toBeInTheDocument()
  })

  it('[AC-15] avec une paire opposée, elle annonce le montant éteignable', () => {
    poser(partenaire({ debts: [dette('d1', 180_000)], credits: [dette('c1', 45_000)] }))
    expect(screen.getByTestId('ouvrir-compensation')).toBeInTheDocument()
    expect(screen.getByText(/vous vous devez mutuellement/)).toHaveTextContent(
      montantAffiche(45_000),
    )
  })

  it('[AC-16] elle envoie LES DEUX dettes', () => {
    poser(partenaire({ debts: [dette('d1', 180_000)], credits: [dette('c1', 45_000)] }))
    fireEvent.click(screen.getByTestId('ouvrir-compensation'))
    saisirMontant('45000')
    fireEvent.click(screen.getByRole('button', { name: 'Déclarer' }))

    expect(srv.declareInternalDebtCompensation).toHaveBeenCalledWith({
      debtId: 'd1',
      oppositeDebtId: 'c1',
      amount: '45000',
    })
  })

  it('[AC-17] elle plafonne au compensable, pas au reste dû', () => {
    poser(partenaire({ debts: [dette('d1', 180_000)], credits: [dette('c1', 45_000)] }))
    fireEvent.click(screen.getByTestId('ouvrir-compensation'))
    saisirMontant('100000')
    expect(screen.getByText(`Le maximum est ${montantAffiche(45_000)}.`)).toBeInTheDocument()
  })

  it('[AC-18] elle ne demande PAS de méthode : ce n’est pas un paiement', () => {
    poser(partenaire({ debts: [dette('d1', 180_000)], credits: [dette('c1', 45_000)] }))
    fireEvent.click(screen.getByTestId('ouvrir-compensation'))
    expect(screen.queryByLabelText('Méthode')).not.toBeInTheDocument()
  })
})

describe('TC-124-E — le routage : deux guichets, pas un', () => {
  it('[AC-19] confirmer un RÈGLEMENT passe par le guichet des règlements', () => {
    srv.tranches = [tranche('c1', 's1', 40_000, 'especes')]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    fireEvent.click(within(screen.getByTestId('dialogue-confirmation')).getByRole('button', { name: 'Confirmer' }))

    expect(srv.confirmInternalDebtSettlement).toHaveBeenCalledWith({ debtId: 'c1', settlementId: 's1' })
    expect(srv.confirmInternalDebtCompensation).not.toHaveBeenCalled()
  })

  it('[AC-20] confirmer une COMPENSATION passe par l’autre', () => {
    // Le croisement imputerait une seule des deux dettes : l'autre boutique
    // resterait débitrice d'un montant déjà éteint.
    srv.tranches = [tranche('c1', 's1', 45_000, 'compensation')]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    fireEvent.click(within(screen.getByTestId('dialogue-confirmation')).getByRole('button', { name: 'Confirmer' }))

    expect(srv.confirmInternalDebtCompensation).toHaveBeenCalledWith({ debtId: 'c1', settlementId: 's1' })
    expect(srv.confirmInternalDebtSettlement).not.toHaveBeenCalled()
  })

  it('[AC-21] le dialogue de confirmation dit lequel des deux il engage', () => {
    srv.tranches = [tranche('c1', 's1', 45_000, 'compensation')]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    const dlg = screen.getByTestId('dialogue-confirmation')
    expect(dlg).toHaveAccessibleName('Confirmer la compensation')
    expect(dlg).toHaveTextContent('Les deux dettes seront réduites')
  })

  it('[AC-22] le rejet suit le même aiguillage', () => {
    srv.tranches = [tranche('c1', 's1', 45_000, 'compensation')]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Montant erroné' } })
    fireEvent.click(within(screen.getByTestId('dialogue-rejet')).getByRole('button', { name: 'Rejeter' }))

    expect(srv.rejectInternalDebtCompensation).toHaveBeenCalledWith({
      debtId: 'c1', settlementId: 's1', rejectionReason: 'Montant erroné',
    })
    expect(srv.rejectInternalDebtSettlement).not.toHaveBeenCalled()
  })
})

describe('TC-124-F — le motif de rejet', () => {
  it('[AC-23] moins de 3 caractères ne part pas', () => {
    srv.tranches = [tranche('c1', 's1', 40_000)]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'ab' } })
    expect(within(screen.getByTestId('dialogue-rejet')).getByRole('button', { name: 'Rejeter' })).toBeDisabled()
  })

  it('[AC-24] plus de 500 non plus', () => {
    srv.tranches = [tranche('c1', 's1', 40_000)]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'x'.repeat(501) } })
    expect(within(screen.getByTestId('dialogue-rejet')).getByRole('button', { name: 'Rejeter' })).toBeDisabled()
  })

  it('[AC-25] des espaces seules ne comptent pas pour un motif', () => {
    srv.tranches = [tranche('c1', 's1', 40_000)]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: '      ' } })
    expect(within(screen.getByTestId('dialogue-rejet')).getByRole('button', { name: 'Rejeter' })).toBeDisabled()
  })

  it('[AC-26] l’écran prévient que le motif sera lu par l’autre boutique', () => {
    srv.tranches = [tranche('c1', 's1', 40_000)]
    poser(partenaire({ credits: [dette('c1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    expect(screen.getByText(/lira ce motif/)).toBeInTheDocument()
  })
})

describe('TC-124-G — quand ça échoue', () => {
  it('[AC-27] le dialogue reste ouvert, avec la saisie et le message', async () => {
    // Refermer ferait disparaître le montant tapé en même temps que
    // l'explication de l'échec.
    srv.declareInternalDebtSettlement.mockRejectedValue(
      Object.assign(new Error('Le montant dépasse le reste dû.'), { code: 'SETTLEMENT_EXCEEDS_REMAINING' }),
    )
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('40000')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Déclarer' })) })

    expect(screen.getByTestId('dialogue-declaration')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Le montant dépasse le reste dû.')
    expect(screen.getByLabelText('Montant')).toHaveValue('40000')
  })

  it('[AC-28] le succès referme le dialogue', async () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('40000')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Déclarer' })) })
    expect(screen.queryByTestId('dialogue-declaration')).not.toBeInTheDocument()
  })

  it('[AC-29] « Annuler » n’envoie rien', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('40000')
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(srv.declareInternalDebtSettlement).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dialogue-declaration')).not.toBeInTheDocument()
  })

  it('[AC-30] rouvrir repart d’une saisie vide, jamais de la précédente', () => {
    poser(partenaire({ debts: [dette('d1', 100_000)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    saisirMontant('40000')
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rembourser' }))
    expect(screen.getByLabelText('Montant')).toHaveValue('')
  })
})
