import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-309 — La carte à confirmer, dans le panneau de l'assistant.
 *
 * Le modèle est simulé (simuler le SDK vérifierait le simulacre) : on lui fait
 * demander une préparation, et tout le reste est réel — les règles
 * (preparations.js), la carte, et l'appel que fait « Confirmer ».
 *
 * Ce qui est figé : rien ne part avant « Confirmer » ; ce qui part est ce que
 * l'écran aurait envoyé ; un refus du serveur laisse la carte ; une carte par
 * tour ; la question suivante l'efface.
 */

const SALIF = { id: 'c-1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '4544102', orange: '4544102' }
const EN_ATTENTE = {
  id: 'd-1',
  type: 'Dépôt',
  client: SALIF,
  clientId: 'c-1',
  code: '4544102',
  montant: 50000,
  statut: 'Non Terminées',
  createdAt: new Date('2026-10-30T09:00:00Z'),
}
const LIVRAISON = {
  id: 'r-1',
  type: 'Ravitaillement',
  expediteur: 'Patron',
  montant: 300000,
  remainingAmount: 300000,
  balanceType: 'stock',
}

let transactionsValue
let appelsDuModele
let reponsesAuModele

vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: () => ({
    currentUser: { email: 'caisse@c2egf.test' },
    userProfile: { role: 'member', storeId: 'b-1' },
    activeStore: { id: 'b-1', name: 'Gounghin' },
    isStoreAdmin: false,
  }),
}))
vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [SALIF] }) }))
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => transactionsValue }))
vi.mock('../../src/hooks/useNetworkCards.js', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => 500000,
    getLiquidite: () => 500000,
    getNetworkLiquidite: () => 500000,
    formatAmount: (n) => Number(n).toLocaleString('fr-FR'),
  }),
}))
const commande = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/storeTransactionCommandService', () => ({ runStoreTransactionCommand: commande }))

// Le modèle simulé : chaque question déroule les préparations qu'on lui a
// confiées, et garde ce que le panneau lui a répondu.
vi.mock('../../src/lib/ia/assistant.js', () => ({
  poserQuestion: vi.fn(async ({ surPreparation, surTexte }) => {
    for (const appel of appelsDuModele.shift() ?? []) reponsesAuModele.push(surPreparation(appel))
    surTexte('Je l’ai préparée : vérifiez puis confirmez.')
    return { ok: true, texte: '', historique: [] }
  }),
}))

import Assistant from '../../src/components/Assistant.jsx'
import { poserQuestion } from '../../src/lib/ia/assistant.js'

// jsdom ne fait pas défiler : le panneau descend sur le dernier message.
Element.prototype.scrollIntoView = vi.fn()

// Ce fichier regarde les CARTES, pas l'écriture lettre par lettre (TC-312) :
// en « mouvement réduit », la réponse s'affiche d'un coup. Sinon, sous la
// charge de la suite complète, l'écriture ralentit et dépasse les attentes.
const matchMediaInitial = window.matchMedia
beforeAll(() => {
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
})
afterAll(() => {
  window.matchMedia = matchMediaInitial
})

// Le panneau arrive par `lazy`. Son premier import compile tout le graphe du
// modèle ; sous la charge de la suite complète, il dépassait l'attente du
// premier test. Chargé ici une fois, le `lazy` le trouve en cache.
beforeAll(async () => {
  await import('../../src/components/assistant/PanneauAssistant.jsx')
}, 60_000)

const DEPOT = { nom: 'preparer_transaction', arguments: { client: '4544102', type: 'Dépôt', montant: 50000, statut: 'Non Terminées' } }

beforeEach(() => {
  appelsDuModele = []
  reponsesAuModele = []
  commande.mockReset().mockResolvedValue({ ok: true })
  transactionsValue = {
    pendingTransactions: [EN_ATTENTE],
    completedTransactions: [LIVRAISON],
    addTransaction: vi.fn().mockResolvedValue(undefined),
    addPaymentTranche: vi.fn().mockResolvedValue(true),
    addRefundTranche: vi.fn().mockResolvedValue(true),
    trashTransaction: vi.fn().mockResolvedValue(undefined),
  }
})

const demander = async (question, ...appels) => {
  appelsDuModele.push(appels)
  fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
  await screen.findByText('Je l’ai préparée : vérifiez puis confirmez.', {}, { timeout: 3000 })
}

// Le panneau arrive par `lazy` au premier clic : on attend qu'il soit là.
const ouvrir = async () => {
  render(<MemoryRouter><Assistant /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: "Ouvrir l'assistant" }))
  await screen.findByLabelText('Votre question', {}, { timeout: 3000 })
}

