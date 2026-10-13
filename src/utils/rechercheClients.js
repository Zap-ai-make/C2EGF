/**
 * rechercheClients.js — retrouver une fiche à partir de ce que la caissière tape.
 *
 * CE QUI NE MARCHAIT PAS, ET POURQUOI ÇA NE SE VOYAIT PAS
 * ───────────────────────────────────────────────────────
 * Les deux écrans de recherche testaient CHAQUE CHAMP SÉPARÉMENT avec
 * `includes` : `nom.includes(terme) || prenom.includes(terme) || …`. Trois
 * conséquences, toutes invisibles à la lecture du code et toutes vécues en
 * boutique :
 *
 *   1. « OUEDRAOGO SALIF » ne trouvait RIEN. Aucun champ ne contient la chaîne
 *      entière — le nom est dans `nom`, le prénom dans `prenom`. Taper le nom
 *      complet, le geste le plus naturel qui soit, était le seul qui échouait.
 *   2. « ouedraogo » ne trouvait pas « OUÉDRAOGO ». Rien ne pliait les accents,
 *      et la base en est pleine.
 *   3. « 70 11 22 33 » ne trouvait pas « 70112233 », ni l'inverse.
 *
 * Et le menu s'arrêtait à dix résultats SANS CLASSEMENT : sur un nom courant, le
 * client cherché était souvent au-delà, donc absent de l'écran. D'où « pour
 * certains agents ça s'affiche, pour d'autres non » — ce n'était pas la fiche
 * qui manquait, c'était la place.
 *
 * CE QUE FAIT CE MODULE
 * ─────────────────────
 *   · plie accents, casse et espaces des deux côtés de la comparaison ;
 *   · exige que TOUS LES MOTS tapés correspondent, dans n'importe quel ordre ;
 *   · compare les suites de chiffres en chiffres seuls, pour que la mise en
 *     forme d'un numéro n'ait aucune importance ;
 *   · CLASSE : identifiant exact d'abord, puis début de mot, puis le reste ;
 *   · dit combien de fiches correspondent au-delà de celles qu'il rend.
 *
 * PUR : aucun React, aucun Firebase. Les deux écrans l'appellent, donc une
 * amélioration profite aux deux et une divergence est impossible.
 */

import { valeursAgent } from './agentFields.js'

/** Le pli d'un texte : sans accents, sans casse, espaces réduits. */
export const plierTexte = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/** Les chiffres seuls : « +226 70 11 22 33 » et « 70112233 » sont un même numéro. */
export const chiffresSeuls = (valeur) => String(valeur ?? '').replace(/\D/g, '')

/**
 * Les identifiants d'une fiche — ce qui la désigne sans ambiguïté.
 *
 * ⚠ `orange` EST FOUILLÉ EN PLUS DE `valeursAgent`, ET C'EST VOLONTAIRE.
 *   `champsAgent` cesse de lire `orange` dès que les clés `codeAgent`/
 *   `numeroAgent` existent — c'est la bonne règle pour AFFICHER une fiche, parce
 *   qu'une case vidée exprès doit le rester. Mais chercher n'écrit rien : une
 *   fiche dont les deux clés sont vides et dont la vieille valeur dort dans
 *   `orange` deviendrait introuvable, alors qu'elle est bien là. On cherche donc
 *   dans tout ce qui peut désigner la fiche, et on affiche ce que l'écran dit.
 */
export const identifiantsDe = (client) => [
  ...valeursAgent(client),
  client?.orange,
  client?.numeroPersonnel,
].map((v) => String(v ?? '').trim()).filter(Boolean)

/**
 * Tout ce dans quoi on cherche, pour une fiche, plié une fois.
 *
 * Le texte est CONCATÉNÉ : c'est ce qui fait que « ouedraogo salif » trouve, le
 * nom et le prénom étant deux champs distincts en base.
 */
export const matiereDe = (client) => {
  const morceaux = [client?.nom, client?.prenom, ...identifiantsDe(client)]
  const texte = plierTexte(morceaux.filter(Boolean).join(' '))
  return {
    texte,
    mots: texte.split(' ').filter(Boolean),
    identifiants: identifiantsDe(client).map(chiffresSeuls).filter(Boolean),
  }
}

