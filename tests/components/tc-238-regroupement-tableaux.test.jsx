import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

/**
 * TC-238 — Une ligne par client et par type, dans les deux tableaux.
 *
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────
 * TC-237 vérifie le CALCUL du regroupement, sur des objets nus. Ici on vérifie
 * ce qui ne se voit qu'à l'écran, et qui porte tout le risque :
 *
 *   1. ⚠ LES ACTIONS SURVIVENT AU REPLIAGE. « Modifier », « Supprimer »,
 *      « Encaisser » agissent sur UNE transaction. Repliée dans un groupe, une
 *      transaction dont on ne peut plus rien faire serait pire que six rangées :
 *      elle serait inatteignable. Elles doivent reparaître au dépliage, et agir
 *      sur la BONNE ligne.
 *   2. Le groupe montre le TOTAL — la réponse à la question qu'on se posait en
 *      additionnant six montants de tête.
 *   3. Une transaction seule n'est PAS repliée : c'est l'immense majorité des
 *      lignes, et leur coûter un clic serait une régression pour tout le monde.
 *
 * LES DEUX TABLEAUX SONT TESTÉS, et c'est voulu : ils partagent la fonction de
 * regroupement mais pas leur rendu. L'un pourrait replier ce que l'autre
 * déplie sans que rien ne le signale.
 */

let transactionsValue

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: { tableBorder: '', tableHeader: '', text: '' } }),
}))

import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'

const AISSATA = { nom: 'Ouedraogo', prenom: 'Aïssata' }
const SALIF = { nom: 'Kabore', prenom: 'Salif' }

const tx = (over = {}) => ({
  id: 't-1',
  clientId: 'c-1',
  client: AISSATA,
  type: 'Dépôt',
  code: '000111',
  montant: 10_000,
  statut: 'Validée',
  date: '08/10/2026 14:00',
  createdAt: { toMillis: () => Date.parse('2026-10-08T14:00:00Z') },
  ...over,
})

/** Deux dépôts d'Aïssata (groupables) et un retrait de Salif (seul). */
const LOT = [
  tx({ id: 'depot-1', montant: 10_000 }),
  tx({ id: 'depot-2', montant: 25_000 }),
  tx({ id: 'retrait-salif', clientId: 'c-2', client: SALIF, type: 'Retrait', montant: 7_000 }),
]

const CLE_GROUPE = 'c-1::depot'

const contexteBase = () => ({
  getTransactionStyles: () => ({ textColor: '' }),
  trashTransaction: vi.fn(),
  pendingTransactions: [],
  loading: false,
  getActionButtons: () => ({ modifier: true, encaisser: true }),
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
})

beforeEach(() => {
  transactionsValue = contexteBase()
})

// ─────────────────────────────────────────────────────────────────────────────
// L'historique
// ─────────────────────────────────────────────────────────────────────────────

const afficherHistorique = (transactions = LOT) =>
  render(<HistoriqueTable transactions={transactions} onReopen={vi.fn()} />)