describe('TC-309 — la carte à confirmer', () => {
  it('[AC-01] rien ne part avant « Confirmer », puis exactement l’opération préparée', async () => {
    await ouvrir()
    await demander('dépôt à distance de 50 000 pour 4544102', DEPOT)

    const carte = screen.getByRole('group', { name: 'À confirmer : Dépôt non terminé' })
    expect(within(carte).getByText('Salif OUEDRAOGO · 4544102')).toBeInTheDocument()
    expect(transactionsValue.addTransaction).not.toHaveBeenCalled()
    expect(reponsesAuModele[0]).toMatchObject({ presentee: true })

    fireEvent.click(within(carte).getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalledTimes(1))
    expect(transactionsValue.addTransaction).toHaveBeenCalledWith({
      client: SALIF,
      clientId: 'c-1',
      type: 'Dépôt',
      reseau: 'Orange',
      code: '4544102',
      montant: 50000,
      statut: 'Non Terminées',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/^Dépôt non terminé enregistré/)
    expect(screen.queryByTestId('carte-operation')).not.toBeInTheDocument()
  })

  it('[AC-02] « Écarter » ne fait rien partir', async () => {
    await ouvrir()
    await demander('dépôt', DEPOT)
    fireEvent.click(screen.getByRole('button', { name: 'Écarter' }))

    expect(screen.queryByTestId('carte-operation')).not.toBeInTheDocument()
    expect(transactionsValue.addTransaction).not.toHaveBeenCalled()
  })

  it('[AC-03] un refus du serveur reste sur la carte, qui peut être reconfirmée', async () => {
    transactionsValue.addTransaction.mockRejectedValueOnce(new Error('Stock insuffisant. Disponible : 0 FCFA'))
    await ouvrir()
    await demander('dépôt', DEPOT)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Stock insuffisant. Disponible : 0 FCFA')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalledTimes(2))
  })

  it('[AC-04] une seule carte par tour : la seconde préparation est refusée au modèle', async () => {
    await ouvrir()
    await demander('deux dépôts', DEPOT, { ...DEPOT, arguments: { ...DEPOT.arguments, montant: 1000 } })

    expect(screen.getAllByTestId('carte-operation')).toHaveLength(1)
    expect(reponsesAuModele[1]).toMatchObject({ erreur: true, message: expect.stringMatching(/^Une seule opération à la fois/) })
  })

  it('[AC-05] la question suivante efface la carte', async () => {
    await ouvrir()
    await demander('dépôt', DEPOT)
    appelsDuModele.push([])
    fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: 'non, laisse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))

    await waitFor(() => expect(screen.queryByTestId('carte-operation')).not.toBeInTheDocument())
    expect(transactionsValue.addTransaction).not.toHaveBeenCalled()
  })

  it('[AC-06] un règlement réessayé garde sa clé : le serveur y reconnaît le même', async () => {
    transactionsValue.addPaymentTranche.mockRejectedValueOnce(new Error('Réseau indisponible'))
    await ouvrir()
    await demander('encaisse Salif en cash', { nom: 'preparer_reglement', arguments: { client: 'Salif', moyen: 'Cash' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(transactionsValue.addPaymentTranche).toHaveBeenCalledTimes(2))
    const [premier, second] = transactionsValue.addPaymentTranche.mock.calls
    expect(premier.slice(0, 3)).toEqual(['d-1', 50000, 'Cash'])
    expect(second[3]).toBe(premier[3])
  })

  it('[AC-07] un retour part par la commande du serveur, comme depuis l’écran', async () => {
    await ouvrir()
    await demander('rends 100 000 au patron', { nom: 'preparer_retour', arguments: { expediteur: 'Patron', montant: 100000 } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(commande).toHaveBeenCalledWith({
      action: 'returnReplenishment', replenishmentId: 'r-1', amount: 100000, balanceType: 'stock',
    }))
  })

  it('[AC-08] l’annulation se nomme comme dans la liste, et part à la corbeille', async () => {
    await ouvrir()
    await demander('annule le dépôt de Salif', { nom: 'preparer_annulation', arguments: { client: 'Salif' } })
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la transaction' }))

    await waitFor(() => expect(transactionsValue.trashTransaction).toHaveBeenCalledWith('d-1'))
  })
})

describe('TC-309 — la dictée', () => {
  let moteur
  class MoteurSimule {
    constructor() {
      moteur = this
      this.start = vi.fn()
      this.stop = vi.fn(() => this.onend?.())
      this.abort = vi.fn()
    }
  }

  beforeEach(() => {
    window.webkitSpeechRecognition = MoteurSimule
    vi.mocked(poserQuestion).mockClear()
  })
  afterEach(() => {
    delete window.webkitSpeechRecognition
  })

  it('[AC-09] la voix remplit le champ, et rien ne part sans « Envoyer »', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Dicter la question' }))
    expect(screen.getByRole('button', { name: 'Arrêter la dictée' })).toHaveAttribute('aria-pressed', 'true')

    act(() => moteur.onresult({ results: [[{ transcript: 'dépôt de 5000 pour Salif' }]] }))
    expect(screen.getByLabelText('Votre question')).toHaveValue('dépôt de 5000 pour Salif')

    act(() => moteur.onend())
    expect(screen.getByRole('button', { name: 'Dicter la question' })).toBeInTheDocument()
    expect(poserQuestion).not.toHaveBeenCalled()
  })

  it('[AC-10] fermer le panneau coupe le micro', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Dicter la question' }))
    fireEvent.click(screen.getByRole('button', { name: "Fermer l'assistant" }))

    expect(moteur.abort).toHaveBeenCalled()
  })

  it('[AC-11] sans moteur dans le navigateur, pas de bouton micro', async () => {
    delete window.webkitSpeechRecognition
    await ouvrir()
    expect(screen.queryByRole('button', { name: 'Dicter la question' })).not.toBeInTheDocument()
  })
})
