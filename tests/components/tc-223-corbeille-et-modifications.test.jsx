import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-223 — La corbeille, le bouton « Modifier » et le journal des corrections.
 *
 * CE QUE CES TESTS PROTÈGENT VRAIMENT
 * ───────────────────────────────────
 * Pas « le bouton existe ». Trois promesses faites aux franchises :
 *
 *   1. Une ligne supprimée QUITTE l'onglet clients — sinon son montant
 *      continuerait d'être lu comme une opération vivante, alors qu'il a été
 *      rendu aux soldes.
 *   2. Supprimer passe par une confirmation qui DIT ce qu'elle fait. La caisse
 *      n'est pas un endroit où l'on détruit une ligne par mégarde.
 *   3. Une transaction partiellement réglée est refusée AVANT le clic, avec sa
 *      raison. Le serveur la refuse déjà ; un bouton actif qui échoue ensuite
 *      apprendrait la règle par l'erreur.
 *
 * LE CAS QUI MÉRITE LE PLUS D'ATTENTION
 * ─────────────────────────────────────
 * TC-223-05 : « Modifier » doit emmener le gérant sur /transactions. Le
 * formulaire n'habite pas l'historique — oublier la navigation produirait un
 * clic qui rend l'argent aux soldes et ne montre rien, le pire des deux mondes.
 */

