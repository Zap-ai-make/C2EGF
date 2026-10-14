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

  /**
   * ⚠ LE MENSONGE D'UNE FRAME. Le hook démarre à « inactif » : une condition
   *   formulée en négatif affichait le vide dès l'ouverture, avant la moindre
   *   requête — sur un agent qui a un historique.
   */
  it('[TC-261-16] n’annonce pas le vide avant d’avoir chargé', () => {
    afficher({ etat: 'inactif', lignes: [], totaux: null })
    expect(screen.queryByText(/Aucune opération/)).toBeNull()
  })

  /**
   * ⚠ L'AUTRE MOITIÉ DU MÊME MENSONGE, et le cas est QUOTIDIEN. Un agent dont
   *   la toute première opération n'est pas encore terminée n'a RIEN dans
   *   `history` : un brouillon n'y rejoint qu'à la validation. Le panneau
   *   affichait donc l'encart « En cours » avec l'opération, puis juste en
   *   dessous « Rien n'a encore été enregistré sous ce code, dans aucune
   *   boutique » — les deux à l'écran en même temps.
   *
   *   Le fixture `etatPar()` met `enCours: []` par défaut : aucun test ne
   *   croisait les deux listes, c'est pour ça que ça n'a pas été vu.
   */
  it('[TC-261-17] n’annonce pas le vide quand une opération est en cours', () => {
    afficher({
      etat: 'pret',
      lignes: [],
      enCours: [ligne('d1', { source: 'draft', reste: 40000 })],
      totaux: { ...TOTAUX, operations: 0 },
    })
    expect(screen.getByText(/EN COURS/i)).toBeInTheDocument()
    expect(screen.queryByText(/Aucune opération/)).toBeNull()
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

  /**
   * ⚠ UNE PANNE, UNE SEULE RELANCE. Après l'échec d'une page suivante,
   *   `ErrorState` porte son bouton Réessayer ET `LoadMoreButton` restait actif
   *   juste en dessous : deux boutons pour la même panne, dont l'un relance
   *   avec le curseur qui vient d'échouer.
   */
  it('[TC-261-18] pas de « Charger plus » quand la page suivante a échoué', () => {
    afficher({
      etat: 'erreur', erreur: 'Service indisponible',
      lignes: [ligne('a')], totaux: TOTAUX, encore: true,
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Charger plus/ })).toBeNull()
  })
})

describe('TC-261 — quand le serveur ne sait pas compter', () => {
  /**
   * ⚠ `operations: null` VEUT DIRE « JE NE SAIS PAS », PAS « AUCUNE ». Le
   *   serveur le pose quand une agrégation échoue — index absent, quota
   *   dépassé : les lignes restent parfaitement lisibles, seul le total manque.
   *   Avant, les quatre agrégats partageaient un `Promise.all` sans garde et
   *   emportaient la réponse ENTIÈRE, lignes comprises.
   */
  it('[TC-261-19] un total inconnu n’est pas annoncé, les lignes restent', () => {
    afficher({
      etat: 'pret',
      lignes: [ligne('a')],
      totaux: { operations: null, nonDatees: 0, parBoutique: [], resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: 0 },
    })
    expect(screen.getByText(/13\/10\/2026 08:00/)).toBeInTheDocument()
    expect(screen.queryByText(/opérations enregistrées/)).toBeNull()
  })

  /**
   * ⚠ `resteAEncaisser` SURVIT AU REPLI, et c'est le point délicat. Il ne vient
   *   d'aucun agrégat : il est calculé sur les non terminées, lues en entier.
   *   Le laisser tomber avec les comptes afficherait « 0 à encaisser · 0 à
   *   payer » en pied d'un encart dont chaque ligne montre son reste.
   */
  it('[TC-261-20] les restes des non terminées survivent à un repli', () => {
    afficher({
      etat: 'pret',
      lignes: [],
      enCours: [ligne('d1', { source: 'draft', reste: 40000, typePlie: 'retrait', type: 'Retrait' })],
      totaux: { operations: null, nonDatees: 0, parBoutique: [], resteAEncaisser: 0, resteAPayer: 40000, nbEnAttente: 1 },
    })
    expect(screen.getByText(/40\s?000 à payer/)).toBeInTheDocument()
  })

  /**
   * ⚠ LE PIED COMPTE CE QUI EST AFFICHÉ, pas `totaux.operations`. Ce total
   *   porte sur TOUT l'historique, non datées comprises, alors que la liste ne
   *   peut pas montrer les lignes sans `createdAt` — Firestore exclut d'une
   *   requête triée les documents qui ne portent pas le champ trié. Annoncer
   *   « 437 opérations, c'est tout » au bas d'une liste de 2 faisait se
   *   contredire deux nombres du même panneau.
   */
  it('[TC-261-21] le pied ne contredit pas l’avertissement des non datées', () => {
    afficher({
      etat: 'pret',
      lignes: [ligne('a'), ligne('b')],
      totaux: { ...TOTAUX, operations: 437, nonDatees: 435 },
      encore: false,
    })
    expect(screen.getByText(/2 opérations affichées/)).toBeInTheDocument()
    expect(screen.getByText(/435 opération\(s\) sans date/)).toBeInTheDocument()
  })
})
