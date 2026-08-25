import { useState } from 'react'
import SignInForm from './SignInForm'
import SignUpForm from './SignUpForm'
import AuthSidebar from './AuthSidebar'

function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-xl shadow-2xl overflow-hidden w-full max-w-5xl">
        <div className="flex flex-col lg:flex-row">
          {/* Formulaire de connexion/inscription */}
          <div className="w-full lg:w-1/2 p-6 sm:p-8 lg:p-12">
            {isSignUp ? (
              <SignUpForm onToggle={() => setIsSignUp(false)} />
            ) : (
              <SignInForm onToggle={() => setIsSignUp(true)} />
            )}
          </div>

          {/* Sidebar colorée */}
          <div className="w-full lg:w-1/2 order-first lg:order-last">
            <AuthSidebar isSignUp={isSignUp} onToggle={() => setIsSignUp(!isSignUp)} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