let transactionsValue
const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const reel = await vi.importActual('react-router-dom')
  return { ...reel, useNavigate: () => navigate }
})
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))
vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: ({ onUpdate }) => {
    onUpdate({ requests: [] })
    return () => {}
  },
}))
vi.mock('../../src/components/historique/DateFilter', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ClientSearch', () => ({ default: () => null }))
vi.mock('../../src/components/historique/ActionButtons', () => ({ default: () => null }))
vi.mock('../../src/components/historique/DailyPagination', () => ({ default: () => null }))

import Historique from '../../src/pages/Historique.jsx'
import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

const SIMPLE = {
  id: 'h-1',
  type: 'Dépôt',
  reseau: 'Orange',
  code: '000111',
  montant: 50_000,
  statut: 'Encaissé par Cash',
  // `validateDraft` pose TOUJOURS ce champ sur une ligne validée : c'est lui
  // que la réouverture rejoue. Un fixture qui l'oublie ne ressemble à aucune
  // ligne de production.
  paymentMethod: 'Cash',
  effectiveNetwork: 'Liquidite',
  clientId: 'c-1',
  client: { nom: 'Ouedraogo', prenom: 'Kader' },
  date: '06/10/2026 14:32',
  operatorName: 'Awa',
  remainingAmount: 0,
  settlementStatus: 'settled',
}

const CORRIGEE = {
  ...SIMPLE,
  id: 'h-2',
  montant: 45_000,
  modifications: [
    { avant: 50_000, apres: 48_000, at: new Date('2026-10-06T15:12:00Z'), by: 'u1', byName: 'Awa' },
    { avant: 48_000, apres: 45_000, at: new Date('2026-10-06T15:20:00Z'), by: 'u1', byName: 'Awa' },
  ],
}

const PARTIELLE = { ...SIMPLE, id: 'h-3', settlementStatus: 'partial', remainingAmount: 20_000 }

// Ligne importée ou migrée : validée, mais sans mode de règlement à rejouer.
const SANS_REGLEMENT = { ...SIMPLE, id: 'h-6', statut: 'Validée', paymentMethod: undefined }

const SUPPRIMEE_HISTORIQUE = {
  ...SIMPLE,
  id: 'h-4',
  statut: 'Supprimée',
  origin: 'history',
  deletedAt: new Date('2026-10-06T15:10:00Z'),
  deletedByName: 'Awa',
}

const SUPPRIMEE_BROUILLON = {
  ...SIMPLE,
  id: 'h-5',
  type: 'Retrait',
  montant: 25_000,
  statut: 'Supprimée',
  origin: 'draft',
  deletedAt: new Date('2026-10-06T14:48:00Z'),
  deletedByName: 'Awa',
}

const contexteBase = (completed = []) => ({
  completedTransactions: completed,
  pendingTransactions: [],
  historyHasMore: false,
  historyLoadingMore: false,
  loadMoreHistory: vi.fn(),
  getTransactionStyles: () => ({ textColor: '' }),
  trashTransaction: vi.fn().mockResolvedValue(undefined),
  reopenTransaction: vi.fn().mockResolvedValue('draft-9'),
})

const afficherPage = (onglet) =>
  render(
    <MemoryRouter initialEntries={[`/historique?onglet=${onglet}`]}>
      <Historique />
    </MemoryRouter>,
  )

// Monté SANS routeur, volontairement : si `HistoriqueTable` reprenait un jour
// `useNavigate()`, ces montages casseraient aussitôt — comme TC-091 l'a fait.
const afficherTable = (transactions) =>
  render(<HistoriqueTable transactions={transactions} />)

beforeEach(() => {
  navigate.mockReset()
  transactionsValue = contexteBase()
})

// ---------------------------------------------------------------------------
// Les boutons de l'historique
// ---------------------------------------------------------------------------

describe('TC-223 — actions sur une ligne d’historique', () => {
  it('[TC-223-01] offre « Modifier » et « Supprimer » sur chaque ligne', () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    expect(screen.getByTestId('modifier-historique')).toBeEnabled()
    expect(screen.getByTestId('supprimer-historique')).toBeEnabled()
  })

  it('[TC-223-02] « Supprimer » demande confirmation avant d’agir', async () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    fireEvent.click(screen.getByTestId('supprimer-historique'))

    const modal = within(screen.getByTestId('confirmer-suppression-historique'))
    // La confirmation nomme la ligne et dit ce que le geste produit : sans ça
    // elle ne fait que ralentir, elle n'informe pas.
    expect(modal.getByText(/Ouedraogo/)).toBeInTheDocument()
    expect(modal.getByText(/rendu aux soldes/)).toBeInTheDocument()
    expect(modal.getByText(/ne pourra pas être restaurée/)).toBeInTheDocument()
    expect(transactionsValue.trashTransaction).not.toHaveBeenCalled()
  })

  it('[TC-223-03] confirmer supprime la bonne ligne', async () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    fireEvent.click(screen.getByTestId('supprimer-historique'))
    fireEvent.click(screen.getByTestId('confirmer-supprimer'))

    await waitFor(() => expect(transactionsValue.trashTransaction).toHaveBeenCalledWith('h-1'))
  })

  it('[TC-223-04] annuler la confirmation ne supprime rien', async () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    fireEvent.click(screen.getByTestId('supprimer-historique'))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(transactionsValue.trashTransaction).not.toHaveBeenCalled()
  })

  /**
   * LE REFUS DU SERVEUR SE LIT, MOT POUR MOT.
   *
   * Ces deux gestes sont refuses pour une dizaine de raisons distinctes — un
   * reglement partiel, une liquidite deja videe, un historique incomplet, un
   * retrait anterieur a l enregistrement de la repartition — et chacune se
   * corrige autrement.
   *
   * Le premier jet les avalait toutes dans un `catch` vide, en pariant que le
   * contexte afficherait l erreur. Il la STOCKE, mais aucun ecran ne la lit :
   * le clic ne produisait donc rien du tout. Du siege, ou les lignes sont
   * recentes, tout passait ; en franchise, sur des lignes plus anciennes, on
   * obtenait un bouton qui semblait casse. Dix diagnostics reduits a un seul
   * « ca ne marche pas », que personne ne peut rapporter.
   */
  it('[TC-223-28] une suppression refusée affiche la raison, dans la confirmation', async () => {
    transactionsValue = contexteBase([SIMPLE])
    transactionsValue.trashTransaction = vi.fn()
      .mockRejectedValue(new Error('Liquidite insuffisante. Disponible: 0 FCFA'))
    afficherTable([SIMPLE])

    fireEvent.click(screen.getByTestId('supprimer-historique'))
    fireEvent.click(screen.getByTestId('confirmer-supprimer'))

    const message = await screen.findByTestId('echec-suppression-historique')
    expect(message).toHaveTextContent('Liquidite insuffisante. Disponible: 0 FCFA')
    // Le modal RESTE ouvert : il porte le message, et se fermer donnerait a
    // croire que la suppression a eu lieu.
    expect(screen.getByTestId('confirmer-suppression-historique')).toBeInTheDocument()
  })

  it('[TC-223-29] une réouverture refusée affiche la raison, qui n’a pas de modal à elle', async () => {
    transactionsValue = contexteBase([SIMPLE])
    // `onReopen` est une prop : on la fait echouer comme le ferait la page.
    render(
      <HistoriqueTable
        transactions={[SIMPLE]}
        onReopen={() => Promise.reject(new Error('Une transaction partiellement réglée se corrige par un remboursement.'))}
      />,
    )
    fireEvent.click(screen.getByTestId('modifier-historique'))

    const modal = await screen.findByTestId('echec-action-historique')
    expect(within(modal).getByText(/partiellement réglée/)).toBeInTheDocument()
  })

  // Par la PAGE, pas par le tableau : c'est elle qui enchaîne la réouverture et
  // le déplacement, et c'est l'enchaînement qu'il faut protéger.
  it('[TC-223-05] « Modifier » rouvre la ligne ET emmène sur le formulaire', async () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherPage('clients')

    fireEvent.click(screen.getByTestId('modifier-historique'))

    await waitFor(() => expect(transactionsValue.reopenTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h-1' }),
    ))
    // Le formulaire vit sur /transactions : rouvrir sans y aller rendrait
    // l'argent aux soldes sans rien montrer au gérant.
    expect(navigate).toHaveBeenCalledWith('/transactions')
  })

  /**
   * Une transaction validée d'un geste depuis le formulaire n'a pas de mode de
   * règlement. L'exiger pour pouvoir corriger bloquait un cas parfaitement
   * courant ; la revalidation sait désormais rejouer les deux jambes de ce
   * geste, et les deux boutons redeviennent disponibles.
   */
  it('[TC-223-19] une ligne sans mode de règlement se supprime ET se rouvre', () => {
    transactionsValue = contexteBase([SANS_REGLEMENT])
    afficherTable([SANS_REGLEMENT])

    expect(screen.getByTestId('supprimer-historique')).toBeEnabled()
    expect(screen.getByTestId('modifier-historique')).toBeEnabled()
  })

  it('[TC-223-06] une ligne partiellement réglée a ses deux boutons barrés, avec la raison', () => {
    transactionsValue = contexteBase([PARTIELLE])
    afficherTable([PARTIELLE])

    const modifier = screen.getByTestId('modifier-historique')
    const supprimer = screen.getByTestId('supprimer-historique')
    expect(modifier).toBeDisabled()
    expect(supprimer).toBeDisabled()
    expect(modifier).toHaveAttribute('title', expect.stringContaining('remboursement'))
    expect(supprimer).toHaveAttribute('title', expect.stringContaining('remboursement'))
  })
})

