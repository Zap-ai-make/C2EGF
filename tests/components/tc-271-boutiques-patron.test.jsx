import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'

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

// ⚠ TROISIÈME SOURCE, INDÉPENDANTE DES DEUX AUTRES (tâche 9). La carte du
//   chiffre d'affaires appelle `chiffreAffairesService.js`, jamais
//   `dealerService.js` — la mocker à part est ce qui permet de prouver
//   qu'un échec de l'une n'affecte pas l'autre (TC-271-10, TC-271-11 restent
//   verts même quand cette source est en défaut, et inversement).
const chiffreAffaires = vi.fn().mockResolvedValue({ total: 847300000, incomplet: false })
vi.mock('../../src/services/chiffreAffairesService.js', () => ({
  chiffreAffaires: (...a) => chiffreAffaires(...a),
}))

const { default: PatronBoutiques } = await import('../../src/pages/admin/PatronBoutiques.jsx')

const caisse = (i) => ({ storeId: 's' + i, name: 'BOUTIQUE ' + i, stock: 1000 * i, liquidite: 500 * i })

beforeEach(() => {
  listNetworkCaisses.mockReset()
  listArgentDehors.mockReset()
  chiffreAffaires.mockReset()
  listNetworkCaisses.mockResolvedValue({
    caisses: [caisse(1), caisse(2)], total: 2,
    sommeStock: 3000, sommeLiquidite: 1500, illisibles: 0,
  })
  listArgentDehors.mockResolvedValue({
    parBoutique: [{ storeId: 's1', name: 'BOUTIQUE 1', depots: 70000, retraits: 20000, dehors: 50000 }],
    depots: 70000, retraits: 20000, dehors: 50000, illisibles: 0, horsReseau: 0,
  })
  chiffreAffaires.mockResolvedValue({ total: 847300000, incomplet: false })
})
afterEach(cleanup)

/**
 * ⚠ RONDE DE CORRECTION 2 (R42) — L'ÉCRAN EST MONTÉ SOUS `StrictMode` DANS LA
 *   VRAIE APPLICATION (`src/main.jsx:7`), ET AUCUN AUTRE TEST DE CE FICHIER NE
 *   LE FAIT.
 *
 *   React 18+ monte, démonte et REMONTE chaque composant sous `StrictMode` en
 *   développement. Un drapeau « encore monté » rangé dans un `useRef` et remis
 *   à `false` par le nettoyage de l'effet n'est jamais remis à `true` au
 *   remontage — sauf si le corps de l'effet le fait explicitement. Après le
 *   cycle de `StrictMode`, toutes les gardes `if (vivantRef.current)` échouent
 *   et l'écran reste sur « Chargement… » POUR TOUJOURS, en développement.
 *
 *   Les vingt autres tests passent : `render()` nu ne simule pas ce cycle. Ce
 *   test est le seul qui reproduise la condition réelle d'exécution.
 */
