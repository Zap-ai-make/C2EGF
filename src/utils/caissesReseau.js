/**
 * caissesReseau.js — l'échelle commune, le tri et la recherche des caisses.
 *
 * PUR (aucune I/O) → testable directement (tc-202).
 *
 * POURQUOI UNE ÉCHELLE COMMUNE, ET PAS UNE PAR LIGNE
 * ──────────────────────────────────────────────────
 * Une barre par ligne, chacune normalisée sur son propre maximum, donne
 * quatre-vingt-quatre dessins qui se ressemblent et ne se comparent pas : la
 * plus petite caisse du réseau y remplit sa barre autant que la plus grosse.
 * Or la question du dealer est justement comparative — QUI est court. Toutes
 * les barres partagent donc le même plafond, et le seuil bas tombe à la même
 * abscisse sur toute la liste : il devient un FILET VERTICAL continu, que l'œil
 * suit d'un bout à l'autre sans lire un seul chiffre.
 *
 * POURQUOI LE PLAFOND N'EST PAS LE MAXIMUM
 * ────────────────────────────────────────
 * Caler l'échelle sur la plus grosse caisse laisserait une seule boutique
 * décider du dessin des quatre-vingt-trois autres : un jour à 12 000 000 chez
 * Zorgho écrase tout le reste dans les premiers pour-cent, et l'écran ne dit
 * plus rien. Le plafond se prend au neuvième décile, arrondi à un nombre
 * lisible — les rares caisses au-dessus portent un CRAN, et leur montant
 * reste écrit en toutes lettres à côté. On perd la longueur exacte de trois
 * barres ; on garde la lisibilité des quatre-vingt-une autres.
 */

import { DEALER_SEUIL_BAS } from '../constants/dealerConstants'

/**
 * Arrondit au multiple supérieur d'un demi-ordre de grandeur.
 * 2 940 000 → 3 000 000 · 410 000 → 450 000 · 84 000 → 100 000.
 *
 * L'epsilon n'est pas de la superstition : `3e6 / 5e5` vaut 6.000000000000001
 * en binaire, et sans lui un plafond déjà rond serait poussé au cran suivant.
 */
export function arrondiLisible(valeur) {
  if (!(valeur > 0) || !Number.isFinite(valeur)) return 0
  const pas = 10 ** Math.floor(Math.log10(valeur)) / 2
  return Math.ceil(valeur / pas - 1e-9) * pas
}

/** Le montant est-il exploitable pour l'échelle et le tri ? */
function estMontant(valeur) {
  return typeof valeur === 'number' && Number.isFinite(valeur)
}

/**
 * L'échelle partagée par toute la liste.
 *
 * @returns {{ plafond:number, seuil:number, depassements:number, mesures:number }}
 *   `depassements` = nombre de montants au-dessus du plafond (ceux qui portent
 *   un cran). `mesures` = nombre de montants lisibles ayant servi à la calculer.
 */
export function construireEchelle(caisses, seuil = DEALER_SEUIL_BAS) {
  const montants = []
  for (const caisse of caisses ?? []) {
    if (estMontant(caisse?.stock) && caisse.stock > 0) montants.push(caisse.stock)
    if (estMontant(caisse?.liquidite) && caisse.liquidite > 0) montants.push(caisse.liquidite)
  }
  montants.sort((a, b) => a - b)

  const decile9 = montants.length
    ? montants[Math.min(montants.length - 1, Math.ceil(montants.length * 0.9) - 1)]
    : 0

  // Le plafond ne descend jamais sous le double du seuil : en dessous, le filet
  // du seuil occuperait la moitié de la piste et ne signalerait plus rien.
  const plafond = Math.max(arrondiLisible(decile9), arrondiLisible(seuil * 2), 1)

  return {
    plafond,
    seuil,
    depassements: montants.filter(m => m > plafond).length,
    mesures: montants.length,
  }
}

