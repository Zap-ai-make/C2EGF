import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/**
 * TC-245 — L'onglet Ravitaillement : un tableau, une heure juste, un recours.
 *
 * TROIS DÉFAUTS QUI TENAIENT DANS UNE SEULE LIGNE DE LISTE
 * ───────────────────────────────────────────────────────
 *   1. ⚠ LA DATE ÉTAIT FAUSSE, et pas seulement l'heure. Le serveur écrit
 *      `date` SANS heure — « 09/10/2026 » — et l'écran la relisait avec
 *      `new Date()`, qui lit une date française à l'américaine : le jour et le
 *      mois s'échangeaient. Une ligne du 9 octobre s'affichait « 10/09/2026 »,
 *      et son heure valait minuit pour tout le monde.
 *   2. Une liste met chaque ligne sur son propre rythme ; ces lignes-là
 *      s'empilent par dizaines et se lisent en colonnes.
 *   3. Une clôture lancée par erreur n'avait aucun recours. « Vider les
 *      soldes » est retiré depuis (31 octobre 2026, TC-218, TC-318) : les
 *      clôtures d'avant se lisent ici, sans action.
 */

const trashTransaction = vi.fn()
let mouvements = []

vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: () => () => {},
}))
vi.mock('../../src/services/resilientOnSnapshot', () => ({
  safeUnsubscribe: (stop) => stop,
}))
vi.mock('../../src/services/collaborationService', () => ({
  subscribeOutgoingCollaborations: () => () => {},
  subscribeIncomingCollaborations: () => () => {},
  subscribeMyDebts: () => () => {},
  subscribeMyCredits: () => () => {},
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ completedTransactions: mouvements, trashTransaction }),
}))

import { renderHook } from '@testing-library/react'
import { ArchiveDealer } from '../../src/components/historique/HistoriqueArchives'
import { useHistoriqueFilters } from '../../src/hooks/useHistoriqueFilters.js'

/** Le formatage FR sépare les milliers d'une espace fine insécable (U+202F). */
const fr = (texte) => texte.replace(/\s/g, ' ')

/** Un horodatage Firestore, tel que l'abonnement le livre. */
const horodatage = (iso) => {
  const ms = new Date(iso).getTime()
  return { toDate: () => new Date(ms), toMillis: () => ms }
}

const AUJOURDHUI = new Date()
/** Le même instant, mais à 08:30 — pour que l'heure affichée soit vérifiable. */
const ceMatin = () => {
  const d = new Date(AUJOURDHUI)
  d.setUTCHours(8, 30, 0, 0)
  return d.toISOString()
}

const cloture = (over = {}) => ({
  id: 'clo-1',
  type: 'Clôture',
  montant: 1_000_000,
  statut: 'Validée',
  soldes: [{ network: 'Orange', stock: 600_000, liquidite: 400_000 }],
  // La chaîne que le serveur écrit : une date FRANÇAISE, et sans heure.
  date: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Ouagadougou' }).format(AUJOURDHUI),
  createdAt: horodatage(ceMatin()),
  ...over,
})

const ravitaillement = (over = {}) => ({
  id: 'rav-1',
  type: 'Ravitaillement',
  montant: 5_000_000,
  statut: 'Validée',
  expediteur: 'Patron',
  createdAt: horodatage(ceMatin()),
  ...over,
})

const poser = () => render(<ArchiveDealer currentUser={{ uid: 'u1' }} userProfile={{ storeId: 'store-a' }} />)

const tableau = () => screen.getByRole('table', { name: 'Mouvements de la boutique' })

beforeEach(() => {
  trashTransaction.mockReset().mockResolvedValue(true)
  mouvements = []
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-245 — la date et l’heure', () => {
  /**
   * ⚠ LE DÉFAUT PRINCIPAL. Il ne se voyait qu'à moitié : l'utilisateur voyait
   *   « 00:00 » et signalait l'heure. Le jour et le mois étaient intervertis
   *   dans le même mouvement, ce qui est bien pire — et indétectable tant que
   *   le jour du mois reste inférieur à 13.
   */
  it('[TC-245-1] viennent de l’horodatage serveur, pas de la chaîne française', () => {
    mouvements = [cloture()]
    poser()

    const attendu = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Ouagadougou',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ceMatin()))

    expect(fr(within(tableau()).getByTestId('mouvement-clo-1').textContent)).toContain(fr(attendu))
  })

  it('[TC-245-2] et ce n’est jamais minuit pour tout le monde', () => {
    mouvements = [cloture()]
    poser()

    expect(within(tableau()).getByTestId('mouvement-clo-1').textContent).toContain('08:30')
  })
})

