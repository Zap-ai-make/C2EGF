import { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useFormValidation } from '../../hooks/useFormValidation'
import { AUTH_LABELS, AUTH_PLACEHOLDERS, AUTH_SUCCESS, AUTH_CONFIG } from '../../constants/authMessages'
import { AUTH_STYLES, THEME_VARIANTS } from '../../constants/authStyles'
import { createTimeoutWithCleanup } from '../../utils/authHelpers'

function ChangePasswordModal({ isOpen, onClose }) {
  const [message, setMessage] = useState('')
  const [timeoutHandler, setTimeoutHandler] = useState(null)

  const { changePassword } = useAuth()

  // Utilisation du hook de validation personnalisé pour les mots de passe
  const {
    values,
    errors,
    isSubmitting,
    getFieldProps,
    getFieldError,
    hasFieldError,
    handleSubmit: handleFormSubmit,
    reset,
    setPasswordError,
    shouldShowErrors
  } = useFormValidation(
    { currentPassword: '', newPassword: '', confirmPassword: '' },
    {},
    {
      validateOnChange: false,
      validateOnBlur: true,
      resetOnSubmitSuccess: false
    }
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Validation spécifique aux mots de passe
    const isPasswordValid = setPasswordError(
      values.currentPassword,
      values.newPassword,
      values.confirmPassword
    )

    if (!isPasswordValid) return

    const result = await handleFormSubmit(async (formValues) => {
      await changePassword(formValues.currentPassword, formValues.newPassword)

      setMessage(AUTH_SUCCESS.PASSWORD_CHANGED)

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
      console.error('Erreur de changement de mot de passe:', result.error)
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

  const currentPasswordProps = getFieldProps('currentPassword')
  const newPasswordProps = getFieldProps('newPassword')
  const confirmPasswordProps = getFieldProps('confirmPassword')

  return (
    <div className={AUTH_STYLES.modal.overlay}>
      <div className={AUTH_STYLES.modal.container}>
        <div className={AUTH_STYLES.modal.header}>
          <h3 className={AUTH_STYLES.modal.title}>
            {AUTH_LABELS.CHANGE_PASSWORD}
          </h3>
          <button
            onClick={handleClose}
            className={AUTH_STYLES.modal.closeButton}
            aria-label="Fermer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

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
            <label className={AUTH_STYLES.profile.label}>
              Mot de passe actuel
            </label>
            <input
              type="password"
              placeholder={AUTH_PLACEHOLDERS.CURRENT_PASSWORD}
              {...currentPasswordProps}
              className={`${THEME_VARIANTS.primary.input} ${hasFieldError('currentPassword') ? AUTH_STYLES.input.error : ''}`}
              required
              aria-label={AUTH_PLACEHOLDERS.CURRENT_PASSWORD}
            />
            {hasFieldError('currentPassword') && (
              <p className="mt-1 text-sm text-red-600">{getFieldError('currentPassword')}</p>
            )}
          </div>

          <div className={AUTH_STYLES.spacing.modal}>
            <label className={AUTH_STYLES.profile.label}>
              Nouveau mot de passe
            </label>
            <input
              type="password"
              placeholder={AUTH_PLACEHOLDERS.NEW_PASSWORD}
              {...newPasswordProps}
              className={`${THEME_VARIANTS.primary.input} ${hasFieldError('newPassword') ? AUTH_STYLES.input.error : ''}`}
              required
              aria-label={AUTH_PLACEHOLDERS.NEW_PASSWORD}
            />
            {hasFieldError('newPassword') && (
              <p className="mt-1 text-sm text-red-600">{getFieldError('newPassword')}</p>
            )}
          </div>

          <div className="mb-6">
            <label className={AUTH_STYLES.profile.label}>
              Confirmer le nouveau mot de passe
            </label>
            <input
              type="password"
              placeholder={AUTH_PLACEHOLDERS.CONFIRM_PASSWORD}
              {...confirmPasswordProps}
              className={`${THEME_VARIANTS.primary.input} ${hasFieldError('confirmPassword') ? AUTH_STYLES.input.error : ''}`}
              required
              aria-label={AUTH_PLACEHOLDERS.CONFIRM_PASSWORD}
            />
            {hasFieldError('confirmPassword') && (
              <p className="mt-1 text-sm text-red-600">{getFieldError('confirmPassword')}</p>
            )}
          </div>

          <div className={AUTH_STYLES.modal.footer}>
            <button
              type="button"
              onClick={handleClose}
              className={`flex-1 ${AUTH_STYLES.button.tertiary}`}
              aria-label="Annuler le changement de mot de passe"
            >
              {AUTH_LABELS.CANCEL}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 ${AUTH_STYLES.button.primary}`}
              aria-label={isSubmitting ? AUTH_LABELS.LOADING_CHANGING : AUTH_LABELS.SUBMIT_CHANGE}
            >
              {isSubmitting ? AUTH_LABELS.LOADING_CHANGING : AUTH_LABELS.SUBMIT_CHANGE}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ChangePasswordModal