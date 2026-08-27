import { Outlet } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import NavBar from './NavBar'
import NetworkCardsDrawer from './network/NetworkCardsDrawer'

/**
 * Shell de l'espace boutique.
 *
 * AVANT : un héros de 200 px affichant une image de fond sombre et le nom du
 * produit en 4xl, sur CHAQUE écran. Deux cents pixels de hauteur consacrés à
 * une information qui ne change jamais, poussant vers le bas les deux chiffres
 * dont dépend le travail — le stock et la liquidité.
 *
 * Le collage était fait à la main : deux écouteurs `scroll` indépendants (ici
 * et dans NavBar) comparant `window.scrollY` au seuil 200 codé en dur de part
 * et d'autre, plus une mesure de hauteur via `document.querySelector('nav')`
 * prise une seule fois au montage et jamais recalculée. La barre passait en
 * `fixed`, quittait le flux, et la barre des soldes — restée dans le flux —
 * disparaissait dessous.
 *
 * APRÈS : `position: sticky` sur l'en-tête entier. Le navigateur s'en charge.
 * Zéro écouteur, zéro mesure, zéro seuil magique — et les soldes ne quittent
 * jamais l'écran, ce qui est le principe directeur de cette interface : la
 * question « puis-je approvisionner l'agent suivant ? » doit avoir sa réponse
 * en permanence sous les yeux.
 */
function Layout({ children }) {
  const { themeClasses } = useTheme()

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      <header className="sticky top-0 z-50 shadow-md">
        <NavBar />
        <NetworkCardsDrawer />
      </header>

      <main className="w-full px-4 py-6">
        {children !== undefined ? children : <Outlet />}
      </main>
    </div>
  )
}

export default Layout
