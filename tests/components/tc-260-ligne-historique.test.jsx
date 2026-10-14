import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LigneHistorique from '../../src/components/clients/LigneHistorique.jsx'

/**
 * TC-260 — Une ligne de l'historique d'un agent.
 *
 * ⚠ CE QUI DOIT SE LIRE SANS CLIQUER : quand, combien, quel sens, quel statut,
 *   QUELLE BOUTIQUE. La boutique est la raison d'être de cet écran : sans elle,
 *   on ne sait pas si l'opération est la nôtre.
 */

const MAINTENANT = Date.UTC(2026, 9, 13, 14, 0)

const ligne = (over = {}) => ({
  id: 'h1', source: 'history', storeId: 'store-a', storeName: 'C2EGF OUAGA',
  type: 'Dépôt', typePlie: 'depot', montant: 250000, reste: null,
  statut: 'Validée', reseau: 'Orange', code: '0123456',
  date: '13/10/2026 08:00', createdAt: Date.UTC(2026, 9, 13, 8, 0),
  validatedAt: 0, deletedAt: null, operatorName: 'Awa',
  ...over,
})

afterEach(cleanup)

const afficher = (over) => render(<LigneHistorique ligne={ligne(over)} maintenant={MAINTENANT} />)

describe('TC-260 — ce qu’une ligne montre', () => {
  it('[TC-260-01] la date, le montant, le type et le statut', () => {
    afficher()
    expect(screen.getByText(/13\/10\/2026 08:00/)).toBeInTheDocument()
    expect(screen.getByText(/250\s?000/)).toBeInTheDocument()
    expect(screen.getByText('Dépôt')).toBeInTheDocument()
    expect(screen.getByText('Validée')).toBeInTheDocument()
  })

  it('[TC-260-02] la boutique et l’opérateur', () => {
    afficher()
    expect(screen.getByText(/C2EGF OUAGA/)).toBeInTheDocument()
    expect(screen.getByText(/Awa/)).toBeInTheDocument()
  })

  it('[TC-260-03] un opérateur absent ne laisse pas « undefined »', () => {
    afficher({ operatorName: '' })
    expect(screen.queryByText(/undefined/)).toBeNull()
  })
})

describe('TC-260 — une non terminée', () => {
  it('[TC-260-04] affiche ce qui reste et depuis combien de temps', () => {
    afficher({
      source: 'draft', statut: 'Non Terminées', type: 'Retrait', typePlie: 'retrait',
      montant: 100000, reste: 40000, createdAt: Date.UTC(2026, 9, 13, 8, 0),
    })
    expect(screen.getByText(/reste 40\s?000/)).toBeInTheDocument()
    expect(screen.getByText(/6 h/)).toBeInTheDocument()
  })

  it('[TC-260-05] une attente de plusieurs jours se dit en jours', () => {
    afficher({ source: 'draft', reste: 1000, createdAt: Date.UTC(2026, 9, 9, 14, 0) })
    expect(screen.getByText(/4 j/)).toBeInTheDocument()
  })

  it('[TC-260-06] une ligne sans horodatage n’annonce aucune durée', () => {
    afficher({ source: 'draft', reste: 1000, createdAt: 0 })
    expect(screen.queryByText(/en attente depuis/)).toBeNull()
  })
})

describe('TC-260 — une ligne supprimée', () => {
  /** ⚠ Elle RESTE visible : un historique qui tait les annulations ment. */
  it('[TC-260-07] est marquée et barrée, pas masquée', () => {
    const { container } = afficher({ deletedAt: Date.UTC(2026, 9, 13, 10, 0), statut: 'Supprimée' })
    expect(screen.getByText('Supprimée')).toBeInTheDocument()
    expect(container.querySelector('.line-through')).not.toBeNull()
  })
})

/**
 * TC-260 — Le temps mis, et le nom qui ne doit pas être dit deux fois.
 *
 * Trois défauts vus sur une capture de production, sur un même agent :
 * la date sans heure, aucune durée, et « C2EGF 10YAAR C2EGF 10YAAR » côte à côte.
 */
