/**
 * TC-125 — Le sous-onglet Collaborations, et la page à trois modes.
 *
 * Deux choses s'y jouent, et la seconde est celle qui casse en silence :
 *
 *   • LE SENS DÉCIDE DE L'ACTION. Une demande que J'AI émise n'est pas la mienne
 *     à exécuter. Le statut seul ne suffit pas à le savoir : les deux files
 *     contiennent des lignes `pending`, et seule celle des reçues doit offrir
 *     « Exécuter ».
 *
 *   • LE MODE VIT DANS L'URL. Il vivait dans l'état local — inatteignable de
 *     l'extérieur. Or le compteur de la barre doit pouvoir DÉPOSER le gérant sur
 *     la file des reçues. Un état local ne s'adresse pas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const srv = vi.hoisted(() => ({
  outgoing: [],
  incoming: [],
  dernierAbonnement: null,
  options: null,
  listStoreCollaborationProviders: vi.fn(),
  createStoreCollaboration: vi.fn(),
  confirmStoreCollaboration: vi.fn(),
  rejectStoreCollaboration: vi.fn(),
}))

vi.mock('../../src/services/collaborationService', () => ({
  subscribeOutgoingCollaborations: (options) => {
    srv.dernierAbonnement = 'outgoing'
    srv.options = options
    options.onUpdate(srv.outgoing)
    return () => {}
  },
  subscribeIncomingCollaborations: (options) => {
    srv.dernierAbonnement = 'incoming'
    srv.options = options
    options.onUpdate(srv.incoming)
    return () => {}
  },
  listStoreCollaborationProviders: srv.listStoreCollaborationProviders,
  createStoreCollaboration: srv.createStoreCollaboration,
  confirmStoreCollaboration: srv.confirmStoreCollaboration,
  rejectStoreCollaboration: srv.rejectStoreCollaboration,
}))

import CollaborationsPanel from '../../src/components/transactions/CollaborationsPanel.jsx'

const horodatage = { seconds: 1_700_000_000, nanoseconds: 0 }

const collab = (id, extra = {}) => ({
  id,
  operationType: 'withdrawal',
  amount: 75_000,
  status: 'pending',
  requestingStoreId: 'store-a',
  requestingStoreName: 'Gounghin',
  supplierStoreId: 'store-b',
  supplierStoreName: 'Zogona',
  createdAt: horodatage,
  ...extra,
})

const poser = (props = {}) =>
  render(
    <MemoryRouter>
      <CollaborationsPanel storeId="store-a" {...props} />
    </MemoryRouter>,
  )

beforeEach(() => {
  srv.outgoing = []
  srv.incoming = []
  srv.dernierAbonnement = null
  srv.options = null
  srv.listStoreCollaborationProviders.mockReset()
  srv.listStoreCollaborationProviders.mockResolvedValue([
    { storeId: 'store-b', storeName: 'Zogona' },
    { storeId: 'store-c', storeName: 'Patte d’Oie' },
  ])
  for (const cle of ['createStoreCollaboration', 'confirmStoreCollaboration', 'rejectStoreCollaboration']) {
    srv[cle].mockReset()
    srv[cle].mockResolvedValue({ success: true })
  }
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-125-A — les deux sens', () => {
  it('[CP-01] par défaut, on regarde SES demandes', () => {
    poser()
    expect(srv.dernierAbonnement).toBe('outgoing')
  })

  it('[CP-02] le sous-onglet demandé change la REQUÊTE, pas un filtre après coup', () => {
    // `limit()` s'exécute côté serveur avant tout filtrage client : filtrer
    // ensuite ferait disparaître des lignes jamais chargées.
    poser({ sousOnglet: 'incoming' })
    expect(srv.dernierAbonnement).toBe('incoming')
  })

  it('[CP-03] cliquer un sous-onglet remonte le choix, il ne le garde pas', () => {
    // C'est l'URL qui décide — le composant ne détient pas cet état.
    const onChangeSousOnglet = vi.fn()
    poser({ onChangeSousOnglet })
    fireEvent.click(screen.getByTestId('sous-onglet-incoming'))
    expect(onChangeSousOnglet).toHaveBeenCalledWith('incoming')
  })

  it('[CP-04] le sous-onglet actif s’annonce comme tel', () => {
    poser({ sousOnglet: 'incoming' })
    expect(screen.getByTestId('sous-onglet-incoming')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('sous-onglet-outgoing')).toHaveAttribute('aria-selected', 'false')
  })

  it('[CP-05] le compteur ne se pose que sur « Reçues »', () => {
    poser({ compteurRecues: 3 })
    const badge = screen.getByTestId('badge-recues')
    expect(badge).toHaveTextContent('3')
    expect(screen.getByTestId('sous-onglet-incoming')).toContainElement(badge)
  })

  it('[CP-06] sans attente, aucun compteur', () => {
    poser({ compteurRecues: 0 })
    expect(screen.queryByTestId('badge-recues')).not.toBeInTheDocument()
  })
})

describe('TC-125-B — le sens décide de l’action', () => {
  it('[CP-07] une demande que J’AI émise ne s’exécute pas', () => {
    srv.outgoing = [collab('x1')]
    poser({ sousOnglet: 'outgoing' })
    expect(screen.queryByRole('button', { name: 'Exécuter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refuser' })).not.toBeInTheDocument()
  })

  it('[CP-08] une demande REÇUE, oui', () => {
    srv.incoming = [collab('x1')]
    poser({ sousOnglet: 'incoming' })
    expect(screen.getByRole('button', { name: 'Exécuter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeInTheDocument()
  })

  it('[CP-09] une demande déjà traitée n’offre plus rien', () => {
    srv.incoming = [collab('x1', { status: 'confirmed' })]
    poser({ sousOnglet: 'incoming' })
    expect(screen.queryByRole('button', { name: 'Exécuter' })).not.toBeInTheDocument()
  })

  it('[CP-10] chaque ligne nomme L’AUTRE boutique, selon le sens', () => {
    srv.outgoing = [collab('x1')]
    const { unmount } = poser({ sousOnglet: 'outgoing' })
    expect(screen.getByRole('list', { name: 'Mes demandes' })).toHaveTextContent('Zogona')
    unmount()

    srv.incoming = [collab('x2')]
    poser({ sousOnglet: 'incoming' })
    expect(screen.getByRole('list', { name: 'Demandes reçues' })).toHaveTextContent('Gounghin')
  })
})

describe('TC-125-C — exécuter et refuser', () => {
  it('[CP-11] exécuter passe par un dialogue qui dit ce que ça engage', () => {
    srv.incoming = [collab('x1')]
    poser({ sousOnglet: 'incoming' })
    fireEvent.click(screen.getByRole('button', { name: 'Exécuter' }))
    expect(screen.getByTestId('dialogue-execution')).toHaveTextContent(/stock sera débité/)
  })

  it('[CP-12] confirmé, il envoie l’identifiant de la collaboration', async () => {
    srv.incoming = [collab('x1')]
    poser({ sousOnglet: 'incoming' })
    fireEvent.click(screen.getByRole('button', { name: 'Exécuter' }))
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('dialogue-execution')).getByRole('button', { name: 'Exécuter' }))
    })
    expect(srv.confirmStoreCollaboration).toHaveBeenCalledWith({ collaborationId: 'x1' })
  })

  it('[CP-13] refuser exige un motif de 3 caractères au moins', () => {
    srv.incoming = [collab('x1')]
    poser({ sousOnglet: 'incoming' })
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }))
    const dlg = screen.getByTestId('dialogue-refus')
    expect(within(dlg).getByRole('button', { name: 'Refuser' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Plus de stock' } })
    expect(within(dlg).getByRole('button', { name: 'Refuser' })).toBeEnabled()
  })

  it('[CP-14] le refus transmet le motif', async () => {
    srv.incoming = [collab('x1')]
    poser({ sousOnglet: 'incoming' })
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }))
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Plus de stock' } })
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('dialogue-refus')).getByRole('button', { name: 'Refuser' }))
    })
    expect(srv.rejectStoreCollaboration).toHaveBeenCalledWith({
      collaborationId: 'x1', rejectionReason: 'Plus de stock',
    })
  })

  it('[CP-15] un échec garde le dialogue ouvert, avec son message', async () => {
    srv.incoming = [collab('x1')]
    srv.confirmStoreCollaboration.mockRejectedValue(
      new Error('Stock insuffisant pour exécuter cette collaboration.'),
    )
    poser({ sousOnglet: 'incoming' })
    fireEvent.click(screen.getByRole('button', { name: 'Exécuter' }))
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('dialogue-execution')).getByRole('button', { name: 'Exécuter' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Stock insuffisant')
    expect(screen.getByTestId('dialogue-execution')).toBeInTheDocument()
  })
})

describe('TC-125-D — demander à une consœur', () => {
  it('[CP-16] l’annuaire n’est demandé qu’à l’ouverture du dialogue', async () => {
    // Une liste de boutiques n'a pas à être réclamée à qui vient seulement
    // consulter ses propres demandes.
    poser()
    expect(srv.listStoreCollaborationProviders).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByTestId('ouvrir-creation')) })
    expect(srv.listStoreCollaborationProviders).toHaveBeenCalledTimes(1)
  })

  it('[CP-17] les boutiques proposées viennent du callable', async () => {
    poser()
    await act(async () => { fireEvent.click(screen.getByTestId('ouvrir-creation')) })
    const options = within(screen.getByLabelText('Boutique')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Zogona', 'Patte d’Oie'])
  })

  it('[CP-18] la demande part avec les quatre champs, et SANS réseau', async () => {
    // Le réseau est résolu par le serveur depuis le profil : l'accepter du
    // client permettrait de le lui dicter.
    poser()
    await act(async () => { fireEvent.click(screen.getByTestId('ouvrir-creation')) })
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'cli-42' } })
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '75000' } })
    fireEvent.change(screen.getByLabelText('Opération'), { target: { value: 'withdrawal' } })
    fireEvent.change(screen.getByLabelText('Boutique'), { target: { value: 'store-c' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' })) })

    expect(srv.createStoreCollaboration).toHaveBeenCalledWith({
      clientId: 'cli-42',
      operationType: 'withdrawal',
      amount: '75000',
      supplierStoreId: 'store-c',
    })
  })

  it('[CP-19] sans client ou sans montant, on n’envoie pas', async () => {
    poser()
    await act(async () => { fireEvent.click(screen.getByTestId('ouvrir-creation')) })
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '75000' } })
    expect(screen.getByRole('button', { name: 'Envoyer la demande' })).toBeDisabled()
  })

  it('[CP-20] un annuaire indisponible le dit, au lieu d’un menu vide', async () => {
    srv.listStoreCollaborationProviders.mockRejectedValue(new Error('Action réservée aux boutiques.'))
    poser()
    await act(async () => { fireEvent.click(screen.getByTestId('ouvrir-creation')) })
    expect(screen.getByRole('alert')).toHaveTextContent('Action réservée aux boutiques.')
  })
})

describe('TC-125-E — les états de la liste', () => {
  it('[CP-21] l’état vide dit quoi faire, selon le sens', () => {
    const { unmount } = poser({ sousOnglet: 'outgoing' })
    expect(screen.getByText('Aucune demande envoyée')).toBeInTheDocument()
    expect(screen.getByText(/À court de stock/)).toBeInTheDocument()
    unmount()

    poser({ sousOnglet: 'incoming' })
    expect(screen.getByText('Aucune demande reçue')).toBeInTheDocument()
  })

  it('[CP-22] sans boutique, on n’ouvre aucun abonnement', () => {
    poser({ storeId: null })
    expect(srv.dernierAbonnement).toBeNull()
  })

  it('[CP-23] une erreur DÉFINITIVE s’annonce comme une alerte', () => {
    // Les deux échecs ne demandent pas la même chose au gérant : l'un exige un
    // signalement, l'autre seulement de la patience. Le rôle ARIA doit faire la
    // différence, sinon un lecteur d'écran les rend identiques.
    poser()
    act(() => {
      srv.options.onError(Object.assign(new Error('Vous n’avez pas accès.'), { permanent: true }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Vous n’avez pas accès.')
  })

  it('[CP-24] une erreur PASSAGÈRE s’annonce comme un simple statut', () => {
    poser()
    act(() => {
      srv.options.onError(Object.assign(new Error('Connexion interrompue.'), { permanent: false }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('Connexion interrompue.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
