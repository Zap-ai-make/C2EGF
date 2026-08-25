import { useState, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFormValidation } from '../../hooks/useFormValidation'
import { AUTH_LABELS, AUTH_PLACEHOLDERS, AUTH_SUCCESS, AUTH_CONFIG } from '../../constants/authMessages'
import { AUTH_STYLES, THEME_VARIANTS } from '../../constants/authStyles'
import { createTimeoutWithCleanup } from '../../utils/authHelpers'

function ForgotPasswordModal({ isOpen, onClose }) {
  const [message, setMessage] = useState('')
  const [timeoutHandler, setTimeoutHandler] = useState(null)

  const { resetPassword } = useAuth()

  const {
    errors,
    isSubmitting,
    getFieldProps,
    getFieldError,
    hasFieldError,
    handleSubmit: handleFormSubmit,
    reset,
    shouldShowErrors
  } = useFormValidation(
    { email: '' },
    {},
    {
      validateOnChange: false,
      validateOnBlur: true,
      resetOnSubmitSuccess: false
    }
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    const result = await handleFormSubmit(async (formValues) => {
      await resetPassword(formValues.email)

      setMessage(AUTH_SUCCESS.PASSWORD_RESET_EMAIL_SENT)

      // Nettoyer le timeout précédent s'il existe
      if (timeoutHandler) {
        timeoutHandler.clear()
      }

      // Créer un nouveau timeout avec cleanup
      const newTimeout = createTimeoutWithCleanup(() => {
        onClose()
        setMessage('')
      }, AUTH_CONFIG.SUCCESS_MESSAGE_TIMEOUT)

      setTimeoutHandler(newTimeout)
    })

    if (!result.success && result.error) {
      console.error('Erreur de réinitialisation:', result.error)
    }
  }

  const handleClose = useCallback(() => {
    // Nettoyer le timeout
    if (timeoutHandler) {
      timeoutHandler.clear()
      setTimeoutHandler(null)
    }

    reset()
    setMessage('')
    onClose()
  }, [timeoutHandler, reset, onClose])

  if (!isOpen) return null

  const emailProps = getFieldProps('email')

  return (
    <div className={AUTH_STYLES.modal.overlay}>
      <div className={AUTH_STYLES.modal.container}>
        <div className={AUTH_STYLES.modal.header}>
          <h3 className={AUTH_STYLES.modal.title}>
            {AUTH_LABELS.FORGOT_PASSWORD}
          </h3>
          <button
            onClick={handleClose}
            className={AUTH_STYLES.modal.closeButton}
            aria-label="Fermer la modal"
          >
            ×
          </button>
        </div>

        <p className={`${AUTH_STYLES.text.body} ${AUTH_STYLES.spacing.modal}`}>
          Entrez votre adresse email et nous vous enverrons un lien pour réinitialiser votre mot de passe.
        </p>

        {shouldShowErrors && (errors.submit || Object.values(errors).some(error => error)) && (
          <div className={`${AUTH_STYLES.message.error} ${AUTH_STYLES.spacing.modal}`}>
            {errors.submit || Object.values(errors).find(error => error)}
          </div>
        )}

        {message && (
          <div className={`${AUTH_STYLES.message.success} ${AUTH_STYLES.spacing.modal}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={AUTH_STYLES.spacing.modal}>
            <input
              type="email"
              placeholder={AUTH_PLACEHOLDERS.EMAIL}
              {...emailProps}
              className={`${THEME_VARIANTS.primary.input} ${hasFieldError('email') ? AUTH_STYLES.input.error : ''}`}
              required
              aria-label={AUTH_PLACEHOLDERS.EMAIL}
            />
            {hasFieldError('email') && (
              <p className="mt-1 text-sm text-red-600">{getFieldError('email')}</p>
            )}
          </div>

          <div className={AUTH_STYLES.modal.footer}>
            <button
              type="button"
              onClick={handleClose}
              className={`flex-1 ${AUTH_STYLES.button.tertiary}`}
              aria-label="Annuler la réinitialisation"
            >
              {AUTH_LABELS.CANCEL}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 ${AUTH_STYLES.button.primary}`}
              aria-label={isSubmitting ? AUTH_LABELS.LOADING_RESET : AUTH_LABELS.SUBMIT_RESET}
            >
              {isSubmitting ? AUTH_LABELS.LOADING_RESET : AUTH_LABELS.SUBMIT_RESET}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ForgotPasswordModal
