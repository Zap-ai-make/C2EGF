/**
 * TC-106 — Le tableau de bord refait : balance, réseau, flux.
 *
 * Ces trois blocs remplacent des indicateurs de commerce de détail par des
 * indicateurs de distribution. Le fichier vérifie ce qui est AFFICHÉ, jamais
 * comment c'est habillé.
 *
 * Deux exigences d'accessibilité y sont figées, parce qu'elles sont faciles à
 * perdre lors d'une retouche visuelle (DESIGN.md §5) :
 *   - la proportion de la balance est écrite, pas seulement dessinée ;
 *   - les deux sens du flux sont nommés, pas seulement colorés.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Recharts ne mesure rien sous jsdom : on neutralise le rendu graphique et on
// garde tout ce qui porte du sens — titres, légendes, totaux, état vide.
vi.mock('recharts', () => {
  const Passe = ({ children }) => <div>{children}</div>
  return {
    ResponsiveContainer: Passe,
    BarChart: Passe,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
  }
})

import Balance from '../../src/components/dashboard/Balance.jsx'
import ReseauCards from '../../src/components/dashboard/ReseauCards.jsx'
import FluxChart from '../../src/components/dashboard/FluxChart.jsx'

const balanceType = (over = {}) => ({
  reseau: 'Orange',
  stock: 140631529,
  liquidite: 341515014,
  fondsRoulement: 482146543,
  partStock: 140631529 / 482146543,
  versLiquidite: 0,
  versStock: 0,
  deriveNette: 0,
  ...over,
})

/** Compare un texte en neutralisant le type d'espace des milliers (U+202F). */
const texte = (attendu) => (contenu) => contenu.replace(/\s/g, ' ') === attendu

describe('TC-106 — la balance', () => {
  it('affiche les deux plateaux et le fonds de roulement', () => {
    render(<Balance balance={balanceType()} projection={null} />)
    expect(screen.getByRole('heading', { name: /La balance/ })).toBeInTheDocument()
    expect(screen.getByText(texte('140 631 529'))).toBeInTheDocument()
    expect(screen.getByText(texte('341 515 014'))).toBeInTheDocument()
    expect(screen.getByText(texte('482 146 543 FCFA'))).toBeInTheDocument()
  })

  it('nomme le réseau sur le plateau du stock', () => {
    render(<Balance balance={balanceType()} projection={null} />)
    expect(screen.getByText(/Stock Orange/)).toBeInTheDocument()
  })

  it('écrit la proportion — elle ne passe pas par la seule barre colorée', () => {
    render(<Balance balance={balanceType()} projection={null} />)
    expect(screen.getByText('29 %')).toBeInTheDocument()
    expect(screen.getByText('71 %')).toBeInTheDocument()
  })

  it('dit le sens de la dérive du jour, pas seulement son montant', () => {
    render(<Balance balance={balanceType({ deriveNette: 2340000 })} projection={null} />)
    expect(screen.getByText(texte('2 340 000 FCFA'))).toBeInTheDocument()
    expect(screen.getByText(/vers la/)).toBeInTheDocument()
    expect(screen.getByText('liquidité')).toBeInTheDocument()
  })

  it('dérive inverse → le sens s’inverse aussi', () => {
    render(<Balance balance={balanceType({ deriveNette: -500000 })} projection={null} />)
    expect(screen.getByText('stock')).toBeInTheDocument()
  })

  it('journée sans mouvement → le dit, plutôt que d’afficher un zéro nu', () => {
    render(<Balance balance={balanceType({ deriveNette: 0 })} projection={null} />)
    expect(screen.getByText(/n’a pas bougé d’un plateau à l’autre/)).toBeInTheDocument()
  })

  it('fonds à zéro → état vide qui invite à agir', () => {
    const vide = balanceType({ stock: 0, liquidite: 0, fondsRoulement: 0, partStock: 0 })
    render(<Balance balance={vide} projection={null} />)
    expect(screen.getByText(/premier ravitaillement de la centrale/)).toBeInTheDocument()
  })

  it('projection dans la journée → alerte avec l’heure de rupture', () => {
    const projection = {
      vase: 'stock',
      dansLaJournee: true,
      rupture: new Date('2026-08-27T14:30:00'),
    }
    render(<Balance balance={balanceType()} projection={projection} />)
    expect(screen.getByText(/serait épuisé vers/)).toBeInTheDocument()
    expect(screen.getByText('14:30')).toBeInTheDocument()
  })

  it('rupture hors de la journée → on se tait, l’alerte ne serait pas actionnable', () => {
    const projection = { vase: 'stock', dansLaJournee: false, rupture: new Date() }
    render(<Balance balance={balanceType()} projection={projection} />)
    expect(screen.queryByText(/serait épuisé vers/)).not.toBeInTheDocument()
  })
})

const couvertureType = (over = {}) => ({
  totalAgents: 1184, actifs: 187, part: 187 / 1184, visites: 785,
  passagesParAgent: 4.2, fenetreJours: 7, ...over,
})
const decrochagesType = (over = {}) => ({ seuilJours: 15, total: 0, decroches: [], ...over })
const concentrationType = (over = {}) => ({
  topN: 10, fenetreJours: 30, volumeTotal: 0, agentsComptes: 0, tete: [], partTete: 0, ...over,
})

