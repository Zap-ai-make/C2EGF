/**
 * L'instant où une opération a vraiment eu lieu, quand elle part en retard (lot G4a,
 * docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * La machine est éteinte le soir : une saisie de lundi soir, sans réseau, part mardi
 * matin. Datée de son envoi, elle compterait mardi dans l'historique et les rapports.
 *
 * ⚠ LA FILE ENVOIE UN ÂGE, PAS UNE DATE. Le serveur situe l'opération sur sa propre
 *   horloge : une machine réglée trois jours en arrière donne quand même le bon
 *   jour, tant que son heure n'a pas changé entre la saisie et l'envoi.
 *
 * Hors des bornes, l'âge est ignoré : la date d'une opération n'est pas une raison
 * de la refuser. Quand il sert, la ligne garde aussi son heure de réception (`recuLe`).
 */
const AGE_MIN_MS = 60_000
const AGE_MAX_MS = 7 * 24 * 3_600_000

/**
 * @param {*} ageMs ce que la file a mesuré entre la saisie et l'envoi
 * @returns {Date | null} `null` : l'opération prend la date du serveur
 */
export function instantDeLaCaisse(ageMs, maintenant = Date.now()) {
  if (!Number.isSafeInteger(ageMs) || ageMs < AGE_MIN_MS || ageMs > AGE_MAX_MS) return null
  return new Date(maintenant - ageMs)
}
