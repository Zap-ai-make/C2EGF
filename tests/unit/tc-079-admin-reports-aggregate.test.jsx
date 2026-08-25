/**
 * TC-079 — Tests de caractérisation AdminReports (audit espaces dealer/gérant)
 *
 * La fonction aggregate() n'est pas exportée : on la caractérise via le rendu
 * du composant avec getRequestsForReport mocké. Fige le comportement ACTUEL
 * (totaux confirmés uniquement, tris par volume, fallbacks de libellés).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getRequestsForReport: vi.fn(),
}))

vi.mock('../../src/services/adminService', () => ({
  getRequestsForReport: mocks.getRequestsForReport,
}))

import AdminReports from '../../src/pages/admin/AdminReports'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Montants formatés comme le composant (toLocaleString fr-FR). jest-dom
// normalise les espaces insécables (U+202F/U+00A0) du DOM en espaces simples :
// on normalise la chaîne attendue de la même façon.
const fmt = n => (n.toLocaleString('fr-FR') + ' FCFA').replace(/[\u202f\u00a0]/g, ' ')

const REQUESTS = [
  { id: 'r1', requestType: 'stock_add', status: 'confirmed', amount: 1000,
    dealerUid: 'd1', dealerName: 'Moussa', targetStoreId: 's1', targetStoreName: 'Alpha' },
  { id: 'r2', requestType: 'stock_add', status: 'pending', amount: 500,
    dealerUid: 'd1', dealerName: 'Moussa', targetStoreId: 's1', targetStoreName: 'Alpha' },
  { id: 'r3', requestType: 'liquidity_add', status: 'confirmed', amount: 2000,
    dealerUid: 'd2', dealerEmail: 'd2@x.com', targetStoreId: 's2', targetStoreName: 'Beta' },
  { id: 'r4', requestType: 'liquidity_add', status: 'rejected', amount: 9999,
    dealerUid: 'd2', dealerEmail: 'd2@x.com', targetStoreId: 's2', targetStoreName: 'Beta' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

async function renderLoaded(data = REQUESTS) {
  mocks.getRequestsForReport.mockResolvedValue(data)
  render(<AdminReports />)
  await waitFor(() => expect(screen.getByTestId('report-table-type')).toBeInTheDocument())
}

// ---------------------------------------------------------------------------
// §1 — Agrégats globaux
// ---------------------------------------------------------------------------

describe('TC-079-AG — agrégats globaux', () => {
  it('[AG-01] totalCount = toutes les demandes ; totalAmount = confirmées uniquement', async () => {
    await renderLoaded()
    // 4 demandes au total
    expect(screen.getByText('Demandes total').parentElement).toHaveTextContent('4')
    // Montant confirmé = 1000 + 2000 (pending 500 et rejected 9999 exclus).
    // Le libellé apparaît aussi dans les en-têtes de tableaux → la StatCard est la 1re occurrence.
    expect(screen.getAllByText('Montant confirmé')[0].parentElement).toHaveTextContent(fmt(3000))
  })

  it('[AG-02] charge le mois courant par défaut (dateFrom = 1er du mois, dateTo = aujourd\'hui)', async () => {
    await renderLoaded()
    const today = new Date().toISOString().slice(0, 10)
    const firstOfMonth = today.slice(0, 8) + '01'
    expect(mocks.getRequestsForReport).toHaveBeenCalledWith({ dateFrom: firstOfMonth, dateTo: today })
  })
})

// ---------------------------------------------------------------------------
// §2 — Agrégation par type
// ---------------------------------------------------------------------------

describe('TC-079-TY — par type de demande', () => {
  it('[TY-01] compte total, confirmées et montant confirmé par type', async () => {
    await renderLoaded()
    const table = screen.getByTestId('report-table-type')

    const stockRow = within(table).getByText('Approvisionnement Stock').closest('tr')
    expect(stockRow).toHaveTextContent('2')          // count
    expect(stockRow).toHaveTextContent(fmt(1000))    // montant confirmé (pending exclu)

    const liqRow = within(table).getByText('Approvisionnement Liquidité').closest('tr')
    expect(liqRow).toHaveTextContent('2')
    expect(liqRow).toHaveTextContent(fmt(2000))      // rejected exclu
  })

  it('[TY-02] requestType inconnu → clé affichée brute (fallback)', async () => {
    await renderLoaded([
      { id: 'r1', requestType: 'mystery_type', status: 'pending', amount: 10, dealerUid: 'd1', targetStoreId: 's1' },
    ])
    const table = screen.getByTestId('report-table-type')
    expect(within(table).getByText('mystery_type')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// §3 — Agrégation par dealer et par boutique (fallbacks de nom)
// ---------------------------------------------------------------------------

describe('TC-079-DL — par dealer / par boutique', () => {
  it('[DL-01] nom dealer = dealerName, sinon dealerEmail, sinon uid', async () => {
    await renderLoaded([
      ...REQUESTS,
      { id: 'r5', requestType: 'stock_add', status: 'pending', amount: 1, dealerUid: 'd3', targetStoreId: 's3' },
    ])
    const table = screen.getByTestId('report-table-dealer')
    expect(within(table).getByText('Moussa')).toBeInTheDocument()      // dealerName
    expect(within(table).getByText('d2@x.com')).toBeInTheDocument()    // fallback email
    expect(within(table).getByText('d3')).toBeInTheDocument()          // fallback uid
  })

  it('[DL-02] montant dealer = somme des confirmées seulement', async () => {
    await renderLoaded()
    const table = screen.getByTestId('report-table-dealer')
    const d2Row = within(table).getByText('d2@x.com').closest('tr')
    expect(d2Row).toHaveTextContent(fmt(2000))
  })

  it('[DL-03] nom boutique = targetStoreName, sinon storeId ; tri par volume décroissant', async () => {
    await renderLoaded([
      { id: 'a1', requestType: 'stock_add', status: 'pending', amount: 1, dealerUid: 'd1', targetStoreId: 's-solo' },
      { id: 'b1', requestType: 'stock_add', status: 'pending', amount: 1, dealerUid: 'd1', targetStoreId: 's-big', targetStoreName: 'Grande' },
      { id: 'b2', requestType: 'stock_add', status: 'pending', amount: 1, dealerUid: 'd1', targetStoreId: 's-big', targetStoreName: 'Grande' },
    ])
    const table = screen.getByTestId('report-table-store')
    const rows = within(table).getAllByRole('row').slice(1) // sans thead
    // 's-big' (2 demandes) avant 's-solo' (1 demande)
    expect(rows[0]).toHaveTextContent('Grande')
    expect(rows[1]).toHaveTextContent('s-solo') // fallback id
  })
})

// ---------------------------------------------------------------------------
// §4 — Détail des demandes : fallback statut inconnu
// ---------------------------------------------------------------------------

describe('TC-079-DT — détail et statuts', () => {
  it('[DT-01] statut inconnu → libellé brut avec style neutre', async () => {
    await renderLoaded([
      { id: 'r1', requestType: 'stock_add', status: 'weird_status', amount: 10, dealerUid: 'd1', targetStoreId: 's1' },
    ])
    const table = screen.getByTestId('report-table-detail')
    expect(within(table).getByText('weird_status')).toBeInTheDocument()
  })

  it('[DT-02] statuts connus → libellés français', async () => {
    await renderLoaded()
    const table = screen.getByTestId('report-table-detail')
    expect(within(table).getAllByText('Confirmée')).toHaveLength(2)
    expect(within(table).getByText('En attente')).toBeInTheDocument()
    expect(within(table).getByText('Rejetée')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// §5 — États vide et erreur
// ---------------------------------------------------------------------------

describe('TC-079-ES — états vide / erreur', () => {
  it('[ES-01] aucune demande → message vide dédié', async () => {
    mocks.getRequestsForReport.mockResolvedValue([])
    render(<AdminReports />)
    await waitFor(() =>
      expect(screen.getByText('Aucune demande sur cette période')).toBeInTheDocument()
    )
  })

  it('[ES-02] échec du service → message d\'erreur affiché', async () => {
    mocks.getRequestsForReport.mockRejectedValue(new Error('Accès refusé. Vérifiez vos permissions.'))
    render(<AdminReports />)
    await waitFor(() =>
      expect(screen.getByText('Accès refusé. Vérifiez vos permissions.')).toBeInTheDocument()
    )
  })
})
