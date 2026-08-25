/**
 * TC-063 — Historique boutique : tri décroissant par date d'enregistrement.
 *
 * Règle protégée : le dernier élément enregistré doit apparaître en tête.
 * Le tri privilégie le Timestamp Firestore `createdAt`, avec repli sur la
 * date française `date` ("DD/MM/YYYY HH:mm") quand `createdAt` est absent.
 */

import { describe, it, expect, vi } from 'vitest'

// transactions.jsx importe des modules liés à Firebase — on les neutralise
// pour n'exercer que le helper pur exporté.
vi.mock('../../src/services/firestore', () => ({ firestoreService: {} }))
vi.mock('../../src/services/settlementService', () => ({
  addTransactionPayment: vi.fn(),
  addTransactionRefund: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: {} }))

import { sortHistoryDesc } from '../../src/context/transactions.jsx'

const ts = (ms) => ({ toMillis: () => ms })

describe('TC-063 — sortHistoryDesc', () => {
  it('classe par createdAt décroissant (le plus récent en premier)', () => {
    const input = [
      { id: 'a', createdAt: ts(100) },
      { id: 'b', createdAt: ts(300) },
      { id: 'c', createdAt: ts(200) },
    ]
    expect(sortHistoryDesc(input).map(x => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('utilise la date FR en repli quand createdAt est absent', () => {
    const input = [
      { id: 'vieux', date: '01/01/2026 09:00' },
      { id: 'recent', date: '02/01/2026 10:00' },
    ]
    expect(sortHistoryDesc(input).map(x => x.id)).toEqual(['recent', 'vieux'])
  })

  it('ne mute pas le tableau source', () => {
    const input = [{ id: 'a', createdAt: ts(1) }, { id: 'b', createdAt: ts(2) }]
    const copy = [...input]
    sortHistoryDesc(input)
    expect(input).toEqual(copy)
  })
})
