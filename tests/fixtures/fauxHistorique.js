/**
 * Un faux historique de boutique, pour monter le vrai `TransactionsProvider`.
 *
 * Il sert les sources du lot G1 (docs/rester-dans-le-quota-gratuit.md §G) à
 * partir des mêmes lignes : la journée (`subscribeToHistory` avec une plage),
 * les validées et les supprimées depuis un instant, les ravitaillements dus, et
 * la lecture unique d'une période (`getHistoryBetween`).
 *
 * Il trie comme Firestore (`createdAt` décroissant, puis identifiant
 * décroissant) et rejoue chaque écoute à chaque changement, comme le ferait un
 * `onSnapshot`.
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

export function fauxHistorique(lignes) {
  let serveur = [...lignes]
  const ecoutes = new Set()
  const ms = (l) => l.createdAt.toMillis()
  const trier = (liste) => [...liste].sort((a, b) => (ms(b) - ms(a)) || (a.id > b.id ? -1 : 1))
  const depuis = (champ, instant) => trier(serveur).filter((l) => l[champ] && l[champ].toMillis() >= instant.getTime())

  const ecouter = (calculer, emettre) => {
    const ecoute = () => emettre(calculer())
    ecoutes.add(ecoute)
    ecoute()
    return () => ecoutes.delete(ecoute)
  }
  const rejouer = () => act(() => { for (const ecoute of [...ecoutes]) ecoute() })

  const api = {
    subscribeToDrafts: vi.fn((cb) => { cb([]); return () => {} }),
    subscribeToHistory: vi.fn((cb, filtres = {}) => ecouter(() => {
      let liste = trier(serveur)
      const plage = filtres.dateRange
      if (plage?.start) liste = liste.filter((l) => ms(l) >= plage.start.getTime())
      if (plage?.endExclusive) liste = liste.filter((l) => ms(l) < plage.endExclusive.getTime())
      return filtres.limitCount === null ? liste : liste.slice(0, filtres.limitCount ?? 100)
    }, cb)),
    subscribeToValidatedSince: vi.fn((cb, instant) => ecouter(() => depuis('validatedAt', instant), cb)),
    subscribeToDeletedSince: vi.fn((cb, instant) => ecouter(() => depuis('deletedAt', instant), cb)),
    subscribeToOpenReplenishments: vi.fn((cb) => ecouter(
      () => trier(serveur).filter((l) => l.replenishmentStatus === 'open'),
      cb,
    )),
    getHistoryBetween: vi.fn(async ({ start, endExclusive }) => trier(serveur)
      .filter((l) => ms(l) >= start.getTime() && ms(l) < endExclusive.getTime())),
  }

  return {
    api,
    ajouter: (l) => { serveur = [...serveur, l]; return rejouer() },
    modifier: (id, champs) => {
      serveur = serveur.map((l) => (l.id === id ? { ...l, ...champs } : l))
      return rejouer()
    },
  }
}
