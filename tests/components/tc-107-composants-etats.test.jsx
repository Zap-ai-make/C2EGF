/**
 * TC-107 — Les composants d'état : vide, chargement, erreur.
 *
 * Ces quatre composants sont le passage obligé des états d'écran (DESIGN.md
 * §10). Ils n'avaient aucun test. Ce fichier fige ce qu'ils PROMETTENT — un nom
 * accessible, un rôle, un texte français, une action utilisable — et jamais une
 * classe : c'est la règle des tc-100 à 106, et tc-091 vient de montrer ce qu'un
 * sélecteur adossé à une classe de style coûte au premier restyle.
 *
 * Deux cas figent des défauts réels rencontrés en chemin, pour qu'ils ne
 * reviennent pas :
 *
 *   • OptimisticToast levait dès qu'on le rendait sans type explicite —
 *     `type='info'` était la valeur par défaut et `typeStyles.info` n'existait
 *     pas. Le bilan de la refonte l'annonçait corrigé ; il ne l'était pas, le
 *     fichier n'ayant jamais été modifié depuis l'import du produit.
 *   • StatusBadge concaténait deux chaînes de classes sans espace.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import EmptyState from '../../src/components/ui/EmptyState.jsx'
import ErrorState from '../../src/components/ui/ErrorState.jsx'
import FullPageSpinner from '../../src/components/ui/FullPageSpinner.jsx'
import StatusBadge from '../../src/components/ui/StatusBadge.jsx'
import OptimisticToast from '../../src/components/ui/OptimisticToast.jsx'
import { SkeletonTable, SkeletonCards } from '../../src/components/ui/SkeletonList.jsx'

describe('TC-107 — état vide', () => {
  it('affiche un titre par défaut quand rien n’est précisé', () => {
    render(<EmptyState />)
    expect(screen.getByText('Aucun résultat')).toBeInTheDocument()
  })

  it('affiche le titre et l’explication fournis', () => {
    render(<EmptyState title="Aucun agent enrôlé" message="Enrôlez votre premier agent." />)
    expect(screen.getByText('Aucun agent enrôlé')).toBeInTheDocument()
    expect(screen.getByText('Enrôlez votre premier agent.')).toBeInTheDocument()
  })

  it('propose une issue : l’action passée est rendue et cliquable', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Aucun agent"
        action={<button type="button" onClick={onClick}>Enrôler un agent</button>}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enrôler un agent' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('l’icône est décorative : elle ne parle pas au lecteur d’écran', () => {
    const Icone = (props) => <svg data-testid="icone" {...props} />
    render(<EmptyState icon={Icone} title="Aucun agent" />)
    expect(screen.getByTestId('icone')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('TC-107 — état d’erreur', () => {
  it('s’annonce comme une alerte et explique', () => {
    render(<ErrorState message="Le réseau n’a pas répondu." />)
    const alerte = screen.getByRole('alert')
    expect(alerte).toHaveTextContent('Erreur de chargement')
    expect(alerte).toHaveTextContent('Le réseau n’a pas répondu.')
  })

  it('n’offre « Réessayer » que s’il y a quelque chose à réessayer', () => {
    const { rerender } = render(<ErrorState />)
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument()

    const onRetry = vi.fn()
    rerender(<ErrorState onRetry={onRetry} />)
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('« Réessayer » rappelle bien la fonction fournie', () => {
    const onRetry = vi.fn()
    render(<ErrorState onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('TC-107 — état de chargement', () => {
  it('le spinner plein écran annonce l’attente', () => {
    render(<FullPageSpinner />)
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…')
  })

  it('le spinner accepte un libellé propre au contexte', () => {
    render(<FullPageSpinner label="Vérification du compte…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Vérification du compte…')
  })

  it('les squelettes de tableau se déclarent occupés et nommés', () => {
    render(<SkeletonTable rows={3} cols={4} />)
    const zone = screen.getByLabelText('Chargement…')
    expect(zone).toHaveAttribute('aria-busy', 'true')
  })

  it('les squelettes de cartes aussi', () => {
    render(<SkeletonCards count={2} />)
    expect(screen.getByLabelText('Chargement…')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('TC-107 — statut', () => {
  it('le statut est écrit, pas seulement coloré', () => {
    render(<StatusBadge status="pending" label="En attente" />)
    expect(screen.getByText('En attente')).toBeInTheDocument()
  })

  it('sans libellé, le statut brut fait office de texte et de nom accessible', () => {
    render(<StatusBadge status="rejected" />)
    expect(screen.getByLabelText('rejected')).toHaveTextContent('rejected')
  })

  it('une couleur sur mesure ne se colle plus à la classe du préréglage', () => {
    // Le défaut : `${cls}${customCls}` produisait « …font-medium » soudé à la
    // classe suivante. On vérifie qu'aucune classe n'est tronquée par collage.
    const { container } = render(<StatusBadge status="pending" color="bg-brand-50 text-brand-600" />)
    const classes = container.firstChild.className.split(/\s+/)
    expect(classes).toContain('bg-brand-50')
    expect(classes).toContain('text-brand-600')
    expect(classes).toContain('font-medium')
  })
})

describe('TC-107 — toast optimiste', () => {
  it('se rend sans type explicite, sans lever', () => {
    // Le défaut historique : `type` valait 'info' par défaut, `typeStyles.info`
    // n'existait pas, et le rendu levait sur `styles.bg`.
    expect(() =>
      render(<OptimisticToast message="Opération annulée" isVisible onClose={() => {}} />)
    ).not.toThrow()
    expect(screen.getByText('Opération annulée')).toBeInTheDocument()
  })

  it('rend chacun de ses types sans lever', () => {
    for (const type of ['info', 'success', 'error', 'warning', 'rollback']) {
      const { unmount } = render(
        <OptimisticToast message={`Message ${type}`} type={type} isVisible onClose={() => {}} />
      )
      expect(screen.getByText(`Message ${type}`)).toBeInTheDocument()
      unmount()
    }
  })

  it('invisible, il ne rend rien', () => {
    const { container } = render(
      <OptimisticToast message="Rien à voir" isVisible={false} onClose={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
