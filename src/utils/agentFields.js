/**
 * Le code agent et le numéro agent d'un client — deux choses, longtemps rangées
 * dans une seule case.
 *
 * CE QUE CE FICHIER RÉSOUT
 * ────────────────────────
 * Le modèle client ne portait qu'un champ, `orange`, étiqueté « Numéro agent /
 * Code agent ». La boutique y mettait l'un OU l'autre selon qui saisissait :
 * deux informations différentes, mélangées dans la même colonne, impossibles à
 * chercher séparément et impossibles à distinguer une fois écrites.
 *
 * LA RÈGLE DE TRI, ET D'OÙ ELLE VIENT
 * ───────────────────────────────────
 * Au Burkina, un numéro agent fait HUIT chiffres et un code agent en fait SEPT.
 * C'est la règle que la boutique a donnée, et elle suffit à ranger rétroactivement
 * ce qui a déjà été saisi.
 *
 * ⚠ RIEN N'EST RÉÉCRIT EN BASE. Le tri se fait À LA LECTURE.
 *   Migrer les fiches existantes supposerait d'écrire dans le Firestore de
 *   production, ce qu'un agent ne fait pas (AGENTS.md). Et ce serait inutile :
 *   une fiche d'avant la séparation se lit correctement sans qu'on y touche, et
 *   se range définitivement à la première modification.
 *
 * COMMENT ON SAIT QU'UNE FICHE EST DÉJÀ RANGÉE
 * ────────────────────────────────────────────
 * Par la PRÉSENCE des clés, pas par leur valeur. Une fiche enregistrée depuis
 * la séparation porte toujours `codeAgent` et `numeroAgent`, quitte à ce que
 * l'une soit vide — et une case vidée exprès doit le rester. Tester la valeur
 * ferait ressurgir le vieux `orange` dès qu'on efface les deux champs.
 */

/** Huit chiffres : un numéro agent. */
export const LONGUEUR_NUMERO_AGENT = 8

/** Sept chiffres : un code agent. */
export const LONGUEUR_CODE_AGENT = 7

const texte = (valeur) => String(valeur ?? '').trim()

/**
 * Range une valeur unique dans l'un des deux champs, par sa longueur.
 *
 * Toute longueur autre que huit tombe dans le code agent — y compris sept, mais
 * aussi six ou neuf. Ce n'est pas une approximation : le code agent est ce qui
 * alimente le code de la transaction, et une valeur mal rangée y reste au moins
 * utilisable. Dans l'autre colonne, elle serait perdue pour la saisie.
 */
export function repartirValeurAgent(valeur) {
  const brut = texte(valeur)
  if (!brut) return { codeAgent: '', numeroAgent: '' }

  const chiffres = brut.replace(/\D/g, '')
  return chiffres.length === LONGUEUR_NUMERO_AGENT
    ? { codeAgent: '', numeroAgent: brut }
    : { codeAgent: brut, numeroAgent: '' }
}

/**
 * Les deux champs d'un client, qu'il ait été saisi avant ou après la séparation.
 *
 * @param {object} client
 * @returns {{codeAgent: string, numeroAgent: string}}
 */
export function champsAgent(client) {
  if (!client || typeof client !== 'object') return { codeAgent: '', numeroAgent: '' }

  // Présence des clés, pas valeur : voir l'en-tête du fichier.
  if ('codeAgent' in client || 'numeroAgent' in client) {
    return { codeAgent: texte(client.codeAgent), numeroAgent: texte(client.numeroAgent) }
  }

  return repartirValeurAgent(client.orange)
}

/** Les deux valeurs d'un client, sans les vides — pour chercher et pour afficher. */
export function valeursAgent(client) {
  const { codeAgent, numeroAgent } = champsAgent(client)
  return [codeAgent, numeroAgent].filter(Boolean)
}

/**
 * Ce qu'on montre d'un client en une ligne : « Code 1234567 · N° 70112233 ».
 * Vide si la fiche n'en porte aucun — l'appelant décide quoi faire du vide.
 */
export function libelleAgent(client) {
  const { codeAgent, numeroAgent } = champsAgent(client)
  const morceaux = []
  if (codeAgent) morceaux.push(`Code ${codeAgent}`)
  if (numeroAgent) morceaux.push(`N° ${numeroAgent}`)
  return morceaux.join(' · ')
}

