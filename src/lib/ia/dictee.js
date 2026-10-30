/**
 * dictee.js — la voix devient du texte, DANS LE CHAMP DE LA QUESTION.
 *
 * POURQUOI LE CHAMP, ET PAS UN ENVOI DIRECT
 * ─────────────────────────────────────────
 * Le navigateur transcrit (Web Speech API) ; rien ne part au modèle avant
 * « Envoyer ». La caissière relit ce qui a été compris : « cinquante mille »
 * entendu « quinze mille » ne doit pas devenir une opération préparée sans
 * qu'elle l'ait vu. Et la transcription du navigateur ne coûte aucun appel au
 * modèle.
 *
 * ⚠ LE MICRO S'ARRÊTE TOUJOURS : fin de phrase, second appui, envoi,
 *   fermeture du panneau, démontage. Un micro resté ouvert au comptoir écoute
 *   les clients.
 *
 * Indisponible (Firefox, vieux navigateurs) : pas de bouton, et rien d'autre
 * ne change.
 */

/** Le moteur de reconnaissance du navigateur, ou null. */
export function moteurDeDictee(fenetre = globalThis) {
  return fenetre?.SpeechRecognition ?? fenetre?.webkitSpeechRecognition ?? null
}

export const dicteeDisponible = (fenetre = globalThis) => Boolean(moteurDeDictee(fenetre))

const MESSAGES = Object.freeze({
  'not-allowed': 'Le micro est refusé. Autorisez-le pour ce site dans le navigateur.',
  'service-not-allowed': 'Le micro est refusé. Autorisez-le pour ce site dans le navigateur.',
  'audio-capture': 'Aucun micro trouvé sur cet appareil.',
  'no-speech': "Je n'ai rien entendu. Appuyez sur le micro et parlez.",
  network: 'La dictée a besoin d’internet. Tapez la question, ou réessayez.',
  'language-not-supported': 'La dictée en français n’est pas disponible sur ce navigateur.',
})

/** Une erreur du moteur, dite à la caissière. La brute part en console. */
export function messageDErreurDictee(code) {
  return MESSAGES[code] ?? "La dictée s'est arrêtée. Réessayez, ou tapez la question."
}

/**
 * Démarre une dictée. Rend de quoi l'arrêter, ou null si le navigateur ne sait
 * pas faire.
 *
 * @param {object} p
 * @param {(texte: string) => void} p.surTexte   tout ce qui a été compris jusqu'ici
 * @param {() => void} p.surFin                  le micro est coupé (une seule fois)
 * @param {(message: string) => void} p.surErreur
 * @returns {{terminer: () => void, abandonner: () => void} | null}
 *   `terminer` garde ce qui a été dit ; `abandonner` le jette.
 */
export function demarrerDictee({ surTexte, surFin, surErreur, langue = 'fr-FR', fenetre = globalThis } = {}) {
  const Moteur = moteurDeDictee(fenetre)
  if (!Moteur) return null

  const reconnaissance = new Moteur()
  reconnaissance.lang = langue
  // Les résultats provisoires font apparaître la phrase pendant qu'on parle :
  // c'est ce qui permet de voir tout de suite que le micro entend.
  reconnaissance.interimResults = true
  // Une phrase, puis le micro se coupe seul.
  reconnaissance.continuous = false
  reconnaissance.maxAlternatives = 1

  let fini = false
  let jete = false
  const finir = () => {
    if (fini) return
    fini = true
    surFin?.()
  }

  reconnaissance.onresult = (evenement) => {
    // Après un abandon, le moteur peut encore livrer : on n'écrit plus rien.
    if (jete) return
    let texte = ''
    for (const resultat of Array.from(evenement?.results ?? [])) texte += resultat?.[0]?.transcript ?? ''
    surTexte?.(texte.replace(/\s+/g, ' ').trim())
  }
  reconnaissance.onerror = (evenement) => {
    // « aborted » est notre propre abandon : ce n'est pas une panne à dire.
    if (evenement?.error === 'aborted') return
    console.warn('[dictée]', evenement?.error)
    surErreur?.(messageDErreurDictee(evenement?.error))
  }
  reconnaissance.onend = finir

  try {
    reconnaissance.start()
  } catch (cause) {
    console.warn('[dictée] démarrage impossible', cause)
    surErreur?.(messageDErreurDictee())
    finir()
    return null
  }

  return {
    // `stop` livre encore la dernière phrase, PUIS `onend` : c'est lui qui finit.
    terminer: () => {
      try {
        reconnaissance.stop()
      } catch {
        finir() // déjà arrêté
      }
    },
    // `abort` jette tout, et le micro est rendu tout de suite.
    abandonner: () => {
      jete = true
      try {
        reconnaissance.abort()
      } catch {
        // déjà arrêté
      }
      finir()
    },
  }
}
