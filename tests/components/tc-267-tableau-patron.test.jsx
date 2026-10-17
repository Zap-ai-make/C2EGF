import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-267 — le tableau du patron : celui du gérant, en lecture seule, sur toute
 * la base.
 *
 * ⚠ RONDE 1 — `act()` AUTOUR DE CHAQUE POUSSÉE, PAS `flushSync` DANS LE
 *   COMPOSANT. Un callback de snapshot capturé et rappelé directement (hors
 *   `fireEvent`) déclenche une mise à jour d'état hors du cycle de rendu React
 *   — et avec un root concurrent (celui que monte `@testing-library/react`),
 *   React ne la flush plus de façon synchrone. `flushSync` fait bien flusher
 *   la mise à jour, mais ne supprime pas l'avertissement « not wrapped in
 *   act(...) » : celui-ci dépend seulement de `ReactSharedInternals.actQueue`,
 *   que `flushSync` ne pose jamais. Le test, pas le composant, doit poser ce
 *   contexte — motif déjà dans le dépôt :
 *   `tests/components/tc-122-page-dettes-internes.test.jsx:81-85`.
 *
 * ⚠ LA RECHERCHE EST AMORTIE (~150 ms, PatronClients.jsx) : un `fireEvent.change`
 *   ne retouche plus le DOM dans la même microtâche. Les poussées qui suivent
 *   un changement de terme passent donc par `waitFor`, pas par une assertion
 *   immédiate.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

let recoit = null
const desabonner = vi.fn()
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: {
    subscribeToAllClients: (cb) => { recoit = cb; return desabonner },
  },
}))

const { default: PatronClients } = await import('../../src/pages/admin/PatronClients.jsx')

const fiche = (over = {}) => ({
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', registeredStoreName: 'FADA',
  numeroIdentite: 'B 029', numeroPersonnel: '76548890', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga', agentCommercial: 'SORE',
  dateAjout: '04/02/2026', ...over,
})

const ecran = () => render(<MemoryRouter><PatronClients /></MemoryRouter>)

// Le motif de tc-122 : la poussée vient de « hors React » (un abonnement
// Firestore, ici son double de test), donc le test l'enveloppe lui-même.
const pousser = (fiches) => act(() => { recoit(fiches) })

beforeEach(() => { navigate.mockClear(); recoit = null })
afterEach(cleanup)

describe('TC-267 — ce que le tableau montre', () => {
  it('[TC-267-01] 11 en-têtes, et pas de colonne Actions', () => {
    ecran()
    pousser([fiche()])
    const entetes = screen.getAllByRole('columnheader')
    expect(entetes).toHaveLength(11)
    expect(entetes.map(e => e.textContent)).not.toContain('Actions')
  })

  it('[TC-267-02] aucun bouton Modifier : le patron n’écrit rien', () => {
    ecran()
    pousser([fiche()])
    expect(screen.queryByRole('button', { name: /modifier/i })).toBeNull()
  })

  it('[TC-267-03] ni export ni import Excel', () => {
    ecran()
    pousser([fiche()])
    expect(screen.queryByRole('button', { name: /export|import/i })).toBeNull()
  })

  /**
   * ⚠ REVIEW FOCUS 3 — une fiche d'avant la séparation des champs agent. Son
   *   code dort dans `orange` ; `champsAgent` le range à la lecture. La ligne
   *   doit s'afficher, et la recherche doit la trouver.
   */
  it('[TC-267-04] une fiche ancienne (code dans `orange`) s’affiche et se trouve', async () => {
    ecran()
    pousser([fiche({ codeAgent: '', numeroAgent: '', orange: '6412887' })])
    expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '6412887' } })
    await waitFor(() => expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument())
  })
})

describe('TC-267 — la recherche est celle de l’application', () => {
  it('[TC-267-05] un nom complet trouve, nom et prénom étant deux champs', async () => {
    ecran()
    pousser([fiche(), fiche({ id: 'c2', nom: 'KABORE', prenom: 'Alimata', codeAgent: '6503112' })])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'ouedraogo salif' } })
    // Les deux assertions DANS le même `waitFor` : OUEDRAOGO correspond aussi
    // à la liste non filtrée (avant que l'amortissement n'applique le terme),
    // donc une attente qui ne vérifierait que sa présence se résoudrait trop
    // tôt — avant que KABORE n'ait eu le temps de disparaître.
    await waitFor(() => {
      expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument()
      expect(screen.queryByText('KABORE')).toBeNull()
    })
  })

  it('[TC-267-06] un numéro espacé égale le même numéro collé', async () => {
    ecran()
    pousser([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: '70 11 22 33' } })
    await waitFor(() => expect(screen.getByText('OUEDRAOGO')).toBeInTheDocument())
  })

  it('[TC-267-07] rien trouvé le dit', async () => {
    ecran()
    pousser([fiche()])
    fireEvent.change(screen.getByLabelText(/chercher/i), { target: { value: 'zzzz' } })
    await waitFor(() => expect(screen.getByText(/rien trouvé|aucun/i)).toBeInTheDocument())
  })
})

