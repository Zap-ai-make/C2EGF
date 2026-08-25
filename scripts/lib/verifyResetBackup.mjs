/**
 * Porte de vérification du backup de remise à zéro (resetDataToZero.mjs).
 *
 * Fonction pure : compare les comptages effectués avant backup (counts) avec
 * ce qui a réellement été écrit dans les fichiers NDJSON (backupTotals).
 * Le moindre écart doit ABORTER la purge : un document supprimé ou écrasé
 * sans copie de sauvegarde serait une perte financière irrécupérable.
 *
 * Contrôles :
 *   - collections top-level : compté == sauvegardé ;
 *   - par boutique : chaque sous-collection cible, settlements PAR BOUTIQUE
 *     (un écart compensé entre deux boutiques ne doit pas passer),
 *     présence du snapshot networkBalances/current si le doc existait ;
 *   - par dealer : auditLogs, présence du snapshot du doc de solde ;
 *   - total global settlements (filet supplémentaire).
 *
 * @returns {string[]} liste des écarts (vide = backup complet)
 */
export function verifyResetBackup({ counts, backupTotals, topLevelDelete, storeSubcollectionsDelete }) {
  const errors = []

  for (const name of topLevelDelete) {
    if (backupTotals.topLevel[name] !== counts.topLevel[name]) {
      errors.push(`${name} : compté ${counts.topLevel[name]}, sauvegardé ${backupTotals.topLevel[name]}`)
    }
  }

  if (backupTotals.settlementsTotal !== counts.settlementsTotal) {
    errors.push(
      `settlements (global) : compté ${counts.settlementsTotal}, sauvegardé ${backupTotals.settlementsTotal}`
    )
  }

  for (const [storeId, counted] of Object.entries(counts.stores)) {
    const backed = backupTotals.stores[storeId]
    if (!backed) {
      errors.push(`clients/${storeId} : absent du backup`)
      continue
    }
    for (const sub of storeSubcollectionsDelete) {
      if (backed[sub] !== counted[sub]) {
        errors.push(`clients/${storeId}/${sub} : compté ${counted[sub]}, sauvegardé ${backed[sub]}`)
      }
    }
    if (backed.settlements !== backed.settlementsExpected) {
      errors.push(
        `clients/${storeId} settlements : attendu ${backed.settlementsExpected}, sauvegardé ${backed.settlements}`
      )
    }
    if (counted.networkBalancesCurrent && !backed.networkBalancesBackedUp) {
      errors.push(`clients/${storeId}/networkBalances/current : existait mais absent du backup`)
    }
  }

  for (const [dealerUid, counted] of Object.entries(counts.dealers)) {
    const backed = backupTotals.dealers[dealerUid]
    if (!backed) {
      errors.push(`dealerBalances/${dealerUid} : absent du backup`)
      continue
    }
    if (backed.auditLogs !== counted.auditLogs) {
      errors.push(
        `dealerBalances/${dealerUid}/auditLogs : compté ${counted.auditLogs}, sauvegardé ${backed.auditLogs}`
      )
    }
    if (counted.balanceDoc && !backed.balanceBackedUp) {
      errors.push(`dealerBalances/${dealerUid} : le document de solde existait mais est absent du backup`)
    }
  }

  return errors
}
