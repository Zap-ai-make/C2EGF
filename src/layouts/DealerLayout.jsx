import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  DEALER_NAV_GROUPS,
  DEALER_GROUP_LABELS,
  DEALER_ACCOUNT_ITEM,
  dealerNavItemsOfGroup,
  assertCompteurDealerAutorise,
} from '../constants/navigation'
import { subscribeDealerPendingCount } from '../services/dealerService'
import { subscribeIncomingTransfersCount } from '../services/storeTransferService'
import { BRAND } from '../constants/workspaceTheme'
import { APP_NAME } from '../constants/branding'
import { useDealerInventory } from '../hooks/useDealerInventory'
import { estSousSeuil } from '../constants/dealerConstants'
import DealerInventoryBar from '../components/dealer/DealerInventoryBar'

/**
 * Le poste de ravitaillement — shell de l'espace dealer.
 *
 * LA BARRE LATÉRALE N'EST PLUS UN MENU, C'EST LE POSTE DE TRAVAIL
 * ───────────────────────────────────────────────────────────────
 * Elle portait six liens et un bouton de déconnexion. Elle porte maintenant, en
 * permanence : la marque, LES DEUX CUVES, l'action principale, la navigation en
 * deux groupes, et le compte. Le contenu récupère du même coup la centaine de
 * pixels que la bande d'inventaire lui prenait sur chaque écran — et les cuves
 * cessent de défiler, alors qu'elles conditionnent chaque action de la page.
 *
 * La structure reste ce qui distingue les trois espaces : barre latérale ici,
 * navigation haute dans la boutique. C'est un choix déjà pris, documenté en tête
 * de `workspaceTheme.js`, et ce lot ne le défait pas — il l'exploite.
 *
 * UNE SEULE BARRE, DEUX COMPORTEMENTS
 * ───────────────────────────────────
 * L'ancien shell rendait DEUX fois la barre : une pour le bureau, une pour le
 * panneau mobile — deux listes de liens, deux boutons de déconnexion, deux
 * copies à garder d'accord. Il n'y en a plus qu'une : sur le bureau elle est
 * dans le flux, sur mobile elle coulisse. Un seul `<nav>`, un seul jeu de
 * compteurs, rien à synchroniser.
 *
 * LES CUVES SUR MOBILE
 * ────────────────────
 * La barre est repliée par défaut sur petit écran ; les cuves y seraient donc
 * invisibles. Un résumé en lecture seule les rend dans l'en-tête, alimenté par
 * le MÊME hook — pas par une seconde copie de l'état. Ajuster reste dans la
 * barre : c'est une action financière, elle mérite qu'on l'ouvre.
 */

const ACCUEIL = '/dealer'

/**
 * Le compteur d'attente. Il ne dit qu'une chose : « ce nombre de personnes
 * attendent une réponse de vous ». C'est ce qui autorise deux compteurs dans la
 * même barre sans que ce soit du bruit.
 *
 * ⚠ LE PLURIEL SE PASSE, IL NE SE FABRIQUE PAS — même leçon que la barre
 *   boutique : « 2 retour boutiques » ou « 2 demandes en attentes » sont ce que
 *   produit un « s » ajouté au bout d'une locution. C'est tout ce qu'entend un
 *   lecteur d'écran.
 */
