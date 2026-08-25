import { APP_NAME } from '../../constants/branding'

function AuthSidebar({ isSignUp, onToggle }) {
  return (
    // Dégradé de marque. PROVISOIRE : ces hex sont ceux du produit d'origine —
    // l'orange #f08a00 (marque AKAYIS) a été retiré, C2EGF étant bleu/blanc. Les
    // valeurs exactes restent à caler sur le logo C2EGF quand il sera fourni.
    // Ces couleurs sont le seul endroit du front où la marque n'est pas dérivée
    // du profil : Tailwind extrait les classes littéralement, une valeur
    // dynamique ne serait pas générée. Un passage par le profil imposerait des
    // styles inline (voir branding.theme pour le reste).
    <div className={`h-full min-h-[220px] lg:min-h-[500px] flex flex-col items-center justify-center text-white p-6 sm:p-8 lg:p-12 relative overflow-hidden ${
      isSignUp
        ? 'bg-gradient-to-br from-[#2d5ea5] to-[#173e78]'
        : 'bg-gradient-to-br from-[#3a72c4] to-[#173e78]'
    }`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full transform translate-x-16 -translate-y-16"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-white opacity-10 rounded-full transform -translate-x-12 translate-y-12"></div>

      <div className="text-center z-10">
        <img
          src="/akayis-mark.svg"
          alt={APP_NAME}
          className="mx-auto mb-4 lg:mb-6 h-20 w-20 lg:h-28 lg:w-28 rounded-full bg-white p-2 lg:p-3 shadow-lg"
        />
        {isSignUp ? (
          <>
            <h2 className="text-2xl lg:text-4xl font-bold mb-3 lg:mb-6">Bon retour</h2>
            <p className="text-sm lg:text-lg mb-5 lg:mb-8 opacity-90 leading-relaxed">
              Une boutique existe déjà ?<br />
              Connectez-vous avec ses accès
            </p>
            <button
              onClick={onToggle}
              className="border-2 border-white text-white font-semibold py-2.5 lg:py-3 px-6 lg:px-8 rounded-full hover:bg-white hover:text-blue-600 transition-all duration-300"
            >
              SE CONNECTER
            </button>
          </>
        ) : (
          <>
            <h2 className="text-2xl lg:text-4xl font-bold mb-3 lg:mb-6">Bienvenue</h2>
            <p className="text-sm lg:text-lg mb-5 lg:mb-8 opacity-90 leading-relaxed">
              Créez un compte boutique,<br />
              puis gérez vos opérations
            </p>
            <button
              onClick={onToggle}
              className="border-2 border-white text-white font-semibold py-2.5 lg:py-3 px-6 lg:px-8 rounded-full hover:bg-white hover:text-blue-600 transition-all duration-300"
            >
              CRÉER UNE BOUTIQUE
            </button>
          </>
        )}
      </div>

      <div className="hidden lg:block absolute bottom-8 left-1/2 transform -translate-x-1/2">
        <div className="text-center">
          <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center mb-2">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p className="text-sm opacity-75">{APP_NAME}</p>
        </div>
      </div>
    </div>
  )
}

export default AuthSidebar