describe('TC-260 — la durée de traitement', () => {
  /**
   * ⚠ C'EST LA RÉPONSE À « LES DÉLAIS DE REMBOURSEMENT ». Une opération saisie
   *   le matin et validée le soir a fait attendre quelqu'un ; l'historique doit
   *   le dire, sinon il ne raconte que l'instant de la saisie.
   */
  it('[TC-260-08] une opération validée plus tard annonce le temps mis', () => {
    afficher({
      createdAt: Date.UTC(2026, 9, 13, 8, 0),
      validatedAt: Date.UTC(2026, 9, 13, 14, 0),
    })
    expect(screen.getByText(/traité en 6 h/)).toBeInTheDocument()
  })

  it('[TC-260-09] un délai de plusieurs jours se dit en jours', () => {
    afficher({
      createdAt: Date.UTC(2026, 9, 9, 8, 0),
      validatedAt: Date.UTC(2026, 9, 13, 8, 0),
    })
    expect(screen.getByText(/traité en 4 j/)).toBeInTheDocument()
  })

  /**
   * ⚠ LE SILENCE EST L'INFORMATION. Une transaction validée dans la foulée est
   *   le cas ORDINAIRE : écrire « traité en 1 min » sur chaque ligne noierait
   *   les quelques-unes qui ont réellement attendu — les seules qu'on vient
   *   chercher ici.
   */
  it('[TC-260-10] une validation immédiate n’affiche aucun délai', () => {
    afficher({
      createdAt: Date.UTC(2026, 9, 13, 8, 0),
      validatedAt: Date.UTC(2026, 9, 13, 8, 0, 30),
    })
    expect(screen.queryByText(/traité en/)).toBeNull()
  })

  /** Sans `validatedAt`, il n'y a pas de délai — pas un délai de zéro. */
  it('[TC-260-11] une ligne jamais validée n’invente pas de délai', () => {
    afficher({ validatedAt: 0 })
    expect(screen.queryByText(/traité en/)).toBeNull()
  })

  /** Les non terminées disent « en attente depuis », pas « traité en ». */
  it('[TC-260-12] une non terminée ne parle pas de traitement', () => {
    afficher({ source: 'draft', reste: 40000, validatedAt: Date.UTC(2026, 9, 13, 12, 0) })
    expect(screen.queryByText(/traité en/)).toBeNull()
    expect(screen.getByText(/en attente depuis/)).toBeInTheDocument()
  })
})

describe('TC-260 — la boutique n’est nommée qu’une fois', () => {
  /**
   * ⚠ LE COMPTE DE LA BOUTIQUE PORTE LE NOM DE LA BOUTIQUE. Quand la caissière
   *   opère sous le compte du magasin, `operatorName` vaut exactement ce que la
   *   pastille affiche déjà, et la ligne rendait « C2EGF 10YAAR C2EGF 10YAAR ».
   */
  it('[TC-260-13] un opérateur homonyme de la boutique n’est pas répété', () => {
    afficher({ storeName: 'C2EGF 10YAAR', operatorName: 'C2EGF 10YAAR' })
    expect(screen.getAllByText(/C2EGF 10YAAR/)).toHaveLength(1)
  })

  it('[TC-260-14] la casse et les espaces ne font pas deux noms différents', () => {
    afficher({ storeName: 'C2EGF 10YAAR', operatorName: '  c2egf  10yaar ' })
    expect(screen.getAllByText(/10YAAR|10yaar/i)).toHaveLength(1)
  })

  /** Un opérateur qui ajoute quelque chose reste affiché : c'est l'information. */
  it('[TC-260-15] un opérateur distinct est toujours montré', () => {
    afficher({ storeName: 'C2EGF 10YAAR', operatorName: 'Awa' })
    expect(screen.getByText('Awa')).toBeInTheDocument()
    expect(screen.getByText(/C2EGF 10YAAR/)).toBeInTheDocument()
  })
})
