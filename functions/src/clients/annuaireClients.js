/**
 * annuaireClients.js — la base clients en 64 documents au lieu de 15 700.
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * Chaque session boutique écoutait `globalClients` en entier : 15 679 lectures
 * facturées au premier chargement d'un appareil, puis à chaque reconnexion après
 * 30 minutes — un téléphone en veille suffit. Le quota gratuit est de 50 000
 * lectures par jour pour toute la flotte (docs/rester-dans-le-quota-gratuit.md
 * §A1). L'annuaire range les mêmes fiches dans `NOMBRE_TRANCHES` documents :
 * un chargement complet coûte 64 lectures.
 *
 * POURQUOI 64 TRANCHES, ET PAS UN SEUL DOCUMENT
 * ─────────────────────────────────────────────
 * Une tranche modifiée est renvoyée EN ENTIER à chaque appareil qui écoute. Un
 * document unique (~3 Mo, au-delà même de la limite de 1 Mio) partirait vers
 * chaque boutique connectée à chaque fiche corrigée. Le nombre de tranches est
 * le coût en lectures d'un chargement ; la taille d'une tranche est le volume
 * envoyé par modification. 64 garde les deux bas.
 *
 * ⚠ UNE ENTRÉE PORTE TOUS LES CHAMPS QUE L'APPLICATION LIT, ET C'EST UNE
 *   QUESTION DE DONNÉES, PAS DE CONFORT. Le formulaire de modification se
 *   pré-remplit depuis la fiche de la liste (`Clients.jsx`, `initialData`) puis
 *   réécrit chaque champ. Un champ absent de l'entrée serait réécrit vide : la
 *   modification EFFACERAIT la donnée. TC-340 vérifie que chaque champ du
 *   formulaire et de l'export est ici.
 *
 * ⚠ LES CLÉS PRÉSENTES SONT RECOPIÉES TELLES QUELLES, VIDES COMPRIS.
 *   `champsAgent` (src/utils/agentFields.js) décide sur la PRÉSENCE des clés
 *   `codeAgent`/`numeroAgent` : une clé vide qui disparaîtrait ferait relire
 *   l'ancien champ `orange`, et afficher un code que la fiche n'a plus.
 */

export const COLLECTION_ANNUAIRE = 'annuaireClients'

/** Le document qui dit si l'annuaire est complet. Écrit en dernier. */
export const DOC_ETAT = '_etat'

export const NOMBRE_TRANCHES = 64

export const CHAMPS_ANNUAIRE = Object.freeze([
  'nom', 'prenom', 'numeroIdentite', 'numeroPersonnel',
  'codeAgent', 'numeroAgent', 'orange',
  'moov', 'telecel', 'coris', 'sank',
  'localite', 'agentCommercial',
  'registeredStoreId', 'registeredStoreName',
  'dateAjout', 'createdAt',
])

/**
 * La tranche d'une fiche, toujours la même pour un même identifiant (FNV-1a).
 * Elle ne dépend que de l'identifiant : une fiche ne change jamais de tranche.
 */
export function trancheDe(clientId) {
  let empreinte = 0x811c9dc5
  for (let i = 0; i < clientId.length; i += 1) {
    empreinte ^= clientId.charCodeAt(i)
    empreinte = Math.imul(empreinte, 0x01000193) >>> 0
  }
  return `t${String(empreinte % NOMBRE_TRANCHES).padStart(2, '0')}`
}

/** Ce que l'annuaire garde d'une fiche : les champs lus, et eux seuls. */
export function entreeAnnuaire(donnees = {}) {
  const entree = {}
  for (const champ of CHAMPS_ANNUAIRE) {
    if (Object.prototype.hasOwnProperty.call(donnees, champ) && donnees[champ] !== undefined) {
      entree[champ] = donnees[champ]
    }
  }
  return entree
}

/** Les fiches, réparties : `Map<idTranche, { [clientId]: entrée }>`, tranches vides comprises. */
export function construireTranches(fiches) {
  const tranches = new Map()
  for (let n = 0; n < NOMBRE_TRANCHES; n += 1) tranches.set(`t${String(n).padStart(2, '0')}`, {})
  for (const { id, donnees } of fiches) {
    tranches.get(trancheDe(id))[id] = entreeAnnuaire(donnees)
  }
  return tranches
}

