/**
 * TC-121 — Le fléau.
 *
 * C'est la signature de l'écran, donc l'endroit où une régression se verrait le
 * plus — et aussi celui où elle se verrait le MOINS, parce qu'une poutre trop
 * courte reste une poutre plausible. D'où des assertions sur la géométrie
 * réelle, pas seulement sur la présence des éléments.
 *
 * Ce qui est verrouillé :
 *   • le dessin dit la même chose que le texte (sens, longueur, échelle) ;
 *   • la poutre est DÉCORATIVE — le sens complet vit dans le nom accessible,
 *     parce que « moins cent trente-cinq mille » ne dit pas de quel côté ça
 *     penche ;
 *   • la part compensable est SUPERPOSÉE au bras, jamais ajoutée à sa longueur ;
 *   • le squelette garde la hauteur d'une poutre, pour que la ligne de zéro ne
 *     saute pas à l'arrivée des données ;
 *   • une ligne illisible est dite, jamais avalée.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

import Fleau from '../../src/components/debts/Fleau.jsx'
import { computeDebtPositions } from '../../src/utils/debtPositions.js'
import { formatCurrency } from '../../src/utils/formatCurrency.js'

/**
 * ⚠ Les noms accessibles se composent AVEC `formatCurrency`, jamais avec un
 *   littéral recopié à la main.
 *
 *   `Intl.NumberFormat('fr-FR')` sépare les milliers par une ESPACE FINE
 *   INSÉCABLE (U+202F), pas par l'espace ordinaire qu'on tape. `toHaveTextContent`
 *   normalise les blancs et ne voit pas la différence ; `toHaveAccessibleName`
 *   compare caractère par caractère et échoue sur deux chaînes visuellement
 *   identiques. Recopier le montant à la main écrirait un test qui ment sur ce
 *   que l'application produit vraiment.
 */

const MOI = 'store-a'

const dette = (partner, remainingAmount, nom) => ({
  id: `d-${partner}-${remainingAmount}`,
  debtorStoreId: MOI,
  creditorStoreId: partner,
  creditorStoreName: nom ?? partner,
  remainingAmount,
})

const creance = (partner, remainingAmount, nom) => ({
  id: `c-${partner}-${remainingAmount}`,
  debtorStoreId: partner,
  debtorStoreName: nom ?? partner,
  creditorStoreId: MOI,
  remainingAmount,
})

const pose = (debts, credits, props = {}) =>
  render(
    <Fleau positions={computeDebtPositions({ storeId: MOI, debts, credits })} {...props} />,
  )

/** La largeur en % telle qu'elle est réellement posée en style inline. */
const largeur = (el) => Number.parseFloat(el.style.width)

const brasDe = (testId, cote) =>
  [...screen.getByTestId(testId).querySelectorAll('span[style*="width"]')].filter((el) =>
    cote === 'gauche' ? el.className.includes('right-1/2') : el.className.includes('left-1/2'),
  )

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-121-A — les totaux en tête', () => {
  it('[FL-01] rend les trois totaux, signés', () => {
    pose([dette('b', 220_000)], [creance('c', 140_000)])
    expect(screen.getByText('Je dois').parentElement).toHaveTextContent('220 000 FCFA')
    expect(screen.getByText('On me doit').parentElement).toHaveTextContent('140 000 FCFA')
    expect(screen.getByText('Position nette').parentElement).toHaveTextContent('−80 000 FCFA')
  })

  it('[FL-02] une position créditrice porte un plus, une débitrice un moins', () => {
    pose([], [creance('c', 95_000)])
    expect(screen.getByText('Position nette').parentElement).toHaveTextContent('+95 000 FCFA')
  })
})

