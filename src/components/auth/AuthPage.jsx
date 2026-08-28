import { useState } from 'react'
import SignInForm from './SignInForm'
import SignUpForm from './SignUpForm'
import AuthSidebar from './AuthSidebar'

function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false)

  // Le fond de page était un dégradé bleu-indigo : l'indigo n'appartient à
  // aucune famille de jetons, et un dégradé sous une carte blanche ne fait rien
  // qu'on remarque. Le canvas de l'application suffit.
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-3 sm:p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl bg-surface shadow-2xl">
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
