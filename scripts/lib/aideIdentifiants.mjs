/**
 * aideIdentifiants.mjs — ce qu'on dit quand les identifiants manquent.
 *
 * POURQUOI CE TEXTE EST PARTAGÉ
 * ─────────────────────────────
 * Quatre scripts d'administration demandent les mêmes identifiants, et une
 * session PowerShell relancée les perd tous en même temps. Un script de
 * diagnostic qui répond « Ni GOOGLE_APPLICATION_CREDENTIALS ni GCLOUD_PROJECT
 * ne sont définis » sans dire comment les définir fait perdre le temps qu'il
 * venait gagner — et laisse chercher la commande dans l'historique d'un
 * terminal fermé.
 *
 * ⚠ LE PROJET EST NOMMÉ DANS L'AIDE, ET C'EST DÉLIBÉRÉ. Plusieurs clés de
 *   comptes de service traînent vite sur un poste de développement, et rien ne
 *   distingue à l'œil le JSON d'un client de celui d'un autre. Le rappel évite
 *   un rapport sur la mauvaise boutique — que les gardes refusent de produire,
 *   mais autant ne pas en arriver là.
 */

export const PROJET_ATTENDU = 'c2egf-b0b5a'

export const AIDE_IDENTIFIANTS = [
  'Deux façons de s’authentifier :',
  '',
  '  1. Une clé de compte de service — Console Firebase > Paramètres du projet',
  '     > Comptes de service > Générer une nouvelle clé privée :',
  '       $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\chemin\\vers\\la-cle.json"',
  '',
  '  2. Les identifiants par défaut de gcloud :',
  '       gcloud auth application-default login',
  `       $env:GCLOUD_PROJECT = "${PROJET_ATTENDU}"`,
  '',
  `⚠ La clé doit être celle du projet ${PROJET_ATTENDU}. Celle d’un autre client`,
  '  serait refusée — ces scripts énumèrent la base clients entière.',
  '',
  'Rappel : une session PowerShell relancée oublie ces variables.',
].join('\n')

/**
 * Échoue en nommant le problème ET sa réparation, puis sort en code 1.
 *
 * Le code de sortie compte : ces scripts se lancent parfois en chaîne, et un
 * échec silencieux laisserait le suivant travailler sur rien.
 */
export const echouerAvecAide = (message) => {
  console.error('')
  console.error(message)
  console.error('')
  console.error(AIDE_IDENTIFIANTS)
  process.exit(1)
}
