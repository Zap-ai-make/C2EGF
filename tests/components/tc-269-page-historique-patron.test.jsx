import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * TC-269 — l'historique d'un client est une PAGE, pas un panneau.
 *
 * Un panneau se ferme d'un geste accidentel et n'a pas d'adresse. Une page a un
 * retour, survit à une rotation d'écran, et se recharge.
 *
 * ⚠ RONDE DE CORRECTION 1 (I-3) — LE MOCK GARDE LA RÉFÉRENCE AU CALLBACK, IL NE
 *   L'APPELLE PLUS TOUT SEUL. La version précédente appelait `cb(clients)`
 *   dans `subscribeToAllClients` lui-même : impossible, avec ça, d'observer un
 *   état « abonné mais pas encore de réponse » (chargement) ni de déclencher
 *   `.onError`. `clientsCb` capture le callback posé par la page ; chaque test
 *   décide s'il le déclenche, et quand — enveloppé dans `act()`, motif de
 *   `tc-122-page-dettes-internes.test.jsx:81-85`.
 */

let etatHook = {
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
}
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({
  useHistoriqueClient: () => etatHook,
}))

let clientsCb = null
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: { subscribeToAllClients: (cb) => { clientsCb = cb; return vi.fn() } },
}))

const { default: PatronHistoriqueClient } = await import('../../src/pages/admin/PatronHistoriqueClient.jsx')

// Extrait en fonction (plutôt qu'en JSX direct dans `page`) pour pouvoir
// réinvoquer le MÊME arbre via `rerender(...)` — nécessaire à [TC-269-09],
// qui observe une transition d'état SANS démonter le composant.
const arbre = (id) => (
  <MemoryRouter initialEntries={[`/admin/clients/${id}/historique`]}>
    <Routes>
      <Route path="/admin/clients/:clientId/historique" element={<PatronHistoriqueClient />} />
    </Routes>
  </MemoryRouter>
)
const page = (id = 'c1') => render(arbre(id))

/** Fait arriver la liste des clients, comme le ferait Firestore. */
const pousserClients = (data) => act(() => { clientsCb(data) })
/** Fait tomber l'abonnement — `permission-denied`, coupure réseau, etc. */
const echouerClients = (err) => act(() => { clientsCb.onError(err) })

const JOUR = 24 * 60 * 60 * 1000
const debut = new Date('2026-10-01T08:00:00Z')
// ⚠ `typePlie: 'depot'` PAR DÉFAUT (I-2) : `delaiMoyen` ne mesure plus que les
//   dépôts, et ces lignes servent précisément à exercer cette mesure.
const op = (jours, typePlie = 'depot') => ({
  id: 'h' + jours, montant: 500000, type: 'Ravitaillement', statut: 'Validée',
  storeName: 'FADA', typePlie, createdAt: debut, validatedAt: new Date(debut.getTime() + jours * JOUR),
})

afterEach(cleanup)

