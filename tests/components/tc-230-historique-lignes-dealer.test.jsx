import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

/**
 * TC-230 — Le ravitaillement et le retour dans l'historique.
 *
 * CE QUI ÉTAIT CASSÉ, ET POURQUOI ÇA NE SE VOYAIT PAS
 * ──────────────────────────────────────────────────
 * Ces deux lignes vivent dans le même tableau que les dépôts et les retraits —
 * et c'est voulu : le gérant relit sa journée d'un seul tenant. Mais elles
 * empruntaient aussi l'HABILLAGE d'une transaction client, et mentaient trois
 * fois :
 *
 *   1. « Client inconnu » sous une ligne dont l'expéditeur est écrit dans le
 *      document. Le nom existait, personne ne le montrait.
 *   2. Un montant nu, identique pour une livraison reçue et pour un retour
 *      rendu — deux mouvements opposés affichés pareil.
 *   3. Deux boutons que le serveur REFUSE TOUJOURS (storeTransactionCommand.js,
 *      `refuserSiIntouchable`). Cliquer ne pouvait produire qu'une erreur.
 *
 * LE POINT LE PLUS IMPORTANT DU FICHIER
 * ─────────────────────────────────────
 * TC-230-11 : supprimer un RETOUR passe par `trashReplenishmentReturn`, jamais
 * par `trashHistory`. Les deux rendraient bien le montant à la réserve, mais
 * seule la première fait REMONTER le reste dû de la livraison. Se tromper de
 * commande laisserait la livraison soldée à tort : la boutique croirait ne plus
 * rien devoir, alors qu'elle doit encore.
 */

// ── Dépendances du tableau ───────────────────────────────────────────────────
const trashTransaction = vi.fn()

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

// ── Dépendances du provider réel (section B) ─────────────────────────────────
const service = {
  subscribeToDrafts: vi.fn(),
  getHistoryPage: vi.fn(),
  subscribeToHistory: vi.fn(),
  trashHistory: vi.fn(),
  trashReplenishmentReturn: vi.fn(),
}

vi.mock('../../src/services/firestore', () => ({
  firestoreService: new Proxy({}, { get: (_, nom) => (...args) => service[nom](...args) }),
}))
vi.mock('../../src/services/settlementService', () => ({
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: React.createContext(null),
}))

import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import {
  TransactionsContext,
  TransactionsProvider,
  useTransactions,
} from '../../src/context/transactions.jsx'
import { AuthContext } from '../../src/context/AuthContext'

const ravitaillement = (over = {}) => ({
  id: 'rav-1',
  type: 'Ravitaillement',
  expediteur: 'Patron',
  montant: 3_000_000,
  balanceType: 'stock',
  statut: 'Validée',
  date: '08/10/2026 08:00',
  ...over,
})

const retour = (over = {}) => ({
  id: 'ret-1',
  type: 'Retour',
  expediteur: 'Patron',
  replenishmentId: 'rav-1',
  montant: 1_500_000,
  balanceType: 'liquidite',
  statut: 'Validée',
  date: '08/10/2026 14:24',
  ...over,
})

const client = (over = {}) => ({
  id: 'tx-1',
  type: 'Dépôt',
  client: { prenom: 'Mamadou', nom: 'Traoré' },
  code: '77123456',
  montant: 150_000,
  statut: 'Validée',
  date: '08/10/2026 10:00',
  ...over,
})

const contexte = {
  getTransactionStyles: () => ({ textColor: '' }),
  trashTransaction,
}

const afficher = (transactions) => render(
  <TransactionsContext.Provider value={contexte}>
    <HistoriqueTable transactions={transactions} onReopen={vi.fn()} />
  </TransactionsContext.Provider>,
)

/** La ligne du tableau qui contient ce texte. */
const ligneDe = (texte) => screen.getByText(texte).closest('tr')

beforeEach(() => {
  trashTransaction.mockReset().mockResolvedValue(undefined)
})

