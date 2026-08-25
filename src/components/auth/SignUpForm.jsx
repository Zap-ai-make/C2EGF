import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useFormValidation } from '../../hooks/useFormValidation'
import { isValidNewPassword } from '../../utils/authHelpers'
import { AUTH_LABELS, AUTH_PLACEHOLDERS, AUTH_ERRORS } from '../../constants/authMessages'
import { AUTH_STYLES, THEME_VARIANTS } from '../../constants/authStyles'

function SignUpForm({ onToggle }) {
  const { signup } = useAuth()
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
    { storeName: '', email: '', password: '' },
    {},
    { validateOnChange: false, validateOnBlur: true }
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    const result = await handleFormSubmit(async (formValues) => {
      // Exigence renforcée pour un NOUVEAU mot de passe (min 8), sans toucher
      // au plancher de connexion partagé (min 6) des comptes existants.
      if (!isValidNewPassword(formValues.password)) {
        throw new Error(AUTH_ERRORS.NEW_PASSWORD_MIN_LENGTH)
      }
      await signup(formValues.email, formValues.password, formValues.storeName)
      navigate('/profil')
    })

    if (!result.success && result.error) {
      console.error('Erreur d\'inscription:', result.error)
    }
  }

  const storeNameProps = getFieldProps('storeName')
  const emailProps = getFieldProps('email')
  const passwordProps = getFieldProps('password')

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className={AUTH_STYLES.text.title}>{AUTH_LABELS.SIGN_UP}</h2>
        <p className={AUTH_STYLES.text.subtitle}>ou utilisez votre email pour l'inscription</p>
      </div>

      {shouldShowErrors && (errors.submit || Object.values(errors).some(error => error)) && (
        <div className={`${AUTH_STYLES.message.error} mb-4`}>
          {errors.submit || Object.values(errors).find(error => error)}
        </div>
      )}

      <form onSubmit={handleSubmit} className={AUTH_STYLES.spacing.formTight}>
        <div>
          <input
            type="text"
            placeholder={AUTH_PLACEHOLDERS.STORE_NAME}
            {...storeNameProps}
            className={`${THEME_VARIANTS.secondary.input} ${hasFieldError('storeName') ? 'border border-red-300' : ''}`}
            required
            aria-label={AUTH_PLACEHOLDERS.STORE_NAME}
          />
          {hasFieldError('storeName') && (
            <p className="mt-1 text-sm text-red-600">{getFieldError('storeName')}</p>
          )}
        </div>

        <div>
          <input
            type="email"
            placeholder={AUTH_PLACEHOLDERS.EMAIL}
            {...emailProps}
            className={`${THEME_VARIANTS.secondary.input} ${hasFieldError('email') ? 'border border-red-300' : ''}`}
            required
            aria-label={AUTH_PLACEHOLDERS.EMAIL}
          />
          {hasFieldError('email') && (
            <p className="mt-1 text-sm text-red-600">{getFieldError('email')}</p>
          )}
        </div>

        <div>
          <input
            type="password"
            placeholder={AUTH_PLACEHOLDERS.PASSWORD}
            {...passwordProps}
            className={`${THEME_VARIANTS.secondary.input} ${hasFieldError('password') ? 'border border-red-300' : ''}`}
            required
            aria-label={AUTH_PLACEHOLDERS.PASSWORD}
          />
          {hasFieldError('password') && (
            <p className="mt-1 text-sm text-red-600">{getFieldError('password')}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`${THEME_VARIANTS.secondary.button} mt-6`}
          aria-label={isSubmitting ? AUTH_LABELS.LOADING_SIGNUP : AUTH_LABELS.SUBMIT_SIGNUP}
        >
          {isSubmitting ? AUTH_LABELS.LOADING_SIGNUP : AUTH_LABELS.SUBMIT_SIGNUP}
        </button>
      </form>

      <div className="mt-8 text-center">
        <p className={AUTH_STYLES.text.body}>
          Vous avez déjà un compte ?{' '}
          <button
            onClick={onToggle}
            className={THEME_VARIANTS.secondary.link}
            aria-label="Aller au formulaire de connexion"
          >
            Se connecter
          </button>
        </p>
      </div>
    </div>
  )
}

export default SignUpForm