describe('TC-121-B — la géométrie des poutres', () => {
  it('[FL-03] le plus grand bras occupe la demi-piste', () => {
    pose([dette('gros', 180_000), dette('petit', 40_000)], [])
    expect(largeur(brasDe('fleau-ligne-gros', 'gauche')[0])).toBe(50)
  })

  it('[FL-04] les autres bras sont à l’échelle du plus grand', () => {
    pose([dette('gros', 180_000), dette('petit', 45_000)], [])
    expect(largeur(brasDe('fleau-ligne-petit', 'gauche')[0])).toBe(12.5)
  })

  it('[FL-05] une dette pousse à GAUCHE, une créance à DROITE', () => {
    pose([dette('debiteur', 100_000)], [creance('crediteur', 100_000)])
    expect(brasDe('fleau-ligne-debiteur', 'gauche')).toHaveLength(1)
    expect(brasDe('fleau-ligne-debiteur', 'droite')).toHaveLength(0)
    expect(brasDe('fleau-ligne-crediteur', 'droite')).toHaveLength(1)
    expect(brasDe('fleau-ligne-crediteur', 'gauche')).toHaveLength(0)
  })

  it('[FL-06] la part compensable est SUPERPOSÉE au bras, pas ajoutée', () => {
    // 180 000 dus, 45 000 dûs en retour. Le bras gauche doit mesurer 180 000 —
    // pas 225 000. Juxtaposer les deux ferait mentir la comparaison entre
    // lignes, et c'est exactement ce que le dessin promet.
    pose([dette('mixte', 180_000)], [creance('mixte', 45_000)])
    const gauche = brasDe('fleau-ligne-mixte', 'gauche').map(largeur).sort((a, b) => b - a)
    expect(gauche).toEqual([50, 12.5])
    const compensables = screen
      .getByTestId('fleau-ligne-mixte')
      .querySelectorAll('.fleau-compensable')
    expect(compensables).toHaveLength(2)
  })

  it('[FL-07] sans bras opposé, aucune hachure', () => {
    pose([dette('seule', 40_000)], [])
    expect(
      screen.getByTestId('fleau-ligne-seule').querySelectorAll('.fleau-compensable'),
    ).toHaveLength(0)
  })

  it('[FL-08] une paire opposée parfaite reste dessinée, malgré son net nul', () => {
    pose([dette('pair', 45_000)], [creance('pair', 45_000)])
    const ligne = screen.getByTestId('fleau-ligne-pair')
    expect(ligne).toHaveTextContent('0 FCFA')
    expect(brasDe('fleau-ligne-pair', 'gauche').length).toBeGreaterThan(0)
    expect(brasDe('fleau-ligne-pair', 'droite').length).toBeGreaterThan(0)
  })
})

describe('TC-121-C — ce que le dessin ne dit pas tout seul', () => {
  it('[FL-09] la poutre est masquée de l’arbre d’accessibilité', () => {
    pose([dette('b', 50_000)], [])
    const poutre = screen.getByTestId('fleau-ligne-b').querySelector('[aria-hidden="true"]')
    expect(poutre).not.toBeNull()
  })

  it('[FL-10] le nom accessible porte le SENS, que le montant signé ne donne pas', () => {
    pose([dette('b', 135_000, 'Gounghin')], [])
    expect(screen.getByTestId('fleau-ligne-b')).toHaveAccessibleName(
      `Gounghin : je dois ${formatCurrency(135_000)}`,
    )
  })

  it('[FL-11] une créance s’annonce dans l’autre sens', () => {
    pose([], [creance('c', 95_000, 'Zogona')])
    expect(screen.getByTestId('fleau-ligne-c')).toHaveAccessibleName(
      `Zogona : on me doit ${formatCurrency(95_000)}`,
    )
  })

  it('[FL-12] à l’équilibre, le nom accessible annonce le compensable', () => {
    // Sinon la ligne s'annoncerait « 0 FCFA » et n'aurait aucune raison d'être
    // là — alors que c'est la plus actionnable de l'écran.
    pose([dette('pair', 45_000, 'Gounghin')], [creance('pair', 45_000, 'Gounghin')])
    expect(screen.getByTestId('fleau-ligne-pair')).toHaveAccessibleName(
      `Gounghin : à l’équilibre, ${formatCurrency(45_000)} compensables`,
    )
  })

  it('[FL-13] la légende double chaque teinte d’un mot', () => {
    pose([dette('b', 50_000)], [creance('b', 20_000)])
    expect(screen.getByText('Ce que je dois')).toBeInTheDocument()
    expect(screen.getByText('Ce qu’on me doit')).toBeInTheDocument()
    expect(screen.getByText('Hachuré : compensable')).toBeInTheDocument()
  })

  it('[FL-14] le décompte des dettes et créances accorde ses pluriels', () => {
    pose([dette('b', 10_000), dette('b', 20_000)], [creance('b', 5_000)])
    expect(screen.getByTestId('fleau-ligne-b')).toHaveTextContent('2 dettes · 1 créance')
  })
})