function PendingBadge({ count, noun = 'demande', nounPluriel, testId = 'dealer-pending-badge' }) {
  if (!count) return null
  const mot = count > 1 ? (nounPluriel ?? `${noun}s`) : noun
  return (
    <span
      className="ml-auto inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
      aria-label={`${count} ${mot} en attente`}
      data-testid={testId}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Ce que compte chaque compteur, au singulier et au pluriel. */
function libelleCompteur(path) {
  if (path === '/dealer/transfers') {
    return {
      noun: 'retour de boutique',
      nounPluriel: 'retours de boutiques',
      testId: 'dealer-transfers-badge',
    }
  }
  return { noun: 'demande', nounPluriel: 'demandes', testId: 'dealer-pending-badge' }
}

function NavItem({ item, badgeCount, onNavigate }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === ACCUEIL}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          isActive ? BRAND.navActive : BRAND.navIdle
        }`
      }
    >
      <span className="truncate">{item.name}</span>
      <PendingBadge count={badgeCount} {...libelleCompteur(item.path)} />
    </NavLink>
  )
}

/** Les initiales du dealer. Un nom vide rend « ? » plutôt qu'une pastille muette. */
export function initiales(nom) {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

/**
 * Résumé des cuves pour l'en-tête mobile : lecture seule, jamais d'action.
 *
 * ⚠ PAS DE `formatCurrency` ICI, ET C'EST LE POINT. Il suffixe « FCFA », et à
 *   390 px les deux montants suffixés dépassaient — la troncature emportait la
 *   devise, puis le marqueur « bas ». Autrement dit, le seul signal d'alerte de
 *   cet en-tête disparaissait précisément sur l'écran où il compte le plus.
 *   Vu à la capture, pas déduit.
 *
 *   La devise part donc : dans un produit où tout est en francs CFA, la répéter
 *   deux fois sur une barre de 390 px coûte plus qu'elle n'apprend. Le marqueur
 *   « bas », lui, ne rétrécit jamais (`shrink-0`) : c'est le nombre qui cède la
 *   place, pas l'alerte.
 */
const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

function CuvesResume({ inventory }) {
  const lignes = [
    { label: 'Stock', montant: inventory.stock },
    { label: 'Liquidité', montant: inventory.liquidite },
  ]
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-3 overflow-hidden">
      {lignes.map(({ label, montant }) => {
        const bas = estSousSeuil(montant)
        return (
          <p key={label} className="flex min-w-0 items-baseline gap-1 text-xs">
            <span className="shrink-0 text-ink-muted">{label}</span>
            <span className={`truncate font-bold tabular-nums ${bas ? 'text-warn' : 'text-ink'}`}>
              {Number.isFinite(Number(montant)) ? nombre.format(Number(montant)) : '—'}
            </span>
            {bas && (
              <span className="shrink-0 font-semibold text-warn" aria-label="sous le seuil bas">
                bas
              </span>
            )}
          </p>
        )
      })}
    </div>
  )
}

function DealerLayout() {
  const { logout, userProfile, currentUser } = useAuth()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)
  const [transfersCount, setTransfersCount] = useState(0)
  const [barreOuverte, setBarreOuverte] = useState(false)
  const { inventory } = useDealerInventory()

  useEffect(() => {
    setPendingCount(0)
    return subscribeDealerPendingCount({ currentUser, userProfile, onUpdate: setPendingCount })
  }, [currentUser, userProfile])

  useEffect(() => {
    setTransfersCount(0)
    if (userProfile?.role !== 'dealer' || !currentUser?.uid) return undefined
    return subscribeIncomingTransfersCount({ dealerUid: currentUser.uid, onUpdate: setTransfersCount })
  }, [currentUser, userProfile])

  // Naviguer referme la barre. Sans ça, elle resterait ouverte par-dessus la
  // page qu'on vient de demander.
  useEffect(() => { setBarreOuverte(false) }, [location.pathname])

  // Échap referme, comme tout calque (DESIGN.md §11).
  useEffect(() => {
    if (!barreOuverte) return undefined
    const surTouche = (e) => { if (e.key === 'Escape') setBarreOuverte(false) }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [barreOuverte])

  const compteurs = {
    '/dealer/requests': pendingCount,
    '/dealer/transfers': transfersCount,
  }
  Object.keys(compteurs).forEach(assertCompteurDealerAutorise)
  const totalEnAttente = pendingCount + transfersCount

  const groupes = [DEALER_NAV_GROUPS.DISTRIBUER, DEALER_NAV_GROUPS.CONSULTER]
  const fermer = () => setBarreOuverte(false)

  return (
    <div className="min-h-screen bg-canvas" data-testid="dealer-layout">

      {/* ── Voile mobile ───────────────────────────────────────────────── */}
      {barreOuverte && (
        <div
          className="fixed inset-0 z-30 bg-ink/50 lg:hidden"
          onClick={fermer}
          aria-hidden="true"
        />
      )}

      {/* ── Le poste ────────────────────────────────────────────────────
          UNE SEULE barre : dans le flux sur le bureau, coulissante sur mobile.
          `-translate-x-full` la sort de l'écran sans la retirer du DOM, ce qui
          garde le mouvement et évite de remonter l'abonnement des cuves. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col ${BRAND.sidebar} shadow-xl transition-transform duration-200 motion-reduce:transition-none lg:w-56 lg:translate-x-0 ${
          barreOuverte ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Marque — le seul moment d'identité de l'espace dealer. Texture en
            dégradés, définie par `.poste-marque` : zéro octet transféré, et
            prévisible à cette taille, ce que la photographie du bandeau n'est
            pas (voir le commentaire dans index.css). */}
        <div className="poste-marque flex h-16 shrink-0 items-center justify-between gap-3 px-5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-none text-white">{APP_NAME}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-brand-200">
              Centrale
            </p>
          </div>
          <button
            type="button"
            onClick={fermer}
            className="-mr-1 rounded p-1 text-brand-100 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        {/* Les cuves — permanentes, jamais défilées. */}
        <div className={`shrink-0 border-b ${BRAND.sidebarBorder}`}>
          <DealerInventoryBar />
        </div>

        {/* L'action principale, à demeure. C'est le geste que la centrale fait
            dix fois par jour ; il vivait derrière deux clics, sur l'écran des
            demandes. Il est ici parce que DESIGN.md §3 demande que l'action
            principale soit immédiatement lisible — sur TOUS les écrans, pas
            seulement celui qui la contient. */}
        <div className="shrink-0 px-3 pt-3">
          <NavLink
            to="/dealer/requests/new"
            onClick={fermer}
            className="block rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Nouveau ravitaillement
          </NavLink>
        </div>

        <nav
          className="flex-1 overflow-y-auto px-3 py-3"
          aria-label="Navigation dealer"
          data-testid="dealer-nav"
        >
          {groupes.map(groupe => (
            <div key={groupe} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200">
                {DEALER_GROUP_LABELS[groupe]}
              </p>
              <div className="grid gap-0.5">
                {dealerNavItemsOfGroup(groupe).map(item => (
                  <NavItem
                    key={item.path}
                    item={item}
                    badgeCount={compteurs[item.path] ?? 0}
                    onNavigate={fermer}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Le compte — hors de la liste : ce n'est pas une destination sœur des
            autres. Se déconnecter n'est pas une suppression : pas de rouge. */}
        <div className={`shrink-0 border-t ${BRAND.sidebarBorder} px-3 py-3`}>
          <NavLink
            to={DEALER_ACCOUNT_ITEM.path}
            onClick={fermer}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isActive ? BRAND.navActive : BRAND.navIdle
              }`
            }
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {initiales(userProfile?.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-white">
                {userProfile?.name || 'Dealer'}
              </span>
              <span className="block text-[10px] text-brand-200">{DEALER_ACCOUNT_ITEM.name}</span>
            </span>
          </NavLink>
          <button
            onClick={logout}
            className="mt-2 w-full rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-brand-100 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* ── En-tête mobile ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 shadow-sm lg:hidden">
        <button
          type="button"
          onClick={() => setBarreOuverte(true)}
          className="-ml-1 flex items-center gap-1.5 rounded p-1.5 text-ink-muted transition-colors hover:bg-brand-50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          aria-label="Ouvrir le menu"
          aria-expanded={barreOuverte}
        >
          <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          <PendingBadge count={totalEnAttente} noun="demande" nounPluriel="demandes" testId="dealer-total-badge" />
        </button>
        {/* Les cuves restent lisibles sans ouvrir le menu. */}
        <CuvesResume inventory={inventory} />
      </header>

      {/* ── Contenu ────────────────────────────────────────────────────── */}
      <div className="lg:pl-56">
        <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DealerLayout
