import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-312 — Le volet de l'assistant.
 *
 * Demande du responsable (30 octobre 2026) : un volet sur toute la hauteur, à
 * droite, avec la boutique sous « Assistant », une nouvelle conversation, un
 * historique ; des réponses qui s'écrivent lettre par lettre, pas en vrac.
 *
 * Le modèle est simulé ; tout le reste est réel.
 */

let reponseDuModele

vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u-1', email: 'awa@c2egf.test' },
    userProfile: { role: 'member', storeId: 'b-1', name: 'Awa' },
    activeStore: { id: 'b-1', name: 'C2EGF SIEGE' },
    isStoreAdmin: false,
  }),
}))
vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [] }) }))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ pendingTransactions: [], completedTransactions: [] }),
}))
vi.mock('../../src/hooks/useNetworkCards.js', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => 0,
    getLiquidite: () => 0,
    getNetworkLiquidite: () => 0,
    formatAmount: (n) => String(n),
  }),
}))
vi.mock('../../src/lib/ia/assistant.js', () => ({
  // La mémoire telle que la rend getHistory() : la question, puis la réponse.
  poserQuestion: vi.fn(async ({ question, surTexte }) => {
    surTexte(reponseDuModele)
    return {
      ok: true,
      texte: reponseDuModele,
      historique: [
        { role: 'user', parts: [{ text: question }] },
        { role: 'model', parts: [{ text: reponseDuModele }] },
      ],
    }
  }),
}))

import Assistant from '../../src/components/Assistant.jsx'
import { poserQuestion } from '../../src/lib/ia/assistant.js'
import { chargerConversations, cleDesConversations } from '../../src/lib/ia/conversations.js'
import { SUGGESTIONS } from '../../src/components/assistant/PanneauAssistant.jsx'

beforeAll(async () => {
  await import('../../src/components/assistant/PanneauAssistant.jsx')
}, 60_000)

const matchMediaInitial = window.matchMedia
const mouvementReduit = (reduit) => {
  window.matchMedia = () => ({ matches: reduit, addEventListener() {}, removeEventListener() {} })
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(poserQuestion).mockClear()
  reponseDuModele = 'Bonjour ! Comment puis-je vous aider ?'
  mouvementReduit(true)
})
afterEach(() => {
  window.matchMedia = matchMediaInitial
})

const ouvrir = async () => {
  render(<MemoryRouter><Assistant /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: "Ouvrir l'assistant" }))
  await screen.findByLabelText('Votre question', {}, { timeout: 3000 })
}

const demander = async (question) => {
  fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
  await waitFor(() => expect(poserQuestion).toHaveBeenCalled())
  // Pendant une réponse, le champ et les gestes de l'en-tête sont bloqués :
  // on attend qu'elle soit reçue, comme la caissière.
  await waitFor(() => expect(screen.getByLabelText('Votre question')).not.toBeDisabled())
}

