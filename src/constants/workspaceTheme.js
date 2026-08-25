/**
 * workspaceTheme.js — Jetons de design partagés des espaces Gérant & Dealer.
 *
 * Objectif : aligner ces back-offices sur l'identité visuelle de l'espace
 * Boutique tout en gardant leur sidebar. Source unique de vérité pour les
 * classes Tailwind, afin d'éviter la dispersion de couleurs codées en dur.
 *
 * Marque AKAYIS = vert (fixe, indépendant du thème configurable d'une boutique).
 * Accent de rôle discret pour se repérer : Gérant = bleu, Dealer = vert.
 */

// ── Marque AKAYIS (commune aux deux espaces) ────────────────────────────────
export const BRAND = {
  sidebar:       'bg-green-900',
  sidebarBorder: 'border-green-800',
  sidebarMuted:  'text-green-300',
  navActive:     'bg-green-700 text-white',
  navIdle:       'text-green-100 hover:bg-green-800/60 hover:text-white',
  wordmark:      'text-green-900',
}

// ── Accent par rôle (barre supérieure, labels de section, focus ring) ───────
export const ROLE_ACCENT = {
  admin:  {
    label:    'Administration',
    bar:      'bg-blue-500',
    section:  'text-blue-300',
    ring:     'focus-visible:ring-blue-400',
  },
  dealer: {
    label:    'Espace Dealer',
    bar:      'bg-green-500',
    section:  'text-green-300',
    ring:     'focus-visible:ring-green-400',
  },
}

export const getRoleAccent = (role) => ROLE_ACCENT[role] ?? ROLE_ACCENT.dealer

// ── Vocabulaire de surfaces (aligné boutique) ───────────────────────────────
export const CARD       = 'rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm'
export const TABLE_WRAP = 'overflow-x-auto rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm'
export const TABLE_HEAD = 'bg-green-50/70 text-green-900'   // en-tête tinté marque

// ── Boutons ─────────────────────────────────────────────────────────────────
export const BTN_PRIMARY =
  'rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 transition-colors'
export const BTN_SECOND =
  'rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 transition-colors'