describe('TC-271 — l’écran survit au double montage de StrictMode', () => {
  it('[TC-271-21] les lignes s’affichent après le cycle monter/démonter/remonter', async () => {
    render(<StrictMode><PatronBoutiques /></StrictMode>)
    expect(await screen.findByTestId('boutique-s1')).toBeInTheDocument()
    expect(screen.getByTestId('credit-s1')).toHaveTextContent(/70/)
  })
})

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

  /**
   * Une boutique sans non terminée affiche zéro, pas un vide.
   *
   * ⚠ RONDE DE CORRECTION 1 (M1) — CE TEST NE POUVAIT PAS ÉCHOUER AVANT.
   *   `ligne.toHaveTextContent(/0/)` sur `boutique-s2` passait quoi que
   *   montrent le crédit et le retrait, parce que le STOCK de s2 est « 2 000 »
   *   — il contient déjà un « 0 ». Remplacer `?? 0` par `?? null` dans
   *   l'implémentation aurait laissé ce test vert. Il porte maintenant sur
   *   `credit-s2` / `retrait-s2` spécifiquement, maintenant que ces testid
   *   existent.
   */
  it('[TC-271-04] une boutique sans non terminée affiche 0, sur les deux cases', async () => {
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s2')
    const credit = ligne.querySelector('[data-testid="credit-s2"]')
    const retrait = ligne.querySelector('[data-testid="retrait-s2"]')
    expect(credit).toHaveTextContent('0')
    expect(retrait).toHaveTextContent('0')
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
    // ⚠ RONDE DE CORRECTION 1 (I2) — ASSERTION POSITIVE AJOUTÉE. Sans elle,
    //   `/3/` passe sur n'importe quelle chaîne contenant un 3 (« 32 000 FCFA »
    //   par exemple), même une phrase qui affirmerait le contraire du vrai.
    expect(note).toHaveTextContent(/incomplet/i)
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

describe('TC-271 — l’argent dehors « en vol » n’est pas « en échec » (ronde de correction 1, I1)', () => {
  /**
   * ⚠ LA FORME MIROIR DU DÉFAUT DE TC-271-11. Là, un échec se repliait sur un
   *   silence (« le réseau n'a rien »). Ici, le silence d'une callable encore
   *   en vol — Cloud Run froid, quelques secondes — se repliait sur un échec
   *   (« indisponible ») : le patron lirait une panne qui n'a pas eu lieu,
   *   pendant que la réponse arrive. Les deux sont la même faute : se prononcer
   *   avant d'avoir fini de demander.
   */
  it('[TC-271-16] pendant que l’agrégat charge, le crédit dit « … », jamais « — »', async () => {
    let resoudre
    listArgentDehors.mockReturnValue(new Promise((r) => { resoudre = r }))
    render(<PatronBoutiques />)
    const ligne = await screen.findByTestId('boutique-s1')
    const credit = ligne.querySelector('[data-testid="credit-s1"]')
    expect(credit).toHaveTextContent('…')
    expect(credit).not.toHaveTextContent('—')
    // Nettoyage : la promesse est résolue pour ne rien laisser en attente —
    // `mockReturnValue` n'est pas consommé comme `mockResolvedValueOnce` et
    // resterait actif pour le test suivant sinon.
    await act(async () => {
      resoudre({ parBoutique: [], depots: 0, retraits: 0, dehors: 0, illisibles: 0, horsReseau: 0 })
    })
  })
})

describe('TC-271 — la somme réseau de l’argent dehors porte le brut, pas le net (ronde de correction 1, C1)', () => {
  /**
   * ⚠ `dehors.dehors` (= dépôts − retraits) PORTAIT LE MÊME LIBELLÉ QUE LE
   *   BRUT PAR BOUTIQUE AVANT CETTE RONDE. Avec 70 000 de dépôts et 20 000 de
   *   retraits non terminés, l'en-tête annonçait « Argent dehors · 50 000 » —
   *   le net — sous le même mot que « Crédit · argent dehors » qui, lui,
   *   désigne le brut sur chaque ligne. Ce test verrouille que le total réseau
   *   montre les DEUX bruts, pas un seul chiffre fusionné.
   */
  it('[TC-271-17] « argent dehors » et « clients non payés » portent chacun leur propre total réseau', async () => {
    render(<PatronBoutiques />)
    const note = await screen.findByTestId('somme-dehors')
    expect(note).toHaveTextContent(/argent dehors/i)
    expect(note).toHaveTextContent(/70\s?000/)
    expect(note).toHaveTextContent(/clients non payés/i)
    expect(note).toHaveTextContent(/20\s?000/)
  })
})

describe('TC-271 — l’état de chargement ne se confond ni avec l’erreur ni avec le prêt (ronde de correction 1, R29)', () => {
  it('[TC-271-18] pendant que les caisses chargent : ni alerte, ni ligne, ni somme', async () => {
    let resoudre
    listNetworkCaisses.mockReturnValue(new Promise((r) => { resoudre = r }))
    render(<PatronBoutiques />)
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('boutique-s1')).toBeNull()
    expect(screen.queryByTestId('somme-caisses')).toBeNull()
    await act(async () => {
      resoudre({ caisses: [caisse(1)], total: 1, sommeStock: 1000, sommeLiquidite: 500, illisibles: 0 })
    })
    expect(await screen.findByTestId('boutique-s1')).toBeInTheDocument()
  })
})

describe('TC-271 — la somme de l’argent dehors porte sur le réseau, pas sur la vue (ronde de correction 1, M2)', () => {
  it('[TC-271-19] le filtre ne change pas la somme de l’argent dehors', async () => {
    render(<PatronBoutiques />)
    await screen.findByTestId('boutique-s1')
    const avant = screen.getByTestId('somme-dehors').textContent
    fireEvent.change(screen.getByLabelText(/filtrer les boutiques/i), { target: { value: 'BOUTIQUE 2' } })
    expect(screen.getByTestId('somme-dehors').textContent).toBe(avant)
  })
})

describe('TC-271 — Réessayer remet tout à zéro avant de relire (ronde de correction 1, C2)', () => {
  /**
   * ⚠ LE DÉFAUT QUE CE TEST EXISTE POUR EMPÊCHER. `setDehorsEnEchec(true)`
   *   existait ; `setDehorsEnEchec(false)` n'existait nulle part. Après une
   *   coupure des DEUX lectures à l'ouverture puis un Réessayer qui réussit,
   *   l'écran continuait d'afficher « indisponible » et « — » dans les cases
   *   crédit/retrait alors que l'agrégat portait de vrais montants en mémoire.
   */
  it('[TC-271-20] après une coupure totale, un Réessayer qui réussit montre le vrai crédit, pas « — »', async () => {
    listNetworkCaisses.mockRejectedValueOnce(new Error('coupure'))
    listArgentDehors.mockRejectedValueOnce(new Error('coupure'))
    render(<PatronBoutiques />)
    fireEvent.click(await screen.findByRole('button', { name: /réessayer/i }))
    const ligne = await screen.findByTestId('boutique-s1')
    const credit = ligne.querySelector('[data-testid="credit-s1"]')
    expect(credit).toHaveTextContent('70 000')
    expect(credit).not.toHaveTextContent('—')
  })
})

describe('TC-271 — une réponse périmée ne remasque pas un montant valide (ronde de correction 2, R44)', () => {
  /**
   * ⚠ C2 RÉINCARNÉ DANS UNE FENÊTRE DE COURSE. Le fix de C2 (ronde 1) a
   *   remplacé un `let vivant` fermé PAR TENTATIVE — recréé à chaque appel de
   *   l'effet, donc isolé — par un `vivantRef` partagé entre toutes les
   *   tentatives. Le point unique de remise à zéro était le bon acquis ; mais
   *   plus rien ne distinguait « la réponse de la tentative N-1, encore en
   *   vol » de « celle de la tentative N ».
   *
   *   Scénario : les caisses échouent vite (le bouton Réessayer apparaît),
   *   l'agrégat de CETTE MÊME tentative reste en vol (Cloud Run froid,
   *   plusieurs secondes). Le patron tape Réessayer avant que cette première
   *   réponse ne soit arrivée. La tentative 2 réussit. PUIS la réponse périmée
   *   de la tentative 1 se règle — en échec — et son `.catch` fait
   *   `setDehorsEnEchec(true)` par-dessus un `dehors` déjà valide : l'écran
   *   affiche « indisponible » et « — » alors que le bon montant est en
   *   mémoire. `vivantRef.current` seul ne voit rien venir : le composant est
   *   toujours monté, la garde passe.
   */
  it('[TC-271-22] une tentative 1 encore en vol qui échoue APRÈS une tentative 2 réussie ne remasque pas le crédit', async () => {
    let rejeterTentative1
    listArgentDehors
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeterTentative1 = reject }))
      .mockResolvedValueOnce({
        parBoutique: [{ storeId: 's1', name: 'BOUTIQUE 1', depots: 70000, retraits: 20000, dehors: 50000 }],
        depots: 70000, retraits: 20000, dehors: 50000, illisibles: 0, horsReseau: 0,
      })
    listNetworkCaisses.mockRejectedValueOnce(new Error('coupure'))

    render(<PatronBoutiques />)
    fireEvent.click(await screen.findByRole('button', { name: /réessayer/i }))

    const ligne = await screen.findByTestId('boutique-s1')
    const credit = ligne.querySelector('[data-testid="credit-s1"]')
    // La tentative 2 a réussi : on attend que son montant s'affiche avant de
    // faire parler la réponse périmée — sinon on ne testerait qu'un « en vol ».
    await waitFor(() => expect(credit).toHaveTextContent('70 000'))

    // La réponse PÉRIMÉE de la tentative 1 se règle seulement maintenant.
    await act(async () => { rejeterTentative1(new Error('périmée')) })

    expect(credit).toHaveTextContent('70 000')
    expect(credit).not.toHaveTextContent('—')
  })
})

