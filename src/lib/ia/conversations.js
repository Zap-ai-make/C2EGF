/**
 * conversations.js — l'historique des conversations de l'assistant, sur
 * l'appareil.
 *
 * ⚠ RANGÉ PAR PERSONNE ET PAR BOUTIQUE. La clé porte l'uid et la boutique :
 *   au comptoir, deux caissières se succèdent sur le même navigateur, et
 *   l'une ne doit pas rouvrir les échanges de l'autre. Ce qui est rangé est ce
 *   que l'écran a déjà montré à cette personne — noms, montants — et rien de
 *   plus : ni carte en attente (elle ne se confirme qu'en direct), ni jeton.
 *
 * ⚠ LA MÉMOIRE DU MODÈLE SE RANGE SANS CE QUE LES OUTILS ONT LU. L'historique
 *   du SDK porte les appels d'outils et leurs résultats bruts : jusqu'à
 *   cinquante fiches par recherche, numéros personnels compris. Il se rangeait
 *   tel quel, en clair, à côté d'un commentaire qui promettait le contraire.
 *   Décision du responsable, 2 novembre 2026 (audit SEC-13) : seuls les textes
 *   échangés se rangent (`memoireSansDonnees`). Pendant la conversation, rien
 *   ne change ; rouverte, elle a perdu ses données, et le modèle reconsulte.
 *
 * ⚠ BORNÉ. localStorage tient quelques Mo pour toute l'application : vingt
 *   conversations au plus, et la mémoire rendue au modèle coupée à ses
 *   derniers échanges. Plein quand même, on jette la plus ancienne et on
 *   réessaie ; un historique qui ne s'écrit pas ne casse jamais le panneau.
 *
 * Une conversation rouverte reprend sa mémoire, pas ses chiffres : le prompt
 * interdit déjà de répondre sur ce qui a été dit plus haut sans reconsulter.
 */

export const CONVERSATIONS_MAX = 20
const MEMOIRE_MAX = 40
const TITRE_MAX = 60
const VERSION = 'v1'

/** La clé de rangement : une par personne et par boutique. */
export function cleDesConversations(uid, boutique) {
  return `c2egf.assistant.${VERSION}.${uid || 'anonyme'}.${boutique || 'boutique'}`
}

export function nouvelIdentifiant() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Le titre d'une conversation : sa première question, coupée proprement. */
export function titreDe(tours = []) {
  const premiere = tours.find((tour) => tour?.role === 'moi')?.texte?.replace(/\s+/g, ' ').trim() ?? ''
  if (!premiere) return 'Conversation'
  return premiere.length > TITRE_MAX ? `${premiere.slice(0, TITRE_MAX - 1).trimEnd()}…` : premiere
}

/** Ce qui se range d'un tour : son rôle, son texte, sa nature. Rien d'autre. */
const rangerTour = ({ role, texte, panne, succes }) => ({
  role,
  texte: String(texte ?? ''),
  ...(panne ? { panne: true } : {}),
  ...(succes ? { succes: true } : {}),
})

function stockage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null // stockage refusé par le navigateur
  }
}

/** Les textes d'un contenu du SDK : ni appel, ni résultat d'outil, ni réflexion. */
const textesDe = (contenu) => (Array.isArray(contenu?.parts) ? contenu.parts : [])
  .filter((part) => typeof part?.text === 'string' && part.text.trim() && !part.thought)
  .map((part) => ({ text: part.text }))

/**
 * La mémoire à ranger : les questions et les réponses écrites, rien de ce que
 * les outils ont lu.
 *
 * ⚠ LE SDK LA CONTRÔLE À LA REPRISE (`startChat`) : elle commence par une
 *   question, et deux contenus du même rôle ne se suivent jamais. Une fois les
 *   outils retirés, les morceaux d'une même réponse se rejoignent, et une
 *   question restée sans réponse écrite (un geste seul) rejoint la suivante
 *   ou tombe si elle est la dernière.
 */
export function memoireSansDonnees(historique) {
  const memoire = []
  for (const contenu of Array.isArray(historique) ? historique : []) {
    if (contenu?.role !== 'user' && contenu?.role !== 'model') continue
    const textes = textesDe(contenu)
    if (textes.length === 0) continue
    const precedent = memoire[memoire.length - 1]
    if (precedent?.role === contenu.role) precedent.parts.push(...textes)
    else memoire.push({ role: contenu.role, parts: textes })
  }
  let debut = Math.max(0, memoire.length - MEMOIRE_MAX)
  while (debut < memoire.length && memoire[debut].role !== 'user') debut += 1
  const gardee = memoire.slice(debut)
  if (gardee[gardee.length - 1]?.role === 'user') gardee.pop()
  return gardee
}

/**
 * Les conversations rangées, de la plus récente à la plus ancienne.
 *
 * Un rangement d'avant le 2 novembre 2026 porte encore les données brutes des
 * outils : relu, il est purgé et réécrit une fois.
 */
export function chargerConversations(cle) {
  let liste
  try {
    const brut = stockage()?.getItem(cle)
    liste = brut ? JSON.parse(brut) : []
  } catch {
    return []
  }
  if (!Array.isArray(liste)) return []
  const lues = liste.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.tours))
  let purgee = false
  const propres = lues.map((conversation) => {
    const memoire = memoireSansDonnees(conversation.historique)
    if (JSON.stringify(memoire) === JSON.stringify(conversation.historique ?? [])) return conversation
    purgee = true
    return { ...conversation, historique: memoire }
  })
  return purgee ? ecrire(cle, propres) : propres
}

function ecrire(cle, liste) {
  const zone = stockage()
  if (!zone) return liste
  let aEcrire = liste
  while (aEcrire.length > 0) {
    try {
      zone.setItem(cle, JSON.stringify(aEcrire))
      return aEcrire
    } catch {
      // Plein : on rend la place de la plus ancienne, et on réessaie.
      aEcrire = aEcrire.slice(0, -1)
    }
  }
  try {
    zone.removeItem(cle)
  } catch {
    // rien à faire
  }
  return []
}

/**
 * Range une conversation (nouvelle ou reprise) en tête de liste.
 *
 * @param {string} cle
 * @param {{id: string, tours: Array, historique?: Array}} conversation
 * @returns {Array} la liste telle qu'elle est désormais rangée
 */
export function rangerConversation(cle, { id, tours = [], historique = [] }, maintenant = Date.now()) {
  const toursRanges = tours.filter((tour) => tour?.role && String(tour.texte ?? '').trim()).map(rangerTour)
  const autres = chargerConversations(cle).filter((c) => c.id !== id)
  if (toursRanges.length === 0) return autres

  const conversation = {
    id,
    titre: titreDe(toursRanges),
    misAJour: maintenant,
    tours: toursRanges,
    historique: memoireSansDonnees(historique),
  }
  return ecrire(cle, [conversation, ...autres].slice(0, CONVERSATIONS_MAX))
}

/** Efface tout l'historique de cette personne dans cette boutique. */
export function effacerConversations(cle) {
  try {
    stockage()?.removeItem(cle)
  } catch {
    // rien à faire
  }
  return []
}

/** « aujourd'hui 14:05 », « hier », « 28/10 » : la date d'une conversation, lue d'un coup d'œil. */
export function dateLisible(instant, maintenant = Date.now()) {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const jour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const ecart = Math.round((jour(new Date(maintenant)) - jour(date)) / 86_400_000)
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (ecart === 0) return `aujourd'hui ${heure}`
  if (ecart === 1) return `hier ${heure}`
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