/**
 * Le refus opposé à qui saisit un identifiant agent déjà pris.
 *
 * POURQUOI CE MESSAGE NOMME LE PORTEUR ET SA BOUTIQUE
 * ───────────────────────────────────────────────────
 * Le refus précédent disait « Un client avec ce numéro/code agent existe déjà
 * dans cette boutique. » Deux problèmes, et le second a coûté 175 grappes de
 * doublons.
 *
 * ⚠ 1. IL NE DISAIT PAS OÙ CHERCHER. Un opérateur qui ne retrouve pas la fiche
 *      annoncée conclut que le logiciel se trompe, et contourne : il retire un
 *      chiffre, il écrit le nom autrement. Nommer le porteur rend le refus
 *      vérifiable en trois secondes — et un refus vérifiable est un refus qu'on
 *      ne contourne pas.
 *
 * ⚠ 2. « DANS CETTE BOUTIQUE » ÉTAIT LA CAUSE DU PROBLÈME. L'audit du
 *      2026-10-12 a mesuré que 174 des 175 grappes restantes étaient À CHEVAL
 *      SUR PLUSIEURS BOUTIQUES : le contrôle ne regardait que la boutique de
 *      l'opérateur, donc il laissait passer tout ce que les autres avaient
 *      enregistré. Un identifiant agent désigne un commerce, pas une relation
 *      commerciale avec une boutique : il est unique dans TOUTE la base.
 *
 * L'ARBITRAGE ASSUMÉ : un agent qui serait légitimement client de deux
 * boutiques C2EGF est désormais refusé à la seconde. Les données disent que
 * c'est au mieux 1 cas sur 175 — et c'est pour lui que le message nomme la
 * boutique détentrice, afin que le refus indique qui appeler au lieu de laisser
 * l'opérateur sans issue.
 */
/**
 * La fiche qui porte DÉJÀ cet identifiant agent, s'il y en a une.
 *
 * ⚠ TROIS CHAMPS, COMME LE CONTRÔLE DU SERVEUR. `valeursAgent` ne suffirait pas :
 *   il cesse de lire `orange` dès que les deux clés existent, et laisserait donc
 *   passer un doublon d'une fiche d'avant la séparation — c'est-à-dire presque
 *   toute la base. Ce qui est cherché ici doit être exactement ce que
 *   `_refuserDoublonAgent` refusera : un avertissement plus permissif que le
 *   refus ferait remplir un formulaire entier pour le voir rejeté à la fin.
 *
 * @param {Array<object>} clients   les fiches déjà en mémoire
 * @param {string} valeur           le code ou le numéro saisi
 * @param {string|null} idExclu     la fiche en cours de modification
 */
export function trouverFicheAgent(clients, valeur, idExclu = null) {
  const cherchee = texte(valeur)
  if (!cherchee || !Array.isArray(clients)) return null

  return clients.find((client) => {
    if (!client || client.id === idExclu) return false
    return texte(client.codeAgent) === cherchee
      || texte(client.numeroAgent) === cherchee
      || texte(client.orange) === cherchee
  }) || null
}

/**
 * L'avertissement affiché PENDANT la saisie, quand l'identifiant est déjà pris.
 *
 * ⚠ CE N'EST PAS LE MÊME MESSAGE QUE LE REFUS D'ENREGISTREMENT, et ce n'est pas
 *   un doublon de code. `messageDoublonAgent` clôt une tentative de création :
 *   il explique pourquoi c'est refusé. Celui-ci s'affiche alors que la personne
 *   est encore en train de taper, et sa seule raison d'être est d'ouvrir une
 *   porte — « c'est cette fiche-là, va la modifier » — pendant qu'il est encore
 *   temps de ne pas ressaisir le reste du formulaire.
 *
 * ⚠ LA FICHE D'UNE AUTRE BOUTIQUE EST MODIFIABLE, et le message le dit sans
 *   détour. La boutique d'origine est nommée non pas comme un obstacle mais
 *   comme une information : on corrige une fiche que quelqu'un d'autre a créée.
 */
export function messageFicheExistante(existant, storeIdCourant) {
  const nom = `${existant?.nom ?? ''} ${existant?.prenom ?? ''}`.trim()
  const qui = nom ? `« ${nom} »` : 'une fiche sans nom'
  const boutique = texte(existant?.registeredStoreName) || texte(existant?.registeredStoreId)
  const memeBoutique = existant?.registeredStoreId && existant.registeredStoreId === storeIdCourant

  if (memeBoutique) {
    return `Cet identifiant agent est déjà celui de ${qui}, dans cette boutique.`
      + ' Ouvrir sa fiche plutôt que d\'en créer une seconde.'
  }

  return `Cet identifiant agent est déjà celui de ${qui}`
    + `${boutique ? `, enregistré par ${boutique}` : ', enregistré par une autre boutique'}.`
    + ' La fiche client est commune : vous pouvez la compléter ou la corriger ici.'
}

export function messageDoublonAgent(existant, storeIdCourant) {
  const nom = `${existant?.nom ?? ''} ${existant?.prenom ?? ''}`.trim()
  // « celui de une fiche » : l'élision se décide ici, pas à l'interpolation.
  const porteur = nom ? `de « ${nom} »` : "d'une fiche sans nom"
  const boutique = texte(existant?.registeredStoreName) || texte(existant?.registeredStoreId)

  if (existant?.registeredStoreId && existant.registeredStoreId === storeIdCourant) {
    return `Ce code/numéro agent existe déjà : c'est celui ${porteur}, dans cette boutique.`
      + ' Ouvrir sa fiche au lieu d\'en créer une seconde.'
  }

  const chez = boutique ? ` par ${boutique}` : ' par une autre boutique'
  return `Ce code/numéro agent existe déjà : c'est celui ${porteur}, enregistré${chez}.`
    + ' Un identifiant agent désigne un commerce, il ne peut pas être enregistré deux fois.'
    + `${boutique ? ` Si c'est bien un nouveau client ici, voir avec ${boutique}.` : ''}`
}
