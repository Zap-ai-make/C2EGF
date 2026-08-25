/**
 * TC-066 — Liste clients (espace boutique) : tri décroissant par date
 * d'enregistrement. Le dernier client enregistré doit apparaître en haut.
 *
 * L'abonnement temps réel `subscribeToClients` ne pose pas d'`orderBy` :
 * le tri est fait côté client (createdAt Timestamp, repli sur `dateAjout` FR).
 */

import { describe, it, expect, vi } from 'vitest'

// ClientsContext importe firestore (Firebase) et AuthContext → neutralisés.
vi.mock('../../src/services/firestore', () => ({ firestoreService: {} }))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: {} }))

import { sortClientsByRegistrationDesc } from '../../src/context/ClientsContext.jsx'

const ts = (ms) => ({ toMillis: () => ms })

describe('TC-066 — sortClientsByRegistrationDesc', () => {
  it('classe par createdAt décroissant', () => {
    const input = [
      { id: 'a', createdAt: ts(100) },
      { id: 'b', createdAt: ts(300) },
      { id: 'c', createdAt: ts(200) },
    ]
    expect(sortClientsByRegistrationDesc(input).map(x => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('repli sur dateAjout (JJ/MM/AAAA) quand createdAt absent', () => {
    const input = [
      { id: 'vieux', dateAjout: '01/01/2026' },
      { id: 'recent', dateAjout: '15/06/2026' },
    ]
    expect(sortClientsByRegistrationDesc(input).map(x => x.id)).toEqual(['recent', 'vieux'])
  })

  it('les clients avec createdAt passent avant ceux sans date', () => {
    const input = [
      { id: 'sans-date' },
      { id: 'avec-date', createdAt: ts(1) },
    ]
    expect(sortClientsByRegistrationDesc(input).map(x => x.id)).toEqual(['avec-date', 'sans-date'])
  })

  it('ne mute pas le tableau source', () => {
    const input = [{ id: 'a', createdAt: ts(1) }, { id: 'b', createdAt: ts(2) }]
    const copy = [...input]
    sortClientsByRegistrationDesc(input)
    expect(input).toEqual(copy)
  })
})
