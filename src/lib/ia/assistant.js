/**
 * assistant.js — la conversation : configuration du modèle, boucle d'outils,
 * flux, traduction des erreurs.
 *
 * Plomberie assumée (pas de test unitaire ici : simuler le SDK du modèle
 * vérifierait le simulacre). Tout ce qui DÉCIDE vit dans les modules purs.
 */

import { getAI, getGenerativeModel, GoogleAIBackend, VertexAIBackend } from 'firebase/ai'
import app from '../../config/firebase.js'
import { construirePrompt } from './prompt.js'
import { DECLARATIONS, OUTILS_DE_GESTE, executerOutil } from './outils.js'

/**
 * ⚠ CHOIX DU BACKEND — défaut `googleAI` parce que c'est le plus rapide à
 *   activer (une bascule dans la console Firebase) et que ce lot doit pouvoir
 *   être essayé tout de suite.
 *
 *   EN PRODUCTION, BASCULER SUR `vertexAI` (VITE_AI_BACKEND=vertexAI) : le
 *   backend « Gemini Developer » facture sur une cagnotte prépayée à recharger
 *   à la main, qui s'épuise SANS PRÉVENIR et rend alors
 *   « [429] Your prepayment credits are depleted ». Vertex est adossé au compte
 *   Google Cloud du projet, déjà en plan Blaze pour les Cloud Functions.
 *   Voir docs/ia/LOT-APPCHECK.md §4.
 */
const BACKEND = import.meta.env.VITE_AI_BACKEND === 'vertexAI' ? 'vertexAI' : 'googleAI'
const MODELE = import.meta.env.VITE_AI_MODEL || 'gemini-2.5-flash'

/** Sans plafond de tours, un modèle qui boucle sur un outil en erreur
 *  consomme des jetons jusqu'à épuisement — et la facture est réelle. */
const TOURS_MAX = 5

let modeleMemorise = null

function obtenirModele(instructionSysteme) {
  // Le prompt change avec la personne connectée : on ne mémorise que si
  // l'instruction est identique.
  if (modeleMemorise?.instruction === instructionSysteme) return modeleMemorise.modele

  const ia = getAI(app, {
    backend: BACKEND === 'vertexAI' ? new VertexAIBackend() : new GoogleAIBackend(),
  })

  const modele = getGenerativeModel(ia, {
    model: MODELE,
    systemInstruction: instructionSysteme,
    tools: [{ functionDeclarations: DECLARATIONS }],
    generationConfig: {
      // Large : il borne le pire cas, il ne taille pas dans le texte. Les
      // jetons de réflexion se comptent dans ce plafond.
      maxOutputTokens: 4096,
      temperature: 0.2,
    },
  })

  modeleMemorise = { instruction: instructionSysteme, modele }
  return modele
}

/**
 * Traduit une panne en phrase qui dit QUOI FAIRE. La brute va toujours en
 * console : un message rassurant posé sur un diagnostic faux coûte cher.
 */
export function traduireErreur(cause) {
  console.error('[assistant] échec du modèle', cause)
  const texte = `${cause?.message ?? ''} ${cause?.code ?? ''}`.toLowerCase()

  // 401 ET 403 : le service rend 401 quand le jeton d'attestation manque,
  // 403 quand il est refusé. Ne connaître que 403 laisse l'autre sans message.
  if (texte.includes('401') || texte.includes('403') || texte.includes('app-check') || texte.includes('appcheck')) {
    return "L'assistant n'est pas autorisé sur cet appareil."
  }
  if (texte.includes('prepayment') || texte.includes('credits are depleted')) {
    // Deux refus portent le même 429 : celui-ci ne se vide jamais tout seul.
    return "Le crédit de l'assistant est épuisé. Prévenez le responsable."
  }
  if (texte.includes('429') || texte.includes('quota') || texte.includes('resource_exhausted')) {
    // Pas « limite atteinte » : à cette seconde, la file était pleine.
    return 'Le service est occupé en ce moment. Réessayez dans quelques secondes.'
  }
  if (texte.includes('service_disabled') || texte.includes('404') || texte.includes('not found')) {
    return "L'assistant n'est pas encore activé sur cette installation."
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Ne l'affirmer QUE si le navigateur le dit : déduire « hors ligne » d'un
    // fetch raté fait accuser le réseau pour toutes les pannes.
    return 'Vous êtes hors ligne. La réponse arrivera au retour du réseau.'
  }
  return "Je n'ai pas pu répondre. Réessayez dans un instant."
}

/**
 * Pose une question et rend la réponse en flux.
 *
 * @param {object} options
 * @param {string} options.question
 * @param {Array} options.historique      tours précédents, format du SDK
 * @param {object} options.contexte       { nom, boutique, role }
 * @param {(texte: string) => void} options.surTexte      appelé à chaque morceau
 * @param {(nom: string) => void}   options.surOutil      nom lisible de la lecture en cours
 * @param {(geste: object) => void} options.surGeste      geste d'écran demandé
 * @returns {Promise<{ok: true, texte: string, historique: Array}
 *                 | {ok: false, message: string}>}
 */
export async function poserQuestion({
  question,
  historique = [],
  contexte = {},
  surTexte = () => {},
  surOutil = () => {},
  surGeste = () => {},
}) {
  const instruction = construirePrompt({ ...contexte, date: new Date() })

  try {
    const modele = obtenirModele(instruction)
    const conversation = modele.startChat({ history: historique })

    let message = question
    let texteComplet = ''

    for (let tour = 0; tour < TOURS_MAX; tour += 1) {
      const flux = await conversation.sendMessageStream(message)

      for await (const morceau of flux.stream) {
        const texte = typeof morceau.text === 'function' ? morceau.text() : ''
        if (texte) {
          texteComplet += texte
          surTexte(texte)
        }
      }

      const reponse = await flux.response
      const appels = reponse.functionCalls?.() ?? []
      if (appels.length === 0) {
        return { ok: true, texte: texteComplet, historique: await conversation.getHistory() }
      }

      // Les gestes d'écran ne se lisent pas en base : le composant les exécute.
      const resultats = []
      const lectures = []

      for (const appel of appels) {
        if (OUTILS_DE_GESTE.includes(appel.name)) {
          surGeste({ nom: appel.name, arguments: appel.args ?? {} })
          resultats.push({ functionResponse: { name: appel.name, response: { fait: true } } })
          continue
        }
        surOutil(nommerLecture(appel.name))
        lectures.push(
          executerOutil(appel.name, appel.args ?? {}).then((donnees) => ({
            functionResponse: { name: appel.name, response: donnees },
          })),
        )
      }

      // Plusieurs appels d'un même tour partent ensemble.
      resultats.push(...(await Promise.all(lectures)))
      message = resultats
    }

    return { ok: true, texte: texteComplet, historique: await conversation.getHistory() }
  } catch (cause) {
    return { ok: false, message: traduireErreur(cause) }
  }
}

/**
 * Nomme la lecture en cours. Une attente nommée est une information : on juge
 * que l'assistant a compris la question avant même qu'il réponde.
 */
export function nommerLecture(nomOutil) {
  switch (nomOutil) {
    case 'bilan_du_jour':
      return 'je fais le point de la journée'
    case 'chercher_client':
      return 'je cherche le client'
    case 'creances_en_cours':
      return 'je regarde les créances'
    case 'operations_recentes':
      return "je parcours l'historique"
    default:
      return 'je consulte'
  }
}