describe('TC-238 — l’historique', () => {
  it('[TC-238-1] replie les deux dépôts du même client en une rangée', () => {
    afficherHistorique()

    const groupe = within(screen.getByTestId(`groupe-${CLE_GROUPE}`))
    expect(groupe.getByText('Aïssata Ouedraogo')).toBeInTheDocument()
    expect(groupe.getByText('× 2')).toBeInTheDocument()
    expect(screen.queryAllByTestId('ligne-de-groupe')).toHaveLength(0)
  })

  it('[TC-238-2] et en affiche le total', () => {
    afficherHistorique()

    expect(within(screen.getByTestId(`groupe-${CLE_GROUPE}`))
      .getByText((contenu) => contenu.replace(/\s/g, ' ') === '35 000 FCFA')).toBeInTheDocument()
  })

  /**
   * L'immense majorité des lignes sont seules de leur espèce. Leur coûter un
   * clic pour revoir ce qu'on voyait déjà serait une régression générale.
   */
  it('[TC-238-3] laisse la transaction seule intacte, avec ses boutons', () => {
    afficherHistorique()

    const ligne = screen.getByText('Salif Kabore').closest('tr')
    expect(within(ligne).getByTestId('modifier-historique')).toBeInTheDocument()
    expect(within(ligne).getByTestId('supprimer-historique')).toBeInTheDocument()
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI REND LE REPLIAGE ACCEPTABLE.
   *   Sans dépliage, les deux dépôts deviendraient inatteignables : ni
   *   corrigeables, ni supprimables, et leur montant resterait à l'écran.
   */
  it('[TC-238-4] déplie les lignes, chacune avec ses actions', () => {
    afficherHistorique()
    fireEvent.click(screen.getByTestId(`basculer-${CLE_GROUPE}`))

    const lignes = screen.getAllByTestId('ligne-de-groupe')
    expect(lignes).toHaveLength(2)
    for (const ligne of lignes) {
      expect(within(ligne).getByTestId('modifier-historique')).toBeInTheDocument()
      expect(within(ligne).getByTestId('supprimer-historique')).toBeInTheDocument()
    }
  })

  it('[TC-238-5] le bouton dit ce qu’il va faire, et change après le clic', () => {
    afficherHistorique()
    const bouton = screen.getByTestId(`basculer-${CLE_GROUPE}`)

    expect(bouton).toHaveTextContent('Voir les 2')
    expect(bouton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(bouton)
    expect(screen.getByTestId(`basculer-${CLE_GROUPE}`)).toHaveTextContent('Masquer')
    expect(screen.getByTestId(`basculer-${CLE_GROUPE}`)).toHaveAttribute('aria-expanded', 'true')
  })

  it('[TC-238-6] et se replie au second clic', () => {
    afficherHistorique()
    fireEvent.click(screen.getByTestId(`basculer-${CLE_GROUPE}`))
    fireEvent.click(screen.getByTestId(`basculer-${CLE_GROUPE}`))

    expect(screen.queryAllByTestId('ligne-de-groupe')).toHaveLength(0)
  })

  /**
   * ⚠ Un ravitaillement et un retour n'ont pas de `clientId`. Les regrouper
   *   entasserait sous un même total l'argent de plusieurs expéditeurs.
   */
  it('[TC-238-7] ne regroupe jamais les lignes du dealer', () => {
    afficherHistorique([
      { id: 'rav-1', type: 'Ravitaillement', expediteur: 'Patron', montant: 100_000, statut: 'Validée', date: '08/10/2026 08:00' },
      { id: 'rav-2', type: 'Ravitaillement', expediteur: 'DG', montant: 200_000, statut: 'Validée', date: '08/10/2026 09:00' },
    ])

    expect(screen.queryByText('× 2')).not.toBeInTheDocument()
    expect(screen.getByText('Patron')).toBeInTheDocument()
    expect(screen.getByText('DG')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Les non terminées
// ─────────────────────────────────────────────────────────────────────────────

const afficherNonTerminees = (transactions = LOT) => {
  transactionsValue = { ...contexteBase(), pendingTransactions: transactions }
  return render(<TransactionTable />)
}

describe('TC-238 — les non terminées', () => {
  it('[TC-238-8] replient de la même façon, avec le total', () => {
    afficherNonTerminees()

    const groupe = within(screen.getByTestId(`groupe-${CLE_GROUPE}`))
    expect(groupe.getByText('Aïssata Ouedraogo')).toBeInTheDocument()
    expect(groupe.getByText('× 2')).toBeInTheDocument()
    expect(groupe.getByText((c) => c.replace(/\s/g, ' ') === '35 000 FCFA')).toBeInTheDocument()
  })

  /**
   * ⚠ Les actions de règlement ne peuvent PAS vivre sur l'en-tête : « Encaisser »
   *   porte un montant et une méthode, qui ne valent que pour une transaction.
   *   Elles doivent donc être atteignables au dépliage, et seulement là.
   */
  it('[TC-238-9] l’en-tête n’offre aucun règlement, les lignes dépliées si', () => {
    afficherNonTerminees()
    const entete = within(screen.getByTestId(`groupe-${CLE_GROUPE}`))
    expect(entete.queryByRole('button', { name: 'Encaisser' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId(`basculer-${CLE_GROUPE}`))
    const lignes = screen.getAllByTestId('ligne-de-groupe')
    expect(lignes).toHaveLength(2)
    for (const ligne of lignes) {
      expect(within(ligne).getByRole('button', { name: 'Encaisser' })).toBeInTheDocument()
    }
  })

  it('[TC-238-10] la transaction seule garde ses actions sans rien déplier', () => {
    afficherNonTerminees()

    const ligne = screen.getByText('Salif Kabore').closest('tr')
    expect(within(ligne).getByRole('button', { name: 'Encaisser' })).toBeInTheDocument()
  })

  /**
   * Le compteur du groupe montre la PLUS LONGUE attente de ses lignes : c'est
   * elle qui décide si la rangée doit s'allumer. Montrer la plus courte ferait
   * passer pour fraîche une rangée qui contient un client oublié depuis une
   * heure.
   */
  it('[TC-238-11] le compteur du groupe est celui qui attend le plus', () => {
    const maintenant = Date.parse('2026-10-08T15:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(maintenant)

    afficherNonTerminees([
      tx({ id: 'recente', createdAt: { toMillis: () => maintenant - 60_000 } }),
      tx({ id: 'vieille', createdAt: { toMillis: () => maintenant - 45 * 60_000 } }),
    ])

    const compteur = screen.getByTestId(`attente-groupe-${CLE_GROUPE}`)
    expect(compteur).toHaveTextContent('00:45:00')
    expect(screen.getByTestId(`groupe-${CLE_GROUPE}`).className).toContain('bg-warn-soft')

    vi.useRealTimers()
  })

  it('[TC-238-12] les totaux en attente comptent toutes les transactions, groupées ou non', () => {
    afficherNonTerminees()

    // 10 000 + 25 000 de dépôts, et 7 000 de retrait : le regroupement est un
    // fait d'affichage, il ne doit rien retirer aux compteurs.
    expect(screen.getByTestId('total-depots-non-terminees'))
      .toHaveTextContent((35_000).toLocaleString('fr-FR').replace(/\s/g, ' '))
    expect(screen.getByTestId('nombre-depots-non-terminees')).toHaveTextContent('2')
    expect(screen.getByTestId('nombre-retraits-non-terminees')).toHaveTextContent('1')
  })
})
