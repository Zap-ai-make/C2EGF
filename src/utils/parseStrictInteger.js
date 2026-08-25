/**
 * Parsing d'un montant entier STRICT (chiffres uniquement, aucun espace interne).
 *
 * Contrairement à parseFcfaAmount (utils/fcfaAmount.js) qui tolère et supprime
 * les espaces de séparation ("1 000" → 1000), ce parseur les REJETTE : toute
 * chaîne contenant autre chose que des chiffres 0-9 → null. Sémantique utilisée
 * par les circuits dealer / transferts boutique (saisies sans séparateur).
 *
 * Retourne un entier sûr strictement positif, ou null sinon.
 * Rejette : '', espaces internes, décimales, notation scientifique, 0, négatifs,
 * non-string non-number.
 */
export function parseStrictInteger(raw) {
  const s = String(raw ?? '').trim()
  if (!/^[0-9]+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
}