describe('TC-267 — l’historique est une page', () => {
  it('[TC-267-08] le bouton navigue vers la page du client', () => {
    ecran()
    pousser([fiche()])
    fireEvent.click(screen.getByRole('button', { name: /historique de OUEDRAOGO/i }))
    expect(navigate).toHaveBeenCalledWith('/admin/clients/c1/historique')
  })
})

describe('TC-267 — le cycle de l’abonnement', () => {
  it('[TC-267-09] il se coupe au démontage', () => {
    const { unmount } = ecran()
    unmount()
    expect(desabonner).toHaveBeenCalled()
  })
})

/**
 * F-1 (ronde 1) — la colonne Nom doit rester lisible pendant le défilement
 * horizontal : le `th` ET le `td` sticky, au bon niveau de superposition. Sans
 * ce test, une régression sur l'un des deux (ou sur l'ordre des `z-index`)
 * ne casse aucune assertion existante — c'est précisément ce qui s'est passé.
 */
describe('TC-267 — le nom reste lisible pendant le défilement horizontal', () => {
  it('[TC-267-10] contrat CSS : sticky + left:0 sur le th et le td Nom, empilement à trois niveaux', () => {
    ecran()
    pousser([fiche()])

    const theadNom = screen.getByRole('columnheader', { name: 'Nom' })
    const theadAutre = screen.getByRole('columnheader', { name: 'Boutique' })
    const tdNom = screen.getByText('OUEDRAOGO')

    expect(theadNom).toHaveClass('sticky', 'left-0')
    expect(tdNom).toHaveClass('sticky', 'left-0')

    // Le coin haut-gauche ne se résout qu'à trois niveaux : le th Nom (sticky
    // en haut ET à gauche, le coin lui-même) au-dessus des autres th (sticky
    // en haut seulement), eux-mêmes au-dessus du td Nom (sticky à gauche
    // seulement) — sinon une ligne qui défile repeint par-dessus l'en-tête,
    // ou un en-tête voisin recouvre celui de Nom.
    const zDe = (el) => Number(el.className.match(/\bz-(\d+)\b/)?.[1] ?? 0)
    expect(zDe(theadNom)).toBeGreaterThan(zDe(theadAutre))
    expect(zDe(theadAutre)).toBeGreaterThan(zDe(tdNom))
  })
})

/**
 * F-3 (ronde 1) — un abonnement qui échoue, et une base légitimement vide, ne
 * sont pas la même chose que « en cours de chargement ». Les trois états.
 */
describe('TC-267 — l’abonnement peut tomber, la base peut être vide', () => {
  it('[TC-267-11] une erreur poussée affiche un bandeau, jamais « Chargement… »', () => {
    ecran()
    act(() => { recoit.onError(new Error('Permission refusée.')) })
    expect(screen.getByRole('alert')).toHaveTextContent('Permission refusée.')
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('[TC-267-12] une liste vide reçue dit « aucune fiche », pas « Chargement… »', () => {
    ecran()
    pousser([])
    expect(screen.getByText(/aucune fiche/i)).toBeInTheDocument()
    expect(screen.queryByText('Chargement…')).toBeNull()
  })
})

/**
 * F-4 (ronde 1) — on plafonne l'AFFICHAGE, pas la recherche : `chercherClients`
 * voit toujours la base entière (couvert par TC-267-05/06/07), mais le DOM
 * rendu, lui, s'arrête à 50 lignes, et le reste est annoncé.
 */
describe('TC-267 — l’affichage est plafonné, pas la recherche', () => {
  it('[TC-267-13] au plus 50 lignes rendues, et le reste annoncé', () => {
    ecran()
    const fiches = Array.from({ length: 60 }, (_, i) =>
      fiche({ id: `c${i}`, nom: `CLIENT${String(i).padStart(2, '0')}` }))
    pousser(fiches)

    const lignes = screen.getAllByRole('row').slice(1) // retire la ligne d'en-tête
    expect(lignes).toHaveLength(50)
    expect(screen.getByText(/50 affichées sur 60/i)).toBeInTheDocument()
  })
})
