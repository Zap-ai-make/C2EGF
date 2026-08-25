import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import NavBar from './NavBar'
import NetworkCardsDrawer from './network/NetworkCardsDrawer'
import { APP_NAME } from '../constants/branding'
function Layout({ children }) {
  const { themeClasses, backgroundImage } = useTheme()
  const [navbarHeight, setNavbarHeight] = useState(0)
  const [isNavbarSticky, setIsNavbarSticky] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const headerHeight = 200

      setIsNavbarSticky(scrollTop >= headerHeight)
    }

    // Mesurer la hauteur de la navbar
    const navbar = document.querySelector('nav')

    if (navbar) {
      setNavbarHeight(navbar.offsetHeight)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      {/* Header avec titre */}
      <header
        className="relative text-white w-full overflow-hidden"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
          minHeight: '200px'
        }}
      >
        {/* Overlay pour garder la visibilité */}
        <div className="absolute inset-0 bg-black/20"></div>

        {/* Contenu du header */}
        <div className="relative z-10 w-full px-4 py-12 flex items-center justify-center">
          <h1
            className="text-4xl font-bold text-center text-white"
            style={{
              textShadow: '0 3px 12px rgba(0, 0, 0, 0.8), 0 2px 6px rgba(0, 0, 0, 0.6)'
            }}
          >
            {APP_NAME}
          </h1>
        </div>
      </header>

      {/* Navigation */}
      <NavBar />

      {/* Rideau des cartes réseau */}
      <NetworkCardsDrawer />

      {/* Contenu principal avec padding top conditionnel */}
      <main
        className="w-full px-4 py-6 transition-all duration-300"
        style={{
          paddingTop: isNavbarSticky ? `${navbarHeight + 24}px` : '24px'
        }}
      >
        <div className="relative">
          {/* Arrière-plan thématique avec overlay */}
          <div
            className="fixed inset-0 -z-10 opacity-5"
            style={{
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed'
            }}
          />
          {children !== undefined ? children : <Outlet />}
        </div>
      </main>

    </div>
  )
}

export default Layout
