/**
 * Doublure du service dealer — BANC D'ESSAI UNIQUEMENT.
 *
 * Elle rend **84 boutiques**, et c'est tout l'intérêt : le réseau réel de
 * C2EGF en compte plus de quatre-vingts, et un écran vérifié à trois lignes ne
 * prouve rien de ce qu'il promet à quatre-vingt-quatre. Densité, alignement des
 * montants, hauteur de la liste, comportement du seuil partagé — rien de tout
 * cela n'apparaît sur un jeu de démonstration.
 *
 * Même API que `src/services/dealerService.js`. Substituée par un alias Vite
 * posé uniquement par `scripts/lib/banc.mjs` ; `preview.html` n'est pas une
 * entrée de build, cette doublure ne peut pas atteindre la production.
 */

const LOCALITES = [
  'OUAGA CENTRE', 'POUYTENGA', 'KOUPELA', 'ZORGHO', 'FADA', 'KOUDOUGOU',
  'BOBO DIOULASSO', 'NIAOGHO', 'ZABRE', 'DIABO', 'MOGTEDO', 'KOMBISSIRI',
  'BEGUEDO', 'MEGUET', 'DIALGAYE', 'NEDOGO', 'KOAKIN', 'KOMSEOGO',
  'GOUNGHIN', 'TENKODOGO', 'MANGA', 'KAYA',
]

/** Variante demandée par l'URL : `?caisses=vide` ou `?caisses=erreur`. */
const variante =
  new URLSearchParams(globalThis.location?.search ?? '').get('caisses') ?? 'garni'

/**
 * 84 boutiques aux caisses plausibles. Le jeu est DÉTERMINISTE — pas de
 * `Math.random()` : une capture doit pouvoir se comparer à la précédente, et un
 * écart doit venir du code, jamais du tirage.
 *
 * Trois cas sont posés à la main, parce qu'ils portent chacun une décision de
 * dessin qu'on ne verrait pas autrement :
 *   • KOUDOUGOU  — à sec des deux côtés
 *   • ZORGHO     — dépasse le plafond d'échelle (le cran de débordement)
 *   • POUYTENGA  — l'inverse exact de ZORGHO : c'est l'appariement à voir
 */
const CAISSES_POSEES = {
  KOUDOUGOU: { stock: 90000, liquidite: 120000 },
  ZORGHO: { stock: 4180000, liquidite: 410000 },
  POUYTENGA: { stock: 180000, liquidite: 2940000 },
}

const boutiques = Array.from({ length: 84 }, (_, i) => {
  const base = LOCALITES[i % LOCALITES.length]
  const nom = i < LOCALITES.length ? base : `${base} ${Math.floor(i / LOCALITES.length) + 1}`
  const pose = CAISSES_POSEES[nom]
  return {
    id: `store-${i}`,
    name: nom,
    active: true,
    // Suite déterministe, étalée de ~50 000 à ~3 200 000.
    stock: pose ? pose.stock : 50000 + ((i * 137717) % 3150000),
    liquidite: pose ? pose.liquidite : 60000 + ((i * 241879) % 3040000),
  }
})

export async function listActiveStores({ lastDoc = null } = {}) {
  const debut = lastDoc ? Number(lastDoc.id) : 0
  const page = boutiques.slice(debut, debut + 20)
  const fin = debut + page.length
  return {
    stores: page.map(({ id, name, active }) => ({ id, name, active })),
    lastDoc: fin < boutiques.length ? { id: String(fin) } : null,
    hasMore: fin < boutiques.length,
  }
}

export async function getStoreBalances(storeId) {
  const b = boutiques.find(x => x.id === storeId)
  if (!b) return { balances: {} }
  return { balances: { Orange: { stock: b.stock, liquidite: b.liquidite } } }
}

export async function listNetworkCaisses() {
  if (variante === 'erreur') throw new Error('Service temporairement indisponible. Réessayez.')
  if (variante === 'vide') {
    return { caisses: [], total: 0, sommeStock: 0, sommeLiquidite: 0, illisibles: 0 }
  }

  // Une caisse illisible dans le lot : l'état « partiel » doit pouvoir se
  // regarder, c'est celui où un total incomplet risque de s'annoncer complet.
  const caisses = boutiques.map((b, i) => ({
    storeId: b.id,
    name: b.name,
    stock: i === 7 ? null : b.stock,
    liquidite: i === 7 ? null : b.liquidite,
  }))

  return {
    caisses,
    total: caisses.length,
    sommeStock: caisses.reduce((s, c) => s + (c.stock ?? 0), 0),
    sommeLiquidite: caisses.reduce((s, c) => s + (c.liquidite ?? 0), 0),
    illisibles: caisses.filter(c => c.stock === null || c.liquidite === null).length,
  }
}

const abonnement = (valeur) => ({ onUpdate }) => {
  onUpdate?.(valeur)
  return () => {}
}

export const subscribeDealerPendingCount = abonnement(4)

export async function listDealerRequests() {
  return { requests: [], lastDoc: null, hasMore: false }
}

export const subscribeDealerRequests = ({ onUpdate }) => {
  onUpdate?.({ requests: [], lastDoc: null, hasMore: false })
  return () => {}
}

export async function createDealerRequest() { return { id: 'banc' } }
export { parseStrictInteger as parseDealerAmount } from '../utils/parseStrictInteger'
