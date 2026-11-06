/**
 * Un faux historique de boutique, pour monter le vrai `TransactionsProvider`.
 *
 * Il parle les deux langues du service : l'ancienne lecture de la première page
 * (`getHistoryPage` + `subscribeToHistory`) et la nouvelle
 * (`subscribeToHistoryWindow`, lot A3a). Les mêmes lignes servent les deux, si
 * bien qu'un test de comportement passe avant et après le lot (TC-344).
 *
 * Il trie comme Firestore (`createdAt` décroissant, puis identifiant
 * décroissant) et rejoue chaque écoute à chaque changement.
 *
 * `cache` simule la persistance : tant que `synchroniser()` n'a pas été appelé,
 * les écoutes répondent depuis ces lignes-là, et la fenêtre dit `fromCache`.
 * `getHistoryPage`, comme un `getDocs` en ligne, lit toujours le serveur.
 */

import { vi } from 'vitest'
import { act } from '@testing-library/react'

export const horodatage = (iso) => {
  const date = new Date(iso)
  return { toMillis: () => date.getTime(), toDate: () => date }
}

export const ligne = (id, iso, autres = {}) => ({
  id, type: 'Dépôt', montant: 1000, statut: 'Validée', createdAt: horodatage(iso), ...autres,
})

/** `nombre` lignes à `pasMinutes` d'écart, la première à `depuis`, puis en remontant. */
export const serie = (prefixe, nombre, depuis, pasMinutes = 10) => Array.from({ length: nombre }, (_, i) => ligne(
  `${prefixe}${String(i).padStart(3, '0')}`,
  new Date(new Date(depuis).getTime() - i * pasMinutes * 60_000).toISOString(),
))

export function fauxHistorique(lignes, { cache = null } = {}) {
  let serveur = [...lignes]
  let synchronise = cache === null
  const ecoutes = new Set()
  const ms = (l) => l.createdAt.toMillis()
  const trier = (liste) => [...liste].sort((a, b) => (ms(b) - ms(a)) || (a.id > b.id ? -1 : 1))
  const apres = (l, curseur) => ms(l) < curseur.ms || (ms(l) === curseur.ms && l.id < curseur.id)
  const curseurDe = (l) => (l ? { id: l.id, ms: ms(l) } : null)
  const courant = () => trier(synchronise ? serveur : cache)

  const ecouter = (calculer, emettre) => {
    const ecoute = () => emettre(calculer())
    ecoutes.add(ecoute)
    ecoute()
    return () => ecoutes.delete(ecoute)
  }
  const rejouer = () => act(() => { for (const ecoute of [...ecoutes]) ecoute() })

  const api = {
    subscribeToDrafts: vi.fn((cb) => { cb([]); return () => {} }),
    getHistoryPage: vi.fn(async ({ lastDoc = null, pageSize = 100 } = {}) => {
      const tout = trier(serveur)
      const reste = lastDoc ? tout.filter((l) => apres(l, lastDoc)) : tout
      const page = reste.slice(0, pageSize)
      return { transactions: page, lastDoc: curseurDe(page.at(-1)), hasMore: reste.length > pageSize }
    }),
    subscribeToHistory: vi.fn((cb, filtres = {}) => ecouter(() => {
      let liste = courant()
      const plage = filtres.dateRange
      if (plage?.start) liste = liste.filter((l) => ms(l) >= plage.start.getTime())
      if (plage?.endExclusive) liste = liste.filter((l) => ms(l) < plage.endExclusive.getTime())
      return filtres.limitCount === null ? liste : liste.slice(0, filtres.limitCount ?? 100)
    }, cb)),
    subscribeToHistoryWindow: vi.fn((cb, { pageSize = 100 } = {}) => ecouter(() => {
      const tout = courant()
      const page = tout.slice(0, pageSize)
      return { transactions: page, lastDoc: curseurDe(page.at(-1)), hasMore: tout.length > pageSize, fromCache: !synchronise }
    }, cb)),
    subscribeToValidatedSince: vi.fn((cb, depuis) => ecouter(
      () => courant().filter((l) => l.validatedAt && l.validatedAt.toMillis() >= depuis.getTime()),
      cb,
    )),
    subscribeToOpenReplenishments: vi.fn((cb) => ecouter(
      () => courant().filter((l) => l.replenishmentStatus === 'open'),
      cb,
    )),
  }

  return {
    api,
    ajouter: (l) => { serveur = [...serveur, l]; return rejouer() },
    modifier: (id, champs) => {
      serveur = serveur.map((l) => (l.id === id ? { ...l, ...champs } : l))
      return rejouer()
    },
    synchroniser: () => { synchronise = true; return rejouer() },
  }
}
