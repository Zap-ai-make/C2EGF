import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const chargerHistoriqueClient = vi.fn()
vi.mock('../../src/services/clientHistoryService.js', () => ({ chargerHistoriqueClient }))

const { useHistoriqueClient } = await import('../../src/hooks/useHistoriqueClient.js')

/**
 * TC-258 — Le cumul des pages de l'historique d'un agent.
 *
 * ⚠ DEUX RÈGLES QUI NE SE VOIENT QU'À L'USAGE :
 *   1. DÉDOUBLONNER À CHAQUE PAGE. Une ligne écrite pendant la lecture décale la
 *      pagination et peut faire revenir un document déjà affiché.
 *   2. REPARTIR DE ZÉRO QUAND LE CLIENT CHANGE. Sans ça, ouvrir le panneau d'un
 *      second agent lui empile les pages du premier.
 *
 * ⚠ LE CURSEUR EST OPAQUE : `{ chemin: string }`, le chemin du dernier document
 *   lu (voir functions/src/clients/listClientHistory.js, validerCurseur). Le
 *   hook ne l'inspecte jamais, il le renvoie tel quel au service.
 *
 * ⚠ `totaux` NE CONTIENT PAS DE SOMMES D'ARGENT — une ligne annulée garde son
 *   montant alors que l'argent est déjà revenu aux soldes. Forme réelle :
 *   { operations, nonDatees, resteAEncaisser, resteAPayer, nbEnAttente, parBoutique }.
 */

const page = (ids, over = {}) => ({
  enCours: [],
  lignes: ids.map((id) => ({ id, montant: 1 })),
  totaux: { operations: ids.length, nonDatees: 0, resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: 0, parBoutique: [] },
  curseurSuivant: null,
  encore: false,
  ...over,
})

beforeEach(() => { chargerHistoriqueClient.mockReset() })

describe('TC-258 — le chargement initial', () => {
  it('[TC-258-01] ne charge rien tant qu’aucun client n’est désigné', () => {
    const { result } = renderHook(() => useHistoriqueClient(null))
    expect(result.current.etat).toBe('inactif')
    expect(chargerHistoriqueClient).not.toHaveBeenCalled()
  })

  it('[TC-258-02] charge la première page et passe à « pret »', async () => {
    chargerHistoriqueClient.mockResolvedValue(page(['a', 'b']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b'])
    expect(chargerHistoriqueClient).toHaveBeenCalledWith('c1', null)
  })

  it('[TC-258-03] une erreur est portée, pas avalée', async () => {
    chargerHistoriqueClient.mockRejectedValue(new Error('Accès refusé'))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('erreur'))
    expect(result.current.erreur).toMatch(/Accès refusé/)
  })

  it('[TC-258-04] `reessayer` relance le chargement', async () => {
    chargerHistoriqueClient.mockRejectedValueOnce(new Error('réseau'))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('erreur'))
    await act(async () => { await result.current.reessayer() })
    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes).toHaveLength(1)
  })
})

describe('TC-258 — les pages suivantes', () => {
  it('[TC-258-05] `chargerPlus` empile sans écraser', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b'], { encore: true, curseurSuivant: { chemin: 'clients/store-a/history/x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['c'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(chargerHistoriqueClient).toHaveBeenLastCalledWith('c1', { chemin: 'clients/store-a/history/x' })
  })

  /** ⚠ Les totaux de la première page ne sont pas effacés par une page suivante. */
  it('[TC-258-06] les totaux survivent aux pages suivantes', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a'], { encore: true, curseurSuivant: { chemin: 'clients/store-a/history/x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['b'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    const avant = result.current.totaux
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.totaux).toEqual(avant)
  })

  it('[TC-258-07] une ligne revenue deux fois n’apparaît qu’une fois', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b'], { encore: true, curseurSuivant: { chemin: 'clients/store-a/history/x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['b', 'c'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('[TC-258-08] `chargerPlus` ne fait rien quand tout est chargé', async () => {
    chargerHistoriqueClient.mockResolvedValue(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(chargerHistoriqueClient).toHaveBeenCalledTimes(1)
  })

  /**
   * ⚠ `StrictMode` DOUBLE-INVOQUE L'EFFET DE MONTAGE en développement. Sans
   *   garde, chaque ouverture du panneau part en deux appels de Cloud Function,
   *   payés deux fois pour un résultat identique.
   */
  it('[TC-258-10] deux chargerPlus rapprochés ne partent qu’une fois', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a'], { encore: true, curseurSuivant: { chemin: 'clients/store-a/history/a' } }))
    let resoudre
    chargerHistoriqueClient.mockImplementationOnce(() => new Promise((r) => { resoudre = r }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    const appelsAvant = chargerHistoriqueClient.mock.calls.length

    await act(async () => {
      result.current.chargerPlus()
      result.current.chargerPlus()
      resoudre(page(['b'], { totaux: null }))
    })

    expect(chargerHistoriqueClient.mock.calls.length).toBe(appelsAvant + 1)
  })

  /** Une erreur ne doit pas laisser le hook bloqué : la garde se relâche toujours. */
  it('[TC-258-11] après une erreur, un nouvel essai repart bien', async () => {
    chargerHistoriqueClient.mockRejectedValueOnce(new Error('réseau'))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('erreur'))
    await act(async () => { await result.current.reessayer() })
    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes).toHaveLength(1)
  })

  /**
   * ⚠ LE CAS QUE LA GARDE NE DOIT PAS CASSER : changer de client pendant qu'une
   *   page suivante est en vol. Le nouveau client doit se charger, et la réponse
   *   tardive de l'ancien ne doit rien afficher sous son nom.
   */
  it('[TC-258-12] changer de client pendant une page suivante charge bien le nouveau', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a'], { encore: true, curseurSuivant: { chemin: 'clients/store-a/history/a' } }))
    let resoudreAncien
    chargerHistoriqueClient.mockImplementationOnce(() => new Promise((r) => { resoudreAncien = r }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['z']))

    const { result, rerender } = renderHook(({ id }) => useHistoriqueClient(id), { initialProps: { id: 'c1' } })
    await waitFor(() => expect(result.current.etat).toBe('pret'))

    act(() => { result.current.chargerPlus() })
    rerender({ id: 'c2' })
    await act(async () => { resoudreAncien(page(['vieux'], { totaux: null })) })

    await waitFor(() => expect(result.current.lignes.map((l) => l.id)).toEqual(['z']))
  })
})

