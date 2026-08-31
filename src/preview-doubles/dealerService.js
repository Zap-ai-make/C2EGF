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

/**
 * Variante demandée par l'URL — `?caisses=…` :
 *
 *   garni            (défaut) les 84, toutes lisibles
 *   vide             aucune boutique en service
 *   erreur           la lecture du réseau échoue
 *   erreur-partielle 3 caisses illisibles sur 84 — l'état où un total incomplet
 *                    risque le plus de s'annoncer complet
 *   clairseme        une seule boutique : l'échelle ne compare plus rien
 */
const variante =
  new URLSearchParams(globalThis.location?.search ?? '').get('caisses') ?? 'garni'

/** Les caisses illisibles de la variante `erreur-partielle`, par indice. */
const MUETTES = new Set([7, 31, 58])

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

/**
 * Le CHOIX complet, sans pagination — ce que lit le formulaire de
 * ravitaillement depuis S5. La doublure doit exposer la même API que le
 * service réel : un export manquant ici ne casserait pas les tests, seulement
 * le banc, et bien plus tard.
 */
export async function listAllActiveStores() {
  if (variante === 'erreur') throw new Error('Service temporairement indisponible. Réessayez.')
  if (variante === 'vide') return { stores: [] }
  const source = variante === 'clairseme' ? boutiques.slice(0, 1) : boutiques
  return { stores: source.map(({ id, name, active }) => ({ id, name, active })) }
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

  const source = variante === 'clairseme' ? boutiques.slice(0, 1) : boutiques
  const muet = variante === 'erreur-partielle'

  const caisses = source.map((b, i) => ({
    storeId: b.id,
    name: b.name,
    stock: muet && MUETTES.has(i) ? null : b.stock,
    liquidite: muet && MUETTES.has(i) ? null : b.liquidite,
  }))

  return {
    caisses,
    total: caisses.length,
    // Les totaux ignorent les caisses illisibles, exactement comme le service
    // réel : c'est `illisibles` qui dit que la somme est incomplète.
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
