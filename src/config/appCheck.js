/**
 * appCheck.js — l'attestation d'intégrité, activée PARESSEUSEMENT.
 *
 * ⚠ C'EST LE RÉGLAGE LE PLUS DANGEREUX DU LOT. App Check s'applique au trafic
 *   Firebase de TOUTE l'application. Mal réglé — jeton absent, domaine non
 *   déclaré, script injoignable — il ne dégrade rien : il BLOQUE TOUT, Auth
 *   comprise. Sur un autre projet, l'activation au démarrage a mis tout le
 *   monde dehors : reCAPTCHA injoignable, et Auth rendait
 *   « network-request-failed », c'est-à-dire un écran qui accusait le réseau.
 *   Invisible en local, où le jeton de débogage ne passe jamais par reCAPTCHA.
 *
 * D'OÙ LES CINQ GARDES, ET AUCUNE N'EST FACULTATIVE :
 *   1. PARESSEUSE — appelée à l'ouverture de l'assistant, nulle part ailleurs.
 *      Portée de panne : si reCAPTCHA tombe, l'assistant se tait ; la caisse
 *      continue d'ouvrir.
 *   2. IDEMPOTENTE — deux initialisations sur la même app lèvent, et le
 *      panneau s'ouvre vingt fois par jour.
 *   3. JAMAIS SUR LES ÉMULATEURS — il n'y a pas de service App Check : la
 *      suite bout en bout échouerait pour une raison étrangère à ce qu'elle
 *      teste.
 *   4. JAMAIS CÔTÉ SERVEUR — pas de `document`, pas de reCAPTCHA.
 *   5. JAMAIS SANS CLÉ DÉCLARÉE — tant qu'elle est absente, l'application
 *      tourne exactement comme avant et SEUL l'assistant refuse de répondre.
 *      C'est l'inverse du réglage qui casse tout en silence.
 *
 * Contexte daté : depuis juillet 2026, Firebase pose l'application forcée
 * d'App Check automatiquement quand on configure AI Logic, et elle ne peut pas
 * être retirée pour ce produit. Au 2 novembre 2026 elle devient obligatoire.
 * Ce fichier n'est donc pas une précaution : c'est une condition de service.
 */

import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import app from './firebase.js'
import { lireEnvRuntime, resolveFirebaseRuntime } from './firebaseRuntime.js'

let etat = null

/**
 * Active l'attestation si c'est possible et utile. NE LÈVE JAMAIS.
 *
 * @returns {{actif: boolean, raison?: string}}
 */
export function activerAppCheck() {
  if (etat) return etat // garde 2 : idempotente

  // garde 4 : pas de navigateur, pas d'attestation.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    etat = { actif: false, raison: 'hors navigateur' }
    return etat
  }

  // garde 3 : les émulateurs n'ont pas de service App Check.
  const runtime = resolveFirebaseRuntime(lireEnvRuntime())
  if (runtime.useEmulators) {
    etat = { actif: false, raison: 'émulateurs' }
    return etat
  }

  const cle = import.meta.env.VITE_FIREBASE_APPCHECK_KEY
  // garde 5 : sans clé, on ne tente rien. L'application reste intacte.
  if (!cle) {
    etat = { actif: false, raison: 'clé absente' }
    return etat
  }

  try {
    // En local, le jeton de débogage remplace reCAPTCHA. Il doit être posé
    // AVANT l'initialisation, sinon il est ignoré.
    //
    // ⚠ EN DÉVELOPPEMENT SEULEMENT, et la condition doit envelopper la LECTURE.
    //   Vite remplace `import.meta.env.VITE_…` par sa valeur en clair : lu sans
    //   condition, le jeton partait dans tout bundle de production construit
    //   avec ce `.env` — vérifié dans `dist/` le 30 octobre 2026. Quiconque le
    //   lit obtient des attestations valides, donc le modèle à nos frais.
    //   Sous `import.meta.env.DEV`, faux en production, la branche disparaît
    //   du bundle, valeur comprise.
    const jetonDebogage = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined
    if (jetonDebogage) {
      // `true` fait imprimer un jeton à enregistrer dans la console Firebase ;
      // une chaîne emploie un jeton déjà enregistré.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = jetonDebogage === 'true' ? true : jetonDebogage
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(cle),
      // Une session ouverte toute la journée au comptoir verrait sinon ses
      // appels refusés au bout d'une heure.
      isTokenAutoRefreshEnabled: true,
    })

    etat = { actif: true }
  } catch (cause) {
    // La brute va en console, toujours : un échec d'attestation se présente
    // comme un `fetch` raté, donc comme « le réseau est coupé » — dit à
    // quelqu'un dont tout le reste fonctionne.
    console.error('[app-check] activation impossible', cause)
    etat = { actif: false, raison: 'échec' }
  }

  return etat
}
