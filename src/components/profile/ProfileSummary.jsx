function ProfileSummary({ testId, title, roleLabel, userProfile }) {
  return (
    <div className="max-w-xl mx-auto" data-testid={testId}>
      <div className="bg-white rounded-lg shadow p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">{title}</h2>
        {userProfile && (
          <dl className="space-y-3">
            <div className="flex gap-3">
              <dt className="w-24 text-sm font-medium text-gray-500">Nom</dt>
              <dd className="text-sm text-gray-800">{userProfile.name}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 text-sm font-medium text-gray-500">Email</dt>
              <dd className="text-sm text-gray-800">{userProfile.email}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 text-sm font-medium text-gray-500">Rôle</dt>
              <dd className="text-sm text-gray-800">{roleLabel}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}

export default ProfileSummary
