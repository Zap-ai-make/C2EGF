import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TableRow from '../../src/components/TableRow.jsx'
import { TABLE_HEADERS } from '../../src/constants/index.js'

/**
 * TC-262 — La colonne « Historique » du tableau des clients.
 *
 * ⚠ LE TABLEAU PORTE DÉJÀ DIX COLONNES. La colonne ajoutée doit être un en-tête
 *   déclaré, pas un bouton glissé dans « Actions » : l'utilisateur a demandé un
 *   en-tête, et c'est aussi ce qui garde l'alignement des cellules.
 *
 * ⚠ `CLIENT_TABLE_COLUMNS` N'EXISTE PAS DANS CE DÉPÔT. Le registre réel des
 *   colonnes s'appelle `TABLE_HEADERS` (src/constants/index.js) — c'est lui
 *   qu'on importe et qu'on vérifie ici.
 */

const CLIENT = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'SALIF',
  codeAgent: '0123456', numeroAgent: '01234567',
  registeredStoreName: 'C2EGF OUAGA', dateAjout: '13/10/2026',
}

const rendre = (props = {}) => render(
  <table><tbody>
    <TableRow client={CLIENT} index={0} onEdit={vi.fn()} {...props} />
  </tbody></table>,
)

afterEach(cleanup)

describe('TC-262 — la colonne', () => {
  it('[TC-262-01] « Historique » est un en-tête déclaré', () => {
    expect(TABLE_HEADERS.some((c) => c.key === 'historique' && c.label === 'Historique')).toBe(true)
  })

  it('[TC-262-02] chaque ligne porte autant de cellules que d’en-têtes, plus les actions', () => {
    const { container } = rendre()
    expect(container.querySelectorAll('td')).toHaveLength(TABLE_HEADERS.length + 1)
  })

  /**
   * ⚠ AJUSTEMENT DE REQUÊTE (intention conservée) : sans `onHistorique`, aucun
   *   bouton n'existe (TC-262-05) — c'est la règle vérifiée juste en dessous.
   *   `rendre()` seul ne pouvait donc jamais faire apparaître le bouton dont ce
   *   test lit le libellé ; il faut fournir un gestionnaire pour l'exercer.
   */
  it('[TC-262-03] le bouton nomme le client, pour les lecteurs d’écran', () => {
    rendre({ onHistorique: vi.fn() })
    expect(screen.getByRole('button', { name: /Historique de OUEDRAOGO SALIF/ })).toBeInTheDocument()
  })

  it('[TC-262-04] le bouton remonte le client cliqué', () => {
    const onHistorique = vi.fn()
    rendre({ onHistorique })
    fireEvent.click(screen.getByRole('button', { name: /Historique/ }))
    expect(onHistorique).toHaveBeenCalledWith(CLIENT)
  })

  /** Sans gestionnaire, pas de bouton inerte : la colonne reste vide. */
  it('[TC-262-05] sans `onHistorique`, aucun bouton n’est proposé', () => {
    rendre({ onHistorique: undefined })
    expect(screen.queryByRole('button', { name: /Historique/ })).toBeNull()
  })
})
