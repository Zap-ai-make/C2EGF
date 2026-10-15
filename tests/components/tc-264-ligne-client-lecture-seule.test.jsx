import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TableRow from '../../src/components/TableRow.jsx'

/**
 * TC-264 — la ligne client ne propose que ce qu'elle peut faire.
 *
 * ⚠ LE DÉFAUT. `TableRow` gardait `onHistorique` derrière une condition, mais
 *   PAS la cellule d'actions : son bouton « Modifier » s'affichait toujours, et
 *   son `onClick` faisait `onEdit && onEdit(client)` — donc rien, sans le dire.
 *   L'espace patron est en lecture seule : un bouton qui a l'air d'écrire et
 *   n'écrit pas est pire qu'un bouton absent, et devient un chemin d'écriture
 *   le jour où quelqu'un le câble.
 */

const fiche = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif', registeredStoreName: 'FADA',
  numeroIdentite: 'B 029', numeroPersonnel: '76548890', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga', agentCommercial: 'SORE', dateAjout: '04/02/2026',
}

const ligne = (props = {}) => render(
  <table><tbody><TableRow client={fiche} index={0} {...props} /></tbody></table>,
)

afterEach(cleanup)

describe('TC-264 — sans `onEdit`, aucune action', () => {
  it('[TC-264-01] le bouton Modifier est absent', () => {
    ligne()
    expect(screen.queryByRole('button', { name: /modifier/i })).toBeNull()
  })

  it('[TC-264-02] le bouton Supprimer est absent lui aussi', () => {
    ligne()
    expect(screen.queryByRole('button', { name: /supprimer/i })).toBeNull()
  })

  /** 11 colonnes d'en-tête chez le patron, donc 11 cellules. */
  it('[TC-264-03] la ligne rend 11 cellules', () => {
    const { container } = ligne()
    expect(container.querySelectorAll('td')).toHaveLength(11)
  })
})

describe('TC-264 — avec `onEdit`, le gérant ne perd rien', () => {
  it('[TC-264-04] le bouton Modifier est là et appelle `onEdit`', () => {
    const onEdit = vi.fn()
    ligne({ onEdit })
    screen.getByRole('button', { name: /modifier/i }).click()
    expect(onEdit).toHaveBeenCalledWith(fiche)
  })

  it('[TC-264-05] Supprimer reste présent et désactivé', () => {
    ligne({ onEdit: vi.fn() })
    expect(screen.getByRole('button', { name: /supprimer/i })).toBeDisabled()
  })

  it('[TC-264-06] la ligne rend 12 cellules', () => {
    const { container } = ligne({ onEdit: vi.fn() })
    expect(container.querySelectorAll('td')).toHaveLength(12)
  })
})
