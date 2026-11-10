/**
 * Un mot de passe que le patron peut dicter ou recopier dans un message.
 *
 * ⚠ NI 0/O, NI 1/l/i : ce mot de passe passe de la voix ou de l'écran du patron
 *   au clavier d'une boutique, et ces caractères s'y confondent. Minuscules et
 *   chiffres seulement, pour la même raison. 10 caractères parmi 31 : ~49 bits,
 *   assez pour un compte que Firebase protège déjà des essais en série.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const LONGUEUR_MOT_DE_PASSE = 10

// Un octet vaut 0 à 255 ; 256 n'est pas un multiple de 31. On écarte les octets
// au-delà du dernier multiple, sans quoi les premières lettres sortiraient plus souvent.
const PLAFOND = 256 - (256 % ALPHABET.length)

export function genererMotDePasse(aleatoire = (octets) => crypto.getRandomValues(octets)) {
  let resultat = ''
  while (resultat.length < LONGUEUR_MOT_DE_PASSE) {
    for (const octet of aleatoire(new Uint8Array(16))) {
      if (octet < PLAFOND && resultat.length < LONGUEUR_MOT_DE_PASSE) resultat += ALPHABET[octet % ALPHABET.length]
    }
  }
  return resultat
}
