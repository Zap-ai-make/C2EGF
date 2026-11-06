/**
 * stockageEnvois.js — la file d'envoi écrite sur l'appareil (lot G3b).
 *
 * ⚠ UNE BASE PAR COMPTE ET PAR PROJET. Une opération part sous le compte qui
 *   l'a saisie : le serveur en tire l'opérateur et la boutique. Une file
 *   partagée enverrait les saisies d'une caissière sous le nom de la suivante.
 *
 * ⚠ SANS INDEXEDDB, LA FILE VIT EN MÉMOIRE. Elle marche le temps de la
 *   session, réseau compris, mais une opération en attente ne survivrait pas à
 *   un rechargement. Le cas est rare (navigation privée de certains
 *   navigateurs) et signalé en console, jamais bloquant.
 */

const VERSION_BASE = 1
const MAGASIN = 'operations'

const enPromesse = (demande) => new Promise((resolve, reject) => {
  demande.onsuccess = () => resolve(demande.result)
  demande.onerror = () => reject(demande.error)
})

const finDe = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error ?? new Error('Transaction annulée'))
})

const parOrdre = (a, b) => (a.creeLe - b.creeLe) || (a.sequence - b.sequence)

/** Une file en mémoire, au même contrat. Sert aussi aux tests. */
export function stockageEnMemoire() {
  const operations = new Map()
  let sequence = 0
  return {
    async lister() { return [...operations.values()].sort(parOrdre).map((op) => ({ ...op })) },
    async ajouter(op) { operations.set(op.id, { ...op, sequence: (sequence += 1) }) },
    async modifier(id, champs) {
      const op = operations.get(id)
      if (op) operations.set(id, { ...op, ...champs })
    },
    async retirer(id) { operations.delete(id) },
  }
}

/**
 * @param {{ projet: string, uid: string, indexedDB?: IDBFactory }} options
 */
export function ouvrirStockageEnvois({ projet, uid, indexedDB = globalThis.indexedDB }) {
  if (!indexedDB) {
    console.warn('IndexedDB indisponible : la file d’envoi ne survivra pas à un rechargement.')
    return stockageEnMemoire()
  }

  let base = null
  const ouvrir = () => {
    if (!base) {
      base = new Promise((resolve, reject) => {
        const demande = indexedDB.open(`c2egf-envois-${projet}-${uid}`, VERSION_BASE)
        demande.onupgradeneeded = () => demande.result.createObjectStore(MAGASIN, { keyPath: 'id' })
        demande.onsuccess = () => resolve(demande.result)
        demande.onerror = () => reject(demande.error)
      })
      base.catch(() => { base = null })
    }
    return base
  }

  const ecrire = async (geste) => {
    const db = await ouvrir()
    const transaction = db.transaction(MAGASIN, 'readwrite')
    geste(transaction.objectStore(MAGASIN))
    await finDe(transaction)
  }

  return {
    async lister() {
      const db = await ouvrir()
      const tout = await enPromesse(db.transaction(MAGASIN).objectStore(MAGASIN).getAll())
      return tout.sort(parOrdre)
    },
    // La séquence départage deux saisies de la même milliseconde : sans elle,
    // l'ordre d'envoi suivrait celui des identifiants, tirés au hasard.
    async ajouter(op) {
      await ecrire((magasin) => magasin.add({ ...op, sequence: performance.now() }))
    },
    async modifier(id, champs) {
      await ecrire((magasin) => {
        const lecture = magasin.get(id)
        lecture.onsuccess = () => {
          if (lecture.result) magasin.put({ ...lecture.result, ...champs })
        }
      })
    },
    async retirer(id) {
      await ecrire((magasin) => magasin.delete(id))
    },
  }
}
