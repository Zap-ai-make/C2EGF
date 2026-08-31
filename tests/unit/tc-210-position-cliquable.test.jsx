/**
 * TC-210 — Les cinq chiffres de la position mènent quelque part.
 *
 * L'écran énonçait cinq nombres et n'ouvrait sur rien : « 341 200 000 FCFA de
 * ravitaillements confirmés » pose aussitôt la question « lesquels ? », et il
 * fallait retrouver la file par le menu.
 *
 * Trois choses se vérifient ici :
 *   §CI — les cinq cibles, leur nature (lien ou bouton) et leur destination ;
 *   §NA — leur nom accessible, qui doit porter le montant ET la destination ;
 *   §MO — la modale : ce qu'elle montre, ce qu'elle refuse de taire, et le fait
 *         qu'elle n'ouvre AUCUNE lecture supplémentaire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import PositionDealer from '../../src/components/dealer/PositionDealer'
import { rapprocherPosition } from '../../src/utils/positionDealer'

const DEHORS = {
  parBoutique: [
    { storeId: 's1', name: 'POUYTENGA', depots: 900000, retraits: 100000, dehors: 800000 },
    { storeId: 's2', name: 'FADA', depots: 50000, retraits: 250000, dehors: -200000 },
  ],
  depots: 950000, retraits: 350000, dehors: 600000, illisibles: 0, horsReseau: 0,
}

const position = () => rapprocherPosition({
  flux: { envoyeCumul: 10_000_000, revenuCumul: 2_000_000, amorce: true },
  sommeStock: 4_000_000,
  sommeLiquidite: 3_000_000,
  sommeDehors: 600_000,
  enTransit: 400_000,
})

const monter = (props = {}) => render(
  <MemoryRouter>
    <PositionDealer
      position={position()}
      retoursEnAttente={3}
      envoisEnAttente={{ nombre: 2, montant: 1_500_000 }}
      dehors={DEHORS}
      {...props}
    />
  </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())

// ===========================================================================
// §CI — les cibles
// ===========================================================================

describe('TC-210-CI — cinq chiffres, cinq cibles', () => {
  it('[CI-01] les quatre navigations sont des LIENS, avec leur destination', () => {
    // Un lien s'ouvre dans un onglet, se copie, s'annonce comme « lien ». Le
    // dealer qui veut ouvrir deux files côte à côte le peut.
    monter()
    const dest = {
      'ligne-ravitaillements': '/dealer/requests',
      'ligne-retours': '/dealer/transfers',
      'ligne-stock': '/dealer/stores',
      'ligne-liquidite': '/dealer/stores',
    }
    for (const [testId, href] of Object.entries(dest)) {
      const cible = screen.getByTestId(testId)
      expect(cible.tagName).toBe('A')
      expect(cible.getAttribute('href')).toBe(href)
    }
  })

  it('[CI-02] « Dehors » est un BOUTON : il ne navigue pas, il déplie', () => {
    monter()
    expect(screen.getByTestId('ligne-dehors').tagName).toBe('BUTTON')
    expect(screen.getByTestId('ligne-dehors').getAttribute('href')).toBeNull()
  })

  it('[CI-03] sans détail à montrer, « Dehors » n’est pas une cible', () => {
    // Une cible qui ouvrirait un calque vide serait une promesse non tenue.
    monter({ dehors: null })
    expect(screen.queryByTestId('ligne-dehors')).toBeNull()
    // Le montant reste affiché, lui : c'est le geste qui disparaît, pas le chiffre.
    expect(screen.getByTestId('montant-caisses')).toBeInTheDocument()
  })

  it('[CI-04] la LIGNE entière est la cible, pas le seul chiffre', () => {
    // Un nombre est une cible étroite, à la souris comme au doigt.
    monter()
    const lien = screen.getByTestId('ligne-stock')
    expect(within(lien).getByText('Stock')).toBeInTheDocument()
    expect(lien.textContent).toMatch(/4[\s\u202f\u00a0]000[\s\u202f\u00a0]000/)
  })
})

// ===========================================================================
// §NA — les noms accessibles
// ===========================================================================

describe('TC-210-NA — chaque cible dit où elle mène', () => {
  it('[NA-01] le nom porte le libellé, le montant ET la destination', () => {
    // Sans lui, cinq cibles s'annonceraient par leur seul texte visible, et
    // « Stock » ne dirait pas qu'il mène à la liste des boutiques.
    monter()
    expect(screen.getByTestId('ligne-stock'))
      .toHaveAccessibleName(/^Stock : .*voir le stock de chaque boutique$/)
    expect(screen.getByTestId('ligne-dehors'))
      .toHaveAccessibleName(/^Dehors : .*voir le détail par boutique$/)
  })

  it('[NA-02] les cinq noms sont distincts', () => {
    monter()
    const noms = [
      'ligne-ravitaillements', 'ligne-retours', 'ligne-stock', 'ligne-liquidite', 'ligne-dehors',
    ].map(t => screen.getByTestId(t).getAttribute('aria-label'))
    expect(noms.filter(Boolean)).toHaveLength(5)
    expect(new Set(noms).size).toBe(5)
  })

  it('[NA-03] Stock et Liquidité mènent au même écran mais ne se disent pas pareil', () => {
    // Deux cibles de même destination doivent rester distinctes à l'oreille.
    monter()
    expect(screen.getByTestId('ligne-stock').getAttribute('aria-label'))
      .not.toBe(screen.getByTestId('ligne-liquidite').getAttribute('aria-label'))
  })
})

// ===========================================================================
// §MO — la modale
// ===========================================================================

describe('TC-210-MO — le détail par boutique', () => {
  it('[MO-01] fermée par défaut, ouverte au clic, refermée par Échap', () => {
    monter()
    expect(screen.queryByTestId('dialogue-dehors')).toBeNull()

    fireEvent.click(screen.getByTestId('ligne-dehors'))
    expect(screen.getByTestId('dialogue-dehors')).toBeInTheDocument()

    // `Dialog` écoute sur `document` — cf. tc-123.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('dialogue-dehors')).toBeNull()
  })

  it('[MO-02] chaque boutique exposée a ses deux colonnes et son solde', () => {
    monter()
    fireEvent.click(screen.getByTestId('ligne-dehors'))

    const ligne = screen.getByTestId('dehors-row-s1')
    expect(ligne.textContent).toContain('POUYTENGA')
    expect(ligne.textContent).toMatch(/900[\s\u202f\u00a0]000/)   // dépôts
    expect(ligne.textContent).toMatch(/100[\s\u202f\u00a0]000/)   // retraits
    expect(ligne.textContent).toMatch(/800[\s\u202f\u00a0]000/)   // solde
  })

  it('[MO-03] un solde négatif est affiché tel quel, jamais borné à zéro', () => {
    // La boutique doit plus qu'on ne lui doit : c'est une information, pas une
    // anomalie à masquer.
    monter()
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    expect(screen.getByTestId('dehors-row-s2').textContent).toMatch(/-\s?200[\s\u202f\u00a0]000/)
  })

  it('[MO-04] le total de la modale est CELUI de la ligne qui l’ouvre', () => {
    // Les lignes viennent de l'agrégat déjà chargé : aucune seconde lecture,
    // donc aucune divergence possible entre les deux chiffres.
    monter()
    const surLaLigne = screen.getByTestId('ligne-dehors').textContent
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    const dansLaModale = screen.getByTestId('dehors-total').textContent.trim()
    expect(dansLaModale).toBeTruthy()
    expect(surLaLigne).toContain(dansLaModale)
  })

  it('[MO-05] aucune boutique exposée → un vide qui le dit', () => {
    monter({ dehors: { parBoutique: [], depots: 0, retraits: 0, dehors: 0, illisibles: 0, horsReseau: 0 } })
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    expect(screen.getByTestId('dehors-vide')).toBeInTheDocument()
    expect(screen.queryByTestId('dehors-table')).toBeNull()
  })

  it('[MO-06] un total incomplet ne s’annonce jamais complet', () => {
    monter({ dehors: { ...DEHORS, illisibles: 2, horsReseau: 1 } })
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    const calque = screen.getByTestId('dialogue-dehors')
    expect(calque.textContent).toMatch(/2 opérations n’ont pas pu être lues/)
    expect(calque.textContent).toMatch(/1 opération appartient à une boutique qui n’est plus en service/)
  })

  it('[MO-07] la phrase bascule en entier au singulier', () => {
    // Le défaut que ce dépôt a déjà consigné trois fois : un « s » collé au
    // bout d'une locution produit « 1 opérations n'ont pas pu être lue ».
    monter({ dehors: { ...DEHORS, illisibles: 1, horsReseau: 0 } })
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    expect(screen.getByTestId('dialogue-dehors').textContent)
      .toMatch(/1 opération n’a pas pu être lue/)
  })

  it('[MO-08] aucun élément focusable ne se cache dans un sous-arbre aria-hidden', () => {
    const { container } = monter()
    fireEvent.click(screen.getByTestId('ligne-dehors'))
    const pieges = [...container.querySelectorAll('[aria-hidden="true"] a, [aria-hidden="true"] button')]
    expect(pieges).toEqual([])
  })
})
