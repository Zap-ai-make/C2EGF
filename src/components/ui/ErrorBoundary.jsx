import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(_error) {
    // Met à jour le state pour afficher l'UI de fallback
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    // Log l'erreur pour le debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Sauvegarder les détails de l'erreur
    this.setState({
      error,
      errorInfo
    })

    // Ici on pourrait envoyer l'erreur à un service de monitoring
    // comme Sentry, LogRocket, etc.
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-[400px] flex items-center justify-center">
          <div className="mx-4 w-full max-w-md rounded-lg bg-surface p-8 shadow-lg">
            <div className="text-center">
              {/* Icône d'erreur */}
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                <svg
                  className="h-6 w-6 text-danger"
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>

              {/* Titre */}
              <h3 className="mb-2 text-lg font-medium text-ink">
                Oups ! Quelque chose s'est mal passé
              </h3>

              {/* Message */}
              <p className="mb-6 text-sm text-ink-muted">
                Une erreur inattendue s'est produite. Vous pouvez essayer de recharger la page ou contacter le support.
              </p>

              {/* Boutons d'action */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={this.handleRetry}
                  className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                >
                  Réessayer
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                >
                  Recharger la page
                </button>
              </div>

              {/* Détails de l'erreur (mode développement) */}
              {import.meta.env.DEV && this.state.error && (
                <details className="mt-6 text-left">
                  <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                    Détails de l'erreur (développement)
                  </summary>
                  <div className="mt-2 p-4 bg-gray-50 rounded text-xs text-gray-700 overflow-auto max-h-40">
                    <div className="font-medium mb-2">Error:</div>
                    <div className="mb-4">{this.state.error.toString()}</div>
                    <div className="font-medium mb-2">Stack trace:</div>
                    <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Hook pour créer des error boundaries fonctionnels (optionnel)
export const withErrorBoundary = (Component, fallback) => {
  return function WrappedComponent(props) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    )
  }
}

export default ErrorBoundary