describe('TC-269 — la fiche et le verdict', () => {
  it('[TC-269-01] le nom du client est affiché', () => {
    etatHook = { ...etatHook, lignes: [op(4)] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887' }])
    expect(screen.getByText(/OUEDRAOGO Salif/)).toBeInTheDocument()
  })

  it('[TC-269-02] le délai moyen dit sur combien d’opérations il porte', () => {
    etatHook = { ...etatHook, lignes: [op(4), { id: 'h9', typePlie: 'depot', createdAt: debut }] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    const bloc = screen.getByTestId('delai-moyen')
    expect(bloc).toHaveTextContent(/4\s*j/)
    expect(bloc).toHaveTextContent(/1 .* 2/)
  })

  /** Aucune mesure n'est un résultat, et l'écran ne doit pas écrire « 0 j ». */
  it('[TC-269-03] sans mesure, il le dit au lieu d’afficher zéro', () => {
    etatHook = { ...etatHook, lignes: [{ id: 'h1', typePlie: 'depot', createdAt: debut }] }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByTestId('delai-moyen')).not.toHaveTextContent(/\b0\s*j\b/)
  })
})

/**
 * ⚠ REVIEW FOCUS 2 — une adresse qui désigne une fiche inexistante. Signet
 *   périmé, URL tapée, fiche supprimée entre-temps. La page doit le dire.
 */
describe('TC-269 — un client introuvable', () => {
  it('[TC-269-04] la page le dit et ne plante pas', () => {
    etatHook = { ...etatHook, lignes: [] }
    page('inconnu')
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })

  it('[TC-269-05] et elle offre le retour au tableau', () => {
    page('inconnu')
    pousserClients([])
    expect(screen.getByRole('link', { name: /retour|tableau/i })).toBeInTheDocument()
  })
})

/**
 * ⚠ RONDE DE CORRECTION 1 (I-3) — LES DEUX BRANCHES AJOUTÉES PAR LA PRÉCÉDENTE
 *   RONDE N'AVAIENT AUCUN TEST. Supprimer `onClients.onError` en entier
 *   laissait les 5 tests ci-dessus verts : rien ne distinguait « pas encore de
 *   réponse » de « introuvable », et rien n'exerçait la branche d'erreur.
 */
describe('TC-269 — l’abonnement clients peut être lent ou tomber', () => {
  it('[TC-269-06] tant que rien n’est arrivé, l’écran dit qu’il charge — jamais « fiche introuvable »', () => {
    page('c1')
    // Aucun `pousserClients(...)` : l'abonnement est posé, rien n'a encore répondu.
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByText(/fiche introuvable/i)).not.toBeInTheDocument()
  })

  it('[TC-269-07] une erreur d’abonnement affiche une alerte, pas un chargement perpétuel', () => {
    page('c1')
    echouerClients(Object.assign(new Error('Accès refusé.'), { code: 'permission-denied' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/^chargement…$/i)).not.toBeInTheDocument()
  })

  it('[TC-269-08] une liste vide reçue pour un id inconnu dit « fiche introuvable »', () => {
    page('inconnu')
    pousserClients([])
    expect(screen.getByText(/fiche introuvable/i)).toBeInTheDocument()
  })
})

/**
 * ⚠ RONDE DE CORRECTION 2 (R17) — `'chargementPage'` NE DÉMONTE PLUS LE
 *   VERDICT. Mon doute n°1 de la ronde précédente : la condition stricte
 *   `etat === 'pret'` faisait clignoter le bloc `delai-moyen` à chaque clic sur
 *   « Charger plus ». Ce test clique réellement le bouton, puis simule la
 *   transition que ferait le vrai hook (`useHistoriqueClient.js:55`), et
 *   vérifie que le bloc traverse la transition sans disparaître.
 */
describe('TC-269 — « Charger plus » ne doit pas faire clignoter la moyenne', () => {
  it('[TC-269-09] le bloc delai-moyen reste affiché pendant `chargementPage`', () => {
    const chargerPlus = vi.fn()
    etatHook = { ...etatHook, etat: 'pret', lignes: [op(4)], encore: true, chargerPlus }
    const { rerender } = page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByTestId('delai-moyen')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /charger plus/i }))
    expect(chargerPlus).toHaveBeenCalled()

    // Le clic n'a rebranché que le mock `chargerPlus` : c'est à ce test de
    // reproduire la réponse du hook, exactement comme `charger(id, curseur)`
    // le ferait avant que la page suivante n'arrive.
    etatHook = { ...etatHook, etat: 'chargementPage' }
    rerender(arbre('c1'))
    expect(screen.getByTestId('delai-moyen')).toBeInTheDocument()
  })
})

/**
 * ⚠ RONDE DE CORRECTION 2 (R21) — « MOINS D'UN JOUR » N'ÉTAIT EXERCÉE PAR
 *   AUCUN TEST. La correction M-1 (ronde 1) ajoutait la phrase mais rien ne la
 *   déclenchait : `op(0.3)` règle un dépôt en ~7 h, une moyenne qui arrondit à
 *   `jours: 0` (`delaiMoyen`, arrondi au jour) sans être nulle.
 */
