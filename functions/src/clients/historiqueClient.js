/**
 * historiqueClient.js — ce qu'une boutique voit du travail d'une autre.
 *
 * PUR : aucune I/O, aucun Firestore. `listClientHistory.js` apporte les
 * documents ; ce module decide ce qu'ils deviennent. Meme separation que
 * `aggregateOutstandingDrafts`, et pour la meme raison : une lecture qui
 * traverse la frontiere entre boutiques doit etre eprouvable cas par cas.
 *
 * CE MODULE NE PEUT RIEN IMPORTER DE `src/`. Le dossier `functions/` est
 *   deploye seul : un import vers l application casserait le deploiement. D ou
 *   la reimplementation de `montantRestant`, qui existe aussi dans
 *   `src/utils/argentDehors.js`. `listOutstandingDrafts.js` fait de meme.
 */

/** Les mouvements de la BOUTIQUE, qui ne sont pas des operations d'agent. */
export const TYPES_MOUVEMENT_BOUTIQUE = Object.freeze(['ravitaillement', 'cloture'])

/**
 * Les ecritures du type rencontrees en base.
 *
 * « Depot » ET « Depot » COEXISTENT, et ce n'est pas une hypothese :
 *   `src/utils/caisse.js` plie deja les accents pour cette raison exacte. Toute
 *   comparaison directe en manquerait la moitie.
 */
export const VARIANTES_DEPOT = Object.freeze(['Depot', 'Depot', 'depot', 'depot', 'DEPOT', 'DEPOT'])
export const VARIANTES_RETRAIT = Object.freeze(['Retrait', 'retrait', 'RETRAIT'])

/** Accents et casse retires — « Depot » et « Depot » deviennent « depot ». */
export const plierType = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase()

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Le montant qu'une non terminee laisse reellement dehors.
 *
 * `remainingAmount` fait autorite des qu'il est lisible : il vaut 0 sur une
 * transaction soldee. On ne retombe sur `montant` que s'il est absent.
 */
export function montantRestant(ligne) {
  if (estNombre(ligne?.remainingAmount)) return ligne.remainingAmount
  if (estNombre(ligne?.montant)) return ligne.montant
  return null
}

/** Un Timestamp Firestore, une Date ou une chaine, ramenes en millisecondes. */
const enMillisecondes = (brut) => {
  if (!brut) return 0
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  const t = date.getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * L'instant de la DERNIERE ACTION — c'est lui qui classe.
 *
 * Une operation notee le matin et validee le soir garde le `createdAt` du
 * brouillon : le serveur le recopie tel quel. Classee la-dessus, elle
 * reapparaîtrait au milieu de la matinee alors qu'on vient de la traiter.
 * Meme regle que `src/context/transactions.jsx`.
 */
export const instantDerniereAction = (ligne) => Math.max(
  Number(ligne?.createdAt) || 0,
  Number(ligne?.validatedAt) || 0,
)

/** « clients/store-a/history/h1 » → « store-a ». Null si le chemin n'a pas cette forme. */
const boutiqueDuChemin = (chemin) => {
  const morceaux = String(chemin ?? '').split('/')
  return morceaux.length >= 2 && morceaux[0] === 'clients' ? morceaux[1] : null
}

/**
 * Une ligne affichable, ou `null` si le document n'en est pas une.
 *
 * LA BOUTIQUE VIENT DU CHEMIN. `storeName` recopie dans le document peut
 *   dater d'un renommage ; le chemin, lui, ne ment pas. Le nom est resolu
 *   depuis `stores`, puis depuis le champ recopie, puis depuis l'identifiant —
 *   une boutique fermee reste nommee par quelque chose plutot que par rien.
 */
export function ligneDeDocument({ id, chemin, donnees = {}, source, nomsDeBoutique }) {
  const type = plierType(donnees.type)
  if (TYPES_MOUVEMENT_BOUTIQUE.includes(type)) return null

  const storeId = boutiqueDuChemin(chemin)
  const storeName = (storeId && nomsDeBoutique?.get?.(storeId))
    || String(donnees.storeName ?? '').trim()
    || storeId
    || '—'

  return {
    id,
    source,
    storeId,
    storeName,
    type: donnees.type ?? '',
    typePlie: type,
    montant: estNombre(donnees.montant) ? donnees.montant : null,
    reste: montantRestant(donnees),
    statut: donnees.statut ?? '',
    reseau: donnees.reseau ?? '',
    code: donnees.code ?? '',
    date: donnees.date ?? '',
    createdAt: enMillisecondes(donnees.createdAt),
    validatedAt: enMillisecondes(donnees.validatedAt),
    deletedAt: enMillisecondes(donnees.deletedAt) || null,
    paidAmount: estNombre(donnees.paidAmount) ? donnees.paidAmount : null,
    refundedAmount: estNombre(donnees.refundedAmount) ? donnees.refundedAmount : null,
    settlementStatus: donnees.settlementStatus ?? null,
    operatorName: donnees.operatorName ?? '',
  }
}

/**
 * Les deux sources, reunies et classees.
 *
 * LES NON TERMINEES SORTENT A PART. Ce sont des operations EN COURS, peu
 *   nombreuses, et ce qu'on vient voir en premier. Les melees a la liste paginee
 *   produirait un defaut visible : une non terminee vieille de trois mois
 *   s afficherait des la premiere page, puis se ferait depasser par des lignes
 *   plus recentes a chaque « charger plus ».
 */
export function construireHistoriqueClient({ history = [], drafts = [], nomsDeBoutique = new Map() } = {}) {
  const convertir = (documents, source) => documents
    .map((d) => ligneDeDocument({ ...d, source, nomsDeBoutique }))
    .filter(Boolean)

  const enCours = convertir(drafts, 'draft')
    .sort((a, b) => instantDerniereAction(b) - instantDerniereAction(a))
  const lignes = convertir(history, 'history')
    .sort((a, b) => instantDerniereAction(b) - instantDerniereAction(a))

  const attente = { resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: enCours.length }
  for (const ligne of enCours) {
    const reste = Number(ligne.reste) || 0
    if (ligne.typePlie === 'depot') attente.resteAEncaisser += reste
    else if (ligne.typePlie === 'retrait') attente.resteAPayer += reste
  }

  return { enCours, lignes, attente }
}
