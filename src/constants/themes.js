import { getStorageKey } from '../config/clientIsolation'
import { BRAND_THEME } from './branding.js'

/**
 * THEMES — les palettes que CETTE instance embarque.
 *
 * Il y en avait sept, puis six : `custom` est parti au lot des jetons (il
 * fabriquait `bg-[${couleur}]` à l'exécution, chaîne que l'extracteur Tailwind
 * ne peut par nature jamais lire), et `blue`, `light`, `dark`, `green`,
 * `purple` partent ici.
 *
 * Pourquoi maintenant, alors qu'ils étaient conservés au lot précédent : il
 * n'existe aucun sélecteur de thème dans l'application. Ces cinq entrées
 * n'étaient atteignables qu'en éditant `localStorage` à la main. Elles
 * portaient du vert, du violet et du bleu qui échapperaient à la règle ESLint
 * anti-arc-en-ciel prévue en fin de campagne — cinq palettes hors marque
 * qu'aucun écran ne pouvait afficher, mais que tout audit de couleur aurait
 * continué de compter.
 *
 * Ce qui NE change pas : `branding.theme` reste l'axe de variation client
 * d'AGENTS.md, et `ThemeContext` reste la seule façon de lire ces classes. Un
 * futur client n'édite aucun composant — il ajoute SON entrée ici et la nomme
 * dans son profil.
 *
 * Conséquence assumée : `config/clients/_pilot.js` et
 * `config/clients/taofic-ajagbe.js` déclarent encore `theme: 'green'`, thème
 * qui n'existe plus. Ces deux profils ne se construisent pas dans ce dépôt —
 * il est l'INSTANCE C2EGF, bâtie sur `c2egf_burkina` (VITE_CLIENT_ID). S'ils
 * étaient construits ici, ils ouvriraient sur la palette C2EGF au lieu de
 * planter : c'est le repli de DEFAULT_THEME ci-dessous, et il est délibéré —
 * une marque au mauvais bleu se voit et se corrige, une application sans
 * classes ne s'affiche pas.
 */
export const THEMES = {
  // Palette de marque C2EGF, tirée des jetons de src/index.css.
  //
  // Ces classes étaient écrites en valeurs arbitraires — bg-[#173863] et
  // consorts — avec un commentaire expliquant qu'on ne pouvait pas faire
  // autrement, l'extracteur Tailwind ne lisant jamais une chaîne calculée.
  // C'était vrai sans jetons. Avec le bloc @theme, `bg-brand-500` produit
  // exactement la même couleur, et le bleu de marque n'a plus qu'un seul
  // endroit où être défini.
  c2egf: {
    id: 'c2egf',
    name: 'Thème C2EGF',
    classes: {
      background: 'bg-canvas',
      text: 'text-ink',
      accent: 'bg-brand-500',
      navbar: 'bg-brand-500/95 backdrop-blur-sm',
      tableHeader: 'bg-brand-100/80 border-brand-200',
      tableBorder: 'border-brand-200',
      tableAccent: 'bg-brand-50/60'
    }
  }
}

// Thème d'ouverture, DÉRIVÉ du profil client (branding.theme) — même source de
// vérité que le nom du produit. Le repli était 'dark', défaut historique du
// produit ; ce thème n'existe plus, et le repli devient le seul thème embarqué.
// Le choix explicite de l'utilisateur, persisté en localStorage, reste
// prioritaire (voir ThemeContext) : ceci ne fixe que le premier chargement.
export const DEFAULT_THEME = THEMES[BRAND_THEME] ? BRAND_THEME : 'c2egf'

export const STORAGE_KEY = getStorageKey('theme')
