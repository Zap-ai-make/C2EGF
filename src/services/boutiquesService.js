import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

/**
 * La création d'une boutique par le patron (callable `creerBoutique`).
 *
 * ⚠ LE MESSAGE BRUT DU SERVEUR N'EST JAMAIS AFFICHÉ, comme ailleurs dans les
 *   services : on lit le code métier. À défaut, on dit qu'on peut réessayer, et
 *   c'est vrai : un second clic rend la boutique déjà créée au lieu d'en créer
 *   une deuxième.
 */

const MESSAGES = Object.freeze({
  UNAUTHENTICATED: 'Session expirée : reconnecte-toi.',
  PROFILE_NOT_FOUND: 'Réservé au compte du patron.',
  PROFILE_INACTIVE: 'Ton compte est désactivé.',
  ROLE_FORBIDDEN: 'Réservé au compte du patron.',
  INVALID_REQUEST_ID: 'Formulaire invalide.',
  INVALID_STORE_NAME: 'Nom : 2 à 80 caractères.',
  INVALID_EMAIL: 'E-mail invalide.',
  INVALID_PASSWORD: 'Mot de passe : 8 caractères au moins, sans espace au début ni à la fin.',
  EMAIL_ALREADY_USED: 'Cet e-mail sert déjà à un autre compte.',
  STORE_NAME_TAKEN: 'Une boutique active porte déjà ce nom.',
})

export const ECHEC_CREATION = 'La création n’a pas abouti. Vérifie la connexion et réessaie : rien ne sera créé deux fois.'

function erreurAffichable(err) {
  const code = err?.details?.code
  const message = (code && MESSAGES[code]) || ECHEC_CREATION
  return Object.assign(new Error(message), { code: code ?? '' })
}

/**
 * @returns {Promise<{ storeId: string, uid: string, nom: string, email: string, dejaCreee: boolean }>}
 */
export async function creerBoutique({ nom, email, motDePasse }) {
  try {
    const { data } = await httpsCallable(functions, 'creerBoutique')({ nom, email, motDePasse })
    const { success: _success, ...boutique } = data ?? {}
    return boutique
  } catch (err) {
    throw erreurAffichable(err)
  }
}