describe('TC-312 — le volet', () => {
  it('[VO-01] « Assistant », la boutique dessous, et les trois gestes de l’en-tête', async () => {
    await ouvrir()
    const volet = screen.getByRole('region', { name: 'Assistant' })
    expect(volet).toHaveTextContent('C2EGF SIEGE')
    for (const nom of ['Nouvelle conversation', 'Historique des conversations', "Fermer l'assistant"]) {
      expect(screen.getByRole('button', { name: nom })).toBeInTheDocument()
    }
  })

  it('[VO-02] vide, il salue par le nom et propose des questions qui partent d’un clic', async () => {
    await ouvrir()
    expect(screen.getByText('Bonjour Awa.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: SUGGESTIONS[0] }))

    await waitFor(() => expect(poserQuestion).toHaveBeenCalledWith(expect.objectContaining({ question: SUGGESTIONS[0] })))
    expect(await screen.findByText(reponseDuModele)).toBeInTheDocument()
  })

  // Horloge simulée : sous la charge de la suite complète, une vraie horloge
  // ralentit l'écriture et ferait échouer ce test pour une raison étrangère.
  it('[VO-03] la réponse s’écrit lettre par lettre', async () => {
    mouvementReduit(false)
    reponseDuModele = 'Voici le bilan de la journée. '.repeat(8).trim()
    await ouvrir()
    vi.useFakeTimers()
    try {
      fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: 'fais le point' } })
      fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
      await act(async () => {})

      const zone = () => screen.getByRole('region', { name: 'Assistant' }).textContent
      expect(zone()).not.toContain(reponseDuModele)

      // Quelques tics : le début est là, pas la fin.
      for (let i = 0; i < 5; i += 1) await act(async () => { vi.advanceTimersByTime(16) })
      expect(zone()).toContain('Voi')
      expect(zone()).not.toContain(reponseDuModele)

      // Assez de tics pour tout écrire.
      for (let i = 0; i < 400 && !zone().includes(reponseDuModele); i += 1) {
        await act(async () => { vi.advanceTimersByTime(16) })
      }
      expect(screen.getByText(reponseDuModele)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('[VO-04] « mouvement réduit » : la réponse arrive d’un coup', async () => {
    await ouvrir()
    await demander('salut')
    expect(screen.getByText(reponseDuModele)).toBeInTheDocument()
  })

  it('[VO-05] une nouvelle conversation repart de l’accueil ; l’ancienne est dans l’historique', async () => {
    await ouvrir()
    await demander('qui me doit de l’argent ?')
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }))
    expect(screen.getByText('Bonjour Awa.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    fireEvent.click(screen.getByRole('button', { name: /qui me doit de l’argent \?/ }))

    expect(screen.getByText('qui me doit de l’argent ?')).toBeInTheDocument()
    expect(screen.getByText(reponseDuModele)).toBeInTheDocument()
  })

  it('[VO-06] la conversation se range pour cette personne et cette boutique, avec sa mémoire', async () => {
    await ouvrir()
    await demander('salut')
    await waitFor(() => expect(chargerConversations(cleDesConversations('u-1', 'b-1'))).toHaveLength(1))
    const [rangee] = chargerConversations(cleDesConversations('u-1', 'b-1'))
    expect(rangee.titre).toBe('salut')
    expect(rangee.historique).toEqual([
      { role: 'user', parts: [{ text: 'salut' }] },
      { role: 'model', parts: [{ text: reponseDuModele }] },
    ])
  })

  it('[VO-07] une conversation rouverte rend sa mémoire au modèle', async () => {
    await ouvrir()
    await demander('salut')
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    fireEvent.click(screen.getByRole('button', { name: /salut/ }))

    vi.mocked(poserQuestion).mockClear()
    await demander('et ensuite ?')
    expect(poserQuestion).toHaveBeenCalledWith(expect.objectContaining({
      historique: [
        { role: 'user', parts: [{ text: 'salut' }] },
        { role: 'model', parts: [{ text: reponseDuModele }] },
      ],
    }))
  })

  it('[VO-08] Échap ferme le volet', async () => {
    await ouvrir()
    fireEvent.keyDown(screen.getByLabelText('Votre question'), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Assistant' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Ouvrir l'assistant" })).toBeInTheDocument()
  })

  // « La sortie est brusque » (30 octobre 2026) : le volet disparaissait d'un
  // coup. Il glisse désormais, et reste le temps de sortir — hors d'atteinte.
  it('[VO-09] fermé, le volet glisse hors de l’écran avant de partir', async () => {
    mouvementReduit(false)
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: "Fermer l'assistant" }))

    const volet = document.querySelector('section[aria-label="Assistant"]')
    expect(volet).not.toBeNull()
    expect(volet).toHaveAttribute('inert')
    await waitFor(() => expect(document.querySelector('section[aria-label="Assistant"]')).toBeNull(), { timeout: 2000 })
  })

  it('[VO-10] fermé, le clavier revient au bouton qui l’a ouvert', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: "Fermer l'assistant" }))
    expect(screen.getByRole('button', { name: "Ouvrir l'assistant" })).toHaveFocus()
  })

  it('[VO-11] rouvert, il reprend la conversation, prêt à taper', async () => {
    await ouvrir()
    await demander('salut')
    fireEvent.click(screen.getByRole('button', { name: "Fermer l'assistant" }))
    fireEvent.click(screen.getByRole('button', { name: "Ouvrir l'assistant" }))

    expect(await screen.findByText(reponseDuModele)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Assistant' })).not.toHaveAttribute('inert')
    expect(screen.getByLabelText('Votre question')).toHaveFocus()
  })
})
