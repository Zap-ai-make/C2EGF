/**
 * TC-123 — La modale accessible.
 *
 * Sept écrans posaient déjà un `role="dialog"` ; aucun ne piégeait le focus.
 * Sans piège, la tabulation sort de la modale et parcourt la page derrière le
 * voile : le lecteur d'écran annonce des boutons invisibles, et l'on peut
 * déclencher une action qu'on ne voit pas.
 *
 * Ce fichier verrouille les quatre moitiés du contrat — entrer, rester, sortir,
 * et RENDRE le focus. La dernière est celle qu'on oublie : sans elle, refermer
 * renvoie en haut du document, et au clavier on a tout perdu.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Dialog from '../../src/components/ui/Dialog.jsx'

const Contenu = () => (
  <>
    <input aria-label="Champ" />
    <button type="button">Action</button>
  </>
)

const poser = (props = {}) =>
  render(
    <>
      <button type="button">Derrière</button>
      <Dialog open title="Titre" testId="dlg" onClose={() => {}} {...props}>
        <Contenu />
      </Dialog>
    </>,
  )

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-123-A — la coquille', () => {
  it('[DG-01] fermée, elle ne rend rien du tout', () => {
    render(<Dialog open={false} title="Titre" testId="dlg"><Contenu /></Dialog>)
    expect(screen.queryByTestId('dlg')).not.toBeInTheDocument()
  })

  it('[DG-02] ouverte, elle s’annonce comme modale et porte son titre', () => {
    poser()
    const dlg = screen.getByTestId('dlg')
    expect(dlg).toHaveAttribute('role', 'dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('Titre')
  })

  it('[DG-03] le bouton de fermeture a un nom, pas seulement une croix', () => {
    poser()
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })
})

describe('TC-123-B — le focus entre, reste, et revient', () => {
  it('[DG-04] à l’ouverture, le focus entre par le CONTENU, pas par la croix', () => {
    // Ouvrir un formulaire pour poser le curseur sur « Fermer » oblige à
    // tabuler avant de saisir, et place la sortie sous la touche Entrée.
    poser()
    expect(screen.getByLabelText('Champ')).toHaveFocus()
  })

  it('[DG-05] Tab depuis la dernière cible revient à la première', () => {
    // Dans l'ordre du DOM : [Fermer, Champ, Action]. La croix est en tête parce
    // qu'elle est dans l'en-tête — elle ouvre le CYCLE, sans être l'entrée.
    poser()
    screen.getByRole('button', { name: 'Action' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus()
  })

  it('[DG-06] Maj+Tab depuis la première va à la dernière', () => {
    poser()
    screen.getByRole('button', { name: 'Fermer' }).focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Action' })).toHaveFocus()
  })

  it('[DG-07] le focus ne peut pas atteindre la page derrière le voile', () => {
    // C'est tout l'objet du piège : le bouton « Derrière » existe, il est
    // focusable, et il ne doit jamais recevoir le focus tant que la modale est
    // ouverte.
    poser()
    const derriere = screen.getByText('Derrière')
    screen.getByRole('button', { name: 'Action' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(derriere).not.toHaveFocus()
  })

  it('[DG-08] à la fermeture, le focus RETOURNE d’où il venait', () => {
    const declencheur = document.createElement('button')
    declencheur.textContent = 'Ouvrir'
    document.body.appendChild(declencheur)
    declencheur.focus()

    const { rerender } = render(
      <Dialog open title="Titre" testId="dlg" onClose={() => {}}><Contenu /></Dialog>,
    )
    expect(screen.getByLabelText('Champ')).toHaveFocus()

    rerender(<Dialog open={false} title="Titre" testId="dlg" onClose={() => {}}><Contenu /></Dialog>)
    expect(declencheur).toHaveFocus()
    declencheur.remove()
  })
})

describe('TC-123-C — fermer', () => {
  it('[DG-09] Échap ferme', () => {
    const onClose = vi.fn()
    poser({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('[DG-10] le bouton ferme', () => {
    const onClose = vi.fn()
    poser({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('[DG-11] un clic sur le voile ne ferme PAS', () => {
    // Ces dialogues portent des montants d'argent : un clic à côté effacerait
    // une saisie sans confirmation. Fermer reste un geste explicite.
    const onClose = vi.fn()
    poser({ onClose })
    fireEvent.click(screen.getByTestId('dlg').parentElement)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('[DG-12] fermée, elle n’écoute plus le clavier', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open title="Titre" testId="dlg" onClose={onClose}><Contenu /></Dialog>,
    )
    rerender(<Dialog open={false} title="Titre" testId="dlg" onClose={onClose}><Contenu /></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TC-123-D — arrière-plan inerte', () => {
  /**
   * CE TEST A ÉTÉ RÉÉCRIT, ET LA RAISON COMPTE.
   *
   * Il exigeait l'attribut `inert` sur le bouton LUI-MÊME. C'était figer le
   * mécanisme — « on marque chaque frère, niveau par niveau » — plutôt que la
   * propriété, qui est « ce qui est derrière ne se tabule pas ».
   *
   * Depuis que le dialogue part dans un portail vers `document.body` (voir
   * Dialog.jsx : un ancêtre `backdrop-filter` en faisait un bloc conteneur et
   * repliait la modale en bande), le marquage ne descend plus : un seul `inert`
   * posé sur la racine de l'application rend tout l'arrière-plan inerte d'un
   * coup. Le bouton n'en porte donc plus l'attribut — il en HÉRITE, ce qui est
   * la sémantique même d'`inert` et vaut mieux que l'ancien parcours.
   *
   * La règle, elle, n'a pas bougé d'un pouce. On la vérifie donc là où elle
   * vit : sur la chaîne des ancêtres.
   */
  const porteurInerte = (element) => {
    for (let n = element; n && n !== document.documentElement; n = n.parentElement) {
      if (n.hasAttribute('inert')) return n
    }
    return null
  }

  it('[DG-13] rend le contenu derrière inerte puis restaure son état', () => {
    const { rerender } = poser()
    const derriere = screen.getByText('Derrière')

    const porteur = porteurInerte(derriere)
    expect(porteur, 'rien derrière le dialogue n’a été rendu inerte').not.toBeNull()
    expect(porteur).toHaveAttribute('aria-hidden', 'true')

    // ET le dialogue échappe à l'inertie : la rendre à tout le document le
    // rendrait inutilisable, panne qu'aucune autre assertion ne verrait.
    expect(porteurInerte(screen.getByTestId('dlg'))).toBeNull()

    rerender(
      <>
        <button type="button">Derrière</button>
        <Dialog open={false} title="Titre" testId="dlg" onClose={() => {}}><Contenu /></Dialog>
      </>,
    )

    // Restauration : plus un seul ancêtre inerte, et l'`aria-hidden` retiré.
    const apres = screen.getByRole('button', { name: 'Derrière' })
    expect(porteurInerte(apres)).toBeNull()
    for (let n = apres; n && n !== document.documentElement; n = n.parentElement) {
      expect(n).not.toHaveAttribute('aria-hidden')
    }
  })
})
