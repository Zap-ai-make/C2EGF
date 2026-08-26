/**
 * TC-100 — Toast : caractérisation avant refonte du design.
 *
 * Ce fichier fige le COMPORTEMENT du toast, pas son habillage : message affiché,
 * fermeture automatique au bout de `duration`, fermeture manuelle, et absence de
 * rappel si le composant est démonté avant l'échéance.
 *
 * Aucune assertion ne porte sur une classe CSS — c'est délibéré. Le lot 1 (jetons)
 * et le lot 5 (icônes lucide) vont réécrire entièrement l'apparence ; un test qui
 * s'accrocherait aux classes bloquerait la refonte qu'il est censé protéger.
 *
 * Défaut connu, documenté ici et corrigé au lot 5 (DESIGN.md §5 et §11) : le type
 * du toast (succès / erreur / avertissement) n'est porté QUE par la couleur de fond
 * et un glyphe texte — aucun équivalent textuel, aucun rôle ARIA, et le bouton de
 * fermeture n'a pas de nom accessible. Les requêtes ci-dessous visent donc le rôle
 * `button` sans nom, ce qui reste vrai après l'ajout d'un `aria-label`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'

import Toast from '../../src/components/Toast.jsx'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TC-100 — Toast, comportement figé', () => {
  it('affiche le message qu’on lui passe', () => {
    render(<Toast message="Transaction enregistrée" onClose={vi.fn()} />)
    expect(screen.getByText('Transaction enregistrée')).toBeInTheDocument()
  })

  it('appelle onClose après `duration` puis le délai de sortie de 300 ms', () => {
    const onClose = vi.fn()
    render(<Toast message="Fini" duration={4000} onClose={onClose} />)

    act(() => { vi.advanceTimersByTime(4000) })
    // La sortie est animée : onClose n'arrive qu'après 300 ms de plus.
    expect(onClose).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('respecte une durée personnalisée', () => {
    const onClose = vi.fn()
    render(<Toast message="Rapide" duration={1000} onClose={onClose} />)

    act(() => { vi.advanceTimersByTime(1000 + 300) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('le bouton de fermeture déclenche onClose après le délai de sortie', () => {
    const onClose = vi.fn()
    render(<Toast message="À fermer" onClose={onClose} />)

    act(() => { screen.getByRole('button').click() })
    expect(onClose).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('démonté avant l’échéance → onClose n’est jamais appelé', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Toast message="Annulé" duration={4000} onClose={onClose} />)

    unmount()
    act(() => { vi.advanceTimersByTime(10000) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['success', 'error', 'warning', 'info'])(
    'type « %s » → le message reste affiché',
    (type) => {
      render(<Toast message={`Message ${type}`} type={type} onClose={vi.fn()} />)
      expect(screen.getByText(`Message ${type}`)).toBeInTheDocument()
    },
  )
})
