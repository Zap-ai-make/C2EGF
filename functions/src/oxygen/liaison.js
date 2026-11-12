/**
 * liaison.js — les règles de la liaison Oxygen, sans Firestore.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.2.
 * PUR : aucune I/O. `genererCodeLiaison.js` et `pointEntreeOxygen.js` apportent
 * les documents ; ce module décide. Même séparation que `historiqueClient.js`,
 * et pour la même raison : une décision qui ouvre l'activité d'un agent à un
 * compte extérieur doit être éprouvable cas par cas (TC-376).
 *
 * ⚠ CE MODULE NE PEUT RIEN IMPORTER DE `src/`. Le dossier `functions/` est
 *   déployé seul. D'où la réimplémentation de `champsAgent`
 *   (src/utils/agentFields.js), qui doit rester son reflet exact.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Un code de liaison vit quinze minutes (contrat §5.1). */
export const DUREE_CODE_MS = 15 * 60 * 1000

/** Au cinquième échec, le code de la fiche est annulé (contrat §5.2). */
export const ECHECS_MAX = 5

/** Huit chiffres : un numéro agent. Sinon, un code agent. */
const LONGUEUR_NUMERO_AGENT = 8

const texte = (valeur) => String(valeur ?? '').trim()

/** Les chiffres seuls : c'est la forme sous laquelle Oxygen envoie l'identifiant. */
export const chiffres = (valeur) => texte(valeur).replace(/\D/g, '')

/**
 * Le code agent et le numéro agent d'une fiche, qu'elle date d'avant ou d'après
 * la séparation des deux champs.
 *
 * ⚠ LA PRÉSENCE DES CLÉS DÉCIDE, PAS LEUR VALEUR — exactement comme
 *   `champsAgent`. Une case vidée exprès reste vide : relire `orange` ferait
 *   ressurgir un identifiant que la fiche n'a plus.
 */
export function champsAgentFiche(fiche) {
  if (!fiche || typeof fiche !== 'object') return { codeAgent: '', numeroAgent: '' }
  if ('codeAgent' in fiche || 'numeroAgent' in fiche) {
    return { codeAgent: texte(fiche.codeAgent), numeroAgent: texte(fiche.numeroAgent) }
  }
  const brut = texte(fiche.orange)
  if (!brut) return { codeAgent: '', numeroAgent: '' }
  return chiffres(brut).length === LONGUEUR_NUMERO_AGENT
    ? { codeAgent: '', numeroAgent: brut }
    : { codeAgent: brut, numeroAgent: '' }
}

/**
 * La clé du verrou « un seul compte actif par code agent ».
 *
 * ⚠ TIRÉE DE LA FICHE, JAMAIS DE LA SAISIE. Un agent qui se relierait une fois
 *   par son code et une fois par son numéro obtiendrait sinon deux clés pour le
 *   même point de vente, donc deux titulaires actifs.
 *
 * @returns {string|null} null si la fiche ne porte aucun identifiant agent
 */
export function cleVerrou(fiche) {
  const { codeAgent, numeroAgent } = champsAgentFiche(fiche)
  return chiffres(codeAgent) || chiffres(numeroAgent) || null
}

/**
 * L'identifiant saisi est-il celui de cette fiche ?
 *
 * ⚠ LES TROIS CHAMPS, COMME LE GARDE-FOU ANTI-DOUBLON (`_refuserDoublonAgent`).
 *   Presque toute la base date d'avant la séparation : sans `orange`, elle
 *   serait introuvable.
 */
export function ficheCorrespond(fiche, identifiant) {
  const cherche = chiffres(identifiant)
  if (!cherche || !fiche) return false
  return [fiche.codeAgent, fiche.numeroAgent, fiche.orange].some((v) => chiffres(v) === cherche)
}

/** Six chiffres tirés par le générateur cryptographique, zéros de tête compris. */
export const genererCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

