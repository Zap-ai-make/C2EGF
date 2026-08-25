/**
 * branding.js — marque affichée, dérivée du profil client actif.
 * ─────────────────────────────────────────────────────────────────────────────
 * Source unique de vérité pour le nom du produit dans l'UI (wordmark, titre
 * d'onglet, PWA). Un nouveau client ne touche QUE `branding` dans son profil
 * (config/clients/<id>.js) — aucun fichier front à éditer à la main.
 *
 * Défauts = marque historique « AKAYIS » : un profil sans `branding` (ou un build
 * mal configuré retombant sur le pilote) reste identique au comportement actuel.
 * Le build-time (titre index.html, manifest PWA) dérive de la même donnée via
 * vite.config.js (résolue depuis VITE_CLIENT_ID).
 */

import { activeProfile } from '../config/activeClientProfile.js'

const branding = activeProfile.branding ?? {}

// Nom court affiché en wordmark (headers Boutique / Gérant / Dealer, sidebar auth).
export const APP_NAME = branding.appName ?? 'AKAYIS'

// Nom complet (titre de l'onglet navigateur, nom PWA installée).
export const APP_FULL_NAME = branding.pwaName ?? 'AKAYIS CRM'

// Thème de marque déclaré par le profil (réservé — le rendu couleur reste piloté
// par le système de thème existant). Exposé pour un usage futur cohérent.
export const BRAND_THEME = branding.theme ?? 'green'