describe('TC-258 — changer de client', () => {
  it('[TC-258-09] repart de zéro, sans empiler les pages du précédent', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b']))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['z']))
    const { result, rerender } = renderHook(({ id }) => useHistoriqueClient(id), { initialProps: { id: 'c1' } })

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    rerender({ id: 'c2' })

    await waitFor(() => expect(result.current.lignes.map((l) => l.id)).toEqual(['z']))
  })

  /**
   * ⚠ LA RÉGRESSION QUE LE VERROU PAR IDENTIFIANT AVAIT CRÉÉE. Fermer le panneau
   *   puis rouvrir le MÊME client avant la réponse : le second appel était refusé
   *   par un verrou que plus personne ne surveillait, et l'écran annonçait
   *   « aucune opération » sur un agent qui en a.
   */
  it('[TC-258-14] rouvrir le même client après fermeture relance bien le chargement', async () => {
    let resoudrePremier
    chargerHistoriqueClient.mockImplementationOnce(() => new Promise((r) => { resoudrePremier = r }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a']))

    const { result, rerender } = renderHook(({ id }) => useHistoriqueClient(id), { initialProps: { id: 'c1' } })
    rerender({ id: null })
    rerender({ id: 'c1' })

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes.map((l) => l.id)).toEqual(['a'])

    // La réponse de la requête abandonnée ne doit rien changer après coup.
    await act(async () => { resoudrePremier(page(['vieux'])) })
    expect(result.current.lignes.map((l) => l.id)).toEqual(['a'])
  })

  /**
   * ⚠ ALLER-RETOUR : la réponse de la PREMIÈRE requête pour un client ne doit ni
   *   s'afficher à la place de la seconde, ni rendre le verrou qu'elle détient.
   */
  it('[TC-258-15] revenir sur un client n’affiche pas la réponse de l’aller', async () => {
    let resoudreAller
    chargerHistoriqueClient.mockImplementationOnce(() => new Promise((r) => { resoudreAller = r }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['z']))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['retour']))

    const { result, rerender } = renderHook(({ id }) => useHistoriqueClient(id), { initialProps: { id: 'c1' } })
    rerender({ id: 'c2' })
    rerender({ id: 'c1' })

    await waitFor(() => expect(result.current.lignes.map((l) => l.id)).toEqual(['retour']))
    await act(async () => { resoudreAller(page(['aller'])) })
    expect(result.current.lignes.map((l) => l.id)).toEqual(['retour'])
  })
})

describe('TC-258 — StrictMode', () => {
  /**
   * ⚠ LE SCÉNARIO QUE LE COMMENTAIRE PROMETTAIT SANS QUE RIEN NE LE VÉRIFIE.
   *   `StrictMode` rejoue l'effet de montage avant que la première requête
   *   n'ait eu le temps de se résoudre. Sans un verrou qui retient POUR QUI il
   *   a été posé, le rejeu relâche celui du premier passage et part en double.
   *
   * ⚠ MÉCANIQUE ADAPTÉE, INTENTION CONSERVÉE : `wrapper: ({children}) =>
   *   <StrictMode>{children}</StrictMode>` NE mord PAS ici — vérifié
   *   empiriquement (voir rapport). `reactStrictMode: true` est l'option
   *   native de `renderHook` pour ce besoin ; vérifiée empiriquement comme
   *   reproduisant bien le double montage — c'est aussi la forme la plus
   *   proche de `src/main.jsx`, où `<StrictMode>` est la racine montée.
   */
  it('[TC-258-13] un double montage StrictMode ne part qu’une fois', async () => {
    chargerHistoriqueClient.mockResolvedValue(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'), { reactStrictMode: true })

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(chargerHistoriqueClient).toHaveBeenCalledTimes(1)
  })
})
