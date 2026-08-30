import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import {
  STORE_NAV_ITEMS,
  STORE_ACCOUNT_ITEM,
  NAV_GROUPS,
  INTERNAL_DEBTS_PATH,
  navItemsOfGroup,
  assertCompteurAutorise,
} from '../constants/navigation'
import { useTheme } from '../context/ThemeContext.jsx'
import { useAuth } from '../context/AuthContext'
import { subscribeStorePendingCount } from '../services/storeAdminDealerService'
import { subscribePendingSettlementsCount } from '../services/collaborationService'

import PWAInstallButton from './PWAInstallButton'

const DEALER_REQUESTS_PATH = '/dealer-requests'

/**
 * Ce que compte chaque compteur, au singulier et au pluriel.
 *
 * Une seule source pour le bureau et le panneau : deux compteurs au même dessin
 * doivent rester distincts à l'oreille. « 2 demandes en attente » sur une file de
 * règlements serait un mensonge pour qui n'a que le lecteur d'écran.
 */
function libelleCompteur(path) {
  if (path === INTERNAL_DEBTS_PATH) {
    return {
      noun: 'règlement à confirmer',
      nounPluriel: 'règlements à confirmer',
      testId: 'store-debts-badge',
    }
  }
  return { noun: 'demande', nounPluriel: 'demandes', testId: 'store-pending-badge' }
}

/**
 * Les initiales du gérant, pour la pastille du compte.
 *
 * Deux mots → première lettre du premier et du dernier ; un seul mot → ses deux
 * premières lettres. Un nom vide rend « ? » plutôt qu'une pastille muette : le
 * compte reste identifiable même quand le profil n'a pas de nom.
 */
