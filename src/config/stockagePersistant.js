/**
 * Demande au navigateur de ne pas vider le stockage de l'application.
 *
 * POURQUOI
 * ────────
 * Sans connexion, l'application ne vit que de ce qu'elle a gardé sur la
 * machine : la session, le cache Firestore, bientôt l'annuaire des clients et
 * la file d'envoi (docs/rester-dans-le-quota-gratuit.md §G). Par défaut, ce
 * stockage est « au mieux » : le navigateur peut l'effacer quand le disque se
 * remplit. Persistant, il ne l'efface plus sans que l'utilisateur le demande.
 *
 * Chrome et Edge accordent ou refusent sans rien demander, selon que
 * l'application est installée ou souvent utilisée. Firefox peut poser la
 * question. Un refus ne casse rien : on retombe sur le comportement d'avant.
 *
 * @returns {Promise<'deja-accorde'|'accorde'|'refuse'|'indisponible'>}
 */
export async function demanderStockagePersistant(storage = globalThis.navigator?.storage) {
  if (typeof storage?.persist !== 'function' || typeof storage?.persisted !== 'function') {
    return 'indisponible'
  }
  try {
    if (await storage.persisted()) return 'deja-accorde'
    return (await storage.persist()) ? 'accorde' : 'refuse'
  } catch {
    return 'indisponible'
  }
}
