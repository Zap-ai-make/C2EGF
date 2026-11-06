/**
 * copieAnnuaire.js — l'annuaire des clients gardé sur l'appareil (lot G2).
 *
 * POURQUOI UNE BASE À PART, ET PAS LE CACHE DE FIRESTORE
 * ──────────────────────────────────────────────────────
 * Le cache de Firestore est plafonné à 40 Mo et se vide de lui-même : rien ne
 * garantit que l'annuaire (~5 Mo) y soit encore le lendemain matin. Et une
 * écoute reprise après 30 minutes est facturée comme une requête neuve : 65
 * lectures et ~5 Mo à chaque démarrage. Cette copie reste jusqu'à son
 * remplacement. Elle sert à afficher la liste sans réseau, et à ne demander
 * au serveur que ce qui a changé depuis (docs/rester-dans-le-quota-gratuit.md
 * §G2).
 *
 * ⚠ UNE BASE PAR PROJET FIREBASE. Les fiches des émulateurs et celles de la
 *   production ne se mêlent jamais, même dans le même navigateur.
 *
 * ⚠ UNE TRANCHE N'EST JAMAIS REMPLACÉE PAR UNE PLUS ANCIENNE. Deux onglets
 *   écrivent ici chacun de leur côté. Sans cette garde, un onglet en retard
 *   ramènerait une tranche à une version passée, alors que la copie, par son
 *   `majLe` le plus récent, croirait la connaître : la modification serait
 *   perdue jusqu'à la suivante.
 *
 * ⚠ UNE COPIE N'EST LUE QUE SI ELLE EST COMPLÈTE. L'enregistrement complet
 *   pose sa marque dans la même transaction que les tranches : une écriture
 *   interrompue ne laisse rien, et une copie partielle n'est jamais affichée
 *   comme la base entière.
 */

import { comparerHorodatages } from './annuaireClients.js'

const VERSION_BASE = 1
const MAGASIN = 'tranches'
const ID_COPIE = '_copie'
const HORODATAGE = '__horodatage'

const estHorodatage = (valeur) => valeur !== null && typeof valeur === 'object'
  && typeof valeur.toMillis === 'function'
  && Number.isInteger(valeur.seconds) && Number.isInteger(valeur.nanoseconds)

const transformerEntrees = (entrees, transformer) => {
  const resultat = {}
  for (const [clientId, entree] of Object.entries(entrees ?? {})) {
    const champs = {}
    for (const [champ, valeur] of Object.entries(entree)) champs[champ] = transformer(valeur)
    resultat[clientId] = champs
  }
  return resultat
}

/**
 * Une tranche, prête pour IndexedDB.
 *
 * ⚠ LES `Timestamp` SONT MARQUÉS. IndexedDB les rendrait en objets nus, sans
 *   `toMillis` : le tri des clients par date d'ajout (`ClientsContext.jsx`)
 *   retomberait sur `dateAjout`, et l'ordre de la liste changerait.
 */
export function versStockage({ id, majLe, entrees }) {
  return {
    id,
    majLe: majLe ? { seconds: majLe.seconds, nanoseconds: majLe.nanoseconds } : null,
    entrees: transformerEntrees(entrees, (valeur) => (
      estHorodatage(valeur) ? { [HORODATAGE]: [valeur.seconds, valeur.nanoseconds] } : valeur
    )),
  }
}

/** L'inverse de `versStockage` : les fiches telles que Firestore les rend. */
export function depuisStockage({ id, majLe, entrees }, Timestamp) {
  return {
    id,
    majLe,
    entrees: transformerEntrees(entrees, (valeur) => {
      const marque = valeur?.[HORODATAGE]
      return Array.isArray(marque) ? new Timestamp(marque[0], marque[1]) : valeur
    }),
  }
}

const enPromesse = (demande) => new Promise((resolve, reject) => {
  demande.onsuccess = () => resolve(demande.result)
  demande.onerror = () => reject(demande.error)
})

const finDe = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error ?? new Error('Transaction annulée'))
})

/**
 * La copie locale de l'annuaire, pour `ecouterAnnuaireGarde`.
 *
 * @param {{ projet: string, Timestamp: Function, indexedDB?: IDBFactory }} options
 * @returns {{ lire: () => Promise<null | { tranches: object[] }>, enregistrer: (tranches: object[], options?: { complete?: boolean }) => Promise<void> }}
 */
export function ouvrirCopieAnnuaire({ projet, Timestamp, indexedDB = globalThis.indexedDB }) {
  let base = null

  const ouvrir = () => {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB indisponible'))
    if (!base) {
      base = new Promise((resolve, reject) => {
        const demande = indexedDB.open(`c2egf-annuaire-${projet}`, VERSION_BASE)
        demande.onupgradeneeded = () => demande.result.createObjectStore(MAGASIN, { keyPath: 'id' })
        demande.onsuccess = () => resolve(demande.result)
        demande.onerror = () => reject(demande.error)
      })
      // Une ouverture ratée se retente à l'appel suivant.
      base.catch(() => { base = null })
    }
    return base
  }

  return {
    async lire() {
      const db = await ouvrir()
      const tout = await enPromesse(db.transaction(MAGASIN).objectStore(MAGASIN).getAll())
      const marque = tout.find((e) => e.id === ID_COPIE)
      const tranches = tout.filter((e) => e.id !== ID_COPIE)
      if (marque?.complete !== true || tranches.length < marque.tranches) return null
      return { tranches: tranches.map((e) => depuisStockage(e, Timestamp)) }
    },

    async enregistrer(tranches, { complete = false } = {}) {
      const db = await ouvrir()
      const transaction = db.transaction(MAGASIN, 'readwrite')
      const magasin = transaction.objectStore(MAGASIN)
      for (const tranche of tranches) {
        const lecture = magasin.get(tranche.id)
        lecture.onsuccess = () => {
          const connue = lecture.result
          if (connue?.majLe && tranche.majLe && comparerHorodatages(tranche.majLe, connue.majLe) < 0) return
          magasin.put(versStockage(tranche))
        }
      }
      if (complete) magasin.put({ id: ID_COPIE, complete: true, tranches: tranches.length })
      await finDe(transaction)
    },
  }
}
