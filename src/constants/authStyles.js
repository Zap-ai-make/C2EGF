// Styles Tailwind réutilisables pour l'authentification.
//
// Les couleurs de marque viennent des jetons de src/index.css : brand-500 est
// le bleu relevé sur logo.jpeg, brand-400 sa version éclaircie, brand-600 la
// version assombrie du survol.
//
// CE FICHIER PORTAIT DEUX THÈMES. `THEME_VARIANTS` exposait un `primary`
// marine et un `secondary` VIOLET, consommé cinq fois par le seul formulaire
// d'inscription : l'application affichait donc une connexion marine et une
// inscription violette sur le même écran, à un clic d'intervalle. Le violet
// n'était pas une erreur de teinte à corriger — c'était un axe de variation
// qui n'avait aucune raison d'exister dans un produit à une seule marque.
// Les deux variantes sont parties avec lui ; il ne reste que des styles nommés
// par leur RÔLE.
export const AUTH_STYLES = {
  // Champs
  input: {
    // Le champ complet, prêt à poser. Il fallait auparavant composer `base` et
    // une variante de focus, ce qui était l'unique raison d'être de
    // `combineClasses` sur ce fichier.
    field:
      'w-full rounded-md border border-line bg-canvas px-4 py-3 text-ink transition-colors ' +
      'placeholder:text-ink-muted focus:border-brand-400 focus:bg-surface focus:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-brand-400',
    error: 'border-danger bg-danger-soft focus:border-danger focus-visible:ring-danger',
    label: 'mb-1.5 block text-sm font-medium text-ink',
    hint: 'mt-1.5 text-xs text-ink-muted',
    fieldError: 'mt-1.5 text-sm text-danger',
  },

  // Boutons
  button: {
    primary:
      'w-full rounded-md bg-brand-500 px-6 py-3 font-semibold text-white transition-colors ' +
      'hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
    tertiary:
      'rounded-md border border-line bg-surface px-4 py-3 font-medium text-ink transition-colors ' +
      'hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
    danger:
      'rounded-md bg-danger px-4 py-3 font-medium text-white transition-colors hover:bg-danger/90 ' +
      'disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger',
    link:
      'rounded font-semibold text-brand-500 transition-colors hover:text-brand-600 ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  },

  // Messages
  message: {
    error: 'rounded-md border border-danger/30 bg-danger-soft p-3 text-danger',
    success: 'rounded-md border border-success/30 bg-success-soft p-3 text-success',
    info: 'rounded-md border border-brand-200 bg-brand-50 p-3 text-brand-600',
    warning: 'rounded-md border border-warn/30 bg-warn-soft p-3 text-warn',
  },

  // Modales
  modal: {
    overlay: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
    container: 'w-full max-w-md rounded-lg bg-surface p-6 shadow-xl',
    header: 'mb-4 flex items-center justify-between',
    title: 'text-lg font-bold text-ink',
    closeButton:
      'rounded p-1 text-ink-muted transition-colors hover:text-ink focus:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-brand-400',
    footer: 'flex gap-4',
  },

  // Layouts
  layout: {
    authPage: 'flex min-h-screen items-center justify-center bg-canvas p-4',
    authContainer: 'w-full max-w-4xl overflow-hidden rounded-2xl bg-surface shadow-2xl',
    authForm: 'w-full p-8 md:w-1/2 md:p-12',
    authSidebar: 'w-full md:w-1/2',
  },

  // Profil
  profile: {
    container: 'max-w-4xl mx-auto space-y-6',
    card: 'bg-surface rounded-lg shadow-md p-6',
    header: 'flex items-center justify-between',
    avatar: 'w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold',
    grid: 'grid grid-cols-1 md:grid-cols-2 gap-6',
    field: 'p-3 bg-canvas rounded-md border border-line',
    label: 'block text-sm font-medium text-ink mb-2',
    badge: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    badgeSuccess: 'bg-success-soft text-success',
    badgeWarning: 'bg-warn-soft text-warn',
  },

  // États de chargement
  loading: {
    spinner: 'motion-safe:animate-spin rounded-full h-16 w-16 border-b-2 border-brand-500 mx-auto',
    container: 'min-h-screen flex items-center justify-center bg-canvas',
    text: 'text-ink-muted mt-4',
  },

  // Typographie
  text: {
    title: 'text-3xl font-bold text-ink',
    subtitle: 'text-ink-muted',
    heading: 'text-xl font-bold text-ink',
    body: 'text-ink-muted',
    small: 'text-sm text-ink-muted',
    link: 'rounded text-brand-500 transition-colors hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  },

  // Espacements
  spacing: {
    form: 'space-y-5',
    formTight: 'space-y-4',
    section: 'space-y-8',
    buttons: 'flex gap-4',
    modal: 'mb-4',
    profile: 'space-y-6',
  },
}

// Fonction helper pour combiner les classes
export const combineClasses = (...classes) => {
  return classes.filter(Boolean).join(' ')
}
