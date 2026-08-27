import { Outlet } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { APP_NAME } from '../constants/branding'
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

export function BandeauMarque() {
  return (
    <header className="bandeau-marque">
      {/* Composition CENTRÉE, comme avant la refonte. L'alignement à gauche
          poussait la marque dans un coin de la photographie et laissait les
          deux tiers droits vides ; sur un bandeau qui n'existe qu'à l'arrivée,
          l'axe central est le seul endroit que le regard cherche. La marque, le
          nom et la ligne de métier s'empilent sur cet axe. */}
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center md:gap-4 md:py-12">
        {/* La marque dit déjà « C2EGF » : la répéter à voix haute encombrerait
            le lecteur d'écran, qui a le nom en toutes lettres juste après. */}
        <img
          src="/c2egf-mark.png"
          alt=""
          aria-hidden="true"
          width="56"
          height="56"
          className="h-12 w-12 rounded-full ring-1 ring-white/25 md:h-14 md:w-14"
        />
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold leading-tight tracking-tight text-white md:text-4xl">
            {APP_NAME}
          </p>
          <p className="mt-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200 md:text-[11px] md:tracking-[0.28em]">
            Distribution mobile money · Burkina Faso
          </p>
        </div>
      </div>
    </header>
  )
}

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
