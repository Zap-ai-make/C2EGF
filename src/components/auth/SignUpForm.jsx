import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useFormValidation } from '../../hooks/useFormValidation'
import { isValidNewPassword } from '../../utils/authHelpers'
import { AUTH_LABELS, AUTH_PLACEHOLDERS, AUTH_ERRORS } from '../../constants/authMessages'
import { AUTH_STYLES } from '../../constants/authStyles'

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
        <p className={`${AUTH_STYLES.text.subtitle} mt-1`}>
          Créez l'accès de votre boutique.
        </p>
      </div>

      {shouldShowErrors && (errors.submit || Object.values(errors).some(error => error)) && (
        <div className={`${AUTH_STYLES.message.error} mb-4`}>
          {errors.submit || Object.values(errors).find(error => error)}
        </div>
      )}

      <form onSubmit={handleSubmit} className={AUTH_STYLES.spacing.formTight}>
        <div>
          <label htmlFor="signup-store" className={AUTH_STYLES.input.label}>
            {AUTH_PLACEHOLDERS.STORE_NAME}
          </label>
          <input
            type="text"
            autoComplete="organization"
            placeholder="C2EGF OUAGA"
            {...storeNameProps}
            id="signup-store"
            className={`${AUTH_STYLES.input.field} ${hasFieldError('storeName') ? AUTH_STYLES.input.error : ''}`}
            required
          />
          {hasFieldError('storeName') && (
            <p className={AUTH_STYLES.input.fieldError}>{getFieldError('storeName')}</p>
          )}
        </div>

        <div>
          <label htmlFor="signup-email" className={AUTH_STYLES.input.label}>
            {AUTH_PLACEHOLDERS.EMAIL}
          </label>
          <input
            type="email"
            autoComplete="email"
            placeholder="vous@exemple.bf"
            {...emailProps}
            id="signup-email"
            className={`${AUTH_STYLES.input.field} ${hasFieldError('email') ? AUTH_STYLES.input.error : ''}`}
            required
          />
          {hasFieldError('email') && (
            <p className={AUTH_STYLES.input.fieldError}>{getFieldError('email')}</p>
          )}
        </div>

        <div>
          <label htmlFor="signup-password" className={AUTH_STYLES.input.label}>
            {AUTH_PLACEHOLDERS.PASSWORD}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            {...passwordProps}
            id="signup-password"
            className={`${AUTH_STYLES.input.field} ${hasFieldError('password') ? AUTH_STYLES.input.error : ''}`}
            required
            aria-describedby="signup-password-regle"
          />
          {/* La règle est annoncée AVANT la saisie, pas après l'échec.
              L'exigence de 8 caractères vit dans isValidNewPassword ; elle
              n'était visible nulle part tant qu'on ne s'était pas trompé. */}
          <p id="signup-password-regle" className={AUTH_STYLES.input.hint}>
            8 caractères au minimum.
          </p>
          {hasFieldError('password') && (
            <p className={AUTH_STYLES.input.fieldError}>{getFieldError('password')}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`${AUTH_STYLES.button.primary} mt-6`}
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
            className={AUTH_STYLES.button.link}
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
