import { useState, useCallback, useMemo } from 'react'
import { validateFormFields, debounce, getAuthErrorMessage } from '../utils/authHelpers'
import { AUTH_CONFIG } from '../constants/authMessages'

/**
 * Hook personnalisé pour la validation de formulaires d'authentification
 * @param {Object} initialValues - Valeurs initiales du formulaire
 * @param {Object} validationRules - Règles de validation personnalisées
 * @param {Object} options - Options du hook
 */
export const useFormValidation = (initialValues = {}, _validationRules = {}, options = {}) => {
  const {
    validateOnChange = false,
    validateOnBlur = true,
    debounceMs = 300,
    resetOnSubmitSuccess = true
  } = options

  // États
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitCount, setSubmitCount] = useState(0)

  // Validation debounced
  const debouncedValidate = useMemo(
    () => debounce((fieldsToValidate) => {
      const validation = validateFormFields(fieldsToValidate)
      setErrors(validation.errors)
    }, debounceMs),
    [debounceMs]
  )

  // Validation immédiate
  const validate = useCallback((fieldsToValidate = values) => {
    const validation = validateFormFields(fieldsToValidate)
    setErrors(validation.errors)
    return validation
  }, [values])

  // Mise à jour d'une valeur
  const setValue = useCallback((name, value) => {
    const newValues = { ...values, [name]: value }
    setValues(newValues)

    // Marquer comme touché
    setTouched(prev => ({ ...prev, [name]: true }))

    // Validation en temps réel si activée
    if (validateOnChange) {
      if (debounceMs > 0) {
        debouncedValidate(newValues)
      } else {
        const validation = validateFormFields(newValues)
        setErrors(validation.errors)
      }
    }
  }, [values, validateOnChange, debounceMs, debouncedValidate])

  // Mise à jour de plusieurs valeurs
  const setMultipleValues = useCallback((newValues) => {
    setValues(prev => ({ ...prev, ...newValues }))

    // Marquer tous les champs comme touchés
    const touchedFields = Object.keys(newValues).reduce((acc, key) => {
      acc[key] = true
      return acc
    }, {})
    setTouched(prev => ({ ...prev, ...touchedFields }))

    // Validation si nécessaire
    if (validateOnChange) {
      const validation = validateFormFields({ ...values, ...newValues })
      setErrors(validation.errors)
    }
  }, [values, validateOnChange])

  // Gestion du blur
  const handleBlur = useCallback((name) => {
    setTouched(prev => ({ ...prev, [name]: true }))

    if (validateOnBlur) {
      const validation = validateFormFields(values)
      setErrors(validation.errors)
    }
  }, [values, validateOnBlur])

  // Réinitialisation du formulaire
  const reset = useCallback(() => {
    setValues(initialValues)
    setErrors({})
    setTouched({})
    setIsSubmitting(false)
    setSubmitCount(0)
  }, [initialValues])

  // Soumission du formulaire
  const handleSubmit = useCallback(async (onSubmit) => {
    setSubmitCount(prev => prev + 1)
    setIsSubmitting(true)

    // Marquer tous les champs comme touchés
    const allTouched = Object.keys(values).reduce((acc, key) => {
      acc[key] = true
      return acc
    }, {})
    setTouched(allTouched)

    // Validation finale
    const validation = validate()

    if (!validation.isValid) {
      setIsSubmitting(false)
      return { success: false, errors: validation.errors }
    }

    try {
      const result = await onSubmit(values)

      if (resetOnSubmitSuccess && result !== false) {
        reset()
      }

      setIsSubmitting(false)
      return { success: true, data: result }
    } catch (error) {
      setIsSubmitting(false)

      // Gestion des erreurs Firebase
      const errorMessage = getAuthErrorMessage(error.code, error.message)
      setErrors(prev => ({
        ...prev,
        submit: errorMessage
      }))

      return { success: false, error: errorMessage }
    }
  }, [values, validate, reset, resetOnSubmitSuccess])

  // Helpers pour les champs spécifiques (seulement props DOM valides)
  // IMPORTANT: Ne jamais inclure hasError ou d'autres props non-DOM ici
  const getFieldProps = useCallback((name) => ({
    name,
    value: values[name] || '',
    onChange: (e) => setValue(name, e.target.value),
    onBlur: () => handleBlur(name)
  }), [values, setValue, handleBlur])

  // Helper pour obtenir l'erreur d'un champ
  const getFieldError = useCallback((name) => {
    return touched[name] && errors[name]
  }, [touched, errors])

  // Helper pour vérifier si un champ a une erreur (booléen)
  const hasFieldError = useCallback((name) => {
    return touched[name] && !!errors[name]
  }, [touched, errors])

  // État de validation global
  const isValid = useMemo(() => {
    return Object.keys(errors).length === 0
  }, [errors])

  const hasErrors = useMemo(() => {
    return Object.keys(errors).some(key => touched[key] && errors[key])
  }, [errors, touched])

  // Gestion des erreurs spécifiques aux mots de passe
  const setPasswordError = useCallback((currentPassword, newPassword, confirmPassword) => {
    const passwordErrors = {}

    if (currentPassword === newPassword) {
      passwordErrors.newPassword = 'Le nouveau mot de passe doit être différent de l\'ancien'
    }

    if (newPassword && newPassword.length < AUTH_CONFIG.MIN_NEW_PASSWORD_LENGTH) {
      passwordErrors.newPassword = `Le mot de passe doit contenir au moins ${AUTH_CONFIG.MIN_NEW_PASSWORD_LENGTH} caractères`
    }

    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      passwordErrors.confirmPassword = 'Les mots de passe ne correspondent pas'
    }

    setErrors(prev => ({ ...prev, ...passwordErrors }))
    return Object.keys(passwordErrors).length === 0
  }, [])

  // Validation d'email en temps réel
  const validateEmail = useCallback((email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const isValidEmail = emailRegex.test(email)

    if (!isValidEmail && email) {
      setErrors(prev => ({ ...prev, email: 'Format d\'email invalide' }))
    } else {
      setErrors(prev => {
        const { email: _emailError, ...rest } = prev
        return rest
      })
    }

    return isValidEmail
  }, [])

  return {
    // Valeurs et état
    values,
    errors,
    touched,
    isSubmitting,
    submitCount,
    isValid,
    hasErrors,

    // Actions
    setValue,
    setMultipleValues,
    handleBlur,
    handleSubmit,
    reset,
    validate,

    // Helpers
    getFieldProps,
    getFieldError,
    hasFieldError,
    setPasswordError,
    validateEmail,

    // États calculés
    canSubmit: isValid && !isSubmitting,
    shouldShowErrors: submitCount > 0 || Object.keys(touched).length > 0
  }
}
