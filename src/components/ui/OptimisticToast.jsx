import { memo } from 'react'

const OptimisticToast = memo(function OptimisticToast({
  message,
  type = 'info',
  isVisible,
  onClose,
  autoClose = true
}) {
  const typeStyles = {
    success: {
      bg: 'bg-success-soft border-success/30',
      text: 'text-success',
      icon: (
        <svg className="h-5 w-5 text-success" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )
    },
    error: {
      bg: 'bg-danger-soft border-danger/30',
      text: 'text-danger',
      icon: (
        <svg className="h-5 w-5 text-danger" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      )
    },
    warning: {
      bg: 'bg-warn-soft border-warn/30',
      text: 'text-warn',
      icon: (
        <svg className="h-5 w-5 text-warn" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )
    },
    info: {
      bg: 'bg-brand-50 border-brand-200',
      text: 'text-brand-600',
      icon: (
        <svg className="h-5 w-5 text-brand-500" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      )
    },
    rollback: {
      bg: 'bg-warn-soft border-warn/30',
      text: 'text-warn',
      icon: (
        <svg className="h-5 w-5 text-warn" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
        </svg>
      )
    }
  }

  // `type` vaut 'info' par défaut, et `typeStyles.info` N'EXISTAIT PAS : le
  // repli `|| typeStyles.info` valait donc `undefined`, et le rendu levait sur
  // `styles.bg` dès qu'un appelant omettait le type. Le seul appelant est
  // sauvé par son `isVisible={false}`, qui sort avant le rendu — le défaut est
  // resté latent, jamais corrigé.
  const styles = typeStyles[type] || typeStyles.info

  if (!isVisible) return null

  return (
    <div className={`fixed top-4 right-4 max-w-sm w-full z-50 transform transition-all duration-300 ${
      isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
    }`}>
      <div className={`rounded-lg border p-4 shadow-lg ${styles.bg}`}>
        <div className="flex">
          <div className="flex-shrink-0">
            {styles.icon}
          </div>
          <div className="ml-3">
            <p className={`text-sm font-medium ${styles.text}`}>
              {message}
            </p>
          </div>
          {!autoClose && (
            <div className="ml-auto pl-3">
              <div className="-mx-1.5 -my-1.5">
                <button
                  onClick={onClose}
                  className={`inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 hover:opacity-75 ${styles.text}`}
                >
                  <span className="sr-only">Fermer</span>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export default OptimisticToast