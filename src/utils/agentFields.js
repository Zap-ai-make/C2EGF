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
