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

import { ClientsContext } from './context/ClientsContext.jsx'
import { TransactionsContext } from './context/transactions.jsx'
import { BandeauMarque } from './components/Layout.jsx'
import { THEMES } from './constants/themes.js'
import { STORE_NAV_ITEMS } from './constants/navigation.js'
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
      type: rang % 3 === 0 ? 'Retrait' : 'Depot',
      reseau: 'Orange',
      montant: 25000 + ((rang * 8117) % 900000),
      statut: 'Validee',
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
        <div className="hidden flex-1 md:flex">
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

function CarteSolde({ nom, libelle, montant, teinte }) {
  return (
    <div className="flex min-h-[68px] items-center justify-between gap-4 rounded-lg bg-white/95 px-4 py-3 shadow-sm ring-1 ring-white/10">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: teinte }} />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-ink">{nom}</h3>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {libelle}
          </p>
        </div>
      </div>
      <p className="shrink-0 text-2xl font-black leading-none tabular-nums text-ink">
        {new Intl.NumberFormat('fr-FR').format(montant)}
      </p>
    </div>
  )
}

function SoldesDoublure() {
  return (
    <section aria-label="Soldes opérationnels" className="border-b border-brand-400/30 bg-brand-600">
      <div className="flex w-full flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        <span className="shrink-0 text-center text-xs font-semibold uppercase tracking-[0.2em] text-brand-200 md:text-left">
          Soldes
        </span>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:max-w-3xl">
          <CarteSolde nom="Orange" libelle="Stock" montant={balance.stock} teinte="#ff6b35" />
          <CarteSolde nom="Liquidité" libelle="Espèces" montant={balance.liquidite} teinte="#173863" />
        </div>
      </div>
    </section>
  )
}

// ── Rendu ───────────────────────────────────────────────────────────────────

function Preview() {
  return (
    <ClientsContext.Provider value={{ clients: agents, loading: false }}>
      <TransactionsContext.Provider
        value={{ pendingTransactions: [], completedTransactions: operations }}
      >
      <div className="min-h-screen bg-canvas">
        <BandeauMarque />

        <div className="sticky top-0 z-50 shadow-lg shadow-brand-600/20">
          <NavDoublure />
          <SoldesDoublure />
        </div>

        <div className="w-full space-y-6 px-4 py-6">
          <div className="border-b-2 border-line pb-4">
            <h1 className="text-3xl font-bold text-ink">Tableau de bord</h1>
          </div>

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
        </div>
      </div>
      </TransactionsContext.Provider>
    </ClientsContext.Provider>
  )
}

createRoot(document.getElementById('preview')).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
