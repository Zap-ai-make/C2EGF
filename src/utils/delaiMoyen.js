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
 *
 * ⚠ SEULS LES DÉPÔTS (`typePlie === 'depot'`) ENTRENT DANS LA MOYENNE. Sur un
 *   RETRAIT, `validatedAt − createdAt` mesure le temps que LA BOUTIQUE a mis à
 *   remettre l'argent — pas un retard du client. Exemple mesuré qui a motivé ce
 *   filtre : un agent avec 3 retraits payés en 10 j par la boutique et 2 dépôts
 *   réglés en 1 j affichait « 6 j en moyenne » sous le titre « Temps mis avant
 *   remboursement » — un verdict faux aux trois cinquièmes, publié au nom du
 *   client. La tâche 6 republie ce chiffre par WhatsApp : une erreur ici devient
 *   un message accusateur envoyé à la mauvaise personne. `typePlie` est déjà
 *   posé sur chaque ligne par le serveur (`functions/src/clients/historiqueClient.js`),
 *   donc ce filtre ne coûte aucune donnée supplémentaire.
 *
 *   `total`, lui, compte TOUTES les lignes (dépôts et retraits confondus) — il
 *   répond à « sur combien d'opérations le patron regarde », pas à « combien de
 *   dépôts ». Ne pas le restreindre aux dépôts : un agent avec 20 retraits et 1
 *   dépôt doit lire « sur 21 opérations », pas « sur 1 » — le second chiffre
 *   masquerait l'essentiel de son activité.
 */
export function delaiMoyen(lignes = []) {
  const liste = Array.isArray(lignes) ? lignes : []
  const durees = []

  for (const ligne of liste) {
    if (!ligne) continue
    if (ligne.typePlie !== 'depot') continue
    const duree = dureeDe(ligne)
    if (duree) durees.push(duree.ms)
  }

  const jours = durees.length === 0
    ? null
    : Math.round(durees.reduce((somme, ms) => somme + ms, 0) / durees.length / JOUR)

  return { jours, mesurees: durees.length, total: liste.length }
}

export default delaiMoyen
