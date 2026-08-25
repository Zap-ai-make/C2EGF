import { useState, useCallback, useEffect, useMemo } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import ErrorState from '../../components/ui/ErrorState'
import { getRequestsForReport } from '../../services/adminService'
import { formatDateShort as fmtDate } from '../../utils/formatters'

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fmtAmount(n) {
  if (typeof n !== 'number') return '—'
  return n.toLocaleString('fr-FR') + ' FCFA'
}

const TYPE_LABELS = {
  stock_add:     'Approvisionnement Stock',
  liquidity_add: 'Approvisionnement Liquidité',
}

const STATUS_LABELS = {
  pending:   { label: 'En attente',  cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Confirmée',   cls: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Rejetée',     cls: 'bg-red-100   text-red-700'  },
}

// ──────────────────────────────────────────────────────────────────────────────
// Agrégation
// ──────────────────────────────────────────────────────────────────────────────

function aggregate(requests) {
  const byType    = {}
  const byDealer  = {}
  const byStore   = {}
  let totalAmount = 0
  let totalCount  = 0

  for (const r of requests) {
    totalCount++
    if (r.status === 'confirmed') totalAmount += r.amount ?? 0

    // par type
    const typeKey = r.requestType ?? 'unknown'
    byType[typeKey] = byType[typeKey] ?? { count: 0, confirmed: 0, amount: 0 }
    byType[typeKey].count++
    if (r.status === 'confirmed') {
      byType[typeKey].confirmed++
      byType[typeKey].amount += r.amount ?? 0
    }

    // par dealer
    const dk = r.dealerUid ?? 'unknown'
    byDealer[dk] = byDealer[dk] ?? { name: r.dealerName ?? r.dealerEmail ?? dk, count: 0, amount: 0 }
    byDealer[dk].count++
    if (r.status === 'confirmed') byDealer[dk].amount += r.amount ?? 0

    // par boutique
    const sk = r.targetStoreId ?? 'unknown'
    byStore[sk] = byStore[sk] ?? { name: r.targetStoreName ?? sk, count: 0, amount: 0 }
    byStore[sk].count++
    if (r.status === 'confirmed') byStore[sk].amount += r.amount ?? 0
  }

  return {
    totalCount,
    totalAmount,
    byType,
    byDealer: Object.entries(byDealer).sort((a, b) => b[1].count - a[1].count),
    byStore:  Object.entries(byStore).sort((a, b) => b[1].count - a[1].count),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV export
// ──────────────────────────────────────────────────────────────────────────────

function exportCsv(requests) {
  const headers = ['Date', 'Type', 'Dealer', 'Boutique', 'Montant', 'Statut']
  const rows = requests.map(r => [
    fmtDate(r.createdAt),
    TYPE_LABELS[r.requestType] ?? r.requestType ?? '',
    r.dealerName ?? r.dealerEmail ?? '',
    r.targetStoreName ?? '',
    r.amount ?? 0,
    STATUS_LABELS[r.status]?.label ?? r.status ?? '',
  ])
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rapport-demandes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ──────────────────────────────────────────────────────────────────────────────
// Stat card
// ──────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// AdminReports
// ──────────────────────────────────────────────────────────────────────────────

function AdminReports() {
  const today      = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'

  const [dateFrom, setDateFrom]   = useState(firstOfMonth)
  const [dateTo,   setDateTo]     = useState(today)
  const [requests, setRequests]   = useState([])
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState(null)

  const stats = useMemo(() => aggregate(requests), [requests])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getRequestsForReport({
        dateFrom: dateFrom || null,
        dateTo:   dateTo   || null,
      })
      setRequests(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  return (
    <div data-testid="admin-reports">
      <PageHeader
        title="Rapports"
        subtitle="Synthèse des demandes Dealer sur la période sélectionnée"
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || today}
              onChange={e => setDateFrom(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              aria-label="Date de début"
              data-testid="report-date-from"
            />
            <span className="text-sm text-gray-400">→</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={today}
              onChange={e => setDateTo(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              aria-label="Date de fin"
              data-testid="report-date-to"
            />
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              data-testid="report-refresh"
            >
              {loading ? 'Chargement…' : 'Actualiser'}
            </button>
            {requests.length > 0 && (
              <button
                type="button"
                onClick={() => exportCsv(requests)}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                data-testid="report-export-csv"
              >
                Exporter CSV
              </button>
            )}
          </div>
        }
      />

      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[1,2,3,4].map(n => <div key={n} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && requests.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-base font-medium text-gray-600">Aucune demande sur cette période</p>
          <p className="mt-1 text-sm text-gray-400">Modifiez les dates ou actualisez.</p>
        </div>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="space-y-6">
          {/* ── Résumé global ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Résumé réseau</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Demandes total"    value={stats.totalCount} />
              <StatCard label="Montant confirmé"  value={fmtAmount(stats.totalAmount)} sub="Toutes boutiques" />
              <StatCard
                label="Types distincts"
                value={Object.keys(stats.byType).length}
                sub={Object.keys(stats.byType).map(t => TYPE_LABELS[t] ?? t).join(', ')}
              />
              <StatCard label="Boutiques actives" value={stats.byStore.length} />
            </div>
          </section>

          {/* ── Par type ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Par type de demande</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm" data-testid="report-table-type">
                <thead className="bg-green-50/70 text-xs font-semibold text-green-900 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Confirmées</th>
                    <th className="px-4 py-3 text-right">Montant confirmé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {Object.entries(stats.byType).map(([type, s]) => (
                    <tr key={type} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{TYPE_LABELS[type] ?? type}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.count}</td>
                      <td className="px-4 py-3 text-right text-green-700">{s.confirmed}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{fmtAmount(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Activité Dealer ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Activité Dealer</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm" data-testid="report-table-dealer">
                <thead className="bg-green-50/70 text-xs font-semibold text-green-900 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Dealer</th>
                    <th className="px-4 py-3 text-right">Demandes</th>
                    <th className="px-4 py-3 text-right">Montant confirmé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {stats.byDealer.map(([uid, s]) => (
                    <tr key={uid} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{s.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.count}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{fmtAmount(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Par boutique ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Détail par boutique</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm" data-testid="report-table-store">
                <thead className="bg-green-50/70 text-xs font-semibold text-green-900 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Boutique</th>
                    <th className="px-4 py-3 text-right">Demandes</th>
                    <th className="px-4 py-3 text-right">Montant confirmé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {stats.byStore.map(([storeId, s]) => (
                    <tr key={storeId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{s.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.count}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{fmtAmount(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Liste brute ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Détail des demandes ({requests.length} résultat{requests.length > 1 ? 's' : ''})
              {requests.length >= 500 && (
                <span className="ml-2 text-amber-500 font-normal normal-case">
                  — Limite 500 atteinte, affinez la période.
                </span>
              )}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm" data-testid="report-table-detail">
                <thead className="bg-green-50/70 text-xs font-semibold text-green-900 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Dealer</th>
                    <th className="px-4 py-3 text-left">Boutique</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="px-4 py-3 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {requests.map(r => {
                    const st = STATUS_LABELS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-700' }
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-800">{TYPE_LABELS[r.requestType] ?? r.requestType}</td>
                        <td className="px-4 py-3 text-gray-800">{r.dealerName ?? r.dealerEmail ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-800">{r.targetStoreName ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-800 whitespace-nowrap">{fmtAmount(r.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminReports
