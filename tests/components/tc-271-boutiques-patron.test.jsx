import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/**
 * TC-271 — les 84 boutiques, et les quatre chiffres que le patron demande.
 *
 * Les noms viennent du métier : « crédit · argent dehors » pour les dépôts non
 * terminés (le client DOIT à la boutique), « retrait · clients non payés » pour
 * les retraits non terminés (la boutique DOIT au client). C'est la distinction
 * qu'`argentDehors.js` écrit déjà.
 */

const listNetworkCaisses = vi.fn()
const listArgentDehors = vi.fn()
vi.mock('../../src/services/dealerService.js', () => ({
  listNetworkCaisses: (...a) => listNetworkCaisses(...a),
  listArgentDehors: (...a) => listArgentDehors(...a),
}))

const { default: PatronBoutiques } = await import('../../src/pages/admin/PatronBoutiques.jsx')

const caisse = (i) => ({ storeId: 's' + i, name: 'BOUTIQUE ' + i, stock: 1000 * i, liquidite: 500 * i })

beforeEach(() => {
  listNetworkCaisses.mockReset()
  listArgentDehors.mockReset()
  listNetworkCaisses.mockResolvedValue({
    caisses: [caisse(1), caisse(2)], total: 2,
    sommeStock: 3000, sommeLiquidite: 1500, illisibles: 0,
  })
  listArgentDehors.mockResolvedValue({
    parBoutique: [{ storeId: 's1', name: 'BOUTIQUE 1', depots: 70000, retraits: 20000, dehors: 50000 }],
    depots: 70000, retraits: 20000, dehors: 50000, illisibles: 0, horsReseau: 0,
  })
})
afterEach(cleanup)

describe('TC-271 — les quatre soldes, avec les mots du métier', () => {
  it('[TC-271-01] stock et espèces sont affichés', async () => {
    render(<PatronBoutiques />)
    expect(await screen.findByText(/BOUTIQUE 1/)).toBeInTheDocument()
    const ligne = screen.getByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/1\s?000/)
    expect(ligne).toHaveTextContent(/500/)
  })

  it('[TC-271-02] le crédit est nommé « argent dehors »', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/crédit/i)
    expect(ligne).toHaveTextContent(/argent dehors/i)
    expect(ligne).toHaveTextContent(/70\s?000/)
  })

  it('[TC-271-03] le retrait est nommé « clients non payés »', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/clients non payés/i)
    expect(ligne).toHaveTextContent(/20\s?000/)
  })

  /** Une boutique sans non terminée affiche zéro, pas un vide. */
  it('[TC-271-04] une boutique sans non terminée affiche 0', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s2')
    expect(ligne).toHaveTextContent(/0/)
  })
})

/**
 * ⚠ REVIEW FOCUS 4 — une boutique sans document `networkBalances`.
 *   `listNetworkCaisses` rend `null`, jamais `0`, et compte les `illisibles` :
 *   une caisse inconnue n'est pas une caisse vide, et la somme doit le dire.
 */
describe('TC-271 — une caisse inconnue n’est pas une caisse vide', () => {
  it('[TC-271-05] la ligne dit « inconnu » au lieu de 0', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [{ storeId: 's9', name: 'SANS SOLDE', stock: null, liquidite: null }],
      total: 1, sommeStock: 0, sommeLiquidite: 0, illisibles: 1,
    })
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s9')
    expect(ligne).toHaveTextContent(/inconnu/i)
  })

  it('[TC-271-06] la somme annonce qu’elle est incomplète', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [{ storeId: 's9', name: 'SANS SOLDE', stock: null, liquidite: null }],
      total: 1, sommeStock: 0, sommeLiquidite: 0, illisibles: 1,
    })
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('somme-caisses')).toHaveTextContent(/incomplèt|1 caisse/i)
  })
})

describe('TC-271 — 84 lignes se consultent avec tri et filtre', () => {
  it('[TC-271-07] le tri par défaut est le nom A → Z', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [caisse(2), caisse(1)], total: 2, sommeStock: 0, sommeLiquidite: 0, illisibles: 0,
    })
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    const noms = screen.getAllByTestId(/^boutique-/).map(n => n.getAttribute('data-testid'))
    expect(noms).toEqual(['boutique-s1', 'boutique-s2'])
  })

  it('[TC-271-08] le filtre par nom réduit la liste', async () => {
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    fireEvent.change(screen.getByLabelText(/filtrer les boutiques/i), { target: { value: 'BOUTIQUE 2' } })
    expect(screen.queryByTestId('boutique-s1')).toBeNull()
    expect(screen.getByTestId('boutique-s2')).toBeInTheDocument()
  })

  it('[TC-271-09] le total ne bouge pas quand on filtre', async () => {
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    const avant = screen.getByTestId('somme-caisses').textContent
    fireEvent.change(screen.getByLabelText(/filtrer les boutiques/i), { target: { value: 'BOUTIQUE 2' } })
    expect(screen.getByTestId('somme-caisses').textContent).toBe(avant)
  })
})

