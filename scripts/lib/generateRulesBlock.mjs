/**
 * generateRulesBlock.mjs — génère le bloc « PROFIL-GÉNÉRÉ » de firestore.rules
 * à partir d'un profil client. PUR (aucune I/O) → testable et réutilisé par le CLI
 * scripts/generate-rules.mjs.
 *
 * Les axes métier utilisés dans les règles sont tous dérivés du profil actif.
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
  const storeNetworks = profile?.networks?.enabled
  const transactionTypes = profile?.transactions?.types
  const paymentMethods = profile?.transactions?.paymentMethods
  for (const [name, values] of Object.entries({ storeNetworks, transactionTypes, paymentMethods })) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Profil invalide : ${name} doit être une liste non vide.`)
    }
  }
  const quote = values => values.map(value => `'${String(value)}'`).join(', ')
  const selfRegistration = profile?.onboarding?.selfRegistration
  if (typeof selfRegistration !== 'boolean') {
    throw new Error('Profil invalide : onboarding.selfRegistration doit être un booléen.')
  }

  return [
    `${indent}${RULES_BLOCK_START}`,
    `${indent}// Réseaux du circuit dealer autorisés pour ce client (depuis profil.dealer.networks).`,
    `${indent}function profileDealerNetworks() { return [${list}]; }`,
    `${indent}// Axes boutique autorisés pour ce client.`,
    `${indent}function profileStoreNetworks() { return [${quote(storeNetworks)}]; }`,
    `${indent}function profileTransactionTypes() { return [${quote(transactionTypes)}]; }`,
    `${indent}function profilePaymentMethods() { return [${quote(paymentMethods)}]; }`,
    `${indent}// Admission publique des boutiques (depuis profil.onboarding.selfRegistration).`,
    `${indent}function profileAllowsSelfRegistration() { return ${selfRegistration}; }`,
    `${indent}${RULES_BLOCK_END}`,
  ].join('\n')
}
