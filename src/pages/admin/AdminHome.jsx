import { APP_NAME } from '../../constants/branding'

function AdminHome() {
  return (
    <div className="max-w-4xl mx-auto" data-testid="admin-home">
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-3">Tableau de bord global</h2>
        <p className="text-gray-500">Vue d'ensemble de la plateforme {APP_NAME} — en cours de préparation.</p>
      </div>
    </div>
  )
}

export default AdminHome
