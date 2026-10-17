import { dureeDe } from './attente.js'

const JOUR = 24 * 60 * 60 * 1000

/**
 * Combien de temps ce client met, en moyenne — et sur combien d'opérations.
 *
 * ⚠ `mesurees` ET `total` SORTENT AVEC LA MOYENNE, TOUJOURS. `dureeDe` ne
 *   mesure que les opérations qui ont réellement séjourné dans les non
 *   terminées : celles validées d'un geste au formulaire n'ont pas de
 *   `validatedAt`, et une durée nulle vient d'une création-validation dans la
 *   même écriture serveur. Rendre la moyenne seule laisserait l'écran annoncer
 *   « paie en 9 j » à côté de « 24 opérations » alors que six sont mesurées.
 *
 * ⚠ `jours: null` N'EST PAS ZÉRO. Aucune opération mesurable est un résultat
 *   honnête ; zéro jour voudrait dire « il rembourse instantanément ».
 *
 * PUR — aucune I/O, aucune horloge lue à l'intérieur : `dureeDe` travaille sur
 * deux horodatages déjà présents dans la ligne.
 */
export function delaiMoyen(lignes = []) {
  const liste = Array.isArray(lignes) ? lignes : []
  const durees = []

  for (const ligne of liste) {
    if (!ligne) continue
    const duree = dureeDe(ligne)
    if (duree) durees.push(duree.ms)
  }

  const jours = durees.length === 0
    ? null
    : Math.round(durees.reduce((somme, ms) => somme + ms, 0) / durees.length / JOUR)

  return { jours, mesurees: durees.length, total: liste.length }
}

export default delaiMoyen