/** Les mots du terme cherché, pliés. Un terme vide ne cherche rien. */
export const motsDuTerme = (terme) => plierTexte(terme).split(' ').filter(Boolean)

/**
 * Un mot du terme correspond-il à cette fiche ?
 *
 * Un mot fait de chiffres est comparé AUX IDENTIFIANTS EN CHIFFRES SEULS, pour
 * que « 70 11 22 33 » et « 70112233 » soient la même chose. Il reste aussi
 * cherché dans le texte : un numéro peut être écrit dans n'importe quel champ.
 */
const motCorrespond = (mot, matiere) => {
  if (matiere.texte.includes(mot)) return true
  const chiffres = chiffresSeuls(mot)
  if (!chiffres || chiffres.length !== mot.length) return false
  return matiere.identifiants.some((identifiant) => identifiant.includes(chiffres))
}

/**
 * Le rang d'une fiche pour ce terme — plus c'est petit, plus c'est haut.
 *
 * ⚠ LE CLASSEMENT N'EST PAS UN CONFORT, C'EST CE QUI REND LA LIMITE SUPPORTABLE.
 *   Une liste coupée à dix sans classement cache le bon résultat derrière neuf
 *   homonymes. Classée, elle met en tête ce qui ne peut désigner qu'une fiche :
 *   un code agent ou un numéro tapé EN ENTIER.
 */
export const rangDe = (matiere, mots, termePlie) => {
  const chiffresTerme = chiffresSeuls(termePlie)
  const termeEstNumerique = chiffresTerme.length > 0 && chiffresTerme.length === termePlie.replace(/\s/g, '').length

  // 0 — un identifiant vaut exactement ce qui a été tapé : c'est LA fiche.
  if (termeEstNumerique && matiere.identifiants.includes(chiffresTerme)) return 0
  // 1 — un identifiant commence par ce qui a été tapé (code saisi en partie).
  if (termeEstNumerique && matiere.identifiants.some((i) => i.startsWith(chiffresTerme))) return 1
  // 2 — le nom commence par le terme entier : « oued » → « OUEDRAOGO … ».
  if (matiere.texte.startsWith(termePlie)) return 2
  // 3 — chaque mot tapé ouvre un mot de la fiche : « oue sal » → « OUEDRAOGO SALIF ».
  if (mots.every((mot) => matiere.mots.some((m) => m.startsWith(mot)))) return 3
  // 4 — correspondance quelque part au milieu.
  return 4
}

/**
 * Les fiches qui correspondent, classées, et combien il y en a en tout.
 *
 * @param {Array<object>} clients
 * @param {string} terme
 * @param {{maximum?: number}} options  `maximum` nul ou absent → tout est rendu
 * @returns {{resultats: object[], total: number, reste: number}}
 */
export function chercherClients(clients = [], terme = '', { maximum = null } = {}) {
  const termePlie = plierTexte(terme)
  const mots = motsDuTerme(terme)
  if (mots.length === 0 || !Array.isArray(clients) || clients.length === 0) {
    return { resultats: [], total: 0, reste: 0 }
  }

  const trouves = []
  for (const client of clients) {
    if (!client) continue
    const matiere = matiereDe(client)
    // TOUS les mots doivent correspondre : c'est ce qui fait qu'un nom complet
    // cherche bien le nom ET le prénom au lieu de n'en trouver aucun.
    if (!mots.every((mot) => motCorrespond(mot, matiere))) continue
    trouves.push({ client, rang: rangDe(matiere, mots, termePlie) })
  }

  trouves.sort((a, b) => a.rang - b.rang)
  const resultats = (maximum ? trouves.slice(0, maximum) : trouves).map((t) => t.client)
  return { resultats, total: trouves.length, reste: trouves.length - resultats.length }
}

/** La même recherche, quand seule la liste complète intéresse (filtre de tableau). */
export const filtrerClients = (clients, terme) => (
  plierTexte(terme) ? chercherClients(clients, terme).resultats : clients
)
