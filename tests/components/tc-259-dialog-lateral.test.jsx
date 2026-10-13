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
})
