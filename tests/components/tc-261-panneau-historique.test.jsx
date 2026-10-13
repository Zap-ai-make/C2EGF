import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const useHistoriqueClient = vi.fn()
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({ useHistoriqueClient }))

const { default: HistoriqueClientPanel } = await import('../../src/components/clients/HistoriqueClientPanel.jsx')

/**
 * TC-261 — Le panneau d'historique d'un agent.
 *
 * ⚠ CINQ ÉTATS, ET AUCUN NE DOIT RESSEMBLER À UN AUTRE. « Vide » n'est pas une
 *   erreur, « page suivante en cours » n'est pas « chargement », et une liste
 *   qui s'arrête sans le dire laisse croire qu'il en manque.
 */

const CLIENT = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'SALIF',
  codeAgent: '0123456', numeroAgent: '01234567', localite: 'POUYTENGA',
}

const ligne = (id, over = {}) => ({
  id, source: 'history', storeId: 'store-a', storeName: 'C2EGF OUAGA',
  type: 'Dépôt', typePlie: 'depot', montant: 250000, reste: null,
  statut: 'Validée', date: '13/10/2026 08:00', createdAt: 1, validatedAt: 0,
  deletedAt: null, operatorName: 'Awa', ...over,
})

const etatPar = (over = {}) => ({
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(), ...over,
})

// ⚠ `totaux` NE PORTE PLUS AUCUNE SOMME D'ARGENT. Une ligne annulée garde son
//   montant alors que l'argent est déjà revenu aux soldes : les sommer aurait
//   fait annoncer au panneau de l'argent qui n'existe pas. La forme réelle,
//   rendue par le serveur, ne porte que des comptes d'opérations.
const TOTAUX = {
  operations: 437, nonDatees: 0,
  resteAEncaisser: 80000, resteAPayer: 40000, nbEnAttente: 2,
  parBoutique: [
    { storeId: 'store-a', storeName: 'OUAGA', operations: 312 },
    { storeId: 'store-b', storeName: 'BOBO', operations: 125 },
  ],
}

const afficher = (etat) => {
  useHistoriqueClient.mockReturnValue(etatPar(etat))
  return render(<HistoriqueClientPanel client={CLIENT} onClose={vi.fn()} />)
}

beforeEach(() => { useHistoriqueClient.mockReset() })
afterEach(cleanup)

describe('TC-261 — l’identité, toujours visible', () => {
  it('[TC-261-01] le nom et les identifiants sont là dès le chargement', () => {
    afficher({ etat: 'chargement' })
    expect(screen.getByText(/OUEDRAOGO SALIF/)).toBeInTheDocument()
    expect(screen.getByText(/0123456/)).toBeInTheDocument()
    expect(screen.getByText(/POUYTENGA/)).toBeInTheDocument()
  })

  it('[TC-261-02] sans client, le panneau ne rend rien', () => {
    useHistoriqueClient.mockReturnValue(etatPar())
    const { container } = render(<HistoriqueClientPanel client={null} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TC-261 — les cinq états', () => {
  it('[TC-261-03] chargement : un squelette, pas un vide', () => {
    afficher({ etat: 'chargement' })
    expect(screen.queryByText(/Aucune opération/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[TC-261-04] vide : un message qui n’est pas une erreur', () => {
    afficher({ etat: 'pret', lignes: [], totaux: { ...TOTAUX, operations: 0 } })
    expect(screen.getByText(/Aucune opération/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[TC-261-05] erreur : un message et un bouton Réessayer', () => {
    const reessayer = vi.fn()
    afficher({ etat: 'erreur', erreur: 'Accès refusé', reessayer })
    expect(screen.getByRole('alert')).toHaveTextContent('Accès refusé')
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }))
    expect(reessayer).toHaveBeenCalled()
  })

  it('[TC-261-06] page suivante : le bouton change, la liste reste', () => {
    afficher({ etat: 'chargementPage', lignes: [ligne('a')], totaux: TOTAUX, encore: true })
    expect(screen.getByText(/13\/10\/2026 08:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Chargement/ })).toBeDisabled()
  })

  /** ⚠ Une liste qui s'arrête sans le dire laisse croire qu'il en manque. */
  it('[TC-261-07] tout chargé : le bouton disparaît et le compte le confirme', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: { ...TOTAUX, operations: 1 }, encore: false })
    expect(screen.queryByRole('button', { name: /Charger plus/ })).toBeNull()
    // ⚠ AJUSTEMENT DE REQUÊTE (intention conservée) : le composant écrit
    //   l'apostrophe accentuée « c’est tout », comme le reste du dépôt
    //   (NavBar, PositionDealer...). `/c'est tout/i` avec l'apostrophe droite
    //   ne matchait jamais ce caractère — remplacé par un `.` qui accepte
    //   l'une ou l'autre sans rien affaiblir de ce qui est vérifié.
    expect(screen.getByText(/c.est tout/i)).toBeInTheDocument()
  })
})