export function initiales(nom) {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

/**
 * Le compteur d'attente.
 *
 * Il ne dit qu'une chose, toujours la même : « ce nombre de personnes attendent
 * une réponse de vous ». C'est ce qui autorise trois compteurs dans la même
 * barre sans que ce soit du bruit — ils ont le même dessin et le même sens.
 * L'invariant qui interdit d'en poser un sur une destination de consultation
 * vit dans `constants/navigation.js`, et il est vérifié ici.
 *
 * ⚠ LE PLURIEL SE PASSE, IL NE SE FABRIQUE PAS. Ajouter un « s » à la fin
 *   suffisait tant que le nom était un mot (« demande » → « demandes »). Dès que
 *   c'est une locution, le « s » atterrit au mauvais endroit : « 2 règlement à
 *   confirmers ». L'accord porte sur le NOM, pas sur la fin de la chaîne — et
 *   ce libellé est tout ce qu'entend un lecteur d'écran.
 */
function PendingBadge({
  count,
  noun = 'demande',
  nounPluriel,
  testId = 'store-pending-badge',
}) {
  if (!count) return null
  const mot = count > 1 ? (nounPluriel ?? `${noun}s`) : noun
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[1.2rem]"
      aria-label={`${count} ${mot} en attente`}
      data-testid={testId}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * Barre de navigation de l'espace boutique.
 *
 * DEUX GROUPES, UN FILET
 * ──────────────────────
 * La rangée était plate : sept destinations de même poids, dont une seule
 * portait un compteur. Le module Dettes internes en apporte deux de plus, et
 * une liste plate de huit avec trois pastilles rouges dedans ne se lit plus.
 *
 * D'où le filet : à gauche le COURANT (l'état du jour et les endroits où l'on
 * agit), à droite le RÉFÉRENTIEL (ce qu'on va chercher). Un seul dispositif
 * structurel, et il énonce quelque chose de vrai — dont l'invariant « un
 * compteur ne peut apparaître qu'à gauche », qui tient parce qu'on ne répond
 * qu'à l'endroit où l'on agit.
 *
 * Une première version plaçait les compteurs à droite du filet en disant « à
 * droite, ce qui m'attend ». La règle ne tenait que parce qu'il manquait un
 * compteur sur Transactions : dès qu'il y en a un, elle devient fausse — et
 * Transactions ne peut pas passer à droite, c'est la destination la plus
 * utilisée de l'application.
 *
 * LE PROFIL A QUITTÉ LA RANGÉE
 * ────────────────────────────
 * Ce n'est pas une destination sœur des autres, c'est le compte. Il passe à
 * droite sous les initiales du gérant, et la place qu'il libère absorbe l'entrée
 * du module à venir sans que la barre grossisse.
 *
 * LE <select> MOBILE A DISPARU
 * ────────────────────────────
 * C'était une liste déroulante de FORMULAIRE au service de la navigation. Elle
 * ne sait pas afficher de pastille — elle trichait en écrivant « (3) » dans le
 * texte de l'option —, ne sait pas grouper, et s'annonce comme un champ. Sur
 * l'appareil exact où cette application sert.
 *
 * À la place : un bouton et un panneau. Replié, le bouton porte UN SEUL total —
 * la somme des attentes, puisqu'il n'y a pas la place d'en montrer trois.
 * Déplié, le panneau rend les deux groupes et le détail. Même information,
 * adaptée à la place disponible : c'est précisément ce que le <select> ne savait
 * pas faire.
 *
 * UN SEUL <nav>
 * ─────────────
 * Le bureau et le mobile partagent cet élément. TC-101 en fait une hypothèse
 * explicite, et le bouton d'installation reste rendu une seule fois, en dehors
 * des deux variantes.
 */
function NavBar() {
  const location = useLocation()
  const { themeClasses } = useTheme()
  const { currentUser, userProfile } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [settlementsCount, setSettlementsCount] = useState(0)
  const [panneauOuvert, setPanneauOuvert] = useState(false)

  useEffect(() => {
    setPendingCount(0)
    const unsub = subscribeStorePendingCount({
      currentUser,
      userProfile,
      onUpdate: setPendingCount,
    })
    return unsub
  }, [currentUser, userProfile])

  /**
   * Les règlements que mes consœurs ont déclarés et qui attendent MA
   * confirmation. L'abonnement vit dans la barre et non dans la page : un
   * compteur doit alerter même quand l'écran concerné n'est pas ouvert — c'est
   * toute sa raison d'être.
   */
  useEffect(() => {
    setSettlementsCount(0)
    const storeId = userProfile?.storeId
    if (!storeId) return undefined
    return subscribePendingSettlementsCount({ storeId, onUpdate: setSettlementsCount })
  }, [userProfile?.storeId])

  // Naviguer referme le panneau. Sans ça, il resterait ouvert par-dessus la page
  // qu'on vient de demander.
  useEffect(() => {
    setPanneauOuvert(false)
  }, [location.pathname])

  // Échap referme, comme tout calque (DESIGN.md §11).
  useEffect(() => {
    if (!panneauOuvert) return undefined
    const surTouche = (e) => { if (e.key === 'Escape') setPanneauOuvert(false) }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [panneauOuvert])

  /**
   * Les compteurs, par destination. Une seule source pour le bureau, le total du
   * bouton mobile et le détail du panneau — trois rendus qui ne peuvent donc pas
   * diverger. Les deux compteurs du module Dettes internes s'ajouteront ici,
   * et nulle part ailleurs.
   */
  const compteurs = {
    [DEALER_REQUESTS_PATH]: pendingCount,
    [INTERNAL_DEBTS_PATH]: settlementsCount,
  }
  Object.keys(compteurs).forEach(assertCompteurAutorise)
  const totalEnAttente = Object.values(compteurs).reduce((somme, n) => somme + n, 0)

  const courant = navItemsOfGroup(NAV_GROUPS.COURANT)
  const referentiel = navItemsOfGroup(NAV_GROUPS.REFERENTIEL)

  const lienBureau = ({ isActive }) =>
    `inline-flex items-center px-4 py-3 font-medium text-white transition-colors duration-200 hover:bg-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${
      isActive ? 'bg-black/30 border-b-2 border-white/50' : ''
    }`

  const lienPanneau = ({ isActive }) =>
    `flex items-center justify-between rounded-md px-3 py-3 font-medium text-white transition-colors hover:bg-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
      isActive ? 'bg-black/30' : ''
    }`

  const renduBureau = (item) => (
    <NavLink key={item.path} to={item.path} className={lienBureau}>
      {item.name}
      <PendingBadge count={compteurs[item.path]} {...libelleCompteur(item.path)} />
    </NavLink>
  )

  const renduPanneau = (item) => (
    <NavLink key={item.path} to={item.path} className={lienPanneau}>
      <span>{item.name}</span>
      <PendingBadge
        count={compteurs[item.path]}
        {...libelleCompteur(item.path)}
        testId={`nav-panneau-badge-${item.path}`}
      />
    </NavLink>
  )

  return (
    <nav className={`${themeClasses.navbar} w-full`}>
      <div className="relative flex w-full items-center gap-3 px-4">

        {/* ── Bureau : la rangée, centrée sur le même axe que la marque ────── */}
        <div className="hidden flex-1 items-center justify-center md:flex">
          {courant.map(renduBureau)}
          <span className="mx-3 h-6 w-px shrink-0 bg-white/25" aria-hidden="true" />
          {referentiel.map(renduBureau)}
        </div>

        {/* ── Mobile : un bouton, et un panneau ─────────────────────────────
            Le bouton porte le TOTAL. Trois compteurs ne tiennent pas sur un
            bouton ; leur somme, si — et c'est la même information. */}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded border border-white/20 px-3 py-2 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:hidden"
          onClick={() => setPanneauOuvert((ouvert) => !ouvert)}
          aria-expanded={panneauOuvert}
          aria-controls="nav-panneau-boutique"
        >
          {panneauOuvert
            ? <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
            : <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />}
          Menu
          <PendingBadge count={totalEnAttente} testId="nav-total-badge" />
        </button>

        <div className="flex-1 md:hidden" />

        {/* ── Le compte, hors de la rangée ──────────────────────────────────
            Sur mobile il reste visible : c'est une cible tactile, pas une
            entrée de menu de plus. */}
        <div className="flex shrink-0 items-center gap-2 md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2">
          <NavLink
            to={STORE_ACCOUNT_ITEM.path}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium text-white transition-colors hover:bg-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isActive ? 'border-white/60 bg-black/30' : 'border-white/25'
              }`
            }
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold"
              aria-hidden="true"
            >
              {initiales(userProfile?.name)}
            </span>
            {STORE_ACCOUNT_ITEM.name}
          </NavLink>
          <PWAInstallButton />
        </div>
      </div>

      {panneauOuvert && (
        <div id="nav-panneau-boutique" className="border-t border-white/15 px-3 pb-3 pt-2 md:hidden">
          {/* Les intertitres nomment les deux groupes. Sur le bureau c'est le
              filet qui le dit ; ici, où il n'y a pas de rangée, ce sont eux. */}
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
            Aujourd’hui
          </p>
          <div className="flex flex-col">{courant.map(renduPanneau)}</div>

          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-white/60">
            Consulter
          </p>
          <div className="flex flex-col">{referentiel.map(renduPanneau)}</div>
        </div>
      )}
    </nav>
  )
}

export default NavBar
