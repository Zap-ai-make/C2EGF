import { useAuth } from '../../context/AuthContext'
import ProfileSummary from '../../components/profile/ProfileSummary'

function AdminProfile() {
  const { userProfile } = useAuth()

  return (
    <ProfileSummary
      testId="admin-profile"
      title="Profil administrateur"
      roleLabel="Gérant global"
      userProfile={userProfile}
    />
  )
}

export default AdminProfile
