/**
 * generateRulesBlock.mjs — génère le bloc « PROFIL-GÉNÉRÉ » de firestore.rules
 * à partir d'un profil client. PUR (aucune I/O) → testable et réutilisé par le CLI
 * scripts/generate-rules.mjs.
 *
 * Phase 2 (règles seules) : seul l'axe DEALER est paramétré pour l'instant
 *   • profileDealerNetworks() = réseaux du circuit dealer (profil.dealer.networks)
 * Les autres axes des règles (types de transaction, réseaux des soldes, édition des
 * soldes) restent volontairement permissifs (surensemble) — un resserrement est une
 * décision opt-in par client, hors de ce générateur. Voir docs/client-profiles.md.
 */

export const RULES_BLOCK_START =
  '// <<< PROFIL-GÉNÉRÉ — DÉBUT (généré par scripts/generate-rules.mjs, ne pas éditer à la main) >>>'
export const RULES_BLOCK_END =
  '// <<< PROFIL-GÉNÉRÉ — FIN >>>'

/**
 * @param {object} profile - profil client (doit porter dealer.networks non vide)
 * @param {string} [indent='    '] - indentation de chaque ligne du bloc
 * @returns {string} bloc de règles prêt à injecter (marqueurs inclus)
 */
export function generateProfileRulesBlock(profile, indent = '    ') {
  const networks = profile?.dealer?.networks
  if (!Array.isArray(networks) || networks.length === 0) {
    throw new Error('Profil invalide : dealer.networks doit être une liste non vide.')
  }
  // Réseaux échappés en littéraux de règles (ex. ['Orange', 'Moov']).
  const list = networks.map((n) => `'${String(n)}'`).join(', ')

  return [
    `${indent}${RULES_BLOCK_START}`,
    `${indent}// Réseaux du circuit dealer autorisés pour ce client (depuis profil.dealer.networks).`,
    `${indent}function profileDealerNetworks() { return [${list}]; }`,
    `${indent}${RULES_BLOCK_END}`,
  ].join('\n')
}
