/**
 * generateDealerProfile.mjs — génère le contenu de functions/src/config/dealerProfile.js
 * depuis un profil client. PUR (aucune I/O) → testable et réutilisé par le CLI
 * scripts/generate-functions-config.mjs.
 *
 * Équivalent « functions » de generateRulesBlock : la source de vérité est
 * profil.dealer.networks. Le fichier généré n'exporte que la liste des réseaux dealer.
 */

/**
 * @param {object} profile - profil client (doit porter dealer.networks non vide)
 * @returns {string} contenu complet du module functions/src/config/dealerProfile.js
 */
export function generateDealerProfileFile(profile) {
  const networks = profile?.dealer?.networks
  if (!Array.isArray(networks) || networks.length === 0) {
    throw new Error('Profil invalide : dealer.networks doit être une liste non vide.')
  }
  const list = networks.map((n) => `'${String(n)}'`).join(', ')

  return `/**
 * dealerProfile.js — réseaux du circuit dealer, côté Cloud Functions.
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ FICHIER GÉNÉRÉ par scripts/generate-functions-config.mjs depuis le profil client
 * (config/clients/<id>.js, champ dealer.networks). NE PAS ÉDITER À LA MAIN.
 *
 * Défaut committé = référence TAOFIC (['Orange']) → mono-réseau identique à
 * l'historique. Le déploiement régénère ce fichier depuis le profil du client déployé.
 * Les handlers acceptent aussi \`dealerNetworks\` en injection (tests multi-réseaux).
 */
export const DEALER_NETWORKS = [${list}]
`
}
