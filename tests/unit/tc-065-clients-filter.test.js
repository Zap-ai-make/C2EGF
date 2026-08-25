/**
 * TC-065 — useClientsFilter : recherche élargie + null-safety.
 *
 * Comportement protégé :
 *   La recherche porte sur nom, prénom, numéro/code agent (`orange`) et
 *   numéro personnel (`numeroPersonnel`). Les champs absents ne provoquent
 *   aucun plantage (l'ancien code appelait `client.nom.toLowerCase()` sans garde).
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClientsFilter } from '../../src/hooks/useClientsFilter'

const CLIENTS = [
  { id: '1', nom: 'Dupont', prenom: 'Jean', orange: 'AG-100', numeroPersonnel: '0600000000' },
  { id: '2', nom: 'Martin', prenom: 'Luc', orange: 'AG-200', numeroPersonnel: '0700000000' },
  { id: '3', nom: 'Zoe' }, // champs orange/numeroPersonnel/prenom absents → ne doit pas planter
]

function filterWith(term) {
  const { result } = renderHook(() => useClientsFilter(CLIENTS))
  act(() => result.current.setSearchTerm(term))
  return result.current.filteredClients.map(c => c.id)
}

describe('TC-065 — useClientsFilter', () => {
  it('recherche par numéro/code agent (orange)', () => {
    expect(filterWith('ag-200')).toEqual(['2'])
  })

  it('recherche par numéro personnel', () => {
    expect(filterWith('0600000000')).toEqual(['1'])
  })

  it('recherche par nom / prénom', () => {
    expect(filterWith('dupont')).toEqual(['1'])
    expect(filterWith('luc')).toEqual(['2'])
  })

  it('terme vide → tous les clients', () => {
    expect(filterWith('')).toEqual(['1', '2', '3'])
  })

  it('ne plante pas sur les champs absents et ne matche pas à tort', () => {
    expect(filterWith('introuvable')).toEqual([])
    expect(filterWith('zoe')).toEqual(['3'])
  })
})
