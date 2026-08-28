import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useFormValidation } from '../../hooks/useFormValidation'
import { AUTH_LABELS, AUTH_PLACEHOLDERS } from '../../constants/authMessages'
import { AUTH_STYLES } from '../../constants/authStyles'
import { getDefaultRouteForRole } from '../../utils/roleRouting'
import ForgotPasswordModal from './ForgotPasswordModal'

function SignInForm({ onToggle }) {
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const { signin, error: authError } = useAuth()
  const navigate = useNavigate()

  // Utilisation du hook de validation de formulaire
  const {
    errors,
    isSubmitting,
    getFieldProps,
    getFieldError,
    hasFieldError,
    handleSubmit: handleFormSubmit,
    shouldShowErrors
  } = useFormValidation(
    { email: '', password: '' },
    {},
    { validateOnChange: false, validateOnBlur: true }
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    const result = await handleFormSubmit(async (formValues) => {
      const { role } = await signin(formValues.email, formValues.password)
      navigate(getDefaultRouteForRole(role) || '/')
    })

    if (!result.success && result.error) {
      // L'erreur est déjà gérée par le hook
      console.error('Erreur de connexion:', result.error)
    }
  }

  const emailProps = getFieldProps('email')
  const passwordProps = getFieldProps('password')

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className={AUTH_STYLES.text.title}>{AUTH_LABELS.SIGN_IN}</h2>
        <p className={`${AUTH_STYLES.text.subtitle} mt-1`}>
          Entrez les accès de votre boutique.
        </p>
      </div>

      {(shouldShowErrors || authError) && (errors.submit || errors.email || errors.password || authError) && (
        <div className={`${AUTH_STYLES.message.error} mb-4`}>
          {errors.submit || errors.email || errors.password || authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className={AUTH_STYLES.spacing.form}>
        <div>
          {/* Une étiquette VISIBLE, pas un placeholder. Le placeholder
              disparaît dès la première frappe : le champ rempli ne dit plus ce
              qu'il contient, et à la saisie automatique il n'a jamais rien dit.
              Il sert ici d'exemple de format, ce qu'il fait bien. */}
          <label htmlFor="signin-email" className={AUTH_STYLES.input.label}>
            {AUTH_PLACEHOLDERS.EMAIL}
          </label>
          <input
            type="email"
            autoComplete="email"
            placeholder="vous@exemple.bf"
            {...emailProps}
            id="signin-email"
            className={`${AUTH_STYLES.input.field} ${hasFieldError('email') ? AUTH_STYLES.input.error : ''}`}
            required
          />
          {hasFieldError('email') && (
            <p className={AUTH_STYLES.input.fieldError}>{getFieldError('email')}</p>
          )}
        </div>

        <div>
          <label htmlFor="signin-password" className={AUTH_STYLES.input.label}>
            {AUTH_PLACEHOLDERS.PASSWORD}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              {...passwordProps}
              id="signin-password"
              className={`${AUTH_STYLES.input.field} pr-12 ${hasFieldError('password') ? AUTH_STYLES.input.error : ''}`}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(current => !current)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-ink-muted transition-colors hover:text-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.06" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {hasFieldError('password') && (
            <p className={AUTH_STYLES.input.fieldError}>{getFieldError('password')}</p>
          )}
        </div>

        <div className="text-right">
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className={`text-sm ${AUTH_STYLES.text.link}`}
            aria-label="Ouvrir le formulaire de réinitialisation de mot de passe"
          >
            {AUTH_LABELS.FORGOT_PASSWORD}
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={AUTH_STYLES.button.primary}
          aria-label={isSubmitting ? AUTH_LABELS.LOADING_SIGNIN : AUTH_LABELS.SUBMIT_SIGNIN}
        >
          {isSubmitting ? AUTH_LABELS.LOADING_SIGNIN : AUTH_LABELS.SUBMIT_SIGNIN}
        </button>
      </form>

      <div className="mt-8 text-center">
        <p className={AUTH_STYLES.text.body}>
          Nouvelle boutique ?{' '}
          <button
            onClick={onToggle}
            className={AUTH_STYLES.button.link}
            aria-label="Créer un compte boutique"
          >
            Créer un compte boutique
          </button>
        </p>
        <p className={`${AUTH_STYLES.text.body} mt-3`}>
          Chaque boutique utilise son propre compte pour travailler.
        </p>
      </div>

      <ForgotPasswordModal
        isOpen={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
      />
    </div>
  )
}

export default SignInForm
