/**
 * Banc d'essai visuel — DÉVELOPPEMENT UNIQUEMENT.
 *
 * Sert à regarder le rendu réel des blocs du tableau de bord avec des données
 * plausibles, ce que ni jsdom ni un Firestore vide ne permettent. Ouvert à
 * l'adresse /preview.html en `npm run dev`, capturé par Playwright.
 *
 * Ce fichier n'est PAS dans le bundle de production : `preview.html` n'est pas
 * déclaré comme entrée de build dans vite.config.js, et rien dans l'application
 * ne l'importe.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Signal, Wallet } from 'lucide-react'

import { ClientsContext } from './context/ClientsContext.jsx'
import { TransactionsContext } from './context/transactions.jsx'
import { AuthContext } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import BandeauMarque from './components/BandeauMarque.jsx'
import { THEMES } from './constants/themes.js'
import { STORE_NAV_ITEMS } from './constants/navigation.js'
import { getTransactionStyles } from './utils/helpers.js'
import PageHeader from './components/ui/PageHeader.jsx'
import ClientsTable from './components/ClientsTable.jsx'
import HistoriqueTable from './components/historique/HistoriqueTable.jsx'
import StoreAdminDealerRequests from './pages/store/StoreAdminDealerRequests.jsx'
import AuthPage from './components/auth/AuthPage.jsx'
import DealerLayout from './layouts/DealerLayout.jsx'
import DealerDashboard from './pages/dealer/DealerDashboard.jsx'
import DealerRequests from './pages/dealer/DealerRequests.jsx'
import DealerTransfers from './pages/dealer/DealerTransfers.jsx'
import DealerHistory from './pages/dealer/DealerHistory.jsx'
import Balance from './components/dashboard/Balance.jsx'
import ReseauCards from './components/dashboard/ReseauCards.jsx'
import FluxChart from './components/dashboard/FluxChart.jsx'
import Commerciaux from './components/dashboard/Commerciaux.jsx'
import LastClientsTable from './components/dashboard/LastClientsTable.jsx'

// ── Données plausibles ──────────────────────────────────────────────────────

const COMMERCIAUX = ['OUEDRAOGO S.', 'KABORE J.', 'SAWADOGO A.', 'TAPSOBA M.', 'ZONGO P.']
const LOCALITES = ['Ouagadougou', 'Pouytenga', 'Koupela', 'Bobo-Dioulasso', 'Kaya']
const NOMS = ['BANABA', 'TAPSOBA', 'SOUDRE', 'KABORE', 'DIALLO', 'SANA', 'OUEDRAOGO', 'ZONGO']
const PRENOMS = ['Guafarou', 'Sarifatou', 'Assiata', 'Hamado', 'Ali', 'Fatimata', 'Issa', 'Salam']

const agents = Array.from({ length: 187 }, (_, i) => ({
  id: `a-${i}`,
  nom: NOMS[i % NOMS.length],
  prenom: PRENOMS[i % PRENOMS.length],
  orange: String(45441020 + i * 137),
  numeroPersonnel: String(76965827 + i * 91),
  localite: LOCALITES[i % LOCALITES.length],
  agentCommercial: COMMERCIAUX[i % COMMERCIAUX.length],
  registeredStoreName: 'C2EGF OUAGA',
  dateAjout: `${String((i % 28) + 1).padStart(2, '0')}/08/2026 09:30`,
}))

const jour = (decalage) => {
  const d = new Date()
  d.setDate(d.getDate() - decalage)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

const flux = Array.from({ length: 14 }, (_, i) => {
  const rang = 13 - i
  const base = 2_400_000 + Math.round(Math.sin(i * 0.9) * 1_100_000)
  const depots = Math.max(0, base + (i % 3) * 380_000)
  const retraits = Math.max(0, Math.round(base * 0.72) + (i % 4) * 210_000)
  return {
    cle: `j-${i}`,
    libelle: jour(rang),
    depots,
    retraits,
    retraitsNegatifs: -retraits,
  }
})

const balance = {
  reseau: 'Orange',
  stock: 140_631_529,
  liquidite: 341_515_014,
  fondsRoulement: 482_146_543,
  partStock: 140_631_529 / 482_146_543,
  versLiquidite: 3_120_000,
  versStock: 780_000,
  deriveNette: 2_340_000,
}

const projection = {
  vase: 'stock',
  soldeRestant: balance.stock,
  tauxParHeure: 900_000,
  heuresRestantes: 4.4,
  rupture: (() => {
    const d = new Date()
    d.setHours(14, 30, 0, 0)
    return d
  })(),
  dansLaJournee: true,
  operations: 41,
}

const couverture = {
  totalAgents: 1184,
  actifs: 187,
  part: 187 / 1184,
  visites: 785,
  passagesParAgent: 4.2,
  fenetreJours: 7,
}

const decrochages = {
  seuilJours: 15,
  total: 23,
  decroches: agents.slice(0, 6).map((agent, i) => ({
    agent,
    dernierPassage: new Date(),
    joursDeSilence: 42 - i * 5,
  })),
}

const concentration = {
  topN: 10,
  fenetreJours: 30,
  volumeTotal: 118_400_000,
  agentsComptes: 142,
  partTete: 0.58,
  tete: agents.slice(0, 5).map((a, i) => ({
    cle: a.id,
    nom: `${a.prenom} ${a.nom}`,
    volume: 18_200_000 - i * 2_600_000,
  })),
}

const dateFr = (decalage, heure) => {
  const d = new Date()
  d.setDate(d.getDate() - decalage)
  const jj = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${jj}/${mm}/${d.getFullYear()} ${heure}`
}

// Les gros agents passent 4 a 5 fois par jour : on reproduit cette cadence.
const operations = []
let compteur = 0
for (let jourEcoule = 0; jourEcoule < 30; jourEcoule++) {
  for (let rang = 0; rang < 120; rang++) {
    const agent = agents[(rang * 7 + jourEcoule) % agents.length]
    const heure = String(7 + (rang % 11)).padStart(2, '0') + ':' + String((rang * 13) % 60).padStart(2, '0')
    operations.push({
      id: 'op-' + compteur++,
      clientId: agent.id,
      client: agent,
      type: rang % 3 === 0 ? 'Retrait' : 'Dépôt',
      reseau: 'Orange',
      montant: 25000 + ((rang * 8117) % 900000),
      statut: 'Validée',
      date: dateFr(jourEcoule, heure),
    })
  }
}

// ── Doublures du shell ──────────────────────────────────────────────────────
//
// NavBar et NetworkCardsDrawer dépendent d'Auth, du routeur et de Firestore :
// impossible de les monter hors application. Ce qu'on regarde ici est
// l'EMPILEMENT — proportions du bandeau, tonalités des trois bandes marine.
// Les classes sont recopiées des vrais composants ; toute divergence entre
// cette doublure et eux se verrait à la capture suivante, pas ici.

const NAVBAR = THEMES.c2egf.classes.navbar

function NavDoublure() {
  return (
    <nav className={`${NAVBAR} w-full`}>
      <div className="flex w-full items-center gap-4 px-4">
        <div className="hidden flex-1 justify-center md:flex">
          {STORE_NAV_ITEMS.map((item, i) => (
            <span
              key={item.path}
              className={`inline-flex items-center px-4 py-3 font-medium text-white ${
                i === 0 ? 'border-b-2 border-white/50 bg-black/30' : ''
              }`}
            >
              {item.name}
            </span>
          ))}
        </div>
      </div>
    </nav>
  )
}

function CarteSolde({ nom, libelle, montant, teinte, icone }) {
  // Le lint de ce dépôt ne suit pas les usages en JSX (pas d'eslint-plugin-react) :
  // il se repose sur `varsIgnorePattern: '^[A-Z_]'`, qui ne couvre que les
  // VARIABLES. Un composant reçu en prop et rendu uniquement en JSX doit donc
  // passer par une variable capitalisée, sinon il est signalé comme inutilisé.
  const Icone = icone

  return (
    <div
      className="relative flex min-h-[76px] items-center gap-3.5 overflow-hidden rounded-xl bg-surface py-3 pl-5 pr-4 shadow-lg shadow-brand-600/25 ring-1 ring-white/10"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: teinte }} />
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: `${teinte}1f` }}
      >
        <Icone className="h-5 w-5" strokeWidth={2} style={{ color: teinte }} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold leading-tight text-ink">{nom}</h3>
        <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {libelle}
        </p>
      </div>
      <div className="flex shrink-0 items-baseline gap-2">
        <p className="text-[1.75rem] font-black leading-none tabular-nums text-ink">
          {new Intl.NumberFormat('fr-FR').format(montant)}
        </p>
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">FCFA</span>
      </div>
    </div>
  )
}

function SoldesDoublure() {
  return (
    <section aria-label="Soldes opérationnels" className="border-b border-brand-400/30 bg-brand-600">
      <div className="flex w-full flex-col items-center gap-3 px-4 py-3.5 md:flex-row md:justify-center md:gap-5">
        <span className="shrink-0 text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-200">
          Soldes
        </span>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:w-auto md:min-w-[42rem] md:max-w-4xl">
          <CarteSolde nom="Orange" libelle="Stock" montant={balance.stock} teinte="#ff6b35" icone={Signal} />
          <CarteSolde nom="Liquidité" libelle="Espèces" montant={balance.liquidite} teinte="#38a169" icone={Wallet} />
        </div>
      </div>
    </section>
  )
}

// ── Rendu ───────────────────────────────────────────────────────────────────

function Preview() {
  return (
    <MemoryRouter>
    <ThemeProvider>
    <AuthContext.Provider
      value={{
        activeStore: { id: 'store-ouaga', name: 'C2EGF OUAGA' },
        currentUser: { uid: 'banc-essai' },
        userProfile: { role: 'store_admin', storeId: 'store-ouaga', name: 'Gérant OUAGA' },
      }}
    >
    <ClientsContext.Provider value={{ clients: agents, loading: false }}>
      <TransactionsContext.Provider
        value={{
          pendingTransactions: [],
          completedTransactions: operations,
          getTransactionStyles,
        }}
      >
      <div className="min-h-screen bg-canvas">
        <BandeauMarque />

        <div className="sticky top-0 z-50 shadow-lg shadow-brand-600/20">
          <NavDoublure />
          <SoldesDoublure />
        </div>

        <div className="w-full space-y-6 px-4 py-6">
          <PageHeader title="Tableau de bord" />

          <Balance balance={balance} projection={projection} />

          <ReseauCards
            couverture={couverture}
            decrochages={decrochages}
            concentration={concentration}
            onSeuilChange={() => {}}
          />

          <FluxChart flux={flux} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Commerciaux />
            <LastClientsTable clients={agents} />
          </div>

          {/* ── Les écrans de travail ──────────────────────────────────────
              Vrais composants, pas des doublures : ClientsTable et
              HistoriqueTable se montent hors application dès qu'on leur donne
              un thème, une boutique active et un routeur. C'est là que se
              regarde le travail du lot — le damier vert remplacé par des
              filets, les montants alignés, et le comportement à 390 px. */}

          <PageHeader title="Liste des clients" />
          <ClientsTable clients={agents} onEdit={() => {}} onImportClients={() => {}} />

          <PageHeader title="Liste des clients — aucun enregistré" />
          <ClientsTable
            clients={[]}
            onEdit={() => {}}
            onImportClients={() => {}}
            emptyAction={
              <span className="rounded bg-brand-500 px-4 py-2 text-sm font-medium text-white">
                Enregistrer un client
              </span>
            }
          />

          <PageHeader title="Historique" />
          <div className="rounded-lg bg-surface p-6 shadow-md">
            <HistoriqueTable transactions={operations.slice(0, 40)} />
          </div>

          <PageHeader title="Historique — aucune opération" />
          <div className="rounded-lg bg-surface p-6 shadow-md">
            <HistoriqueTable transactions={[]} />
          </div>

          {/* Septième destination de la boutique. L'écran RÉEL — pas une
              maquette : le banc substitue seulement son accès aux données
              (scripts/lib/banc.mjs). */}
          <StoreAdminDealerRequests />

          {/* L'écran d'authentification — le premier que voit un utilisateur,
              et le dernier qu'on regardait. Son `min-h-screen` est neutralisé
              ici pour qu'il tienne dans la colonne du banc ; c'est la seule
              chose que le banc lui impose. */}
          <PageHeader title="Authentification" />
          <div data-testid="apercu-auth" className="overflow-hidden rounded-lg border border-line [&_.min-h-screen]:min-h-0">
            <AuthPage />
          </div>
        </div>
      </div>
      </TransactionsContext.Provider>
    </ClientsContext.Provider>
    </AuthContext.Provider>
    </ThemeProvider>
    </MemoryRouter>
  )
}