// ---------------------------------------------------------------------------
// Le journal des modifications
// ---------------------------------------------------------------------------

describe('TC-223 — journal des modifications', () => {
  it('[TC-223-07] n’affiche pas « Modification » sur une ligne jamais corrigée', () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    expect(screen.queryByTestId('ouvrir-modifications')).not.toBeInTheDocument()
  })

  it('[TC-223-08] affiche « Modification » avec le nombre de corrections', () => {
    transactionsValue = contexteBase([CORRIGEE])
    afficherTable([CORRIGEE])

    expect(screen.getByTestId('ouvrir-modifications')).toHaveTextContent('Modification')
    expect(screen.getByTestId('ouvrir-modifications')).toHaveTextContent('(2)')
  })

  it('[TC-223-09] liste chaque correction « avant → après » dans l’ordre', async () => {
    transactionsValue = contexteBase([CORRIGEE])
    afficherTable([CORRIGEE])

    fireEvent.click(screen.getByTestId('ouvrir-modifications'))

    const entrees = within(screen.getByTestId('journal-modifications')).getAllByRole('listitem')
    expect(entrees).toHaveLength(2)
    // Chronologique, pas inverse : on lit une histoire, pas un flux d'actualité.
    expect(entrees[0]).toHaveTextContent('50 000')
    expect(entrees[0]).toHaveTextContent('48 000')
    expect(entrees[1]).toHaveTextContent('48 000')
    expect(entrees[1]).toHaveTextContent('45 000')
  })

  it('[TC-223-10] horodate chaque correction et nomme son auteur', async () => {
    transactionsValue = contexteBase([CORRIGEE])
    afficherTable([CORRIGEE])

    fireEvent.click(screen.getByTestId('ouvrir-modifications'))

    const entrees = within(screen.getByTestId('journal-modifications')).getAllByRole('listitem')
    expect(entrees[0]).toHaveTextContent('06/10/2026')
    expect(entrees[0]).toHaveTextContent('Awa')
  })
})

// ---------------------------------------------------------------------------
// L'onglet corbeille
// ---------------------------------------------------------------------------

