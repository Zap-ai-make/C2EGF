import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Dialog from '../../src/components/ui/Dialog.jsx'

/**
 * TC-259 — Le dialogue, ancré sur le côté.
 *
 * ⚠ LA VARIANTE NE CHANGE QUE LE POSITIONNEMENT. Tout ce qui rend un dialogue
 *   utilisable — piège à focus, Échap, aria-modal, retour du focus — reste celui
 *   de `Dialog`. Ces tests vérifient précisément que la variante ne l'a pas perdu.
 */

afterEach(cleanup)

const ouvrir = (props = {}) => render(
  <Dialog open onClose={vi.fn()} title="Historique" {...props}>
    <button type="button">Dedans</button>
  </Dialog>,
)

describe('TC-259 — la variante latérale', () => {
  it('[TC-259-01] sans `cote`, le dialogue reste centré comme avant', () => {
    ouvrir()
    expect(screen.getByRole('dialog').className).not.toMatch(/inset-y-0/)
  })

  it('[TC-259-02] avec `cote`, le panneau occupe toute la hauteur à droite', () => {
    ouvrir({ cote: true })
    const panneau = screen.getByRole('dialog')
    expect(panneau.className).toMatch(/inset-y-0/)
    expect(panneau.className).toMatch(/right-0/)
  })

  it('[TC-259-03] la variante garde le rôle et le titre accessible', () => {
    ouvrir({ cote: true })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Historique')
  })

  it('[TC-259-04] la variante se ferme toujours par Échap', () => {
    const onClose = vi.fn()
    ouvrir({ cote: true, onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  /**
   * ⚠ LE CONTENU D'UN PANNEAU LATÉRAL DÉPASSE, C'EST SA NATURE. S'il n'a aucun
   *   conteneur qui défile, ce qui dépasse n'est pas seulement invisible : il est
   *   inatteignable, y compris au clavier. Le pied de page du panneau
   *   d'historique porte le bouton « Charger plus ».
   */
  it('[TC-259-05] le corps du panneau latéral peut défiler', () => {
    // ⚠ Requête ajustée : `Dialog` sort dans un portail vers `document.body`
    //   (voir le commentaire « LE DIALOGUE SORT DE L'ARBRE OÙ IL EST ÉCRIT »
    //   dans Dialog.jsx). Le `container` rendu par `render()` ne contient donc
    //   pas le panneau — il faut interroger `document.body`, comme le fait déjà
    //   `tc-123-dialog.test.jsx` via `screen`. L'intention reste celle du brief :
    //   le bouton du pied doit vivre dans un conteneur qui défile et se réduit.
    render(
      <Dialog open cote onClose={vi.fn()} title="Historique">
        <div style={{ height: '4000px' }}>Très long</div>
        <button type="button">Charger plus</button>
      </Dialog>,
    )

    const defilant = document.body.querySelector('.overflow-y-auto')
    expect(defilant).not.toBeNull()
    expect(defilant.className).toMatch(/min-h-0/)
    expect(defilant).toContainElement(screen.getByRole('button', { name: 'Charger plus' }))
  })
})