/**
 * LE POSTE DEALER — page à part du banc, atteinte par `preview.html?espace=dealer`.
 *
 * Pourquoi une page séparée plutôt qu'une section de plus dans la colonne de la
 * boutique : la barre latérale du poste est en `position: fixed`. Posée dans la
 * colonne, elle en sortirait et se superposerait à tout ce qui la suit — et la
 * sonde de débordement mesurerait alors un empilement qui n'existe nulle part
 * dans l'application.
 *
 * Le shell est le VRAI composant. Seul l'accès aux données est doublé
 * (`src/preview-doubles/`, alias posé par `scripts/lib/banc.mjs`) : ce qu'on
 * regarde ici est ce qui est livré.
 *
 * Variantes d'adresse — elles se combinent :
 *   ?espace=dealer                       le poste et l'accueil, 84 boutiques
 *   &cuves=basses|vides                  l'état des CUVES du dealer
 *   &caisses=vide|erreur|erreur-partielle|clairseme   l'état du RÉSEAU
 *   &position=neufs|anomalie             l'état du RAPPROCHEMENT
 *   &ecran=ravitaillements|retours|historique   l'écran monté (défaut : accueil)
 *   &file=vide                           les files, sans rien à traiter
 *
 * Trois axes séparés parce que ce sont trois sources distinctes — l'inventaire
 * du dealer, la liste des boutiques, les compteurs de flux — et qu'un défaut
 * de dessin se loge presque toujours dans une COMBINAISON : cuves vides et
 * réseau à sec, par exemple, est l'écran le moins souvent regardé.
 */
