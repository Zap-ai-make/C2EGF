import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

import ClientSearch from '../../src/components/transactions/ClientSearch.jsx'
import { useClientsFilter } from '../../src/hooks/useClientsFilter.js'

/**
 * TC-234 — Chercher un client par n'importe lequel de ses identifiants.
 *
 * CE QUI MANQUAIT, ET CE QUI MANQUAIT VRAIMENT
 * ────────────────────────────────────────────
 * La recherche couvrait déjà le nom, le prénom, le numéro personnel et le champ
 * agent. Mais ce dernier était UNIQUE : code agent et numéro agent partageaient
 * une case, et la caissière qui ne connaissait que l'autre ne trouvait rien —
 * non pas parce que la recherche était trop étroite, mais parce que la donnée
 * qu'elle cherchait n'avait jamais été enregistrée à part.
 *
 * Ces tests couvrent donc les deux moitiés du problème :
 *   — les cinq champs sont bien fouillés ;
 *   — une fiche d'avant la séparation reste trouvable par sa vieille valeur,
 *     rangée à la lecture dans l'une ou l'autre colonne (TC-233).
 *
 * ⚠ La seconde moitié est la plus importante. Toute la base de production est
 *   dans cet état, et une recherche qui ne la trouverait plus serait une
 *   régression invisible en test et totale en boutique.
 */

const SEPAREE = {
  id: 'c-1',
  nom: 'Ouedraogo',
  prenom: 'Aïssata',
  codeAgent: '1234567',
  numeroAgent: '70112233',
  numeroPersonnel: '65432100',
}

/** Fiche jamais rouverte depuis la séparation : tout vit encore dans `orange`. */
const ANCIENNE_AVEC_NUMERO = {
  id: 'c-2',
  nom: 'Kabore',
  prenom: 'Salif',
  orange: '70998877',
  numeroPersonnel: '65000011',
}

const ANCIENNE_AVEC_CODE = {
  id: 'c-3',
  nom: 'Sana',
  prenom: 'Fatimata',
  orange: '7654321',
  numeroPersonnel: '65000022',
}

const TOUS = [SEPAREE, ANCIENNE_AVEC_NUMERO, ANCIENNE_AVEC_CODE]

// ─────────────────────────────────────────────────────────────────────────────
// La barre de recherche du formulaire de transaction
// ─────────────────────────────────────────────────────────────────────────────

const onClientSelect = vi.fn()

const chercher = (terme) => {
  // Certains tests cherchent deux termes de suite : sans ce nettoyage, les deux
  // listes coexisteraient dans le document et se compteraient ensemble.
  cleanup()
  render(
    <ClientSearch clients={TOUS} onClientSelect={onClientSelect} selectedClient={null} />,
  )
  const champ = screen.getByPlaceholderText(/code agent/i)
  fireEvent.change(champ, { target: { value: terme } })
  // Le champ est débrayé de 300 ms pour ne pas filtrer à chaque frappe.
  act(() => { vi.advanceTimersByTime(350) })
  return screen.queryAllByRole('listitem')
}

describe('TC-234 — la barre du formulaire de transaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onClientSelect.mockReset()
  })

  it('[TC-234-1] le libellé énonce les cinq champs cherchés', () => {
    render(<ClientSearch clients={TOUS} onClientSelect={onClientSelect} selectedClient={null} />)
    const champ = screen.getByPlaceholderText(/code agent/i)

    for (const mot of ['Nom', 'prénom', 'code agent', 'numéro agent', 'numéro personnel']) {
      expect(champ.placeholder.toLowerCase()).toContain(mot.toLowerCase())
    }
  })

  it('[TC-234-2] trouve par nom', () => {
    expect(chercher('ouedraogo')).toHaveLength(1)
  })

  it('[TC-234-3] trouve par prénom', () => {
    expect(chercher('Aïssata')).toHaveLength(1)
  })

  it('[TC-234-4] trouve par code agent', () => {
    const trouves = chercher('1234567')
    expect(trouves).toHaveLength(1)
    expect(trouves[0]).toHaveTextContent('Ouedraogo')
  })

  it('[TC-234-5] trouve par numéro agent', () => {
    const trouves = chercher('70112233')
    expect(trouves).toHaveLength(1)
    expect(trouves[0]).toHaveTextContent('Ouedraogo')
  })

  it('[TC-234-6] trouve par numéro personnel', () => {
    expect(chercher('65432100')).toHaveLength(1)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LA BASE EXISTANTE.
   *   Ces deux fiches n'ont que leur vieux champ. Si la recherche ne lisait que
   *   `codeAgent` et `numeroAgent`, elle ne trouverait plus AUCUN client de
   *   production — une panne totale, invisible en test si l'on n'écrit que des
   *   fixtures au nouveau format.
   */
  it('[TC-234-7] trouve une fiche d’avant la séparation par sa vieille valeur', () => {
    expect(chercher('70998877')).toHaveLength(1)
    expect(chercher('7654321')).toHaveLength(1)
  })

  it('[TC-234-8] nomme correctement ce qu’elle montre', () => {
    // 8 chiffres → numéro agent ; 7 → code agent. L'ancien écran étiquetait
    // les deux « Code agent ».
    expect(chercher('70998877')[0]).toHaveTextContent('N° 70998877')
    expect(chercher('7654321')[0]).toHaveTextContent('Code 7654321')
  })

  it('[TC-234-9] ne propose rien sur un terme inconnu', () => {
    expect(chercher('00000000')).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le filtre de la liste des clients
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-234 — le filtre de la liste des clients', () => {
  const filtrer = (terme) => {
    const { result } = renderHook(() => useClientsFilter(TOUS))
    act(() => { result.current.setSearchTerm(terme) })
    return result.current.filteredClients
  }

  it('[TC-234-10] couvre les mêmes champs que la barre de transaction', () => {
    expect(filtrer('1234567').map((c) => c.id)).toEqual(['c-1'])
    expect(filtrer('70112233').map((c) => c.id)).toEqual(['c-1'])
    expect(filtrer('65432100').map((c) => c.id)).toEqual(['c-1'])
    expect(filtrer('ouedraogo').map((c) => c.id)).toEqual(['c-1'])
  })

  it('[TC-234-11] et trouve aussi les fiches d’avant la séparation', () => {
    expect(filtrer('70998877').map((c) => c.id)).toEqual(['c-2'])
    expect(filtrer('7654321').map((c) => c.id)).toEqual(['c-3'])
  })
})
