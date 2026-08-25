// Styles Tailwind CSS réutilisables pour l'authentification
// Bleu marine #173863 = couleur de marque C2EGF, relevée sur logo.jpeg.
// #2760a5 en est la version éclaircie, #0f2745 la version assombrie (survol).
// Valeurs littérales : Tailwind ne génère que les classes qu'il lit en clair.
export const AUTH_STYLES = {
  // Inputs
  input: {
    base: "w-full px-4 py-3 bg-gray-100 border-0 rounded-md focus:bg-white focus:ring-2 focus:outline-none transition-all",
    primary: "focus:ring-[#2760a5]",
    secondary: "focus:ring-purple-500",
    error: "bg-red-50 border border-red-300 focus:ring-red-500"
  },

  // Boutons
  button: {
    primary: "w-full bg-[#173863] hover:bg-[#0f2745] text-white font-semibold py-3 px-6 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    secondary: "w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    tertiary: "bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 px-4 rounded-md transition-colors",
    danger: "bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-md transition-colors disabled:opacity-50",
    link: "text-[#173863] hover:text-[#2760a5] font-semibold transition-colors",
    linkSecondary: "text-purple-600 hover:text-purple-700 font-semibold transition-colors"
  },

  // Messages
  message: {
    error: "p-3 bg-red-100 border border-red-400 text-red-700 rounded-md",
    success: "p-3 bg-green-100 border border-green-400 text-green-700 rounded-md",
    info: "p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded-md",
    warning: "p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded-md"
  },

  // Modales
  modal: {
    overlay: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50",
    container: "bg-white rounded-lg p-6 max-w-md w-full mx-4",
    header: "flex justify-between items-center mb-4",
    title: "text-lg font-bold text-gray-800",
    closeButton: "text-gray-500 hover:text-gray-700 text-xl font-bold",
    footer: "flex space-x-4"
  },

  // Layouts
  layout: {
    authPage: "min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4",
    authContainer: "bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-4xl",
    authForm: "w-full md:w-1/2 p-8 md:p-12",
    authSidebar: "w-full md:w-1/2"
  },

  // Profil
  profile: {
    container: "max-w-4xl mx-auto space-y-6",
    card: "bg-white rounded-lg shadow-md p-6",
    header: "flex items-center justify-between",
    avatar: "w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold",
    grid: "grid grid-cols-1 md:grid-cols-2 gap-6",
    field: "p-3 bg-gray-50 rounded-md border",
    label: "block text-sm font-medium text-gray-700 mb-2",
    badge: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
    badgeSuccess: "bg-green-100 text-green-800",
    badgeWarning: "bg-yellow-100 text-yellow-800"
  },

  // États de chargement
  loading: {
    spinner: "animate-spin rounded-full h-16 w-16 border-b-2 border-[#173863] mx-auto",
    container: "min-h-screen flex items-center justify-center bg-gray-100",
    text: "text-gray-600 mt-4"
  },

  // Typographie
  text: {
    title: "text-3xl font-bold text-gray-800",
    subtitle: "text-gray-600",
    heading: "text-xl font-bold text-gray-800",
    body: "text-gray-600",
    small: "text-sm text-gray-500",
    link: "text-[#173863] hover:text-[#2760a5] transition-colors"
  },

  // Espacements
  spacing: {
    form: "space-y-6",
    formTight: "space-y-4",
    section: "space-y-8",
    buttons: "flex space-x-4",
    modal: "mb-4",
    profile: "space-y-6"
  }
}

// Fonction helper pour combiner les classes
export const combineClasses = (...classes) => {
  return classes.filter(Boolean).join(' ')
}

// Classes thématiques pour différents contextes
export const THEME_VARIANTS = {
  primary: {
    button: AUTH_STYLES.button.primary,
    input: combineClasses(AUTH_STYLES.input.base, AUTH_STYLES.input.primary),
    link: AUTH_STYLES.button.link
  },
  secondary: {
    button: AUTH_STYLES.button.secondary,
    input: combineClasses(AUTH_STYLES.input.base, AUTH_STYLES.input.secondary),
    link: AUTH_STYLES.button.linkSecondary
  }
}