/**
 * TC-271 — la carte du chiffre d'affaires (tâche 9).
 *
 * « Pour le chiffre d'affaire, on fait en option filtrable journalier par
 *   défaut, avec un sélecteur de mois » — les mots du patron. La carte a sa
 *   propre source (`chiffreAffairesService.js`), donc son propre état :
 *   zéro et « indisponible » ne se confondent pas, comme pour les caisses.
 */
describe('TC-271 — la carte du chiffre d’affaires', () => {
  it('[TC-271-23] le jour est le défaut', async () => {
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('ca-reseau')).toHaveTextContent(/aujourd/i)
  })

  it('[TC-271-24] une journée vide affiche 0 FCFA, pas « indisponible »', async () => {
    chiffreAffaires.mockResolvedValue({ total: 0, incomplet: false })
    render(<PatronBoutiques />)
    const carte = await screen.findByTestId('ca-reseau')
    expect(carte).toHaveTextContent('0')
    expect(carte).not.toHaveTextContent(/indisponible/i)
  })

  it('[TC-271-25] une panne dit « indisponible », jamais 0', async () => {
    chiffreAffaires.mockResolvedValue({ total: null, incomplet: false })
    render(<PatronBoutiques />)
    const carte = await screen.findByTestId('ca-reseau')
    expect(carte).toHaveTextContent(/indisponible/i)
    expect(carte).not.toHaveTextContent(/\b0\b/)
  })

  it('[TC-271-26] une somme incomplète le dit', async () => {
    chiffreAffaires.mockResolvedValue({ total: null, incomplet: true })
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('ca-reseau')).toHaveTextContent(/incomplet/i)
  })

  it('[TC-271-27] choisir un mois relance la requête sur ce mois', async () => {
    chiffreAffaires.mockResolvedValue({ total: 100, incomplet: false })
    render(<PatronBoutiques />)
    await screen.findByTestId('ca-reseau')
    fireEvent.change(screen.getByLabelText(/choisir un mois/i), { target: { value: '2026-09' } })
    await waitFor(() => {
      expect(chiffreAffaires).toHaveBeenCalledWith({ type: 'mois', cle: '2026-09' })
    })
  })

  /**
   * ⚠ LA DEUXIÈME MOITIÉ DE L'INDÉPENDANCE (brief, Step 4) — PAS SEULEMENT
   *   « une panne du CA n'emporte pas les caisses » (déjà couvert par
   *   TC-271-10/11 qui restent verts avec ce mock par défaut), MAIS AUSSI
   *   « une panne DES CAISSES n'emporte pas le CA ». Sans cette carte posée
   *   au-dessus de la branche erreur/chargement des caisses, l'écran
   *   d'erreur remplacerait tout, carte comprise.
   */
  it('[TC-271-28] un échec des caisses n’empêche pas la carte du CA de s’afficher', async () => {
    listNetworkCaisses.mockRejectedValue(new Error('permission-denied'))
    render(<PatronBoutiques />)
    expect(await screen.findByTestId('ca-reseau')).toHaveTextContent(/847\s?300\s?000/)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