describe('TC-269 — un délai mesuré sous un jour ne s’affiche jamais « 0 j »', () => {
  it('[TC-269-10] un dépôt réglé en quelques heures affiche « Moins d’un jour en moyenne »', () => {
    etatHook = { ...etatHook, etat: 'pret', lignes: [op(0.3)], encore: false }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    const bloc = screen.getByTestId('delai-moyen')
    expect(bloc).toHaveTextContent(/moins d.un jour/i)
    expect(bloc).not.toHaveTextContent(/\b0\s*j\b/)
  })
})

/**
 * ⚠ RONDE DE CORRECTION 2 (R20) — LA CIBLE TACTILE DE `ErrorState` ET
 *   `LoadMoreButton`. `jsdom` ne charge aucune feuille de style Tailwind (voir
 *   `vitest.config.js`/`tests/setup.js`) : `getComputedStyle` n'y rendrait
 *   jamais la hauteur réelle d'une classe utilitaire, donc la seule vérification
 *   possible est la présence de la classe `min-h-11` elle-même — même logique
 *   que `TC-267-10` (tâche 4), qui vérifie `sticky`/`left-0` par la même
 *   contrainte.
 *
 *   PAS DANS `tc-107-composants-etats.test.jsx` : l'en-tête de ce fichier
 *   interdit explicitement « jamais une classe » pour cette famille de tests
 *   (TC-100 à TC-107, verrou anti-restyle). Une assertion de classe y
 *   contredirait la règle que le fichier existe pour faire respecter. Ce test
 *   vit donc ici, contre le rendu réel de la page qui monte les deux
 *   composants.
 */
describe('TC-269 — les boutons empruntés tiennent sous le doigt (44 px)', () => {
  it('[TC-269-11] « Charger plus » et « Réessayer » portent `min-h-11`', () => {
    etatHook = { ...etatHook, etat: 'pret', lignes: [op(4)], encore: true, erreur: null }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByRole('button', { name: /charger plus/i })).toHaveClass('min-h-11')
    cleanup()

    etatHook = { ...etatHook, etat: 'erreur', erreur: 'Service indisponible.', lignes: [], encore: false }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' }])
    expect(screen.getByRole('button', { name: /réessayer/i })).toHaveClass('min-h-11')
  })
})

/**
 * TÂCHE 6 — « Envoyer » fait sortir la fiche vers WhatsApp.
 *
 * ⚠ CE TEST VERROUILLE LE LIEN, PAS SEULEMENT SA PRÉSENCE. Relancer tc-269 en
 *   l'état aurait suffi à prouver que rien n'est cassé, pas que le bouton
 *   existe ni qu'il porte le bon texte : c'est le nom du client ET la phrase de
 *   délai — le chiffre qui sort réellement du CRM — qui sont vérifiés ici,
 *   décodés depuis le `href`, pas recopiés à la main dans l'assertion.
 */
describe('TC-269 — « Envoyer » ouvre la fiche sur WhatsApp', () => {
  it('[TC-269-12] le lien vise wa.me et porte le nom et le délai affichés', () => {
    etatHook = {
      ...etatHook,
      etat: 'pret',
      lignes: [op(4), { id: 'h9', typePlie: 'depot', createdAt: debut }],
      encore: false,
    }
    page()
    pousserClients([{ id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887' }])

    const lien = screen.getByRole('link', { name: /envoyer/i })
    expect(lien.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/)

    const texte = decodeURIComponent(lien.getAttribute('href').replace('https://wa.me/?text=', ''))
    expect(texte).toContain('OUEDRAOGO Salif')
    // Même chiffre qu'à l'écran pour ce jeu de lignes : 4 j, 1 dépôt mesuré sur
    // 2 opérations chargées (voir TC-269-02, mêmes `lignes`).
    expect(texte).toMatch(/4 j en moyenne/)
    expect(texte).toMatch(/1 dépôt mesuré sur 2 opérations chargées/)

    // ⚠ `target="_blank"` SANS `rel="noopener"` laisserait la nouvelle page
    //   WhatsApp accéder à `window.opener` — faille classique de reverse
    //   tabnabbing, ici sur un lien qui part du CRM.
    expect(lien).toHaveAttribute('target', '_blank')
    expect(lien.getAttribute('rel')).toMatch(/noopener/)
  })
})