/**
 * L'écran monté dans le poste, choisi par `?ecran=`. Un seul à la fois : la
 * barre latérale est en `position: fixed`, et empiler deux écrans sous elle
 * mesurerait un débordement qui n'existe nulle part.
 */
const ECRANS = {
  accueil: DealerDashboard,
  ravitaillements: DealerRequests,
  retours: DealerTransfers,
  historique: DealerHistory,
}

function EcranDealer() {
  const nom = new URLSearchParams(globalThis.location?.search ?? '').get('ecran') ?? 'accueil'
  const Ecran = ECRANS[nom] ?? DealerDashboard
  return <Ecran />
}

function PosteDealer() {
  return (
    <MemoryRouter>
      <AuthContext.Provider
        value={{
          currentUser: { uid: 'banc-dealer' },
          userProfile: { role: 'dealer', active: true, name: 'Ousmane Sawadogo', email: 'ousmane@c2egf.bf' },
          logout: () => {},
        }}
      >
        <Routes>
          <Route element={<DealerLayout />}>
            <Route path="*" element={<EcranDealer />} />
          </Route>
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

const espace = new URLSearchParams(globalThis.location?.search ?? '').get('espace')

createRoot(document.getElementById('preview')).render(
  <StrictMode>
    {espace === 'dealer' ? <PosteDealer /> : <Preview />}
  </StrictMode>,
)