describe('TC-121-D — les états', () => {
  it('[FL-15] le squelette garde la hauteur d’une poutre et sa ligne de zéro', () => {
    // Sans ça, la ligne de zéro sauterait à l'arrivée des données — le seul
    // repère de l'écran, qui bouge au pire moment.
    const { container } = render(<Fleau positions={null} loading />)
    expect(container.querySelectorAll('.-top-2.-bottom-2').length).toBeGreaterThan(0)
    expect(screen.queryByText('Aucune dette ouverte')).not.toBeInTheDocument()
  })

  it('[FL-16] l’état vide invite et explique ce qui n’est pas montré', () => {
    pose([], [])
    expect(screen.getByText('Aucune dette ouverte')).toBeInTheDocument()
    expect(screen.getByText(/historique/i)).toBeInTheDocument()
  })

  it('[FL-17] l’état vide ne rend pas de légende — rien à légender', () => {
    pose([], [])
    expect(screen.queryByText('Ce que je dois')).not.toBeInTheDocument()
  })

  it('[FL-18] une ligne illisible est dite, jamais avalée', () => {
    pose([dette('b', 50_000), dette('c', 'illisible')], [])
    const avis = screen.getByRole('status')
    expect(avis).toHaveTextContent('1 ligne illisible')
    expect(screen.getByText('Je dois').parentElement).toHaveTextContent('50 000 FCFA')
  })

  it('[FL-19] plusieurs lignes illisibles accordent leurs pluriels', () => {
    pose([dette('b', 50_000), dette('c', null), dette('d', -1)], [])
    expect(screen.getByRole('status')).toHaveTextContent('2 lignes illisibles')
  })

  it('[FL-20] sans ligne illisible, aucun avis', () => {
    pose([dette('b', 50_000)], [])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('TC-121-E — le dépliage', () => {
  it('[FL-21] chaque poutre est un bouton, et s’annonce replié', () => {
    pose([dette('b', 50_000)], [])
    expect(screen.getByTestId('fleau-ligne-b')).toHaveAttribute('aria-expanded', 'false')
  })

  it('[FL-22] cliquer une poutre remonte son partenaire', () => {
    const onTogglePartner = vi.fn()
    pose([dette('b', 50_000)], [], { onTogglePartner })
    fireEvent.click(screen.getByTestId('fleau-ligne-b'))
    expect(onTogglePartner).toHaveBeenCalledWith('b')
  })

  it('[FL-23] déplié, le détail est rendu sous la poutre', () => {
    pose([dette('b', 50_000)], [], {
      expandedPartnerId: 'b',
      renderDetails: (p) => <p>détail de {p.name}</p>,
    })
    expect(screen.getByTestId('fleau-ligne-b')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('détail de b')).toBeInTheDocument()
  })

  it('[FL-24] une seule poutre à la fois porte le détail', () => {
    pose([dette('b', 50_000), dette('c', 30_000)], [], {
      expandedPartnerId: 'b',
      renderDetails: (p) => <p>détail de {p.name}</p>,
    })
    expect(screen.getAllByText(/détail de/)).toHaveLength(1)
  })

  it('[FL-25] sans renderDetails, déplier ne casse rien', () => {
    pose([dette('b', 50_000)], [], { expandedPartnerId: 'b' })
    expect(screen.getByTestId('fleau-ligne-b')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('TC-121-F — l’ordre à l’écran', () => {
  it('[FL-26] les poutres sortent dans l’ordre des positions, le plus lourd d’abord', () => {
    pose([dette('petit', 40_000), dette('gros', 135_000)], [])
    const lignes = within(screen.getByRole('list')).getAllByRole('button')
    expect(lignes.map((b) => b.dataset.testid)).toEqual([
      'fleau-ligne-gros',
      'fleau-ligne-petit',
    ])
  })
})
