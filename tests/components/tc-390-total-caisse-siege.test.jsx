import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * TC-390 — la barre des soldes retire du Total caisse l'argent qui part au
 * siège (spec 2026-11-15-remb-siege-bleu-ciel).
 *
 * Les sommes sont testées pures dans TC-224. Ce fichier garde le CÂBLAGE : une
 * barre qui oublierait de passer la part du siège laisserait TC-224 vert et
 * afficherait pourtant un total gonflé de chaque remboursement en attente.
 */

vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({
    networkData: {
      Orange: { stock: 1_100_000, liquidite: 0 },
      Liquidite: { stock: 0, liquidite: 500_000 },
    },
  }),
}))
vi.mock('../../src/context/NetworkConfigContext.jsx', () => ({
  useSoldesProvisoires: () => false,
}))
vi.mock('../../src/components/network/NetworkCard', () => ({
  default: ({ network }) => <div data-testid={`carte-${network}`}>{network}</div>,
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({
    pendingTransactions: [
      { id: 'd1', type: 'Dépôt', montant: 20_000 },
      {
        id: 's1', type: 'Remb. siège', statut: 'Non Terminées', montant: 100_000,
        balanceType: 'stock', envoyeAuSiege: 30_000, resteAuSiege: 70_000,
      },
    ],
  }),
}))

// Une demande d'agent en attente, de 50 000 : elle n'est pas encore une
// opération, et l'argent n'a pas bougé (TC-390-2).
vi.mock('../../src/hooks/useDemandesAgent.js', () => ({
  useDemandesAgent: () => ({
    demandes: [{ id: 'dem1', estDemandeAgent: true, sens: 'depot', type: 'Dépôt', reseau: 'Orange', montant: 50_000 }],
  }),
}))

import NetworkCardsDrawer from '../../src/components/network/NetworkCardsDrawer.jsx'

describe('TC-390 — le Total caisse et l’argent du siège', () => {
  it('[TC-390-1] la barre retranche le reste à envoyer au siège', () => {
    render(<NetworkCardsDrawer />)
    // 1 100 000 + 500 000 + 20 000 (dépôt) − 70 000 (reste au siège)
    expect(screen.getByTestId('total-caisse').textContent.replace(/\s/g, '')).toContain('1550000')
  })

  it('[TC-390-2] une demande d’agent en attente ne compte pas : l’argent n’a pas encore bougé', () => {
    // Elle compte une fois acceptée, comme l'opération qu'elle devient.
    render(<NetworkCardsDrawer />)
    expect(screen.getByTestId('total-caisse').textContent.replace(/\s/g, '')).toContain('1550000')
  })
})
