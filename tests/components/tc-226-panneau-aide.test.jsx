import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: {} }),
}))

import AidePanel from '../../src/components/aide/AidePanel.jsx'
import { FICHES, GROUPES } from '../../src/content/aideFiches.js'

/**
 * TC-226 — Le panneau d'aide.
 *
 * CE QU'IL DOIT FAIRE EN DIX SECONDES
 * ───────────────────────────────────
 * Une caissière l'ouvre parce qu'elle est bloquée, au milieu d'une saisie. Tout
 * ce fichier mesure une seule chose : est-ce qu'elle trouve sa réponse sans
 * fouiller ?
 *
 *   — douze TITRES à parcourir des yeux, pas douze fiches dépliées (TC-226-2) ;
 *   — une seule ouverte à la fois, pour que la réponse lue soit seule à
 *     l'écran (TC-226-4) ;
 *   — et les fiches de l'endroit où elle se tient EN PREMIER (TC-226-5), ce qui
 *     est toute la différence entre « rapide » et « encore un truc à fouiller ».
 */

const afficher = (chemin = '/transactions') =>
  render(
    <MemoryRouter initialEntries={[chemin]}>
      <AidePanel open onClose={() => {}} />
    </MemoryRouter>,
  )

describe('TC-226 — le panneau d’aide', () => {
  it('[TC-226-1] présente toutes les fiches', () => {
    afficher()
    const panneau = within(screen.getByTestId('panneau-aide'))

    for (const fiche of FICHES) {
      expect(panneau.getByTestId(`aide-fiche-${fiche.id}`)).toBeInTheDocument()
    }
  })

  it('[TC-226-2] les fiches sont repliées à l’ouverture', () => {
    afficher()

    // Douze fiches dépliées font un mur de texte qu'on referme sans lire. Le
    // contenu de la fiche 1 ne doit donc pas être là avant qu'on la demande.
    expect(screen.queryByText(/Dans la barre de recherche, tape le num/)).not.toBeInTheDocument()
    expect(screen.getByTestId('aide-fiche-1')).toHaveAttribute('aria-expanded', 'false')
  })

  it('[TC-226-3] ouvrir une fiche montre ses étapes', () => {
    afficher()
    fireEvent.click(screen.getByTestId('aide-fiche-1'))

    expect(screen.getByTestId('aide-fiche-1')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Dans la barre de recherche, tape le num/)).toBeInTheDocument()
  })

  it('[TC-226-4] une seule fiche reste ouverte à la fois', () => {
    afficher()
    fireEvent.click(screen.getByTestId('aide-fiche-1'))
    fireEvent.click(screen.getByTestId('aide-fiche-3'))

    expect(screen.getByTestId('aide-fiche-1')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('aide-fiche-3')).toHaveAttribute('aria-expanded', 'true')
  })

  it('[TC-226-5] recliquer sur la fiche ouverte la referme', () => {
    afficher()
    fireEvent.click(screen.getByTestId('aide-fiche-1'))
    fireEvent.click(screen.getByTestId('aide-fiche-1'))

    expect(screen.getByTestId('aide-fiche-1')).toHaveAttribute('aria-expanded', 'false')
  })

  /**
   * L'ORDRE DES GROUPES SUIT L'ENDROIT OÙ L'ON SE TIENT.
   *
   * C'est la seule chose qui rend le panneau utile à une caissière bloquée
   * plutôt qu'à une qui a du temps. Depuis l'historique — là où vivent les
   * gestes les plus récents, donc les moins connus — ses fiches passent devant
   * les sept fiches de saisie qu'elle maîtrise déjà.
   */
  it('[TC-226-6] depuis l’historique, le groupe historique est affiché en premier', () => {
    afficher('/historique')

    const groupes = Array.from(
      screen.getByTestId('panneau-aide').querySelectorAll('[data-testid^="aide-groupe-"]'),
    ).map((noeud) => noeud.getAttribute('data-testid'))

    expect(groupes[0]).toBe(`aide-groupe-${GROUPES.HISTORIQUE}`)
    expect(groupes).toContain(`aide-groupe-${GROUPES.TRANSACTIONS}`)
  })

  it('[TC-226-7] depuis les transactions, c’est le groupe de saisie', () => {
    afficher('/transactions')

    const groupes = Array.from(
      screen.getByTestId('panneau-aide').querySelectorAll('[data-testid^="aide-groupe-"]'),
    ).map((noeud) => noeud.getAttribute('data-testid'))

    expect(groupes[0]).toBe(`aide-groupe-${GROUPES.TRANSACTIONS}`)
  })

  /**
   * Le seul effet du panneau, et celui qui travaille : l'œil retrouve dans la
   * fiche la FORME qu'il cherche à l'écran. Un libellé qui resterait écrit
   * `{{Valider}}` serait pire que pas de mise en forme du tout.
   */
  it('[TC-226-8] les libellés et l’emphase sont rendus, jamais leur balisage', () => {
    afficher()
    fireEvent.click(screen.getByTestId('aide-fiche-1'))
    fireEvent.click(screen.getByTestId('aide-fiche-3'))

    const panneau = screen.getByTestId('panneau-aide')
    // Ni accolade ni astérisque à l'écran : du balisage resté visible serait
    // pire que pas de mise en forme du tout.
    expect(panneau.textContent).not.toMatch(/[{}*]/)
    expect(within(panneau).getAllByText('Valider').length).toBeGreaterThan(0)
    // L'emphase est un vrai <strong>, et non des majuscules qui crient.
    expect(within(panneau).getByText('déjà').tagName).toBe('STRONG')
  })
})

