/**
 * Profil CLIENT — C2EGF BURKINA.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hérite du pilote (opt-out) puis restreint ce que C2EGF n'utilise pas.
 * Aucun fichier front n'est édité pour ce client : le profil est la seule
 * source de variation (front, firestore.rules générées, functions).
 *
 * `firebaseProject` = id réel du projet Firebase (tiret), distinct de `id` qui est
 * l'identifiant client normalisé (souligné). Les deux diffèrent volontairement.
 * Ce projet est aussi référencé dans les garde-fous des scripts admin
 * (scripts/lib/assertFirebaseProject.mjs, scripts/lib/assertResetProject.mjs).
 */

import { pilotProfile } from './_pilot.js'

export const c2egfProfile = Object.freeze({
  ...pilotProfile,

  // ── Identité ────────────────────────────────────────────────────────────────
  // id = identifiant client NORMALISÉ (= VITE_CLIENT_ID normalisé, souligné) ;
  // firebaseProject = id réel du projet Firebase (tiret), à créer côté client.
  id: 'c2egf_burkina',
  label: 'C2EGF BURKINA',
  firebaseProject: 'c2egf-b0b5a', // projet Firebase du client

  // ── Marque ─────────────────────────────────────────────────────────────────
  // appName  = wordmark dans l'UI ; pwaName = titre d'onglet + nom PWA installée.
  // theme    = thème de marque (bleu/blanc), voir THEMES.blue dans
  //            src/constants/themes.js.
  branding: Object.freeze({
    appName: 'C2EGF',
    pwaName: 'C2EGF',
    theme: 'c2egf',
  }),

  // ── Réseaux boutique : 1 seul (Orange) ─────────────────────────────────────
  networks: Object.freeze({
    enabled: ['Orange'],
  }),

  // ── Transactions ───────────────────────────────────────────────────────────
  // types : PAS de Crédit (décision client). La logique de crédit reste dans le
  //   produit — statut « Remboursé par X », paiements partiels, remboursements,
  //   annulations — mais n'est pas proposée à C2EGF. La réactiver = ajouter
  //   'Crédit' ici, rien d'autre.
  // paymentMethods : les 2 méthodes du client. Cohérent avec un unique réseau
  //   actif — un règlement impacte le réseau de SA méthode de paiement
  //   (applySettlementImpact) : autoriser « Moov Money » alors que Moov n'est pas
  //   dans networks.enabled créditerait un solde sans carte réseau correspondante.
  transactions: Object.freeze({
    types: ['Dépôt', 'Retrait'],
    paymentMethods: ['Orange Money', 'Cash'],
  }),

  // ── Édition directe des soldes réseau par la boutique ──────────────────────
  // false = affordance masquée dans l'UI. Option la moins exposante entre les
  // deux (SECURITY.md §0) : l'édition directe est une exception V1 sans piste
  // d'audit serveur. À rebasculer à true si C2EGF exige la saisie directe.
  cashier: Object.freeze({
    canEditBalances: false,
  }),

  // ── Dealer : présent, mono-réseau (Orange) ─────────────────────────────────
  dealer: Object.freeze({
    enabled: true,
    networks: ['Orange'],
  }),

  // regional : hérité du pilote (Africa/Ouagadougou) — C2EGF est au Burkina Faso.
})

export default c2egfProfile
