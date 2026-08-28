import { APP_NAME } from '../../constants/branding'
import { AUTH_LABELS } from '../../constants/authMessages'

/**
 * Le panneau d'accueil de l'écran d'authentification.
 *
 * TROIS CHOSES ONT CHANGÉ, et la première était un défaut visible.
 *
 * 1. Une pastille décorative — un cadenas dans un cercle blanc translucide —
 *    était posée en `absolute bottom-8`, sur un panneau dont le contenu est
 *    centré verticalement. Aux hauteurs réelles, elle RECOUVRAIT le bouton
 *    d'appel à l'action : le cercle blanc passait par-dessus « Se connecter ».
 *    Un décor qui masque l'action est plus qu'inélégant. Il est parti ; le nom
 *    du produit qu'il accompagnait revient dans le flux, où rien ne le
 *    chevauche.
 *
 *    Le cadenas ne manque pas non plus : une icône de sécurité posée sur un
 *    écran de connexion n'informe de rien — elle rassure sans rien prouver,
 *    et c'est exactement le genre de décor que DESIGN.md §1 range parmi les
 *    réflexes par défaut.
 *
 * 2. Les deux ronds blancs flous en arrière-plan partent pour la même raison
 *    (« blobs flous », §1). À leur place, la PHOTOGRAPHIE du bandeau — la même
 *    constellation de nœuds que l'application affiche à l'arrivée. L'écran de
 *    connexion et l'écran d'accueil montrent enfin la même image : c'est la
 *    marque qui accueille, pas un dégradé interchangeable.
 *
 * 3. Les libellés quittent les capitales (« SE CONNECTER » → « Se connecter »),
 *    et le bouton porte ici LE MÊME MOT que celui du formulaire d'en face —
 *    DESIGN.md §12 : un mot d'action garde son nom dans tout le flux.
 */
function AuthSidebar({ isSignUp, onToggle }) {
  return (
    <div className="panneau-auth relative flex h-full min-h-[220px] flex-col items-center justify-between overflow-hidden p-6 text-white sm:p-8 lg:min-h-[560px] lg:p-12">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <img
          src="/c2egf-mark.png"
          alt={APP_NAME}
          className="mx-auto mb-4 h-20 w-20 rounded-full bg-white p-2 shadow-lg lg:mb-6 lg:h-28 lg:w-28 lg:p-3"
        />

        <h2 className="mb-3 text-2xl font-bold lg:mb-5 lg:text-4xl">
          {isSignUp ? 'Bon retour' : 'Bienvenue'}
        </h2>

        <p className="mb-5 text-sm leading-relaxed text-brand-100 lg:mb-8 lg:text-lg">
          {isSignUp ? (
            <>
              Une boutique existe déjà ?<br />
              Connectez-vous avec ses accès
            </>
          ) : (
            <>
              Créez un compte boutique,<br />
              puis gérez vos opérations
            </>
          )}
        </p>

        <button
          onClick={onToggle}
          className="rounded-full border-2 border-white px-6 py-2.5 font-semibold text-white transition-colors duration-200 hover:bg-white hover:text-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500 lg:px-8 lg:py-3"
        >
          {isSignUp ? AUTH_LABELS.SUBMIT_SIGNIN : 'Créer une boutique'}
        </button>
      </div>

      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-brand-200">
        {APP_NAME}
      </p>
    </div>
  )
}

export default AuthSidebar
