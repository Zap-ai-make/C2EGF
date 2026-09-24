import { useAuth } from '../../context/AuthContext'
import ProfileSummary from '../../components/profile/ProfileSummary'

function DealerProfile() {
  const { userProfile } = useAuth()

  return (
    <ProfileSummary
      testId="dealer-profile"
      title="Profil Dealer"
      roleLabel="Dealer"
      userProfile={userProfile}
    />
  )
}

export default DealerProfile