describe('TC-223 — la corbeille', () => {
  it('[TC-223-11] une ligne supprimée quitte l’onglet clients', () => {
    transactionsValue = contexteBase([SIMPLE, SUPPRIMEE_HISTORIQUE])
    afficherPage('clients')

    // La ligne vivante reste ; la supprimée a rendu son montant et s'en va.
    // `getClientName` compose « prénom nom », pas l'inverse.
    expect(screen.getByText('Kader Ouedraogo')).toBeInTheDocument()
    expect(screen.getAllByTestId('supprimer-historique')).toHaveLength(1)
  })

  it('[TC-223-12] rassemble les deux provenances dans une seule liste', () => {
    transactionsValue = contexteBase([SIMPLE, SUPPRIMEE_HISTORIQUE, SUPPRIMEE_BROUILLON])
    afficherPage('corbeille')

    const lignes = screen.getAllByTestId('ligne-corbeille')
    expect(lignes).toHaveLength(2)
    // Triées par heure de suppression, la plus récente d'abord (15h10 > 14h48).
    expect(lignes[0]).toHaveTextContent('Historique')
    expect(lignes[1]).toHaveTextContent('Non terminée')
  })

  it('[TC-223-13] n’offre aucun bouton : rien ne revient de la corbeille', () => {
    transactionsValue = contexteBase([SUPPRIMEE_HISTORIQUE])
    afficherPage('corbeille')

    const ligne = within(screen.getByTestId('ligne-corbeille'))
    expect(ligne.queryByRole('button')).not.toBeInTheDocument()
  })

  it('[TC-223-14] dit qui a supprimé et quand', () => {
    transactionsValue = contexteBase([SUPPRIMEE_HISTORIQUE])
    afficherPage('corbeille')

    const ligne = screen.getByTestId('ligne-corbeille')
    expect(ligne).toHaveTextContent('Awa')
    expect(ligne).toHaveTextContent('06/10/2026')
  })

  it('[TC-223-15] annonce une corbeille vide au lieu d’un tableau nu', () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherPage('corbeille')

    expect(screen.getByText('La corbeille est vide')).toBeInTheDocument()
    expect(screen.queryByTestId('ligne-corbeille')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Le bouton « Supprimer » des non terminées
//
// Même geste, autre tableau — et un enjeu financier différent : ici c'est le
// STOCK engagé par la saisie qui est rendu, pas une liquidité encaissée. Le
// contexte route sur la provenance, l'appelant n'a qu'un identifiant à donner.
// ---------------------------------------------------------------------------

const BROUILLON = {
  id: 'd-1',
  type: 'Dépôt',
  reseau: 'Orange',
  code: '000111',
  montant: 30_000,
  statut: 'Non Terminées',
  clientId: 'c-1',
  client: { nom: 'Diallo', prenom: 'Aïssata' },
  date: '06/10/2026 16:02',
}

describe('TC-223 — suppression d’une non terminée', () => {
  beforeEach(() => {
    transactionsValue = {
      ...contexteBase(),
      pendingTransactions: [BROUILLON],
      getActionButtons: () => ({ modifier: true, encaisser: true, payerPar: false, rembourser: false }),
      startEditTransaction: vi.fn(),
      addPaymentTranche: vi.fn(),
      addRefundTranche: vi.fn(),
      loading: false,
    }
  })

  it('[TC-223-16] offre « Supprimer » sur chaque ligne non terminée', () => {
    render(<TransactionTable />)
    expect(screen.getByTestId('supprimer-non-terminee')).toBeEnabled()
  })

  it('[TC-223-17] demande confirmation et annonce que le stock sera rendu', () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('supprimer-non-terminee'))

    const modal = within(screen.getByTestId('confirmer-suppression-non-terminee'))
    expect(modal.getByText(/Aïssata/)).toBeInTheDocument()
    expect(modal.getByText(/stock engagé sera rendu/)).toBeInTheDocument()
    expect(transactionsValue.trashTransaction).not.toHaveBeenCalled()
  })

  it('[TC-223-18] confirmer supprime le bon brouillon', async () => {
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('supprimer-non-terminee'))
    fireEvent.click(screen.getByTestId('confirmer-supprimer-non-terminee'))

    await waitFor(() => expect(transactionsValue.trashTransaction).toHaveBeenCalledWith('d-1'))
  })
})

// ---------------------------------------------------------------------------
// Les colonnes d'opérateur, pilotées par le profil
// ---------------------------------------------------------------------------

describe('TC-223 — colonnes d’opérateur', () => {
  it('[TC-223-20] le profil C2EGF masque « Utilisateur » et « Email utilisateur »', () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    // Toute la boutique opère sous un compte unique : les deux colonnes
    // répétaient la même valeur sur chaque ligne et repoussaient les actions
    // hors de l'écran. Les CHAMPS restent écrits — seule la colonne s'en va.
    const entetes = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    expect(entetes).not.toContain('Utilisateur')
    expect(entetes).not.toContain('Email utilisateur')
    expect(entetes).toEqual([
      'Date & heure', 'Client', 'Type', 'Code', 'Montant', 'Statut', 'Actions',
    ])
  })

  it('[TC-223-21] chaque ligne compte autant de cellules que d’en-têtes', () => {
    transactionsValue = contexteBase([SIMPLE])
    afficherTable([SIMPLE])

    // Le garde-fou qui attrape un décalage : masquer deux en-têtes sans masquer
    // les deux cellules produirait un tableau dont les colonnes glissent.
    const entetes = document.querySelectorAll('thead th').length
    const cellules = document.querySelectorAll('tbody tr td').length
    expect(cellules).toBe(entetes)
  })
})