describe('TC-261 — ce que les totaux disent', () => {
  it('[TC-261-08] le compte total, pas celui de la page', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX, encore: true })
    expect(screen.getByText(/437 opérations/)).toBeInTheDocument()
  })

  /** ⚠ DEUX RESTES, PAS UN : ils vont dans des sens opposés. */
  it('[TC-261-09] sépare ce qu’on encaisse de ce qu’on paye', () => {
    afficher({ etat: 'pret', lignes: [], totaux: TOTAUX, enCours: [ligne('d1', { source: 'draft', reste: 40000 })] })
    expect(screen.getByText(/80\s?000 à encaisser/)).toBeInTheDocument()
    expect(screen.getByText(/40\s?000 à payer/)).toBeInTheDocument()
  })

  it('[TC-261-10] le récapitulatif par boutique tient sur une ligne', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX })
    expect(screen.getByText(/OUAGA 312/)).toBeInTheDocument()
    expect(screen.getByText(/BOBO 125/)).toBeInTheDocument()
  })

  /**
   * ⚠ CE QUI NE PEUT PAS ÊTRE LISTÉ DOIT ÊTRE DIT. Une vieille ligne sans
   *   `createdAt` est exclue de la requête triée : la taire ferait afficher un
   *   chiffre faux sans que rien ne le signale.
   */
  it('[TC-261-11] annonce les lignes qui ne peuvent pas être listées', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: { ...TOTAUX, nonDatees: 3 } })
    expect(screen.getByText(/3 opération/)).toBeInTheDocument()
  })

  it('[TC-261-12] ne dit rien quand il n’y a rien à signaler', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX })
    expect(screen.queryByText(/non datée/i)).toBeNull()
  })
})

describe('TC-261 — les non terminées, épinglées', () => {
  it('[TC-261-13] apparaissent dans leur bloc, au-dessus de l’historique', () => {
    afficher({
      etat: 'pret',
      enCours: [ligne('d1', { source: 'draft', statut: 'Non Terminées', reste: 40000 })],
      lignes: [ligne('h1')],
      totaux: TOTAUX,
    })
    expect(screen.getByText(/EN COURS/i)).toBeInTheDocument()
    expect(screen.getByText(/reste 40\s?000/)).toBeInTheDocument()
  })

  it('[TC-261-14] le bloc disparaît quand il n’y a rien en cours', () => {
    afficher({ etat: 'pret', enCours: [], lignes: [ligne('h1')], totaux: TOTAUX })
    expect(screen.queryByText(/EN COURS/i)).toBeNull()
  })
})

describe('TC-261 — charger la suite', () => {
  it('[TC-261-15] le bouton appelle `chargerPlus`', () => {
    const chargerPlus = vi.fn()
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX, encore: true, chargerPlus })
    fireEvent.click(screen.getByRole('button', { name: /Charger plus/ }))
    expect(chargerPlus).toHaveBeenCalled()
  })
})
