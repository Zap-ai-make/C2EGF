import { useState, useCallback, useEffect } from 'react'
import { listAllUsers } from '../../services/adminService'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonTable } from '../../components/ui/SkeletonList'
import { formatDateShort as formatDate } from '../../utils/formatters'

const ROLE_LABELS = {
  store_admin: 'Admin boutique',
  member: 'Caissière',
  dealer: 'Dealer',
  system_manager: 'Gérant',
}
const ROLE_OPTIONS = [
  { value: '', label: 'Tous les rôles' },
  { value: 'store_admin', label: 'Admin boutique' },
  { value: 'member', label: 'Caissière' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'system_manager', label: 'Gérant' },
]
const ACTIVE_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'true', label: 'Actifs' },
  { value: 'false', label: 'Inactifs' },
]

function AdminUsers() {
  const [users, setUsers]             = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [roleFilter, setRoleFilter]   = useState('')
  const [activeFilter, setActiveFilter] = useState('')

  const load = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setUsers([])
      setLastDoc(null)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const result = await listAllUsers({
        lastDoc: reset ? null : lastDoc,
        roleFilter: roleFilter || null,
        activeFilter: activeFilter === '' ? null : activeFilter === 'true',
        search,
      })
      if (reset) setUsers(result.users)
      else setUsers(prev => [...prev, ...result.users])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [roleFilter, activeFilter, search, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [roleFilter, activeFilter, search])

  return (
    <div data-testid="admin-users">
      <PageHeader
        title="Utilisateurs"
        subtitle="Supervision de tous les comptes de la plateforme"
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      {/* Filtres */}
      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Filtrer par rôle"
        >
          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={activeFilter}
          onChange={e => setActiveFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Filtrer par statut"
        >
          {ACTIVE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex-1 min-w-48">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher nom ou email…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            aria-label="Rechercher un utilisateur dans la page courante"
            title="Recherche dans la page courante (25 résultats max)"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">Recherche dans la page courante</p>
        </div>
      </div>

      {loading && <SkeletonTable rows={7} cols={5} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {!loading && !error && users.length === 0 && (
        <EmptyState title="Aucun utilisateur" message="Aucun compte ne correspond aux critères sélectionnés." />
      )}

      {!loading && !error && users.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3">Boutique</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Dernière connexion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{u.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.email ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 rounded px-2 py-0.5">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{u.storeName ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        status={u.active ? 'active' : 'inactive'}
                        label={u.active ? 'Actif' : 'Inactif'}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{formatDate(u.lastLogin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => load(false)}
                disabled={loadingMore}
                className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {loadingMore ? 'Chargement…' : 'Charger plus'}
              </button>
            </div>
          )}

          <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
            La création, la suspension ou la réaffectation d'un compte doit être effectuée par l'administrateur système. Cette vue est en lecture seule.
          </p>
        </>
      )}
    </div>
  )
}

export default AdminUsers
