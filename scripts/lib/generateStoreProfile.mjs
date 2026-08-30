/**
 * generateStoreProfile.mjs — génère le contenu de functions/src/config/storeProfile.js
 * depuis un profil client. PUR (aucune I/O) → testable et réutilisé par le CLI
 * scripts/generate-functions-config.mjs.
 *
 * Pendant « boutique » de generateDealerProfile : celui-ci porte l'axe DEALER
 * (profil.dealer.networks), celui-là porte les axes BOUTIQUE dont dépendent les
 * collaborations inter-boutiques et les dettes internes :
 *   • profil.networks.enabled            → réseaux que la boutique opère ;
 *   • profil.collaborations.enabled      → le module est-il ouvert chez ce client ;
 *   • profil.transactions.paymentMethods → méthodes de règlement d'une dette.
 *
 * Pourquoi le serveur en a besoin : le réseau d'une collaboration n'est JAMAIS accepté
 * du client (il est résolu ici), et un client qui n'a pas souscrit au module doit être
 * refusé jusqu'au serveur, pas seulement masqué dans l'UI (docs/client-profiles.md §4).
 */

/**
 * Méthode de règlement toujours ajoutée aux méthodes du profil.
 *
 * Une dette interne peut se solder par un virement bancaire, alors qu'aucune
 * transaction client ne se règle ainsi : « Banque » n'a donc rien à faire dans
 * profil.transactions.paymentMethods, mais tout à faire ici. Comme « Cash », elle
 * ne mappe sur aucun réseau → elle n'entraîne aucun mouvement de stock (l'argent
 * circule hors système), tout en imputant la dette.
 */
export const DEBT_ONLY_SETTLEMENT_METHOD = 'Banque'

function quoteList(values) {
  return values.map((v) => `'${String(v)}'`).join(', ')
}

/**
 * @param {object} profile - profil client (networks.enabled, collaborations.enabled,
 *                           transactions.paymentMethods)
 * @returns {string} contenu complet du module functions/src/config/storeProfile.js
 */
export function generateStoreProfileFile(profile) {
  const networks = profile?.networks?.enabled
  if (!Array.isArray(networks) || networks.length === 0) {
    throw new Error('Profil invalide : networks.enabled doit être une liste non vide.')
  }

  const methods = profile?.transactions?.paymentMethods
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error('Profil invalide : transactions.paymentMethods doit être une liste non vide.')
  }

  const collaborationsEnabled = profile?.collaborations?.enabled
  if (typeof collaborationsEnabled !== 'boolean') {
    throw new Error('Profil invalide : collaborations.enabled doit être un booléen.')
  }

  // Dédoublonne : un profil qui listerait déjà « Banque » ne doit pas la voir deux fois.
  const settlementMethods = [...new Set([...methods, DEBT_ONLY_SETTLEMENT_METHOD])]

  return `/**
 * storeProfile.js — axes BOUTIQUE du profil client, côté Cloud Functions.
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ FICHIER GÉNÉRÉ par scripts/generate-functions-config.mjs depuis le profil client
 * (config/clients/<id>.js). NE PAS ÉDITER À LA MAIN.
 *
 * Alimente les collaborations inter-boutiques et les dettes internes :
 *   • STORE_NETWORKS           — réseaux opérés par les boutiques. Le réseau d'une
 *     collaboration est RÉSOLU ici, jamais accepté du client. Sert aussi à décider
 *     si un règlement déplace du stock (méthode mappée sur un réseau) ou non.
 *   • COLLABORATIONS_ENABLED   — false ⇒ tous les callables du module refusent.
 *   • DEBT_SETTLEMENT_METHODS  — méthodes déclarables pour rembourser une dette
 *     (méthodes du profil + « Banque »). Volontairement distinct des méthodes de
 *     règlement d'une transaction client.
 *
 * ⚠ Ces méthodes ne sont validées qu'à la DÉCLARATION d'une tranche, jamais à sa
 * confirmation : une tranche portant un ancien code doit rester confirmable.
 */
export const STORE_NETWORKS = [${quoteList(networks)}]

export const COLLABORATIONS_ENABLED = ${collaborationsEnabled}

export const DEBT_SETTLEMENT_METHODS = [${quoteList(settlementMethods)}]
`
}