/**
 * Tient l'annuaire à jour après toute écriture sur `globalClients/{clientId}`.
 *
 * ⚠ LA FICHE EST RELUE, L'ÉVÉNEMENT NE SERT QU'À SAVOIR LAQUELLE. Les
 *   événements Firestore peuvent arriver dans le désordre ou en double. Écrire
 *   `event.data.after` laisserait un événement en retard remplacer une version
 *   plus récente. Relire l'état courant rend chaque passage juste, quel que
 *   soit l'ordre : une lecture de plus par fiche modifiée, quelques dizaines
 *   par jour.
 *
 * ⚠ `mergeFields` ET NON `merge: true`. Une fusion profonde garderait dans
 *   l'entrée un champ retiré de la fiche ; le chemin `entrees.<id>` est
 *   remplacé en entier.
 */
export async function majAnnuaireClientsHandler(event, { db, FieldValue, FieldPath }) {
  const clientId = event?.params?.clientId
  if (typeof clientId !== 'string' || clientId.length === 0) return { ignore: true }

  const fiche = await db.collection('globalClients').doc(clientId).get()
  const tranche = db.collection(COLLECTION_ANNUAIRE).doc(trancheDe(clientId))
  const majLe = FieldValue.serverTimestamp()

  if (fiche.exists) {
    await tranche.set(
      { entrees: { [clientId]: entreeAnnuaire(fiche.data()) }, majLe },
      { mergeFields: [new FieldPath('entrees', clientId), 'majLe'] },
    )
    return { ecrit: clientId }
  }

  await tranche.set({ entrees: { [clientId]: FieldValue.delete() }, majLe }, { merge: true })
  return { retire: clientId }
}

/**
 * Reconstruit l'annuaire entier depuis `globalClients`.
 *
 * Sert au PREMIER REMPLISSAGE, puis à toute réparation. Coût : une lecture par
 * fiche (~15 700) et `NOMBRE_TRANCHES` + 1 écritures. Lancée par un humain
 * (docs/rester-dans-le-quota-gratuit.md §A1), jamais par l'application.
 *
 * ⚠ À LANCER QUAND PERSONNE NE SAISIT. Une fiche modifiée entre la lecture de
 *   la base et l'écriture des tranches serait écrasée par sa version lue ; le
 *   déclencheur ne la rattrapera qu'à sa prochaine modification. Relancer la
 *   reconstruction répare.
 *
 * ⚠ `_etat` EST ÉCRIT EN DERNIER. Le navigateur ne lit l'annuaire que si cet
 *   état dit `complet` ; avant, il garde l'écoute de `globalClients`. Un
 *   remplissage interrompu laisse donc l'application sur l'ancien chemin, pas
 *   sur une liste tronquée.
 */
export async function reconstruireAnnuaireClientsHandler({ db, FieldValue }) {
  const base = await db.collection('globalClients').get()
  const tranches = construireTranches(base.docs.map((d) => ({ id: d.id, donnees: d.data() })))
  const majLe = FieldValue.serverTimestamp()

  // Par lots de 16 : une tranche pèse quelques dizaines de Ko, et une requête
  // d'écriture est limitée à 10 Mio. Le lot reste loin de la limite.
  const ids = [...tranches.keys()]
  for (let i = 0; i < ids.length; i += 16) {
    const lot = db.batch()
    for (const id of ids.slice(i, i + 16)) {
      lot.set(db.collection(COLLECTION_ANNUAIRE).doc(id), { entrees: tranches.get(id), majLe })
    }
    await lot.commit()
  }

  await db.collection(COLLECTION_ANNUAIRE).doc(DOC_ETAT).set({
    complet: true,
    tranches: NOMBRE_TRANCHES,
    fiches: base.size,
    construitLe: majLe,
  })

  return { fiches: base.size, tranches: NOMBRE_TRANCHES }
}
