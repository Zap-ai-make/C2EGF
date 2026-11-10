/**
 * boutiquesActives.js — les boutiques actives du réseau, lues UNE fois par session
 * (lot A4a, docs/rester-dans-le-quota-gratuit.md §A4).
 *
 * L'accueil du dealer, l'écran Boutiques du patron et le formulaire de demande
 * relisaient chacun les 84 boutiques à chaque ouverture, par `getDocs` : 84
 * lectures facturées à chaque fois, pour une liste qui ne change presque jamais.
 * Une seule écoute, ouverte à la première demande et gardée jusqu'à la
 * déconnexion, les sert tous : 84 lectures par session, puis une par boutique
 * créée, renommée ou fermée — qui apparaît sans recharger la page.
 *
 * ⚠ LA PREMIÈRE RÉPONSE SERVIE EST CELLE DU SERVEUR. Le `getDocs` remplacé
 *   attendait le serveur ; une écoute répond d'abord avec le cache, qui peut
 *   dater d'une session ancienne et ignorer une boutique créée depuis. On attend
 *   donc la confirmation du serveur (`fromCache: false`), qui n'arrive qu'avec
 *   `includeMetadataChanges` quand le cache disait déjà la même chose (même
 *   constat qu'au lot A3a, `historyService.js`).
 *
 * ⚠ HORS LIGNE, LE CACHE. Navigateur hors ligne : tout de suite. Sinon, après
 *   `ATTENTE_SERVEUR_MS` sans réponse du serveur (wifi sans internet) — le
 *   `getDocs` remplacé faisait de même, une fois le SDK passé hors ligne.
 *
 * ⚠ L'ÉCOUTE SE FERME À LA DÉCONNEXION, et à tout changement de compte. Elle
 *   vit au niveau du module, pas d'un écran : sans cela, le compte suivant sur le
 *   même appareil hériterait d'une écoute ouverte par le précédent.
 */

import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../config/firebase'

export const ATTENTE_SERVEUR_MS = 10_000

let ecoute = null
let surveillanceCompte = false
let compteCourant

const horsLigne = () => typeof navigator !== 'undefined' && navigator.onLine === false

function servable(e) {
  return e.docs !== null && (e.confirme || e.delaiEcoule || horsLigne())
}

function servir(e) {
  const attentes = e.attentes
  e.attentes = []
  attentes.forEach(({ resolve }) => resolve(e.docs))
}

const presente = (e, id) => e.docs?.some((d) => d.id === id) ?? false

function guetter(e) {
  const trouves = e.guets.filter((g) => presente(e, g.id))
  e.guets = e.guets.filter((g) => !trouves.includes(g))
  trouves.forEach((g) => { clearTimeout(g.minuteur); g.resolve(true) })
}

function fermer(e, erreur) {
  clearTimeout(e.minuteur)
  e.desabonner?.()
  if (ecoute === e) ecoute = null
  const attentes = e.attentes
  e.attentes = []
  attentes.forEach(({ reject }) => reject(erreur))
  const guets = e.guets
  e.guets = []
  guets.forEach((g) => { clearTimeout(g.minuteur); g.resolve(false) })
}

function surveillerCompte() {
  if (surveillanceCompte) return
  surveillanceCompte = true
  compteCourant = auth.currentUser?.uid ?? null
  onAuthStateChanged(auth, (utilisateur) => {
    const uid = utilisateur?.uid ?? null
    if (uid !== compteCourant) arreterBoutiquesActives()
    compteCourant = uid
  })
}

function ouvrir() {
  surveillerCompte()
  const e = { docs: null, confirme: false, delaiEcoule: false, attentes: [], guets: [], minuteur: null, desabonner: null }

  e.minuteur = setTimeout(() => {
    e.delaiEcoule = true
    if (servable(e)) servir(e)
  }, ATTENTE_SERVEUR_MS)

  e.desabonner = onSnapshot(
    query(collection(db, 'stores'), where('active', '==', true), orderBy('name')),
    { includeMetadataChanges: true },
    (snap) => {
      e.docs = snap.docs
      if (!snap.metadata.fromCache) {
        e.confirme = true
        clearTimeout(e.minuteur)
      }
      if (servable(e)) servir(e)
      guetter(e)
    },
    // Une écoute tombée ne se relève pas seule : on la ferme, et la demande
    // suivante en rouvre une.
    (err) => fermer(e, err),
  )
  return e
}

/**
 * Les boutiques actives, triées par nom.
 *
 * @returns {Promise<Array<{ id: string, data: () => object }>>} les documents
 */
export function lireBoutiquesActives() {
  if (!ecoute) ecoute = ouvrir()
  const e = ecoute
  if (servable(e)) return Promise.resolve(e.docs)
  return new Promise((resolve, reject) => e.attentes.push({ resolve, reject }))
}

/**
 * Attend qu'une boutique tout juste créée arrive dans l'écoute.
 *
 * ⚠ LA RÉPONSE DE LA CALLABLE ARRIVE AVANT L'ÉCOUTE. Le serveur a écrit la fiche
 *   avant de répondre, mais le changement met encore un instant à redescendre :
 *   relire la liste tout de suite la rendrait sans la boutique qu'on vient de
 *   créer. Rien de plus n'est lu : on attend ce que l'écoute recevra de toute façon.
 *
 * @returns {Promise<boolean>} `false` si elle n'est pas arrivée dans le délai,
 *   ou si l'écoute s'est fermée entre-temps
 */
export function attendreBoutiqueActive(id, delaiMs = ATTENTE_SERVEUR_MS) {
  if (!ecoute) ecoute = ouvrir()
  const e = ecoute
  if (presente(e, id)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const guet = { id, resolve, minuteur: null }
    guet.minuteur = setTimeout(() => {
      e.guets = e.guets.filter((g) => g !== guet)
      resolve(false)
    }, delaiMs)
    e.guets.push(guet)
  })
}

/** Ferme l'écoute ; la prochaine lecture en rouvre une. */
export function arreterBoutiquesActives() {
  if (ecoute) fermer(ecoute, new Error('Session fermée.'))
}
