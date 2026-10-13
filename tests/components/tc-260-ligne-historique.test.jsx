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
