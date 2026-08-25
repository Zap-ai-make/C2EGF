import { createContext, useContext, useState, useMemo } from 'react'
import { THEMES, DEFAULT_THEME, STORAGE_KEY } from '../constants/themes.js'

const ThemeContext = createContext()

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved && THEMES[saved] ? saved : DEFAULT_THEME
    } catch {
      return DEFAULT_THEME
    }
  })

  const [customColor, setCustomColor] = useState(() => {
    try {
      return localStorage.getItem(`${STORAGE_KEY}_custom_color`) || '#3b82f6'
    } catch {
      return '#3b82f6'
    }
  })

  const changeTheme = (themeId) => {
    if (THEMES[themeId]) {
      setCurrentTheme(themeId)
      try {
        localStorage.setItem(STORAGE_KEY, themeId)
      } catch (error) {
        console.error('Theme save failed:', error.message)
      }
    }
  }

  const setCustomThemeColor = (color) => {
    setCustomColor(color)
    setCurrentTheme('custom')
    try {
      localStorage.setItem(`${STORAGE_KEY}_custom_color`, color)
      localStorage.setItem(STORAGE_KEY, 'custom')
    } catch (error) {
      console.error('Custom color save failed:', error.message)
    }
  }

  const themeClasses = useMemo(() => {
    const theme = THEMES[currentTheme]
    if (!theme) return THEMES[DEFAULT_THEME].classes

    if (currentTheme === 'custom') {
      return {
        ...theme.classes,
        accent: `bg-[${customColor}] text-white`,
        navbar: `bg-[${customColor}]/95 backdrop-blur-sm`
      }
    }

    return theme.classes
  }, [currentTheme, customColor])

  const currentBackgroundImage = useMemo(() => {
    const theme = THEMES[currentTheme]
    return theme?.backgroundImage || THEMES[DEFAULT_THEME].backgroundImage
  }, [currentTheme])

  const value = useMemo(() => ({
    currentTheme,
    customColor,
    themes: THEMES,
    themeClasses,
    backgroundImage: currentBackgroundImage,
    changeTheme,
    setCustomThemeColor
  }), [currentTheme, customColor, themeClasses, currentBackgroundImage])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
