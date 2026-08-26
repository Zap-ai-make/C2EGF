/**
 * dashboardTheme.js — Surfaces des cartes du tableau de bord.
 *
 * AVANT : six palettes décoratives (bleu, vert, orange, violet, émeraude,
 * gris). Les quatre cartes d'en-tête étaient de quatre couleurs différentes
 * sans qu'aucune ne veuille dire quoi que ce soit — un arc-en-ciel qui
 * contredisait la marque et n'aidait à rien.
 *
 * APRÈS : cinq surfaces, dont quatre PORTENT UN SENS.
 *
 *   brand    surface neutre de marque — le défaut. Une carte qui n'exprime
 *            pas une direction d'argent n'a pas à être colorée.
 *   inflow   dépôt : l'agent apporte des espèces, la liquidité entre.
 *   outflow  retrait : l'agent repart avec des espèces, la liquidité sort.
 *   warn     seuil bas, ravitaillement à demander.
 *   neutral  donnée secondaire, sans direction.
 *
 * `outflow` n'est PAS `danger`. Un retrait est un mouvement normal, pas une
 * erreur — c'est la distinction que les rouges de l'application confondaient.
 *
 * Les anciens noms restent acceptés et pointent tous sur `brand` : les
 * appelants continuent de fonctionner sans modification, et l'arc-en-ciel
 * disparaît. Le lot du tableau de bord leur assignera les vraies clés
 * sémantiques.
 *
 * Les champs `chart` / `chartAccent` sont des hex littéraux et non des
 * jetons CSS : Recharts les reçoit en attribut `fill`, depuis JavaScript, où
 * les variables CSS ne sont pas lisibles. Leurs valeurs suivent celles de
 * src/index.css et ne doivent pas en diverger.
 */

export const DASHBOARD_COLORS = {
  brand: {
    background: 'from-brand-50 to-white',
    border: 'border-brand-200',
    iconBg: 'bg-brand-100',
    iconColor: 'bg-brand-500',
    title: 'text-brand-600',
    accent: 'text-brand-500',
    chart: '#173863',
    chartAccent: '#2760a5',
  },
  inflow: {
    background: 'from-inflow-soft to-white',
    border: 'border-inflow/20',
    iconBg: 'bg-inflow-soft',
    iconColor: 'bg-inflow',
    title: 'text-inflow',
    accent: 'text-inflow',
    chart: '#0f7a52',
    chartAccent: '#0a5a3c',
  },
  outflow: {
    background: 'from-outflow-soft to-white',
    border: 'border-outflow/20',
    iconBg: 'bg-outflow-soft',
    iconColor: 'bg-outflow',
    title: 'text-outflow',
    accent: 'text-outflow',
    chart: '#8a3324',
    chartAccent: '#6b2619',
  },
  warn: {
    background: 'from-warn-soft to-white',
    border: 'border-warn/20',
    iconBg: 'bg-warn-soft',
    iconColor: 'bg-warn',
    title: 'text-warn',
    accent: 'text-warn',
    chart: '#8a5a00',
    chartAccent: '#6b4600',
  },
  neutral: {
    background: 'from-gray-50 to-white',
    border: 'border-gray-200',
    iconBg: 'bg-gray-100',
    iconColor: 'bg-gray-500',
    title: 'text-gray-800',
    accent: 'text-gray-600',
    chart: '#646f88',
    chartAccent: '#455368',
  },
}

/**
 * Anciens noms décoratifs, conservés le temps que le tableau de bord soit
 * refait. Ils pointent tous sur `brand` — c'est ce qui éteint l'arc-en-ciel
 * sans toucher un seul appelant.
 */
const LEGACY_ALIASES = {
  blue: 'brand',
  green: 'brand',
  orange: 'brand',
  purple: 'brand',
  emerald: 'brand',
  gray: 'neutral',
}

export const CHART_TEXT_COLORS = {
  primary: 'text-gray-700',
  secondary: 'text-gray-600',
  muted: 'text-gray-500',
}

export const getColorTheme = (colorName) =>
  DASHBOARD_COLORS[colorName] ??
  DASHBOARD_COLORS[LEGACY_ALIASES[colorName]] ??
  DASHBOARD_COLORS.neutral

// NOTE (ARCHITECTURE.md §2) : cette fonction est de la logique de calcul dans
// un fichier de configuration. À déplacer vers utils/ dans un lot dédié —
// pas dans un lot de couleur, qui ne doit changer que des classes.
export const calculatePercentage = (value, total) => {
  return total > 0 ? ((value / total) * 100).toFixed(1) : 0
}
