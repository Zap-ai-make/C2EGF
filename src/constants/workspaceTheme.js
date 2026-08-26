/**
 * workspaceTheme.js — Jetons de design partagés des espaces Gérant & Dealer.
 *
 * Ces back-offices gardent leur barre latérale ; seule la couleur change ici.
 *
 * Ils étaient en VERT AKAYIS — la marque d'un autre client, restée dans le
 * produit après l'instanciation pour C2EGF. Tout passe au bleu C2EGF : une
 * seule marque dans toute l'application.
 *
 * Les trois espaces ne se distinguent plus par la couleur mais par leur
 * STRUCTURE — barre latérale ici, navigation haute dans la boutique — et par
 * leur libellé. C'est aussi pourquoi ROLE_ACCENT ne porte plus de teinte
 * propre à chaque rôle : « Administration » et « Espace Dealer » sont déjà
 * écrits en toutes lettres, et les entrées de navigation diffèrent. Un bleu
 * pour l'un et un vert pour l'autre, c'était deux identités dans un même
 * produit pour une information déjà donnée par le texte.
 *
 * Toutes les valeurs viennent des jetons de src/index.css. Contrastes
 * vérifiés : nav au repos 11,84:1, libellé de section 9,64:1, nav actif
 * 6,36:1, bouton primaire 11,78:1 — tous ≥ AA texte normal.
 */

// ── Marque C2EGF (commune aux deux espaces) ─────────────────────────────────
export const BRAND = {
  sidebar:       'bg-brand-600',
  sidebarBorder: 'border-brand-500',
  sidebarMuted:  'text-brand-200',
  navActive:     'bg-brand-400 text-white',
  navIdle:       'text-brand-100 hover:bg-brand-500/60 hover:text-white',
  wordmark:      'text-brand-500',
}

// ── Accent par rôle (barre supérieure, libellés de section, anneau de focus) ─
// Même accent pour les deux : le rôle se lit dans `label` et dans la
// navigation, pas dans la teinte.
const ACCENT = {
  bar:     'bg-brand-400',
  section: 'text-brand-200',
  ring:    'focus-visible:ring-brand-400',
}

export const ROLE_ACCENT = {
  admin:  { label: 'Administration', ...ACCENT },
  dealer: { label: 'Espace Dealer',  ...ACCENT },
}

export const getRoleAccent = (role) => ROLE_ACCENT[role] ?? ROLE_ACCENT.dealer

// ── Vocabulaire de surfaces (aligné boutique) ───────────────────────────────
export const CARD       = 'rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm'
export const TABLE_WRAP = 'overflow-x-auto rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm'
export const TABLE_HEAD = 'bg-brand-100/70 text-brand-600'   // en-tête tinté marque

// ── Boutons ─────────────────────────────────────────────────────────────────
export const BTN_PRIMARY =
  'rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 transition-colors'
export const BTN_SECOND =
  'rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 transition-colors'
