import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Menu, X, Plus, LogOut, Fuel, PanelLeftClose, PanelLeftOpen,
  Gauge, Send, Undo2, Store, History,
} from 'lucide-react'
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
import { DEALER_NAV_ITEMS } from '../constants/navigation'
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
 *
 * LE REPLI SUR GRAND ÉCRAN
 * ────────────────────────
 * La barre se replie en un RAIL de 3,5 rem, et rend 10 rem au contenu. Ce qui
 * en profite est identifiable : la liste des 84 caisses, dont les deux pistes
 * partagent la largeur restante — dix rems de plus, ce sont dix rems de barres
 * comparables en plus, sur le seul écran qui en vit.
 *
 * ⚠ TROIS RÈGLES QUE LE REPLI NE DOIT PAS ENFREINDRE.
 *
 *   1. IL NE CACHE JAMAIS UNE ALERTE. Les cuves disparaissent du rail, mais si
 *      l'une passe sous le seuil, un marqueur ambré reste, et son nom
 *      accessible porte LES DEUX MONTANTS en toutes lettres. Un poste replié
 *      qui tairait une cuve à sec serait pire qu'un poste large.
 *   2. IL NE COÛTE RIEN À QUI N'A QUE LE CLAVIER OU LA VOIX. Chaque cible du
 *      rail garde son nom complet (`aria-label`) et son `title` ; les
 *      intertitres de groupe passent en `sr-only` au lieu d'être supprimés,
 *      donc la structure de la navigation est intacte.
 *   3. IL SE SOUVIENT. Le choix est écrit dans `localStorage` : replier sa
 *      barre à chaque page serait un réglage qui ne se règle jamais.
 *
 * Les icônes n'existaient pas avant ce lot — la navigation était textuelle. Le
 * rail les impose : un rail sans icône est une colonne de cases vides. Elles
 * sont donc affichées AUSSI en mode déplié, pour que la cible ne change pas de
 * dessin en se repliant, seulement de largeur.
 */

/**
 * Une icône par destination. La table est ici, et non dans `navigation.js`,
 * pour que la liste des destinations reste une donnée pure, sans dépendance à
 * React ni à une bibliothèque d'icônes.
 *
 * L'assertion ci-dessous est l'idiome du dépôt (cf. `assertCompteurDealerAutorise`) :
 * ajouter une destination sans lui donner d'icône se voit en développement,
 * pas six mois plus tard sur un rail avec un trou dedans.
 */
const ICONES_NAV = {
  '/dealer':           Gauge,
  '/dealer/requests':  Send,
  '/dealer/transfers': Undo2,
  '/dealer/stores':    Store,
  '/dealer/history':   History,
}

if (import.meta.env?.DEV) {
  for (const item of DEALER_NAV_ITEMS) {
    if (!ICONES_NAV[item.path]) {
      throw new Error(
        `[nav dealer] « ${item.name} » (${item.path}) n'a pas d'icône : elle serait invisible dans la barre repliée.`,
      )
    }
  }
}

/** Le choix de repli survit à la navigation et au rechargement. */
const CLE_REPLI = 'dealer:barre-repliee'

function lireRepli() {
  try { return globalThis.localStorage?.getItem(CLE_REPLI) === '1' } catch { return false }
}

const ACCUEIL = '/dealer'

/**
 * Le compteur d'attente. Il ne dit qu'une chose : « ce nombre de personnes
 * attendent une réponse de vous ». C'est ce qui autorise deux compteurs dans la
 * même barre sans que ce soit du bruit.
 *
 * ⚠ LE PLURIEL SE PASSE, IL NE SE FABRIQUE PAS — même leçon que la barre
 *   boutique : « 2 retour boutiques » ou « 2 ravitaillement en attentes » sont
 *   ce que produit un « s » ajouté au bout d'une locution. C'est tout ce
 *   qu'entend un lecteur d'écran.
 *
 * ⚠ `noun` n'a plus de valeur par défaut. Il en avait une — « demande » — et
 *   c'est ce qui a permis au compteur TOTAL de s'annoncer « demandes » alors
 *   qu'il additionne deux files de natures différentes. Un mot par défaut sur
 *   un compteur générique, c'est un mot que personne ne choisit et que
 *   personne ne relit.
 */
function PendingBadge({ count, noun, nounPluriel, testId = 'dealer-pending-badge' }) {
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
  return {
    noun: 'ravitaillement',
    nounPluriel: 'ravitaillements',
    testId: 'dealer-pending-badge',
  }
}