const renderReseau = (props = {}) =>
  render(
    <ReseauCards
      couverture={couvertureType()}
      decrochages={decrochagesType()}
      concentration={concentrationType()}
      {...props}
    />,
  )

describe('TC-106 — l’état du réseau', () => {
  it('la couverture rapporte les actifs au portefeuille entier', () => {
    renderReseau()
    expect(screen.getByText('187')).toBeInTheDocument()
    expect(screen.getByText(texte('/ 1 184'))).toBeInTheDocument()
    expect(screen.getByText(/16 %/)).toBeInTheDocument()
  })

  it('affiche la cadence mesurée — les passages par agent actif', () => {
    renderReseau()
    expect(screen.getByText('4,2')).toBeInTheDocument()
    expect(screen.getByText(/passages par agent actif/)).toBeInTheDocument()
  })

  it('portefeuille vide → invitation à enrôler, pas un zéro nu', () => {
    renderReseau({ couverture: couvertureType({ totalAgents: 0, actifs: 0, part: 0 }) })
    expect(screen.getByText(/Enregistrez un premier agent/)).toBeInTheDocument()
  })

  it('aucun décrochage → le dit positivement', () => {
    renderReseau()
    expect(screen.getByText(/Le réseau tourne/)).toBeInTheDocument()
  })

  it('des décrochages → nombre, seuil, et les plus silencieux nommés', () => {
    const decroches = [
      { agent: { id: 'a-1', nom: 'BANABA', prenom: 'Guafarou' }, joursDeSilence: 42 },
      { agent: { id: 'a-2', nom: 'TAPSOBA', prenom: 'Sarifatou' }, joursDeSilence: 20 },
    ]
    renderReseau({ decrochages: decrochagesType({ total: 2, decroches }) })
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/depuis plus de 15 jours/)).toBeInTheDocument()
    expect(screen.getByText('Guafarou BANABA')).toBeInTheDocument()
    expect(screen.getByText('42 j')).toBeInTheDocument()
  })

  it('le seuil de décrochage est réglable à l’écran, pas enfoui dans le code', () => {
    const onSeuilChange = vi.fn()
    renderReseau({ onSeuilChange })
    const select = screen.getByLabelText(/Alerter après/)
    expect(select).toHaveValue('15')

    fireEvent.change(select, { target: { value: '30' } })
    expect(onSeuilChange).toHaveBeenCalledWith(30)
  })

  it('concentration élevée → avertissement explicite', () => {
    const concentration = concentrationType({
      volumeTotal: 1000000, agentsComptes: 12, partTete: 0.72,
      tete: [{ cle: 'a-1', nom: 'BANABA Guafarou', volume: 720000 }],
    })
    renderReseau({ concentration })
    expect(screen.getByText('72 %')).toBeInTheDocument()
    expect(screen.getByText(/Dépendance élevée/)).toBeInTheDocument()
  })

  it('concentration faible → aucun avertissement', () => {
    const concentration = concentrationType({
      volumeTotal: 1000000, agentsComptes: 50, partTete: 0.2, tete: [],
    })
    renderReseau({ concentration })
    expect(screen.queryByText(/Dépendance élevée/)).not.toBeInTheDocument()
  })
})

const fluxType = (paves) =>
  paves.map((p, i) => ({
    cle: `j-${i}`, libelle: `0${i + 1}/08`, depots: 0, retraits: 0, retraitsNegatifs: 0, ...p,
  }))

describe('TC-106 — le volume traité', () => {
  it('s’intitule « volume traité », pas « chiffre d’affaires »', () => {
    // Chez un distributeur, le revenu est la marge sur le float, pas le montant
    // qui transite. L'écart est de l'ordre de 100×.
    render(<FluxChart flux={fluxType([{ depots: 100 }])} />)
    expect(screen.getByRole('heading', { name: /Volume traité/ })).toBeInTheDocument()
    expect(screen.queryByText(/chiffre d’affaires|CA\b/i)).not.toBeInTheDocument()
  })

  it('nomme les deux sens — ils ne passent pas par la seule couleur', () => {
    render(<FluxChart flux={fluxType([{ depots: 100 }])} />)
    expect(screen.getByText(/Dépôts, vers la liquidité/)).toBeInTheDocument()
    expect(screen.getByText(/Retraits, vers le stock/)).toBeInTheDocument()
  })

  it('totalise chaque sens et énonce la dérive', () => {
    const flux = fluxType([
      { depots: 500000, retraits: 200000, retraitsNegatifs: -200000 },
      { depots: 300000, retraits: 100000, retraitsNegatifs: -100000 },
    ])
    render(<FluxChart flux={flux} />)
    expect(screen.getByText(texte('800 000 FCFA'))).toBeInTheDocument()
    expect(screen.getByText(texte('300 000 FCFA'))).toBeInTheDocument()
    expect(screen.getByText(texte('500 000 FCFA vers la liquidité'))).toBeInTheDocument()
  })

  it('aucune opération réglée → état vide explicite', () => {
    render(<FluxChart flux={fluxType([{}, {}])} />)
    expect(screen.getByText(/Aucune opération réglée sur les 14 derniers jours/)).toBeInTheDocument()
  })
})
