import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useFormValidation } from '../../hooks/useFormValidation'
import { AUTH_LABELS, AUTH_PLACEHOLDERS } from '../../constants/authMessages'
import { AUTH_STYLES, THEME_VARIANTS } from '../../constants/authStyles'
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
        <p className={AUTH_STYLES.text.subtitle}>ou utilisez votre email et mot de passe</p>
      </div>

      {(shouldShowErrors || authError) && (errors.submit || errors.email || errors.password || authError) && (
        <div className={`${AUTH_STYLES.message.error} mb-4`}>
          {errors.submit || errors.email || errors.password || authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className={AUTH_STYLES.spacing.form}>
        <div>
          <input
            type="email"
            placeholder={AUTH_PLACEHOLDERS.EMAIL}
            {...emailProps}
            className={`${THEME_VARIANTS.primary.input} ${hasFieldError('email') ? 'border border-red-300' : ''}`}
            required
            aria-label={AUTH_PLACEHOLDERS.EMAIL}
          />
          {hasFieldError('email') && (
            <p className="mt-1 text-sm text-red-600">{getFieldError('email')}</p>
          )}
        </div>

        <div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder={AUTH_PLACEHOLDERS.PASSWORD}
              {...passwordProps}
              className={`${THEME_VARIANTS.primary.input} pr-12 ${hasFieldError('password') ? 'border border-red-300' : ''}`}
              required
              aria-label={AUTH_PLACEHOLDERS.PASSWORD}
            />
            <button
              type="button"
              onClick={() => setShowPassword(current => !current)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-gray-500 transition-colors hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
            <p className="mt-1 text-sm text-red-600">{getFieldError('password')}</p>
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
          className={THEME_VARIANTS.primary.button}
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
            className={THEME_VARIANTS.primary.link}
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