/**
 * LE DIALOGUE NE DOIT RIEN DEVOIR À L'ENDROIT D'OÙ ON L'APPELLE.
 *
 * Le panneau d'aide est monté DANS la barre de navigation, qui porte
 * `backdrop-blur-sm`. Un `backdrop-filter` fait de l'élément qui le porte un
 * BLOC CONTENEUR pour ses descendants `position: fixed` — au même titre qu'un
 * `transform`. Le `fixed inset-0` du dialogue se résolvait donc sur la barre et
 * non sur la fenêtre : le panneau s'est affiché replié en une bande de la
 * hauteur de la barre, voile compris.
 *
 * Le portail supprime la question. Ce test la garde posée : il reconstruit la
 * cause EXACTE — un ancêtre filtrant — et vérifie que le dialogue n'y reste pas.
 * Sans lui, le prochain `transform` ajouté n'importe où rejouerait la panne, et
 * personne ne ferait le lien.
 */
describe('TC-226 — le panneau échappe à son point de montage', () => {
  it('[TC-226-9] rendu dans un ancêtre filtrant, il n’y reste pas', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/transactions']}>
        {/* La barre réelle : `backdrop-blur-sm` de themes.js. */}
        <div style={{ backdropFilter: 'blur(4px)' }} data-testid="barre-doublure">
          <AidePanel open onClose={() => {}} />
        </div>
      </MemoryRouter>,
    )

    const panneau = screen.getByTestId('panneau-aide')

    // Il existe, et il est dans le document…
    expect(panneau).toBeInTheDocument()
    // …mais PAS sous l'ancêtre filtrant, sinon `inset-0` se réglerait sur lui.
    expect(container.querySelector('[data-testid="panneau-aide"]')).toBeNull()
    expect(screen.getByTestId('barre-doublure')).not.toContainElement(panneau)
  })

  it('[TC-226-10] le voile couvre la fenêtre, et non la barre', () => {
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <div style={{ backdropFilter: 'blur(4px)' }}>
          <AidePanel open onClose={() => {}} />
        </div>
      </MemoryRouter>,
    )

    // Le voile est le parent du dialogue : c'est lui qui porte `fixed inset-0`.
    const voile = screen.getByTestId('panneau-aide').parentElement
    expect(voile.className).toContain('fixed')
    expect(voile.className).toContain('inset-0')
  })
})
