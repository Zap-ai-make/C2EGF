/**
 * activeClientProfile.js — profil client ACTIF côté front.
 * ─────────────────────────────────────────────────────────────────────────────
 * Résout le profil à partir de VITE_CLIENT_ID (même source que clientIsolation).
 * On lit import.meta.env DIRECTEMENT (et non clientIsolation.CLIENT_ID) pour rester
 * indépendant des tests qui mockent CLIENT_ID : la config produit (réseaux, types,
 * méthodes…) reste pilotée par le vrai VITE_CLIENT_ID, pas par un id de test.
 *
 * Résolution TOLÉRANTE : sur un id inconnu (build mal configuré), on retombe sur le
 * profil pilote complet + un avertissement, plutôt que de casser l'app au chargement.
 * La résolution STRICTE (qui lève) reste réservée à la génération de règles / au
 * déploiement, où un mauvais profil est une erreur bloquante.
 */

import { pilotProfile } from '../../config/clients/_pilot.js'
import { resolveProfile } from '../../config/clients/index.js'

function resolveActiveProfile() {
  const raw = import.meta.env.VITE_CLIENT_ID
  try {
    return resolveProfile(raw)
  } catch (error) {
    console.warn(`[profil client] ${error.message} — repli sur le profil pilote (complet).`)
    return pilotProfile
  }
}

export const activeProfile = resolveActiveProfile()