// ---------------------------------------------------------------------------
// Les totaux en attente, et la colonne Code
// ---------------------------------------------------------------------------

describe('TC-223 — totaux des non terminées', () => {
  const brouillon = (over) => ({
    id: 'd-x', type: 'Dépôt', reseau: 'Orange', code: '000111', montant: 10_000,
    statut: 'Non Terminées', clientId: 'c-1', client: { nom: 'Diallo', prenom: 'Aïssata' },
    date: '06/10/2026 16:02', ...over,
  })

  const poser = (pending) => {
    transactionsValue = {
      ...contexteBase(),
      pendingTransactions: pending,
      getActionButtons: () => ({ modifier: true, encaisser: true, payerPar: false, rembourser: false }),
      startEditTransaction: vi.fn(),
      addPaymentTranche: vi.fn(),
      addRefundTranche: vi.fn(),
      loading: false,
    }
    render(<TransactionTable />)
  }

  it('[TC-223-22] additionne séparément les dépôts et les retraits', () => {
    poser([
      brouillon({ id: 'd-1', type: 'Dépôt', montant: 10_000 }),
      brouillon({ id: 'd-2', type: 'Dépôt', montant: 5_000 }),
      brouillon({ id: 'd-3', type: 'Retrait', montant: 8_000 }),
    ])

    expect(screen.getByTestId('total-depots-non-terminees')).toHaveTextContent('15 000')
    expect(screen.getByTestId('total-retraits-non-terminees')).toHaveTextContent('8 000')
  })

  it('[TC-223-23] tolère les libellés sans accent, écrits à une autre époque', () => {
    // « Depot » sans accent existe en base : un total qui l’ignorerait
    // afficherait un chiffre que la caissière ne retrouverait pas dans sa caisse.
    poser([brouillon({ id: 'd-1', type: 'Depot', montant: 7_000 })])
    expect(screen.getByTestId('total-depots-non-terminees')).toHaveTextContent('7 000')
  })

  it('[TC-223-24] affiche zéro plutôt que de disparaître quand il n’y a rien', () => {
    poser([brouillon({ id: 'd-1', type: 'Retrait', montant: 3_000 })])
    expect(screen.getByTestId('total-depots-non-terminees')).toHaveTextContent('0')
    expect(screen.getByTestId('total-retraits-non-terminees')).toHaveTextContent('3 000')
  })

  it('[TC-223-25] la colonne Réseau cède la place au Code', () => {
    poser([brouillon({ id: 'd-1', code: '7242979' })])

    const entetes = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    expect(entetes).toContain('Code')
    expect(entetes).not.toContain('Réseau')
    expect(screen.getByText('7242979')).toBeInTheDocument()
  })

  /**
   * LE COMPTE COIFFE SON TOTAL.
   *
   * Il vivait dans un sous-titre de page qui recitait « 3 transactions non
   * terminees · 2 depots, 1 retrait », a l autre bout de l ecran des montants
   * qu il denombrait. TC-127 interdit son retour ; ces deux assertions-ci
   * fixent ou il est alle.
   */
  it('[TC-223-26] chaque case porte le nombre de transactions de son type', () => {
    poser([
      brouillon({ id: 'd-1', type: 'Dépôt', montant: 10_000 }),
      brouillon({ id: 'd-2', type: 'Dépôt', montant: 5_000 }),
      brouillon({ id: 'd-3', type: 'Retrait', montant: 8_000 }),
    ])

    expect(screen.getByTestId('nombre-depots-non-terminees')).toHaveTextContent('2')
    expect(screen.getByTestId('nombre-retraits-non-terminees')).toHaveTextContent('1')
  })

  it('[TC-223-27] le nombre reste visible a zero, comme le total', () => {
    // Une case qui disparait quand elle vaut zero oblige a se demander si elle
    // est absente ou si elle est vide. Zero est une reponse, pas un vide.
    poser([brouillon({ id: 'd-1', type: 'Retrait', montant: 3_000 })])
    expect(screen.getByTestId('nombre-depots-non-terminees')).toHaveTextContent('0')
    expect(screen.getByTestId('nombre-retraits-non-terminees')).toHaveTextContent('1')
  })
})