/**
 * L'empreinte d'un code, liée à sa fiche : le même code ne vaut rien ailleurs.
 *
 * ⚠ CE N'EST PAS CE QUI PROTÈGE LE CODE. Un million de possibilités se
 *   parcourent en un instant à partir de l'empreinte. Ce qui le protège, c'est
 *   que la collection est fermée par les règles, qu'il ne vit que quinze minutes,
 *   et que le cinquième échec l'annule. L'empreinte évite seulement qu'un code
 *   encore valable se LISE tel quel dans la console ou dans une sauvegarde.
 */
export const hacherCode = (clientId, code) =>
  createHash('sha256').update(`${clientId}:${code}`).digest('hex')

const memeEmpreinte = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** Un Timestamp Firestore, une Date ou un nombre, ramenés en millisecondes. */
export const enMs = (valeur) => {
  if (!valeur) return 0
  if (typeof valeur.toMillis === 'function') return valeur.toMillis()
  if (valeur instanceof Date) return valeur.getTime()
  return typeof valeur === 'number' ? valeur : 0
}

/**
 * Ce que vaut un code saisi, face au document du code de la fiche.
 *
 * L'ordre suit le contrat : un code déjà consommé l'est quoi qu'il arrive, un
 * code annulé l'est même si le bon code arrive après, et l'expiration ne se
 * regarde que sur un code par ailleurs valable.
 *
 * ⚠ LE REJEU N'EST PAS UN DOUBLE USAGE. Le serveur Oxygen réessaie une fois
 *   après une panne : si la première tentative avait abouti, il doit recevoir la
 *   même réponse, pas « déjà utilisé » — l'agent se croirait refusé alors qu'il
 *   est relié. Un rejeu, c'est le même code, le même compte, le même objet.
 *
 * @param {object|null} doc  le document `codesLiaisonOxygen/{clientId}`
 * @param {{empreinte: string, compteOxygen: string, objet: 'liaison'|'code_secret', maintenantMs: number}} saisie
 * @returns {{accepte: true} | {rejoue: true} | {refus: string, echecs?: number, epuise?: true}}
 */
export function verifierCode(doc, { empreinte, compteOxygen, objet, maintenantMs }) {
  if (!doc) return { refus: 'code_incorrect' }

  const echecs = Number.isInteger(doc.echecs) ? doc.echecs : 0
  const utilise = Boolean(doc.utiliseLe)
  const expire = enMs(doc.expireLe) <= maintenantMs

  if (memeEmpreinte(empreinte, doc.codeHache)) {
    if (utilise) {
      return doc.utilisePar === compteOxygen && doc.objet === objet
        ? { rejoue: true }
        : { refus: 'code_deja_utilise' }
    }
    if (echecs >= ECHECS_MAX) return { refus: 'code_annule' }
    if (expire) return { refus: 'code_expire' }
    return { accepte: true }
  }

  if (memeEmpreinte(empreinte, doc.hachePrecedent)) return { refus: 'code_annule' }

  // Un échec ne se compte que sur un code encore vivant : sur un code mort, il
  // n'y a plus rien à protéger, et rien à écrire.
  if (utilise || expire || echecs >= ECHECS_MAX) return { refus: 'code_incorrect' }
  const apres = echecs + 1
  return apres >= ECHECS_MAX
    ? { refus: 'code_annule', echecs: apres, epuise: true }
    : { refus: 'code_incorrect', echecs: apres }
}

/**
 * Une opération appartient-elle aux périodes de ce compte ?
 *
 * Elle se juge sur le moment où elle a EU LIEU (`createdAt`, qui vaut le moment
 * de la saisie pour une opération partie en retard) : début inclus, fin exclue.
 * Une opération sans date n'appartient à personne plutôt qu'à tout le monde.
 *
 * @param {number} instantMs
 * @param {Array<{debutLe: any, finLe: any}>} periodes
 */
export function dansLesPeriodes(instantMs, periodes) {
  if (!Number.isFinite(instantMs) || instantMs <= 0) return false
  return periodes.some(({ debutLe, finLe }) =>
    instantMs >= enMs(debutLe) && (!finLe || instantMs < enMs(finLe)))
}
