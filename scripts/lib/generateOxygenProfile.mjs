/**
 * generateOxygenProfile.mjs — génère le contenu de functions/src/config/oxygenProfile.js
 * depuis un profil client. PUR (aucune I/O) → testable et réutilisé par le CLI
 * scripts/generate-functions-config.mjs.
 *
 * Porte l'axe OXYGEN (profil.oxygen) : la liaison d'un agent à l'app Oxygen. Le
 * serveur en a besoin pour savoir s'il répond, sous quel `distributeurId`, et quel
 * nom il annonce. Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md (v3).
 */

/**
 * Le format d'échange : un identifiant stable, recopié tel quel dans chaque
 * appel et chaque document. Minuscules, chiffres, « _ » et « - » seulement — rien
 * qu'une majuscule ou une espace rendrait ambigu d'un côté ou de l'autre.
 */
const FORMAT_DISTRIBUTEUR_ID = /^[a-z0-9][a-z0-9_-]{1,39}$/

export function generateOxygenProfileFile(profile) {
  const oxygen = profile?.oxygen

  if (typeof oxygen?.enabled !== 'boolean') {
    throw new Error('Profil invalide : oxygen.enabled doit être un booléen.')
  }
  if (typeof oxygen.distributeurId !== 'string' || !FORMAT_DISTRIBUTEUR_ID.test(oxygen.distributeurId)) {
    throw new Error('Profil invalide : oxygen.distributeurId doit suivre le format ^[a-z0-9][a-z0-9_-]{1,39}$.')
  }
  // L'apostrophe est refusée plutôt qu'échappée : le nom est recopié dans une
  // chaîne entre apostrophes du fichier généré, et un nom de marque n'en a pas
  // besoin. Un refus net vaut mieux qu'un échappement qu'on oublie de tester.
  const nom = oxygen.nomDistributeur
  if (typeof nom !== 'string' || !nom.trim() || nom.includes("'")) {
    throw new Error('Profil invalide : oxygen.nomDistributeur doit être un nom non vide, sans apostrophe.')
  }

  return `/**
 * oxygenProfile.js — axe OXYGEN du profil client, côté Cloud Functions.
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ FICHIER GÉNÉRÉ par scripts/generate-functions-config.mjs depuis le profil client
 * (config/clients/<id>.js, champ oxygen). NE PAS ÉDITER À LA MAIN.
 *
 *   • OXYGEN_ENABLED          — false ⇒ genererCodeLiaison refuse, et le point
 *     d'entrée répond « absent » ou refuse.
 *   • OXYGEN_DISTRIBUTEUR_ID  — l'identifiant sous lequel ce CRM répond à Oxygen.
 *   • OXYGEN_NOM_DISTRIBUTEUR — le nom que l'agent lit dans son app.
 */
export const OXYGEN_ENABLED = ${oxygen.enabled}

export const OXYGEN_DISTRIBUTEUR_ID = '${oxygen.distributeurId}'

export const OXYGEN_NOM_DISTRIBUTEUR = '${nom.trim()}'
`
}
