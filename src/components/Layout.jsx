import { Outlet } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import BandeauMarque from './BandeauMarque'
import NavBar from './NavBar'
import NetworkCardsDrawer from './network/NetworkCardsDrawer'

/**
 * Shell de l'espace boutique.
 *
 * TROIS BANDES, et une seule quitte l'écran.
 *
 *   1. LE BANDEAU DE MARQUE  défile et disparaît — c'est l'accueil, pas l'outil
 *   2. LA NAVIGATION         collante
 *   3. LES SOLDES            collants
 *
 * Le premier jet de cette refonte avait supprimé la bande de marque purement et
 * simplement : l'application s'ouvrait sur une barre bleue nue, sans visage.
 * Le reproche était juste. Ce qui devait partir, ce n'était pas l'identité,
 * c'étaient ses 200 px PERMANENTS et son image de 1,76 Mo.
 *
 * D'où le partage : le bandeau garde la présence (112 px, texture, marque en
 * grand) mais il défile hors de l'écran dès qu'on travaille ; la navigation et
 * les soldes restent. On ne paie l'identité qu'une fois, à l'arrivée, au lieu
 * de la payer sur chaque défilement de chaque écran.
 *
 * Le collage était fait à la main : deux écouteurs `scroll` indépendants (ici
 * et dans NavBar) comparant `window.scrollY` au seuil 200 codé en dur de part
 * et d'autre, plus une mesure de hauteur via `document.querySelector('nav')`
 * prise une seule fois au montage et jamais recalculée. La barre passait en
 * `fixed`, quittait le flux, et la barre des soldes — restée dans le flux —
 * disparaissait dessous.
 *
 * `position: sticky` fait le travail : zéro écouteur, zéro mesure, zéro seuil
 * magique. Il faut pour cela que l'élément collant ne soit PAS enfermé dans le
 * bandeau — son bloc conteneur doit être la page entière, sinon il se
 * décollerait en même temps que le bandeau sortirait de l'écran. C'est la
 * raison pour laquelle les deux sont frères et non imbriqués.
 */

/**
 * `BandeauMarque` vit maintenant dans son propre fichier — le banc Remotion le
 * monte seul, et l'importer d'ici lui aurait fait traîner la navigation, les
 * contextes et Firebase. Il reste ré-exporté : `src/preview.jsx` l'atteint par
 * ce chemin depuis le lot du shell.
 */
export { BandeauMarque }

function Layout({ children }) {
  const { themeClasses } = useTheme()

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      <BandeauMarque />

      <div className="sticky top-0 z-50 shadow-lg shadow-brand-600/20">
        <NavBar />
        <NetworkCardsDrawer />
      </div>

      <main className="w-full px-4 py-6">
        {children !== undefined ? children : <Outlet />}
      </main>
    </div>
  )
}

export default Layout
