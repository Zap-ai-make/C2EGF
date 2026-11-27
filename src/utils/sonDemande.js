/**
 * Le petit son d'une demande d'agent qui arrive (demandé par l'utilisateur le
 * 2026-11-27) : la caissière sert au comptoir, elle ne regarde pas l'écran.
 *
 * SYNTHÉTISÉ, PAS DE FICHIER. Deux notes de Web Audio : rien à télécharger,
 * rien à mettre en cache, et rien qui manque le jour où le réseau est lent.
 *
 * ⚠ PLUSIEURS DEMANDES À LA FOIS, UN SEUL SON. Dans `ECART_MS`, les suivantes
 *   se taisent : trois sons empilés ne disent pas « trois demandes », ils
 *   disent « quelque chose ne va pas ». La pulsation montre combien.
 *
 * ⚠ LE NAVIGATEUR PEUT REFUSER. Tant que la page n'a reçu aucun geste depuis
 *   son chargement, le son est bloqué. Muet alors, jamais d'erreur ; et s'il
 *   n'est permis que plus tard, au premier clic, il ne sonne pas en retard.
 */
export const ECART_MS = 2_000

/** Au-delà, le son permis trop tard ne dirait plus rien : la demande est déjà là. */
const RETARD_MAX_MS = 1_000

const VOLUME = 0.15
const NOTES = Object.freeze([
  { frequence: 880, debut: 0, duree: 0.18 },
  { frequence: 1318.5, debut: 0.14, duree: 0.4 },
])

const jouer = (contexte) => {
  const t = contexte.currentTime
  for (const { frequence, debut, duree } of NOTES) {
    const oscillateur = contexte.createOscillator()
    const gain = contexte.createGain()
    oscillateur.type = 'sine'
    oscillateur.frequency.value = frequence
    gain.gain.setValueAtTime(0.0001, t + debut)
    gain.gain.exponentialRampToValueAtTime(VOLUME, t + debut + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + debut + duree)
    oscillateur.connect(gain).connect(contexte.destination)
    oscillateur.start(t + debut)
    oscillateur.stop(t + debut + duree + 0.02)
  }
}

/**
 * @param {{ Contexte?: typeof AudioContext, horloge?: () => number }} options
 * @returns {() => Promise<boolean>} sonne, et dit si le son est parti
 */
export function creerSonnerie({ Contexte, horloge = Date.now } = {}) {
  let contexte = null
  let dernier = -Infinity
  return async function sonner() {
    const depart = horloge()
    if (!Contexte || depart - dernier < ECART_MS) return false
    dernier = depart
    try {
      // Un seul contexte pour la session : le navigateur en limite le nombre.
      contexte ??= new Contexte()
      if (contexte.state === 'suspended') await contexte.resume()
      if (contexte.state !== 'running' || horloge() - depart > RETARD_MAX_MS) return false
      jouer(contexte)
      return true
    } catch {
      return false
    }
  }
}

export const sonnerDemande = creerSonnerie({
  Contexte: typeof window === 'undefined' ? undefined : (window.AudioContext ?? window.webkitAudioContext),
})