/**
 * Une destination.
 *
 * ⚠ REPLIÉE, LA CIBLE GARDE SON NOM. Le libellé passe en `lg:hidden`, jamais en
 *   `display:none` inconditionnel : sur mobile la barre est TOUJOURS dépliée,
 *   et le repli ne la concerne pas. Le `title` sert la souris, l'`aria-label`
 *   sert la voix et le clavier — sans eux, un rail est cinq carrés muets.
 */
function NavItem({ item, badgeCount, onNavigate, replie }) {
  const Icone = ICONES_NAV[item.path]
  const compteur = libelleCompteur(item.path)
  const mot = badgeCount > 1 ? compteur.nounPluriel : compteur.noun
  const nomComplet = badgeCount > 0 ? `${item.name} — ${badgeCount} ${mot} en attente` : item.name
  return (
    <NavLink
      to={item.path}
      end={item.path === ACCUEIL}
      onClick={onNavigate}
      title={replie ? nomComplet : undefined}
      aria-label={replie ? nomComplet : undefined}
      className={({ isActive }) =>
        `relative flex items-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          replie ? 'px-3 lg:justify-center lg:px-0' : 'px-3'
        } ${isActive ? BRAND.navActive : BRAND.navIdle}`
      }
    >
      {Icone && <Icone className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.75} />}
      <span className={`truncate ${replie ? 'lg:hidden' : ''}`}>{item.name}</span>
      {/* Replié, le compteur chiffré descend en pastille muette : le nombre
          exact tiendrait mal sur un rail, et il est déjà dans le nom
          accessible ci-dessus. Ce qui reste est le SIGNAL — il y a quelque
          chose à traiter ici — qui, lui, ne doit jamais disparaître. */}
      <span className={replie ? 'lg:hidden' : ''}>
        <PendingBadge count={badgeCount} {...compteur} />
      </span>
      {replie && badgeCount > 0 && (
        // Posée en absolu : centrer l'icône ET réserver la place d'une pastille
        // décalerait l'icône d'une ligne à l'autre selon qu'il y a ou non
        // quelque chose en attente. Une colonne d'icônes qui bouge n'est plus
        // une colonne.
        //
        // ⚠ `danger-soft`, PAS `danger`. Mesuré : le rouge plein est à
        //   **1,91:1** sur le marine de la barre — un signal « il y a quelque
        //   chose à traiter ici » qu'on ne voit pas. Le jeton clair y est à
        //   12,99:1. C'est le même piège que le filet de seuil invisible sur
        //   les barres de liquidité (S4) et que l'anneau des cuves
        //   (`DealerInventoryBar`) : un jeton n'est jamais neutre au fond qui
        //   le porte, et sur ce marine c'est la teinte CLAIRE qui porte.
        //
        //   La pastille dépliée, elle, garde son rouge plein : ce qui la rend
        //   lisible là-bas n'est pas son fond mais le CHIFFRE BLANC dedans
        //   (7,87:1). Ici il n'y a pas de chiffre — rien ne rattraperait le
        //   fond.
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 hidden h-2 w-2 rounded-full bg-danger-soft lg:block"
        />
      )}
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

/**
 * Les cuves, réduites au rail.
 *
 * ⚠ C'EST LA PIÈCE OÙ LE REPLI POUVAIT DEVENIR DANGEREUX. Les cuves
 *   conditionnent chaque action du poste ; les faire disparaître pour gagner
 *   dix rems, c'est offrir dix rems contre l'information qui décide s'il faut
 *   envoyer quoi que ce soit.
 *
 *   Deux garde-fous. Le nom accessible porte LES DEUX MONTANTS en toutes
 *   lettres, donc rien n'est perdu pour qui lit à la voix. Et si une cuve passe
 *   sous le seuil, la teinte d'alerte reste, doublée du mot « bas » dans ce
 *   même nom : l'alerte survit au repli, seuls les chiffres s'en vont.
 *
 * Cliquer déplie : le geste naturel quand on voit le marqueur ambré est de
 * vouloir le chiffre, et il n'y a pas de raison de faire chercher le bouton
 * d'ouverture ailleurs.
 */
function CuvesRail({ inventory, onDeplier }) {
  const dire = (label, montant) => {
    const n = Number.isFinite(Number(montant)) ? nombre.format(Number(montant)) : 'inconnu'
    return `${label} ${n}${estSousSeuil(montant) ? ', sous le seuil bas' : ''}`
  }
  const bas = estSousSeuil(inventory.stock) || estSousSeuil(inventory.liquidite)
  return (
    <button
      type="button"
      onClick={onDeplier}
      title="Cuves — déplier pour les chiffres"
      aria-label={`Cuves : ${dire('stock', inventory.stock)} ; ${dire('liquidité', inventory.liquidite)}. Déplier le menu.`}
      // ⚠ `warn-soft` et non `warn` en PREMIER PLAN, exactement comme
      //   `DealerInventoryBar` : #8a5a00 est une teinte d'alerte pour fond
      //   CLAIR ; sur le marine de la barre elle s'éteint. C'est le jeton clair
      //   qui porte l'alerte ici, et un jeton n'est jamais neutre au fond qui
      //   le porte.
      className={`flex w-full items-center justify-center py-3 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        bas ? 'text-warn-soft' : 'text-brand-100'
      }`}
    >
      <Fuel className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
      {bas && <span aria-hidden="true" className="ml-0.5 h-1.5 w-1.5 rounded-full bg-warn-soft" />}
    </button>
  )
}

function DealerLayout() {
  const { logout, userProfile, currentUser } = useAuth()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)
  const [transfersCount, setTransfersCount] = useState(0)
  const [barreOuverte, setBarreOuverte] = useState(false)
  // Le repli ne concerne QUE le grand écran. Sur mobile la barre est un calque
  // qu'on ouvre et qu'on referme : elle n'a pas de largeur à négocier.
  const [replie, setReplie] = useState(lireRepli)
  const { inventory } = useDealerInventory()

  const basculerRepli = useCallback(() => {
    setReplie(prev => {
      const suivant = !prev
      try { globalThis.localStorage?.setItem(CLE_REPLI, suivant ? '1' : '0') } catch { /* stockage refusé : le repli vaut pour la session */ }
      return suivant
    })
  }, [])

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
        id="poste-dealer"
        data-replie={replie ? 'true' : 'false'}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col ${BRAND.sidebar} shadow-xl transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 ${
          replie ? 'lg:w-14' : 'lg:w-56'
        } ${barreOuverte ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Marque — le seul moment d'identité de l'espace dealer. Texture en
            dégradés, définie par `.poste-marque` : zéro octet transféré, et
            prévisible à cette taille, ce que la photographie du bandeau n'est
            pas (voir le commentaire dans index.css). */}
        <div className={`poste-marque flex h-16 shrink-0 items-center justify-between gap-3 ${replie ? 'px-5 lg:justify-center lg:px-0' : 'px-5'}`}>
          <div className={`min-w-0 ${replie ? 'lg:hidden' : ''}`}>
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
          {/* Le bouton de repli n'existe QUE sur grand écran : sur mobile, la
              barre s'ouvre et se referme, elle ne se replie pas. Son nom dit
              l'action à venir, pas l'état courant — « Replier le menu » quand
              il est ouvert. `aria-expanded` porte l'état. */}
          <button
            type="button"
            onClick={basculerRepli}
            aria-expanded={!replie}
            aria-controls="poste-dealer"
            title={replie ? 'Déplier le menu' : 'Replier le menu'}
            aria-label={replie ? 'Déplier le menu' : 'Replier le menu'}
            data-testid="dealer-bascule-repli"
            className="hidden rounded p-1 text-brand-100 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:block"
          >
            {replie
              ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
              : <PanelLeftClose className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />}
          </button>
        </div>

        {/* Les cuves — permanentes, jamais défilées. */}
        <div className={`shrink-0 border-b ${BRAND.sidebarBorder}`}>
          <div className={replie ? 'lg:hidden' : ''}>
            <DealerInventoryBar />
          </div>
          {replie && (
            <div className="hidden lg:block">
              <CuvesRail inventory={inventory} onDeplier={basculerRepli} />
            </div>
          )}
        </div>

        {/* L'action principale, à demeure. C'est le geste que la centrale fait
            dix fois par jour ; il vivait derrière deux clics, sur l'écran des
            ravitaillements. Il est ici parce que DESIGN.md §3 demande que
            principale soit immédiatement lisible — sur TOUS les écrans, pas
            seulement celui qui la contient. */}
        <div className={`shrink-0 pt-3 ${replie ? 'px-3 lg:px-2' : 'px-3'}`}>
          <NavLink
            to="/dealer/requests/new"
            onClick={fermer}
            title={replie ? 'Nouveau ravitaillement' : undefined}
            aria-label={replie ? 'Nouveau ravitaillement' : undefined}
            className={`flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-center text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              replie ? 'px-3 lg:px-0' : 'px-3'
            }`}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2.25} />
            <span className={replie ? 'lg:hidden' : ''}>Nouveau ravitaillement</span>
          </NavLink>
        </div>

        <nav
          className={`flex-1 overflow-y-auto py-3 ${replie ? 'px-3 lg:px-2' : 'px-3'}`}
          aria-label="Navigation dealer"
          data-testid="dealer-nav"
        >
          {groupes.map(groupe => (
            <div key={groupe} className="mb-1">
              {/* Replié, l'intertitre passe en `sr-only` — il n'est pas
                  supprimé. Le groupe porte l'invariant des compteurs
                  (cf. `navigation.js`) ; le faire disparaître de l'arbre
                  d'accessibilité ferait perdre la structure de la navigation à
                  qui ne voit pas le rail, sans rien rendre au contenu. */}
              <p className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200 ${replie ? 'lg:sr-only' : ''}`}>
                {DEALER_GROUP_LABELS[groupe]}
              </p>
              <div className="grid gap-0.5">
                {dealerNavItemsOfGroup(groupe).map(item => (
                  <NavItem
                    key={item.path}
                    item={item}
                    badgeCount={compteurs[item.path] ?? 0}
                    onNavigate={fermer}
                    replie={replie}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Le compte — hors de la liste : ce n'est pas une destination sœur des
            autres. Se déconnecter n'est pas une suppression : pas de rouge. */}
        <div className={`shrink-0 border-t ${BRAND.sidebarBorder} py-3 ${replie ? 'px-3 lg:px-2' : 'px-3'}`}>
          <NavLink
            to={DEALER_ACCOUNT_ITEM.path}
            onClick={fermer}
            title={replie ? `${userProfile?.name || 'Dealer'} — ${DEALER_ACCOUNT_ITEM.name}` : undefined}
            aria-label={replie ? `${userProfile?.name || 'Dealer'} — ${DEALER_ACCOUNT_ITEM.name}` : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                replie ? 'px-2 lg:justify-center lg:px-0' : 'px-2'
              } ${isActive ? BRAND.navActive : BRAND.navIdle}`
            }
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {initiales(userProfile?.name)}
            </span>
            <span className={`min-w-0 flex-1 ${replie ? 'lg:hidden' : ''}`}>
              <span className="block truncate text-xs font-semibold text-white">
                {userProfile?.name || 'Dealer'}
              </span>
              <span className="block text-[10px] text-brand-200">{DEALER_ACCOUNT_ITEM.name}</span>
            </span>
          </NavLink>
          <button
            onClick={logout}
            title={replie ? 'Se déconnecter' : undefined}
            aria-label={replie ? 'Se déconnecter' : undefined}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/25 py-1.5 text-xs font-semibold text-brand-100 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              replie ? 'px-3 lg:px-0' : 'px-3'
            }`}
          >
            <LogOut className={`h-3.5 w-3.5 shrink-0 ${replie ? 'hidden lg:block' : 'hidden'}`} aria-hidden="true" strokeWidth={2} />
            <span className={replie ? 'lg:hidden' : ''}>Se déconnecter</span>
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
          {/* ⚠ CE COMPTEUR-CI N'EST PAS UN COMPTEUR DE RAVITAILLEMENTS.
              `totalEnAttente` additionne les ravitaillements ET les retours de
              boutiques ; le renommer « ravitaillements » avec le reste de S6
              aurait fabriqué un mensonge, et un mensonge qui ne s'entend QUE
              au lecteur d'écran, puisque le badge n'affiche qu'un chiffre.
              « opération » est le seul mot qui couvre les deux files.
              Même règle que la barre boutique — tc-119 [NAV-09c] : un compteur
              dit ce qu'il compte. */}
          <PendingBadge count={totalEnAttente} noun="opération" nounPluriel="opérations" testId="dealer-total-badge" />
        </button>
        {/* Les cuves restent lisibles sans ouvrir le menu. */}
        <CuvesResume inventory={inventory} />
      </header>

      {/* ── Contenu ────────────────────────────────────────────────────── */}
      {/* La marge du contenu suit la barre. Les dix rems rendus vont à la liste
          des caisses, dont les deux pistes se partagent la largeur restante. */}
      <div className={replie ? 'lg:pl-14' : 'lg:pl-56'}>
        <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DealerLayout
