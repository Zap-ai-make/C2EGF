/**
 * Résolveur de profil client — point d'entrée unique du système de profils.
 * ─────────────────────────────────────────────────────────────────────────────
 * Framework-neutre : l'appelant fournit l'identifiant client. Selon la couche :
 *   • Front               → import.meta.env.VITE_CLIENT_ID (via src/config/clientIsolation)
 *   • Functions / scripts → process.env.CLIENT_ID
 *   • Génération de règles → argument --client
 *
 * L'identifiant est NORMALISÉ avec exactement les mêmes règles que
 * src/config/clientIsolation.js (minuscules, non-alphanumérique → « _ »), pour que
 * 'taofic-ajagbe', 'taofic_ajagbe' et 'TAOFIC AJAGBE' résolvent le même profil.
 * On ne peut pas importer clientIsolation ici (il lit import.meta.env, non dispo côté
 * Node) : la fonction est donc dupliquée volontairement et doit rester synchronisée.
 */

import { pilotProfile } from './_pilot.js'
import taoficProfile from './taofic-ajagbe.js'

// ⚠ Doit rester identique à normalizeClientId de src/config/clientIsolation.js.
function normalizeClientId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Registre des profils, keyé par identifiant client NORMALISÉ.
// Ajouter un client = ajouter son fichier + une entrée ici.
//   • 'nouveau_client' = placeholder d'un client non encore profilé → reçoit le
//     pilote complet (opt-out) le temps qu'on lui crée son propre profil restreint.
export const PROFILES = Object.freeze({
  // clé normalisée : normalizeClientId('_pilot') === 'pilot' (le _ de tête est retiré),
  // donc resolveProfile('_pilot') comme resolveProfile('pilot') pointent ici.
  pilot:           pilotProfile,
  nouveau_client:  pilotProfile,
  taofic_ajagbe:   taoficProfile,
})

/**
 * Retourne le profil correspondant à un identifiant client (normalisé).
 * Lève une erreur explicite si l'identifiant est inconnu (échec au build/déploiement,
 * jamais un fallback silencieux vers un mauvais client).
 *
 * @param {string} clientId
 * @returns {object} profil figé
 */
export function resolveProfile(clientId) {
  const key = normalizeClientId(clientId)
  const profile = PROFILES[key]
  if (!profile) {
    const known = Object.keys(PROFILES).join(', ')
    throw new Error(`Profil client inconnu : "${clientId}" (normalisé "${key}"). Profils disponibles : ${known}`)
  }
  return profile
}
