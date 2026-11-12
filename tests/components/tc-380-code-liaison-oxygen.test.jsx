import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const genererCodeLiaison = vi.fn()
vi.mock('../../src/services/liaisonOxygenService.js', () => ({
  genererCodeLiaison,
  LIAISON_OXYGEN_ACTIVE: true,
}))

const useHistoriqueClient = vi.fn()
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({ useHistoriqueClient }))

const { default: CodeLiaisonOxygen } = await import('../../src/components/clients/CodeLiaisonOxygen.jsx')
const { default: HistoriqueClientPanel } = await import('../../src/components/clients/HistoriqueClientPanel.jsx')

/**
 * TC-380 — Le code de liaison Oxygen, côté caissière.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3 :
 *   • règle 10 — la consigne « Vérifiez la SIM agent » est sur l'écran avant le code ;
 *   • parcours 4 — hors connexion, le bouton est grisé : « Connexion nécessaire » ;
 *   • §5.1 — six chiffres, compte à rebours de quinze minutes.
 * Et la règle des caissières : des messages courts, rien qui attende sans le dire.
 */

const QUINZE_MINUTES = 15 * 60 * 1000

const enLigne = (valeur) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => valeur })
}

const afficher = (props = {}) => render(<CodeLiaisonOxygen clientId="f-awa" aIdentifiant {...props} />)

const bouton = (nom) => screen.getByRole('button', { name: nom })

beforeEach(() => {
  genererCodeLiaison.mockReset()
  enLigne(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TC-380 — avant le code', () => {
  it('[TC-380-01] la consigne est là avant que le code n’existe', () => {
    afficher()
    expect(screen.getByText(/Vérifiez la SIM agent/)).toBeInTheDocument()
    expect(bouton(/Code de liaison Oxygen/)).toBeEnabled()
  })

  it('[TC-380-02] hors connexion : bouton grisé, « Connexion nécessaire »', () => {
    enLigne(false)
    afficher()
    expect(bouton(/Code de liaison Oxygen/)).toBeDisabled()
    expect(screen.getByText('Connexion nécessaire.')).toBeInTheDocument()
  })

  it('[TC-380-03] la connexion qui revient rallume le bouton', () => {
    enLigne(false)
    afficher()
    enLigne(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(bouton(/Code de liaison Oxygen/)).toBeEnabled()
  })

  it('[TC-380-04] une fiche sans code ni numéro agent : rien à relier, et on dit quoi faire', () => {
    afficher({ aIdentifiant: false })
    expect(bouton(/Code de liaison Oxygen/)).toBeDisabled()
    expect(screen.getByText(/Ajoutez d’abord un code ou un numéro agent/)).toBeInTheDocument()
  })
})

describe('TC-380 — le code', () => {
  it('[TC-380-05] six chiffres lisibles d’un coup d’œil, et quinze minutes', async () => {
    genererCodeLiaison.mockResolvedValue({ code: '042517', expireLe: 0, valableMs: QUINZE_MINUTES })
    afficher()
    await act(async () => { fireEvent.click(bouton(/Code de liaison Oxygen/)) })
    expect(genererCodeLiaison).toHaveBeenCalledWith('f-awa')
    expect(screen.getByText('042 517')).toBeInTheDocument()
    expect(screen.getByText('Valable 15:00')).toBeInTheDocument()
    expect(bouton(/Nouveau code/)).toBeEnabled()
  })

  it('[TC-380-06] le compte à rebours suit l’horloge du poste, depuis la réception', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    genererCodeLiaison.mockResolvedValue({ code: '042517', expireLe: 0, valableMs: QUINZE_MINUTES })
    afficher()
    await act(async () => { fireEvent.click(bouton(/Code de liaison Oxygen/)) })
    await act(async () => { vi.advanceTimersByTime(61_000) })
    expect(screen.getByText('Valable 13:59')).toBeInTheDocument()
  })

  it('[TC-380-07] expiré : le code disparaît, et on dit comment en avoir un autre', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    genererCodeLiaison.mockResolvedValue({ code: '042517', expireLe: 0, valableMs: QUINZE_MINUTES })
    afficher()
    await act(async () => { fireEvent.click(bouton(/Code de liaison Oxygen/)) })
    await act(async () => { vi.advanceTimersByTime(QUINZE_MINUTES) })
    expect(screen.queryByText('042 517')).not.toBeInTheDocument()
    expect(screen.getByText(/Code expiré/)).toBeInTheDocument()
    expect(bouton(/Nouveau code/)).toBeEnabled()
  })

  it('[TC-380-08] pendant la demande, le bouton dit qu’il travaille et ne part pas deux fois', async () => {
    let finir
    genererCodeLiaison.mockReturnValue(new Promise((ok) => { finir = ok }))
    afficher()
    fireEvent.click(bouton(/Code de liaison Oxygen/))
    expect(bouton(/Code en cours/)).toBeDisabled()
    fireEvent.click(bouton(/Code en cours/))
    expect(genererCodeLiaison).toHaveBeenCalledTimes(1)
    await act(async () => { finir({ code: '111111', expireLe: 0, valableMs: QUINZE_MINUTES }) })
  })

  it('[TC-380-09] un échec se dit en une phrase, et le bouton reste disponible', async () => {
    genererCodeLiaison.mockRejectedValue(new Error('Code non obtenu. Vérifiez la connexion et réessayez.'))
    afficher()
    await act(async () => { fireEvent.click(bouton(/Code de liaison Oxygen/)) })
    expect(screen.getByRole('alert')).toHaveTextContent('Code non obtenu. Vérifiez la connexion et réessayez.')
    expect(bouton(/Code de liaison Oxygen/)).toBeEnabled()
  })
})

describe('TC-380 — dans le panneau de l’agent', () => {
  it('[TC-380-10] le panneau porte la section, sur la fiche ouverte', async () => {
    useHistoriqueClient.mockReturnValue({
      enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
      encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
    })
    genererCodeLiaison.mockResolvedValue({ code: '042517', expireLe: 0, valableMs: QUINZE_MINUTES })
    render(<HistoriqueClientPanel client={{ id: 'f-awa', nom: 'OUEDRAOGO', prenom: 'Awa', codeAgent: '1234567' }} onClose={vi.fn()} />)
    await act(async () => { fireEvent.click(bouton(/Code de liaison Oxygen/)) })
    expect(genererCodeLiaison).toHaveBeenCalledWith('f-awa')
  })

  it('[TC-380-11] une fiche d’avant la séparation (`orange` seul) se relie aussi', () => {
    useHistoriqueClient.mockReturnValue({
      enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
      encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
    })
    render(<HistoriqueClientPanel client={{ id: 'f-old', nom: 'KABORE', prenom: 'Issa', orange: '7654321' }} onClose={vi.fn()} />)
    expect(bouton(/Code de liaison Oxygen/)).toBeEnabled()
  })
})