describe('TC-245 — un tableau, pas une liste', () => {
  it('[TC-245-3] porte ses colonnes en en-tête', () => {
    mouvements = [cloture()]
    poser()

    const entetes = Array.from(tableau().querySelectorAll('thead th')).map((th) => th.textContent.trim())
    expect(entetes).toEqual(['Date & heure', 'Type', 'Détail', 'Montant', 'Statut'])
  })

  it('[TC-245-4] une ligne par mouvement, dans l’ordre reçu', () => {
    mouvements = [cloture(), ravitaillement()]
    poser()

    const lignes = Array.from(tableau().querySelectorAll('tbody tr'))
    expect(lignes).toHaveLength(2)
    expect(lignes[0].textContent).toContain('Clôture')
    expect(lignes[1].textContent).toContain('Ravitaillement')
  })

  it('[TC-245-5] le détail d’un ravitaillement est son expéditeur', () => {
    mouvements = [ravitaillement()]
    poser()

    expect(within(tableau()).getByTestId('mouvement-rav-1').textContent).toContain('Patron')
  })

  it('[TC-245-6] sans mouvement, le tableau laisse place à un message', () => {
    poser()

    expect(screen.getByText('Aucun ravitaillement ni retour')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Mouvements de la boutique' })).not.toBeInTheDocument()
  })
})

describe('TC-245 — une ancienne clôture', () => {
  it('[TC-245-7] se lit avec son statut, et n’offre plus aucun bouton', () => {
    mouvements = [cloture(), cloture({ id: 'clo-2', statut: 'Annulée' })]
    poser()

    expect(within(tableau()).getByText('Validée')).toBeInTheDocument()
    expect(within(tableau()).getByText('Annulée')).toBeInTheDocument()
    expect(within(tableau()).queryByRole('button')).not.toBeInTheDocument()
  })
})

// « Les retours polluent l'historique des clients » (31 octobre 2026) : ils
// n'ont pas de client, et se lisent sous leur livraison, dans cet onglet.
describe('TC-245 — les retours, dans l’onglet Ravitaillement', () => {
  const retour = (over = {}) => ({
    id: 'ret-1',
    type: 'Retour',
    montant: 420_000,
    statut: 'Validée',
    expediteur: 'Patron',
    balanceType: 'liquidite',
    replenishmentId: 'rav-1',
    createdAt: horodatage(ceMatin()),
    ...over,
  })

  it('[TC-245-16] un retour est une ligne du tableau : qui, quelle réserve, et ce qui sort', () => {
    mouvements = [ravitaillement({ balanceType: 'stock' }), retour()]
    poser()

    const ligneRetour = within(tableau()).getByTestId('mouvement-ret-1')
    expect(ligneRetour.textContent).toContain('Retour')
    expect(ligneRetour.textContent).toContain('Patron · espèce')
    expect(fr(ligneRetour.textContent)).toContain('− 420 000 FCFA')
    expect(fr(within(tableau()).getByTestId('mouvement-rav-1').textContent)).toContain('+ 5 000 000 FCFA')
  })

  it('[TC-245-17] il n’est plus dans l’onglet des clients', () => {
    mouvements = [retour(), { id: 'dep-1', type: 'Dépôt', montant: 10_000, statut: 'Validée', date: '31/10/2026 09:00' }]
    const { result } = renderHook(() => useHistoriqueFilters())

    expect(result.current.filteredTransactions.map((t) => t.id)).toEqual(['dep-1'])
  })

  it('[TC-245-18] il s’annule d’ici, et la confirmation dit que la livraison redevient due', async () => {
    mouvements = [retour()]
    poser()
    fireEvent.click(screen.getByTestId('annuler-retour-ret-1'))

    const dialogue = screen.getByTestId('confirmer-annulation-retour')
    expect(dialogue.textContent).toContain('redeviendra due')
    expect(trashTransaction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirmer-annuler-retour'))
    await waitFor(() => expect(trashTransaction).toHaveBeenCalledWith('ret-1'))
  })

  it('[TC-245-19] un retour annulé est dans la corbeille, pas ici', () => {
    mouvements = [retour({ statut: 'Supprimée', deletedAt: new Date() })]
    poser()

    expect(screen.getByText('Aucun ravitaillement ni retour')).toBeInTheDocument()
  })
})