describe('TC-230 — ce que la ligne dit', () => {
  it('[TC-230-1] un ravitaillement montre son expéditeur, pas « Client inconnu »', () => {
    afficher([ravitaillement()])

    expect(screen.getByTestId('expediteur-ligne')).toHaveTextContent('Patron')
    expect(screen.queryByText('Client inconnu')).not.toBeInTheDocument()
  })

  it('[TC-230-2] un retour aussi — c’est la même personne qu’on rembourse', () => {
    afficher([retour()])

    expect(screen.getByTestId('expediteur-ligne')).toHaveTextContent('Patron')
    expect(screen.queryByText('Client inconnu')).not.toBeInTheDocument()
  })

  it('[TC-230-3] la ligne dit de quelle réserve il s’agit', () => {
    afficher([retour({ balanceType: 'liquidite' }), ravitaillement({ balanceType: 'stock' })])

    expect(within(ligneDe('Retour')).getByText('· espèce')).toBeInTheDocument()
    expect(within(ligneDe('Ravitaillement')).getByText('· stock')).toBeInTheDocument()
  })

  /**
   * Les deux mouvements sont OPPOSÉS : l'un remplit la réserve, l'autre la
   * vide. Affichés tous deux « 1 500 000 FCFA », ils ne se distinguaient qu'en
   * relisant la colonne Type — alors que l'œil est déjà sur le montant.
   */
  it('[TC-230-4] le signe distingue ce qui entre de ce qui sort', () => {
    afficher([ravitaillement({ montant: 3_000_000 }), retour({ montant: 1_500_000 })])

    expect(within(ligneDe('Ravitaillement')).getByText(/^\+ /)).toBeInTheDocument()
    expect(within(ligneDe('Retour')).getByText(/^− /)).toBeInTheDocument()
  })

  it('[TC-230-5] une livraison sans expéditeur reste lisible', () => {
    afficher([ravitaillement({ expediteur: undefined })])
    expect(screen.getByTestId('expediteur-ligne')).toHaveTextContent('Sans expéditeur')
  })

  /**
   * ⚠ ANTI-RÉGRESSION. Tout ce qui précède ne doit RIEN changer à la ligne
   *   d'une transaction client — c'est l'écrasante majorité du tableau.
   */
  it('[TC-230-6] une transaction client garde son nom, son code et ses deux boutons', () => {
    afficher([client()])
    const ligne = within(ligneDe('Mamadou Traoré'))

    expect(ligne.getByText('77123456')).toBeInTheDocument()
    expect(ligne.getByText('150 000 FCFA')).toBeInTheDocument()
    expect(ligne.getByTestId('modifier-historique')).toBeInTheDocument()
    expect(ligne.getByTestId('supprimer-historique')).toBeInTheDocument()
    expect(screen.queryByTestId('expediteur-ligne')).not.toBeInTheDocument()
  })
})

