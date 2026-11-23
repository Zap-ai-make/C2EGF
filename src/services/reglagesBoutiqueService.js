import { runStoreTransactionCommand } from './storeTransactionCommandService.js'

/**
 * Les réglages de la boutique, dans Profil → Configuration
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 * ⚠ JAMAIS PAR LA FILE D'ENVOI, comme les numéros : un réglage mis en file et
 *   appliqué plus tard surprendrait. Sans réseau, l'appel échoue tout de suite.
 */

/** Coche ou décoche l'option des transferts d'argent ; le serveur rend l'état enregistré. */
export const enregistrerTransfertsArgent = (actif) =>
  runStoreTransactionCommand({ action: 'updateStoreSettings', transfertsArgent: actif })
