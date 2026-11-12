import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { activeProfile } from '../config/activeClientProfile.js'

/**
 * Le code de liaison Oxygen (callable `genererCodeLiaison`, us-central1).
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.1.
 *
 * ⚠ LE MESSAGE BRUT DU SERVEUR N'EST JAMAIS AFFICHÉ, comme ailleurs dans les
 *   services : on lit le code métier. Les phrases sont courtes — c'est une
 *   caissière qui les lit, un agent devant elle.
 */

/** Le profil ouvre-t-il la liaison ? false ⇒ aucune trace dans l'interface. */
export const LIAISON_OXYGEN_ACTIVE = activeProfile?.oxygen?.enabled === true

const MESSAGES = Object.freeze({
  UNAUTHENTICATED: 'Session expirée : reconnectez-vous.',
  PROFILE_NOT_FOUND: 'Réservé aux comptes de boutique.',
  PROFILE_INACTIVE: 'Ce compte est désactivé.',
  ROLE_FORBIDDEN: 'Réservé aux comptes de boutique.',
  STORE_ID_REQUIRED: 'Réservé aux comptes de boutique.',
  CLIENT_NOT_FOUND: 'Fiche introuvable.',
  AGENT_SANS_IDENTIFIANT: 'Ajoutez d’abord un code ou un numéro agent à la fiche.',
  OXYGEN_DISABLED: 'La liaison Oxygen n’est pas ouverte.',
})

export const ECHEC_CODE = 'Code non obtenu. Vérifiez la connexion et réessayez.'

/**
 * @param {string} clientId  la fiche ouverte
 * @returns {Promise<{ code: string, expireLe: number, valableMs: number }>}
 */
export async function genererCodeLiaison(clientId) {
  try {
    const { data } = await httpsCallable(functions, 'genererCodeLiaison')({ clientId })
    return { code: data.code, expireLe: data.expireLe, valableMs: data.valableMs }
  } catch (err) {
    const code = err?.details?.code
    throw Object.assign(new Error((code && MESSAGES[code]) || ECHEC_CODE), { code: code ?? '' })
  }
}