/** Largeur d'une barre, en pour-cent de la piste. Bornée à 100. */
export function largeurBarre(montant, plafond) {
  if (!estMontant(montant) || !(plafond > 0) || montant <= 0) return 0
  return Math.min(100, (montant / plafond) * 100)
}

/** Le montant dépasse-t-il le plafond de l'échelle ? (→ le cran) */
export function depassePlafond(montant, plafond) {
  return estMontant(montant) && plafond > 0 && montant > plafond
}

/** Abscisse du filet de seuil, en pour-cent de la piste. */
export function positionSeuil(seuil, plafond) {
  if (!(plafond > 0) || !(seuil > 0)) return 0
  return Math.min(100, (seuil / plafond) * 100)
}

// ---------------------------------------------------------------------------
// Tri — côté client, sur les caisses déjà ramenées par la requête unique de S2.
// Aucune requête supplémentaire : trier 84 lignes en mémoire coûte moins qu'un
// aller-retour réseau, et Firestore ne saurait de toute façon pas trier sur un
// champ qui vit dans une AUTRE collection que celle qui porte les noms.
// ---------------------------------------------------------------------------

export const TRIS = Object.freeze([
  { id: 'nom-asc',        cle: 'name',      sens: 'asc',  label: 'Nom (A → Z)',        annonce: 'Trié par nom, de A à Z' },
  { id: 'stock-asc',      cle: 'stock',     sens: 'asc',  label: 'Stock croissant',    annonce: 'Trié par stock, du plus bas au plus haut' },
  { id: 'stock-desc',     cle: 'stock',     sens: 'desc', label: 'Stock décroissant',  annonce: 'Trié par stock, du plus haut au plus bas' },
  { id: 'liquidite-asc',  cle: 'liquidite', sens: 'asc',  label: 'Liquidité croissante',   annonce: 'Trié par liquidité, du plus bas au plus haut' },
  { id: 'liquidite-desc', cle: 'liquidite', sens: 'desc', label: 'Liquidité décroissante', annonce: 'Trié par liquidité, du plus haut au plus bas' },
])

export const TRI_DEFAUT = 'nom-asc'

/** Le tri demandé, ou celui par défaut si l'identifiant est inconnu. */
export function triParId(id) {
  return TRIS.find(t => t.id === id) ?? TRIS[0]
}

const comparerNoms = (a, b) =>
  String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'fr')

/**
 * Trie une copie de la liste. L'original n'est jamais muté : il vient du
 * service, et un tri qui réordonne sa source rendrait le rendu dépendant de
 * l'ordre des rendus précédents.
 *
 * ⚠ Un montant INCONNU (`null`) part toujours en fin de liste, dans les deux
 *   sens. Le faire remonter en tête d'un tri croissant le ferait passer pour la
 *   caisse la plus basse du réseau — exactement l'erreur de lecture qu'un
 *   dealer paierait en envoyant du stock là où il n'en manque pas.
 */
export function trierCaisses(caisses, triId = TRI_DEFAUT) {
  const tri = triParId(triId)
  const facteur = tri.sens === 'desc' ? -1 : 1

  return [...(caisses ?? [])].sort((a, b) => {
    if (tri.cle === 'name') return facteur * comparerNoms(a, b)

    const va = a?.[tri.cle]
    const vb = b?.[tri.cle]
    const aLisible = estMontant(va)
    const bLisible = estMontant(vb)

    if (!aLisible && !bLisible) return comparerNoms(a, b)
    if (!aLisible) return 1
    if (!bLisible) return -1
    if (va === vb) return comparerNoms(a, b)
    return facteur * (va - vb)
  })
}

// ---------------------------------------------------------------------------
// Recherche — sur les 84, pas sur une page
// ---------------------------------------------------------------------------

/** Minuscules, sans accent : « Koupéla » se trouve en tapant « koupela ». */
export function normaliser(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function filtrerCaisses(caisses, terme) {
  const cible = normaliser(terme).trim()
  if (!cible) return caisses ?? []
  return (caisses ?? []).filter(c => normaliser(c?.name).includes(cible))
}
