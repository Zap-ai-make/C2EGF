/**
 * Utilitaire de parsing des montants FCFA
 *
 * Le FCFA est une devise entiere : aucun centime, aucune decimale.
 * Toute saisie non entiere strictement positive doit etre rejetee.
 *
 * Ne jamais appeler parseFloat ou parseInt directement sur la saisie utilisateur.
 */

// Codes des espaces a supprimer : U+0020, U+00A0, U+202F, U+2009, U+0009
const SPACE_CODES = new Set([0x0020, 0x00a0, 0x202f, 0x2009, 0x0009])

function stripSpaces(str) {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (!SPACE_CODES.has(code)) {
      result += str[i]
    }
  }
  return result
}

/**
 * Normalise une saisie utilisateur en montant FCFA entier strict.
 * Retourne le nombre entier ou null si la valeur est invalide.
 *
 * Espaces acceptes et supprimes :
 *   U+0020 (espace normal), U+00A0 (espace insecable),
 *   U+202F (espace fine insecable), U+2009 (espace fine), U+0009 (tab)
 *
 * Exemples valides :
 *   "1000"        -> 1000
 *   "1 000"       -> 1000 (tout type d'espace)
 *   1000 (number) -> 1000
 *
 * Retourne null pour : "", "abc", "0", "-1", NaN, Infinity,
 *   "1000.5", "1000,5", 1000.5, "1e3", null, undefined, {}
 */
export function parseFcfaAmount(value) {
  // Accepter les nombres directs
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) return null
    return value
  }

  if (typeof value !== 'string') return null

  // Supprimer tous les types d'espaces connus (U+0020, U+00A0, U+202F, U+2009, U+0009)
  const stripped = stripSpaces(value).trim()

  if (stripped === '') return null

  // Verifier format entier pur : rejeter tout caractere non numerique
  // Cela rejette . , e E + - et tout autre symbole
  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.charCodeAt(i)
    if (code < 48 || code > 57) return null // 48='0', 57='9'
  }

  const n = Number(stripped)

  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n <= 0) return null

  return n
}
