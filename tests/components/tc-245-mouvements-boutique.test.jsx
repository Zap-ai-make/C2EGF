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
 *   3. Une clôture lancée par erreur met les soldes à zéro et n'avait AUCUN
 *      recours : les deux commandes génériques la refusent, à bon droit.
 */

const cancelClosure = vi.fn()
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
  useTransactions: () => ({ completedTransactions: mouvements, cancelClosure }),
}))

import { ArchiveDealer } from '../../src/components/historique/HistoriqueArchives'

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
  cancelClosure.mockReset().mockResolvedValue(true)
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

    expect(screen.getByText('Aucun ravitaillement ni clôture')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Mouvements de la boutique' })).not.toBeInTheDocument()
  })
})

describe('TC-245 — le bouton d’annulation d’une clôture', () => {
  it('[TC-245-7] remplace le badge sur une clôture du jour', () => {
    mouvements = [cloture()]
    poser()

    expect(screen.getByTestId('annuler-cloture-clo-1')).toHaveTextContent('Annuler')
    expect(within(tableau()).queryByText('Validée')).not.toBeInTheDocument()
  })

  /**
   * ⚠ LE BOUTON NE S'AFFICHE QUE LÀ OÙ LE SERVEUR DIRA OUI.
   *   Les conditions sont celles de `cancelClosure`, dans le même ordre. Un
   *   bouton qui s'affiche là où le serveur refusera ne donne pas un choix au
   *   gérant, il lui donne une erreur.
   */
  it('[TC-245-8] disparaît sur une clôture d’un autre jour', () => {
    mouvements = [cloture({ createdAt: horodatage('2026-09-01T08:30:00Z') })]
    poser()

    expect(screen.queryByTestId('annuler-cloture-clo-1')).not.toBeInTheDocument()
    expect(within(tableau()).getByText('Validée')).toBeInTheDocument()
  })

  it('[TC-245-9] disparaît sur une clôture déjà annulée', () => {
    mouvements = [cloture({ statut: 'Annulée' })]
    poser()

    expect(screen.queryByTestId('annuler-cloture-clo-1')).not.toBeInTheDocument()
    expect(within(tableau()).getByText('Annulée')).toBeInTheDocument()
  })

  it('[TC-245-10] disparaît sur une clôture sans détail par réseau', () => {
    mouvements = [cloture({ soldes: undefined })]
    poser()

    expect(screen.queryByTestId('annuler-cloture-clo-1')).not.toBeInTheDocument()
  })

  /** Un ravitaillement se défait en rendant, pas en s'annulant. */
  it('[TC-245-11] n’apparaît jamais sur un ravitaillement', () => {
    mouvements = [ravitaillement()]
    poser()

    expect(screen.queryByTestId('annuler-cloture-rav-1')).not.toBeInTheDocument()
  })
})

describe('TC-245 — la confirmation', () => {
  it('[TC-245-12] dit ce qui reviendra, réseau par réseau', () => {
    mouvements = [cloture()]
    poser()
    fireEvent.click(screen.getByTestId('annuler-cloture-clo-1'))

    const dialogue = screen.getByTestId('confirmer-annulation-cloture')
    expect(fr(dialogue.textContent)).toContain('Orange')
    expect(fr(dialogue.textContent)).toContain('600 000')
    expect(fr(dialogue.textContent)).toContain('400 000')
  })

  it('[TC-245-13] n’annule rien tant qu’on n’a pas confirmé', () => {
    mouvements = [cloture()]
    poser()
    fireEvent.click(screen.getByTestId('annuler-cloture-clo-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Garder la clôture' }))

    expect(cancelClosure).not.toHaveBeenCalled()
  })

  it('[TC-245-14] la confirmation envoie la commande', async () => {
    mouvements = [cloture()]
    poser()
    fireEvent.click(screen.getByTestId('annuler-cloture-clo-1'))
    fireEvent.click(screen.getByTestId('confirmer-annuler-cloture'))

    await waitFor(() => expect(cancelClosure).toHaveBeenCalledWith('clo-1'))
  })

  /**
   * Le dialogue reste ouvert sur un refus : disparaître sans rien dire
   * laisserait croire que l'annulation a eu lieu, et le gérant repartirait
   * avec des soldes qu'il croit restaurés.
   */
  it('[TC-245-15] un refus du serveur se lit, et le dialogue reste', async () => {
    cancelClosure.mockRejectedValue(new Error('Seule une clôture du jour s’annule.'))
    mouvements = [cloture()]
    poser()
    fireEvent.click(screen.getByTestId('annuler-cloture-clo-1'))
    fireEvent.click(screen.getByTestId('confirmer-annuler-cloture'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Seule une clôture du jour')
    expect(screen.getByTestId('confirmer-annulation-cloture')).toBeInTheDocument()
  })
})