describe('TC-271 — quand l’agrégat échoue', () => {
  it('[TC-271-10] les soldes restent, le crédit dit « — »', async () => {
    listArgentDehors.mockRejectedValue(new Error('indisponible'))
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    expect(ligne).toHaveTextContent(/1\s?000/)
    expect(ligne).toHaveTextContent('—')
  })
})

describe('TC-271 — une lecture qui échoue ne dit pas « le réseau n’a rien »', () => {
  /**
   * ⚠ LE DÉFAUT QUE CE TEST EXISTE POUR EMPÊCHER. En repliant l'échec sur des
   *   zéros, l'écran affichait « Caisses · 0 FCFA sur 0 » et aucune ligne : le
   *   patron lisait que ses 84 boutiques ne détiennent rien, alors que la
   *   lecture avait simplement échoué. Un écran ne dit pas qu'il n'y a rien
   *   tant qu'il n'a pas réussi à demander.
   */
  it('[TC-271-11] un échec des caisses montre une erreur, pas une somme nulle', async () => {
    listNetworkCaisses.mockRejectedValue(new Error('permission-denied'))
    render(<PatronBoutiques />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('somme-caisses')).toBeNull()
  })

  it('[TC-271-12] Réessayer relance la lecture', async () => {
    listNetworkCaisses.mockRejectedValueOnce(new Error('coupure'))
    render(<PatronBoutiques />)
    fireEvent.click(await screen.findByRole('button', { name: /réessayer/i }))
    expect(await screen.findByTestId('boutique-s1')).toBeInTheDocument()
  })
})

describe('TC-271 — l’argent dehors annonce quand il est incomplet', () => {
  it('[TC-271-13] des brouillons illisibles ou hors réseau sont signalés', async () => {
    listArgentDehors.mockResolvedValue({
      parBoutique: [], depots: 0, retraits: 0, dehors: 0, illisibles: 3, horsReseau: 2,
    })
    render(<PatronBoutiques />)
    const note = await screen.findByTestId('somme-dehors')
    expect(note).toHaveTextContent(/3/)
    expect(note).toHaveTextContent(/2/)
  })

  it('[TC-271-14] un agrégat complet ne porte aucune réserve', async () => {
    render(<PatronBoutiques />)
    const note = await screen.findByTestId('somme-dehors')
    expect(note).not.toHaveTextContent(/illisible|hors réseau|incompl/i)
  })
})

describe('TC-271 — « Inconnu » et « 0 » ne veulent pas dire la même chose', () => {
  /**
   * ⚠ LES DEUX SENS SUR LA MÊME LIGNE, TESTÉS ENSEMBLE EXPRÈS. Une caisse sans
   *   document de soldes est INCONNUE ; une boutique absente de `parBoutique`
   *   n'a réellement RIEN dehors (le serveur ne l'y pousse que si elle a
   *   quelque chose). Inverser l'un ou l'autre donne un écran faux : « 0 » sur
   *   une caisse non lue fait croire à une caisse vide, « Inconnu » sur un
   *   crédit absent empêche de voir quelles boutiques ne doivent rien.
   */
  it('[TC-271-15] caisse sans document = « Inconnu », crédit absent = « 0 »', async () => {
    listNetworkCaisses.mockResolvedValue({
      caisses: [{ storeId: 's9', name: 'SANS SOLDE', stock: null, liquidite: null }],
      total: 1, sommeStock: 0, sommeLiquidite: 0, illisibles: 1,
    })
    listArgentDehors.mockResolvedValue({
      parBoutique: [], depots: 0, retraits: 0, dehors: 0, illisibles: 0, horsReseau: 0,
    })
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s9')
    expect(ligne).toHaveTextContent(/inconnu/i)
    // Et le crédit, lui, dit bien zéro — pas « inconnu », pas « — ».
    const credit = ligne.querySelector('[data-testid="credit-s9"]')
    expect(credit).toHaveTextContent('0')
  })
})
