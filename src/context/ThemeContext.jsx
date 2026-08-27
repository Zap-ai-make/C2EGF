import { createContext, useContext, useState, useMemo } from 'react'
import { THEMES, DEFAULT_THEME, STORAGE_KEY } from '../constants/themes.js'

/**
 * ThemeContext — expose les classes du thème actif.
 *
 * Le contexte n'exposait pas seulement ces classes : il portait aussi
 * `currentTheme`, `themes`, `customColor`, `changeTheme` et
 * `setCustomThemeColor`. Aucun de ces cinq symboles n'avait le moindre
 * consommateur dans src/ ni dans tests/ — il n'existe pas de sélecteur de
 * thème dans l'application. C'était une API publique sans public.
 *
 * `setCustomThemeColor` était en outre inapplicable par construction : elle
 * fabriquait `bg-[${couleur}]` à l'exécution, or l'extracteur Tailwind ne lit
 * que les chaînes présentes dans les sources. La classe n'a jamais pu exister
 * dans le CSS produit. Le thème « custom » qu'elle pilotait est retiré avec
 * elle.
 *
 * Ce qui reste : le thème d'ouverture dérive du profil client, et un choix
 * explicite persisté en localStorage garde la priorité.
 */

const ThemeContext = createContext()

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }) => {
  const [currentTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved && THEMES[saved] ? saved : DEFAULT_THEME
    } catch {
      return DEFAULT_THEME
    }
  })

  const themeClasses = useMemo(
    () => THEMES[currentTheme]?.classes ?? THEMES[DEFAULT_THEME].classes,
    [currentTheme],
  )

  const backgroundImage = useMemo(
    () => THEMES[currentTheme]?.backgroundImage ?? THEMES[DEFAULT_THEME].backgroundImage,
    [currentTheme],
  )

  const value = useMemo(
    () => ({ themeClasses, backgroundImage }),
    [themeClasses, backgroundImage],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