describe('TC-230 — ce que la ligne permet', () => {
  /**
   * Le serveur refuse ces deux gestes sur un ravitaillement
   * (`refuserSiIntouchable`), et il a raison : le défaire laisserait ses
   * retours orphelins, rattachés à une livraison disparue. Des boutons qui ne
   * peuvent qu'échouer apprennent la règle par l'erreur.
   */
  it('[TC-230-7] un ravitaillement n’offre ni Modifier ni Supprimer', () => {
    afficher([ravitaillement()])

    expect(screen.queryByTestId('modifier-historique')).not.toBeInTheDocument()
    expect(screen.queryByTestId('supprimer-historique')).not.toBeInTheDocument()
  })

  it('[TC-230-8] et dit par quoi il se défait', () => {
    afficher([ravitaillement()])
    expect(screen.getByTestId('ravitaillement-sans-action')).toHaveTextContent('Se défait par un retour')
  })

  it('[TC-230-9] un retour se supprime, mais ne se modifie pas', () => {
    afficher([retour()])

    expect(screen.getByTestId('supprimer-retour')).toBeInTheDocument()
    expect(screen.queryByTestId('modifier-historique')).not.toBeInTheDocument()
  })

  /**
   * La conséquence d'un retour défait n'est pas celle d'une transaction
   * défaite : la livraison REDEVIENT DUE. C'est la moitié qu'on oublie si la
   * confirmation ne la dit pas.
   */
  it('[TC-230-10] la confirmation annonce que la livraison redevient due', () => {
    afficher([retour({ expediteur: 'Mme Sawadogo' })])
    fireEvent.click(screen.getByTestId('supprimer-retour'))

    const dialogue = within(screen.getByTestId('confirmer-suppression-historique'))
    // La phrase nomme la personne : « la livraison de X redeviendra due ».
    // Savoir que quelque chose redevient dû sans savoir à qui ne sert à rien.
    expect(dialogue.getByText(/redeviendra due/)).toHaveTextContent('Mme Sawadogo')
    expect(dialogue.queryByText(/corbeille/)).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-230 — la commande réellement envoyée', () => {
  const contexteAuth = {
    currentUser: { uid: 'u1' },
    userProfile: { storeId: 'store-a' },
    activeStore: { id: 'store-a' },
    loading: false,
  }

  /** Un consommateur nu : on veut la fonction du contexte, pas un écran. */
  function Declencheur({ id }) {
    const { trashTransaction: supprimer, completedTransactions } = useTransactions()
    return (
      <button type="button" onClick={() => supprimer(id)} data-testid="go">
        {completedTransactions.length} ligne(s)
      </button>
    )
  }

  const monter = async (historique, id) => {
    service.subscribeToDrafts.mockImplementation((cb) => { cb([]); return () => {} })
    service.subscribeToHistory.mockImplementation((cb) => { cb([]); return () => {} })
    service.getHistoryPage.mockResolvedValue({ transactions: historique, lastDoc: null, hasMore: false })

    render(
      <AuthContext.Provider value={contexteAuth}>
        <TransactionsProvider>
          <Declencheur id={id} />
        </TransactionsProvider>
      </AuthContext.Provider>,
    )

    // On attend que l'historique soit réellement chargé : c'est lui qui porte
    // le type de la ligne, donc le routage.
    await waitFor(() => expect(screen.getByTestId('go')).toHaveTextContent(`${historique.length} ligne(s)`))
    fireEvent.click(screen.getByTestId('go'))
  }

  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    service.trashHistory.mockResolvedValue(true)
    service.trashReplenishmentReturn.mockResolvedValue(true)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LES SOLDES.
   *   `trashHistory` rendrait bien le montant à la réserve — et laisserait la
   *   livraison soldée. La boutique croirait ne plus rien devoir. Le serveur
   *   refuse d'ailleurs le type « Retour » sur cette commande-là.
   */
  it('[TC-230-11] un retour part sur trashReplenishmentReturn', async () => {
    await monter([retour({ id: 'ret-9' })], 'ret-9')

    await waitFor(() => expect(service.trashReplenishmentReturn).toHaveBeenCalledWith('ret-9'))
    expect(service.trashHistory).not.toHaveBeenCalled()
  })

  it('[TC-230-12] une transaction client part sur trashHistory, comme avant', async () => {
    await monter([client({ id: 'tx-9' })], 'tx-9')

    await waitFor(() => expect(service.trashHistory).toHaveBeenCalledWith('tx-9'))
    expect(service.trashReplenishmentReturn).not.toHaveBeenCalled()
  })

  it('[TC-230-13] un ravitaillement n’est pas confondu avec un retour', async () => {
    await monter([ravitaillement({ id: 'rav-9' })], 'rav-9')

    await waitFor(() => expect(service.trashHistory).toHaveBeenCalledWith('rav-9'))
    expect(service.trashReplenishmentReturn).not.toHaveBeenCalled()
  })
})
