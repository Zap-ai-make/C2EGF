/**
 * Profil CLIENT — TAOFIC AJAGBE (production actuelle).
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ IMPORTANT : ce profil doit reproduire EXACTEMENT le comportement déployé
 * aujourd'hui. Toute modification ici change le runtime d'un client EN PRODUCTION.
 * Les valeurs ci-dessous sont l'état actuel constaté (cf. docs/adaptation-nouveau-client.md).
 *
 * Hérite du pilote (opt-out) puis désactive/restreint ce que TAOFIC n'utilise pas.
 */

import { pilotProfile } from './_pilot.js'

export const taoficProfile = Object.freeze({
  ...pilotProfile,

  // ── Identité ────────────────────────────────────────────────────────────────
  // id = identifiant client NORMALISÉ (= VITE_CLIENT_ID normalisé, souligné) ;
  // firebaseProject = id réel du projet Firebase (tiret). Les deux diffèrent volontairement.
  id: 'taofic_ajagbe',
  label: 'TAOFIC AJAGBE',
  firebaseProject: 'taofic-ajagbe',

  // ── Marque (inchangée pour ce client) ──────────────────────────────────────
  branding: Object.freeze({
    appName: 'AKAYIS',
    pwaName: 'AKAYIS CRM',
    theme: 'green',
  }),

  // ── Réseaux boutique : 1 seul (Orange) ─────────────────────────────────────
  networks: Object.freeze({
    enabled: ['Orange'],
  }),

  // ── Transactions : pas de Crédit, 2 méthodes de règlement ──────────────────
  transactions: Object.freeze({
    types: ['Dépôt', 'Retrait'],
    paymentMethods: ['Orange Money', 'Cash'],
  }),

  // ── Édition des soldes par la boutique : fonctionnalité DÉSACTIVÉE ──────────
  // État actuel de TAOFIC : l'affordance est MASQUÉE dans l'UI (la logique et les
  // règles Firestore restent permissives — legacy V1, non encore durci).
  //   → Phase 1 : le flag pilote le masquage UI (identique à aujourd'hui).
  //   → Phase 3 : enforcement serveur strict (migration des écritures de solde
  //     vers callables) — changement serveur délibéré, hors « extraire sans changer ».
  cashier: Object.freeze({
    canEditBalances: false,
  }),

  // ── Dealer : présent mais mono-réseau (Orange) ─────────────────────────────
  dealer: Object.freeze({
    enabled: true,
    networks: ['Orange'],
  }),

  // regional : hérité du pilote (Africa/Ouagadougou) — même fuseau pour TAOFIC.
})

export default taoficProfile
