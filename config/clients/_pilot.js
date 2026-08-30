/**
 * Profil PILOTE — le produit standard « AKAYIS CRM » (référence).
 * ─────────────────────────────────────────────────────────────────────────────
 * Politique : OPT-OUT. Ici, TOUT est activé (superset complet). Un client réel
 * hérite de ce profil et DÉSACTIVE ce qu'il n'utilise pas (voir taofic-ajagbe.js).
 *
 * Ce fichier ne contient AUCUNE logique — uniquement des drapeaux déclaratifs.
 * Les 3 couches en dérivent (une seule source de vérité) :
 *   • Front     : listes de réseaux / types / méthodes, affordances UI.
 *   • Règles    : firestore.rules GÉNÉRÉ depuis le profil (enforcement strict).
 *   • Functions : réseaux dealer valides, etc.
 *
 * Convention : ne jamais lire une variation ailleurs qu'ici. Ajouter un axe =
 * ajouter un champ nommé + commenté dans ce profil, défaut « le plus riche ».
 *
 * ⚠ Phase 0 : ce module n'est encore IMPORTÉ nulle part. Le câblage des 3 couches
 * se fait aux phases suivantes, chacune prouvée sans régression pour les clients.
 */

// Ensemble figé des réseaux supportés par le produit (ordre = ordre d'affichage).
export const RESEAUX_SUPPORTES = ['Orange', 'Moov', 'Telecel', 'Coris', 'Sank']

// Les 6 méthodes de règlement supportées (les callables serveur les acceptent déjà toutes).
export const METHODES_PAIEMENT_SUPPORTEES = [
  'Orange Money', 'Moov Money', 'Telecel Money', 'Coris Money', 'Sank Money', 'Cash',
]

export const pilotProfile = Object.freeze({
  // ── Identité (pour le registre + le script de déploiement) ─────────────────
  id: '_pilot',
  label: 'Pilote (standard)',
  firebaseProject: null,          // le pilote ne se déploie pas tel quel

  // ── Marque ─────────────────────────────────────────────────────────────────
  branding: Object.freeze({
    appName: 'AKAYIS',
    pwaName: 'AKAYIS CRM',
    theme: 'green',
  }),

  // ── Réseaux boutique (cartes réseau + choix dans le formulaire) ────────────
  // Superset = les 5 réseaux. Un client mono-réseau met p. ex. ['Orange'].
  networks: Object.freeze({
    enabled: [...RESEAUX_SUPPORTES],
  }),

  // ── Transactions ───────────────────────────────────────────────────────────
  transactions: Object.freeze({
    types: ['Dépôt', 'Retrait', 'Crédit'],                  // Crédit inclus
    paymentMethods: [...METHODES_PAIEMENT_SUPPORTEES],       // les 6 méthodes
  }),

  // ── Édition directe des soldes réseau par la boutique (caissière) ──────────
  // true  = la boutique saisit ses soldes en direct (règle Firestore permissive,
  //         exception V1 assumée, sans piste d'audit serveur).
  // false = soldes pilotés UNIQUEMENT côté serveur.
  //   ⚠ Dépendance : passer à false avec enforcement strict impose de router les
  //   écritures de solde (y compris celles des flux de transaction) via des
  //   callables auditées — une règle Firestore ne distingue pas le chemin de code.
  //   Voir docs/client-profiles.md (« Dépendance canEditBalances »).
  cashier: Object.freeze({
    canEditBalances: true,
  }),

  // ── Circuit dealer (ravitaillement stock/liquidité) ────────────────────────
  // enabled=false → pas d'espace dealer du tout.
  // networks     → réseaux qu'UN dealer approvisionne (multi-réseaux supporté).
  //   Invariant produit conservé : un seul dealer actif dans tout le système.
  // seuilBas → montant EN FCFA sous lequel une caisse est signalée comme basse,
  //   dans l'inventaire du dealer comme dans celui des boutiques qu'il alimente.
  //   UN SEUL seuil pour tout le réseau : c'est la décision prise au cadrage de
  //   la refonte dealer. Un seuil par boutique serait plus juste (Ouaga ne
  //   tourne pas comme Niaogho) mais demande un champ sur chaque fiche — il
  //   deviendra un axe à part le jour où le besoin sera avéré.
  //   ⚠ Il remplace les constantes 10000 / 25000 qui vivaient en dur dans
  //   NetworkCard.jsx : un seuil est une donnée client, pas une valeur magique.
  dealer: Object.freeze({
    enabled: true,
    networks: [...RESEAUX_SUPPORTES],
    seuilBas: 500000,
  }),

  // ── Collaborations inter-boutiques et dettes internes ─────────────────────
  // Une boutique à court de stock fait exécuter l'opération Mobile Money par une
  // consœur qui en a ; la contrepartie devient une dette interne, réglée en
  // tranches ou compensée contre la dette opposée.
  //   ⚠ Le besoin naît du STOCK, pas de la SIM : la fonctionnalité est donc
  //   INDÉPENDANTE du nombre de réseaux. Un client mono-réseau en a autant besoin
  //   qu'un multi-réseaux — d'où ce drapeau explicite plutôt qu'une déduction
  //   depuis networks.enabled.length.
  // enabled=false → aucune trace du module : ni menu, ni onglet, ni abonnement,
  //   et les callables serveur refusent (COLLABORATIONS_DISABLED).
  collaborations: Object.freeze({
    enabled: true,
  }),

  // ── Régional ────────────────────────────────────────────────────────────────
  // Fuseau horaire de référence pour l'affichage/formatage des dates : fixe le
  // rendu quel que soit le fuseau du navigateur de l'utilisateur.
  regional: Object.freeze({
    timezone: 'Africa/Ouagadougou',   // Burkina Faso (UTC+0)
  }),
})

export default pilotProfile
